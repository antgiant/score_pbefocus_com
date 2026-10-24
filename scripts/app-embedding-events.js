/**
 * Embedding event bridge for iframe host integrations.
 *
 * Commands emit their own immediate events. This bridge observes normal app
 * interactions and Yjs changes so hosts also receive events for UI-driven,
 * imported, synced, or otherwise non-command mutations.
 */

var EmbeddingEvents = {
  initialized: false,
  globalSnapshot: null,
  sessionSnapshot: null,
  activeSessionDoc: null,
  activeSessionId: null,
  globalMeta: null,
  sessionNamesMap: null,
  globalObserver: null,
  sessionNamesObserver: null,
  sessionUpdateHandler: null,
  patchedUpdateDataElement: false,
  timers: {},
  suppressDiffUntil: 0,
  throttleMs: {
    "session:stateChanged": 100
  },
  lastEmitAt: {},

  init: function() {
    if (this.initialized) {
      return true;
    }
    if (typeof EmbeddingAPI === "undefined" || !EmbeddingAPI || typeof EmbeddingAPI.emit !== "function") {
      return false;
    }

    this.attachGlobalObservers();
    this.attachActiveSessionObserver();
    this.patchQuestionNavigation();
    this.initialized = true;
    return true;
  },

  resetForTests: function() {
    this.detachSessionObserver();
    this.detachGlobalObservers();
    this.initialized = false;
    this.globalSnapshot = null;
    this.sessionSnapshot = null;
    this.activeSessionDoc = null;
    this.activeSessionId = null;
    this.globalMeta = null;
    this.sessionNamesMap = null;
    this.globalObserver = null;
    this.sessionNamesObserver = null;
    this.sessionUpdateHandler = null;
    this.timers = {};
    this.suppressDiffUntil = 0;
    this.lastEmitAt = {};
  },

  getGlobal: function(name) {
    var root = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : null);
    if (root && root[name] !== undefined) {
      return root[name];
    }
    if (typeof window !== "undefined" && window[name] !== undefined) {
      return window[name];
    }
    return undefined;
  },

  callGlobal: function(name, args) {
    var fn = this.getGlobal(name);
    if (typeof fn !== "function") {
      return undefined;
    }
    return fn.apply((typeof window !== "undefined" ? window : null), args || []);
  },

  markCommandMutation: function() {
    this.suppressDiffUntil = Date.now() + 250;
  },

  shouldSuppressDiff: function() {
    return Date.now() < this.suppressDiffUntil;
  },

  debounce: function(key, callback, delay) {
    var self = this;
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
    }
    this.timers[key] = setTimeout(function() {
      delete self.timers[key];
      callback();
    }, delay);
  },

  emit: function(eventType, data, options) {
    options = options || {};
    if (!eventType || typeof EmbeddingAPI === "undefined" || !EmbeddingAPI) {
      return 0;
    }

    var throttleMs = options.throttleMs;
    if (throttleMs === undefined) {
      throttleMs = this.throttleMs[eventType] || 0;
    }

    if (throttleMs > 0) {
      var now = Date.now();
      var last = this.lastEmitAt[eventType] || 0;
      if (now - last < throttleMs) {
        var self = this;
        this.debounce("emit:" + eventType, function() {
          self.lastEmitAt[eventType] = Date.now();
          EmbeddingAPI.emit(eventType, data || {});
        }, throttleMs);
        return 0;
      }
      this.lastEmitAt[eventType] = now;
    }

    return EmbeddingAPI.emit(eventType, data || {});
  },

  emitStateChanged: function(reason) {
    this.emit("session:stateChanged", this.buildStatePayload(reason), { throttleMs: this.throttleMs["session:stateChanged"] });
  },

  buildStatePayload: function(reason) {
    var commandState = (typeof EmbeddingCommands !== "undefined" && EmbeddingCommands && typeof EmbeddingCommands.serializeActiveState === "function")
      ? EmbeddingCommands.serializeActiveState()
      : {};
    commandState.reason = reason || "stateChanged";
    commandState.timestamp = Date.now();
    return commandState;
  },

  attachGlobalObservers: function() {
    var getGlobalDoc = this.getGlobal("getGlobalDoc");
    if (typeof getGlobalDoc !== "function") {
      return false;
    }
    var doc = getGlobalDoc();
    if (!doc || typeof doc.getMap !== "function") {
      return false;
    }

    this.globalMeta = doc.getMap("meta");
    this.globalSnapshot = this.captureGlobalSnapshot();

    var self = this;
    this.globalObserver = function() {
      self.attachSessionNamesObserver();
      self.scheduleGlobalDiff();
    };
    this.globalMeta.observe(this.globalObserver);
    this.attachSessionNamesObserver();
    return true;
  },

  detachGlobalObservers: function() {
    if (this.globalMeta && this.globalObserver && typeof this.globalMeta.unobserve === "function") {
      this.globalMeta.unobserve(this.globalObserver);
    }
    if (this.sessionNamesMap && this.sessionNamesObserver && typeof this.sessionNamesMap.unobserve === "function") {
      this.sessionNamesMap.unobserve(this.sessionNamesObserver);
    }
  },

  attachSessionNamesObserver: function() {
    if (!this.globalMeta) {
      return;
    }
    var nextMap = this.globalMeta.get("sessionNames");
    if (nextMap === this.sessionNamesMap) {
      return;
    }
    if (this.sessionNamesMap && this.sessionNamesObserver && typeof this.sessionNamesMap.unobserve === "function") {
      this.sessionNamesMap.unobserve(this.sessionNamesObserver);
    }
    this.sessionNamesMap = nextMap;
    if (!nextMap || typeof nextMap.observe !== "function") {
      return;
    }
    var self = this;
    this.sessionNamesObserver = function() {
      self.scheduleGlobalDiff();
    };
    nextMap.observe(this.sessionNamesObserver);
  },

  scheduleGlobalDiff: function() {
    var self = this;
    this.debounce("globalDiff", function() {
      self.flushGlobalDiff();
    }, 50);
  },

  flushGlobalDiff: function() {
    var previous = this.globalSnapshot || this.captureGlobalSnapshot();
    var next = this.captureGlobalSnapshot();
    var suppressed = this.shouldSuppressDiff();

    if (!suppressed) {
      this.emitSessionListDiff(previous, next);
      this.emitUiPreferenceDiff(previous, next);
    }

    var activeChanged = previous.currentSessionId !== next.currentSessionId;
    this.globalSnapshot = next;
    if (activeChanged) {
      this.attachActiveSessionObserver();
    }
    if (!suppressed && activeChanged && next.currentSessionId) {
      this.emit("session:switched", {
        sessionId: next.currentSessionId,
        previousSessionId: previous.currentSessionId || null
      });
      this.emitStateChanged("session:switched");
    } else if (!suppressed && this.globalChanged(previous, next)) {
      this.emitStateChanged("global");
    }
  },

  captureGlobalSnapshot: function() {
    var result = {
      currentSessionId: this.globalMeta ? (this.globalMeta.get("currentSession") || null) : (this.callGlobal("get_current_session_id") || null),
      currentSessionIndex: this.callGlobal("get_current_session_index") || null,
      sessions: {},
      sessionOrder: [],
      themePreference: null,
      languagePreference: null
    };

    var sessionsPayload = (typeof EmbeddingCommands !== "undefined" && EmbeddingCommands && typeof EmbeddingCommands.getSessions === "function")
      ? EmbeddingCommands.getSessions()
      : { sessions: [] };
    for (var i = 0; i < sessionsPayload.sessions.length; i++) {
      var session = sessionsPayload.sessions[i];
      result.sessions[session.id] = {
        id: session.id,
        index: session.index,
        name: session.name
      };
      result.sessionOrder.push(session.id);
    }

    if (this.globalMeta) {
      result.themePreference = this.globalMeta.get("themePreference") || null;
      result.languagePreference = this.globalMeta.get("languagePreference") || null;
      var order = this.globalMeta.get("sessionOrder") || [];
      var index = order.indexOf(result.currentSessionId);
      result.currentSessionIndex = index >= 0 ? index + 1 : result.currentSessionIndex;
    }

    return result;
  },

  globalChanged: function(previous, next) {
    return previous.currentSessionId !== next.currentSessionId ||
      previous.themePreference !== next.themePreference ||
      previous.languagePreference !== next.languagePreference ||
      previous.sessionOrder.join("|") !== next.sessionOrder.join("|");
  },

  emitSessionListDiff: function(previous, next) {
    var previousSessions = previous.sessions || {};
    var nextSessions = next.sessions || {};
    var id;

    for (id in nextSessions) {
      if (!Object.prototype.hasOwnProperty.call(nextSessions, id)) {
        continue;
      }
      if (!previousSessions[id]) {
        this.emit("session:created", nextSessions[id]);
      } else if (previousSessions[id].name !== nextSessions[id].name) {
        this.emit("session:renamed", {
          sessionId: id,
          name: nextSessions[id].name,
          oldName: previousSessions[id].name
        });
      }
    }

    for (id in previousSessions) {
      if (Object.prototype.hasOwnProperty.call(previousSessions, id) && !nextSessions[id]) {
        this.emit("session:deleted", previousSessions[id]);
      }
    }
  },

  emitUiPreferenceDiff: function(previous, next) {
    if (previous.themePreference !== next.themePreference && next.themePreference) {
      this.emit("ui:themeChanged", {
        theme: next.themePreference,
        resolvedTheme: this.callGlobal("resolve_theme", [next.themePreference]) || next.themePreference
      });
    }
    if (previous.languagePreference !== next.languagePreference && next.languagePreference) {
      this.emit("ui:languageChanged", {
        preference: next.languagePreference,
        language: this.callGlobal("get_current_language") || next.languagePreference,
        availableLanguages: this.callGlobal("get_available_languages") || {}
      });
    }
  },

  attachActiveSessionObserver: function() {
    this.detachSessionObserver();

    var sessionId = this.callGlobal("get_current_session_id") || null;
    var getSessionDoc = this.getGlobal("getSessionDoc");
    var sessionDoc = typeof getSessionDoc === "function" && sessionId ? getSessionDoc(sessionId) : null;
    this.activeSessionId = sessionId;
    this.activeSessionDoc = sessionDoc;
    this.sessionSnapshot = this.captureSessionSnapshot();

    if (!sessionDoc || typeof sessionDoc.on !== "function") {
      return false;
    }

    var self = this;
    this.sessionUpdateHandler = function() {
      self.scheduleSessionDiff();
    };
    sessionDoc.on("update", this.sessionUpdateHandler);
    return true;
  },

  detachSessionObserver: function() {
    if (this.activeSessionDoc && this.sessionUpdateHandler && typeof this.activeSessionDoc.off === "function") {
      this.activeSessionDoc.off("update", this.sessionUpdateHandler);
    }
    this.sessionUpdateHandler = null;
  },

  scheduleSessionDiff: function() {
    var self = this;
    this.debounce("sessionDiff", function() {
      self.flushSessionDiff();
    }, 50);
  },

  flushSessionDiff: function() {
    var previous = this.sessionSnapshot || this.captureSessionSnapshot();
    var next = this.captureSessionSnapshot();
    var suppressed = this.shouldSuppressDiff();

    if (!suppressed) {
      this.emitActiveSessionDiff(previous, next);
    }

    this.sessionSnapshot = next;
  },

  captureSessionSnapshot: function() {
    var context = (typeof EmbeddingCommands !== "undefined" && EmbeddingCommands && typeof EmbeddingCommands.getActiveContext === "function")
      ? EmbeddingCommands.getActiveContext({ allowMissing: true })
      : null;
    var snapshot = {
      sessionId: context ? context.sessionId : null,
      name: null,
      questions: {},
      questionOrder: [],
      blocks: {},
      teams: {}
    };
    if (!context || !context.session) {
      return snapshot;
    }

    snapshot.name = context.session.get("name") || "";
    var questions = this.callGlobal("getOrderedQuestions", [context.session]) || [];
    var teams = this.callGlobal("getOrderedTeams", [context.session]) || [];
    var blocks = this.callGlobal("getOrderedBlocks", [context.session]) || [];
    var getTeamScore = this.getGlobal("getTeamScore");

    for (var t = 0; t < teams.length; t++) {
      snapshot.teams[teams[t].id] = {
        id: teams[t].id,
        index: t + 1,
        name: teams[t].data.get("name") || ""
      };
    }

    for (var b = 0; b < blocks.length; b++) {
      snapshot.blocks[blocks[b].id] = {
        id: blocks[b].id,
        index: b,
        name: blocks[b].data.get("name") || "",
        isDefault: blocks[b].data.get("isDefault") === true
      };
    }

    for (var q = 0; q < questions.length; q++) {
      var question = questions[q];
      var entry = {
        id: question.id,
        index: q + 1,
        name: question.data.get("name") || "",
        maxPoints: Number(question.data.get("score") || 0),
        blockId: question.data.get("blockId") || null,
        ignore: question.data.get("ignore") === true,
        teamScores: {}
      };
      if (typeof getTeamScore === "function") {
        for (var teamIndex = 0; teamIndex < teams.length; teamIndex++) {
          var team = teams[teamIndex];
          var score = getTeamScore(context.session, question.id, team.id) || { score: 0, extraCredit: 0 };
          entry.teamScores[team.id] = {
            teamId: team.id,
            teamIndex: teamIndex + 1,
            score: Number(score.score || 0),
            extraCredit: Number(score.extraCredit || 0)
          };
        }
      }
      snapshot.questions[question.id] = entry;
      snapshot.questionOrder.push(question.id);
    }

    return snapshot;
  },

  emitActiveSessionDiff: function(previous, next) {
    var changed = false;
    if (previous.name !== next.name && next.sessionId) {
      changed = true;
      this.emit("session:renamed", {
        sessionId: next.sessionId,
        name: next.name,
        oldName: previous.name
      });
    }

    var questions = next.questions || {};
    var previousQuestions = previous.questions || {};
    for (var questionId in questions) {
      if (!Object.prototype.hasOwnProperty.call(questions, questionId)) {
        continue;
      }
      var current = questions[questionId];
      var old = previousQuestions[questionId];
      if (!old) {
        changed = true;
        this.emit("question:changed", current);
        continue;
      }
      if (old.name !== current.name || old.maxPoints !== current.maxPoints) {
        changed = true;
        this.emit("question:changed", current);
      }
      if (old.ignore !== current.ignore) {
        changed = true;
        this.emit("question:ignored", current);
      }
      if (old.blockId !== current.blockId) {
        changed = true;
        this.emit("question:block-changed", current);
      }
      if (this.questionScoresChanged(old, current)) {
        changed = true;
        this.emit("question:scored", current);
      }
    }

    if (changed) {
      this.emitStateChanged("sessionDoc");
    }
  },

  questionScoresChanged: function(previousQuestion, nextQuestion) {
    var oldScores = previousQuestion.teamScores || {};
    var nextScores = nextQuestion.teamScores || {};
    var teamId;
    for (teamId in nextScores) {
      if (!Object.prototype.hasOwnProperty.call(nextScores, teamId)) {
        continue;
      }
      var nextScore = nextScores[teamId];
      var oldScore = oldScores[teamId] || { score: 0, extraCredit: 0 };
      if (oldScore.score !== nextScore.score || oldScore.extraCredit !== nextScore.extraCredit) {
        return true;
      }
    }
    for (teamId in oldScores) {
      if (Object.prototype.hasOwnProperty.call(oldScores, teamId) && !nextScores[teamId]) {
        return true;
      }
    }
    return false;
  },

  patchQuestionNavigation: function() {
    if (this.patchedUpdateDataElement) {
      return;
    }
    var root = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : null);
    if (!root || typeof root.update_data_element !== "function") {
      return;
    }

    var self = this;
    var original = root.update_data_element;
    root.update_data_element = function(updatedId, newValue) {
      var beforeIndex = typeof current_question_index !== "undefined" ? current_question_index : null;
      var result = original.apply(this, arguments);

      function afterUpdate() {
        if (typeof current_question_index !== "undefined" && beforeIndex !== current_question_index) {
          self.emit("question:changed", self.currentQuestionPayload(updatedId));
          self.emitStateChanged("question:navigation");
        }
      }

      if (result && typeof result.then === "function") {
        return result.then(function(value) {
          afterUpdate();
          return value;
        });
      }
      afterUpdate();
      return result;
    };
    root.update_data_element._embeddingEventsPatched = true;
    this.patchedUpdateDataElement = true;
  },

  currentQuestionPayload: function(reason) {
    var question = (typeof EmbeddingCommands !== "undefined" && EmbeddingCommands && typeof EmbeddingCommands.serializeCurrentQuestion === "function")
      ? EmbeddingCommands.serializeCurrentQuestion()
      : null;
    if (!question) {
      return { reason: reason || "navigation" };
    }
    question.reason = reason || "navigation";
    return question;
  },

};

if (typeof module !== "undefined" && module.exports) {
  module.exports = EmbeddingEvents;
}
