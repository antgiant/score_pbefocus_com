const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createStorage } = require('./storage');

/**
 * Load i18n translations from language JS files for test context.
 * Extracts the translations object from the register_i18n_language() call.
 * @returns {object} Object with language codes as keys and translation objects as values
 */
function loadI18nTranslations() {
  const translations = {};
  const i18nDir = path.join(__dirname, '..', '..', 'scripts', 'i18n');
  
  // Helper to extract translations from JS file content
  function extractTranslations(content) {
    // Match register_i18n_language('code', { ... translations: { ... } })
    // The translations object is deeply nested, so we use a simple regex to find the translations key
    const match = content.match(/register_i18n_language\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*\})\s*\)/);
    if (match) {
      try {
        // Create a sandbox context to safely evaluate the config object
        const evalContext = { result: null };
        vm.createContext(evalContext);
        vm.runInContext(`result = ${match[2]}`, evalContext);
        if (evalContext.result && evalContext.result.translations) {
          return { code: match[1], translations: evalContext.result.translations };
        }
      } catch (e) {
        console.warn('Failed to parse translations:', e.message);
      }
    }
    return null;
  }
  
  // Load all .js files in the i18n directory
  try {
    const files = fs.readdirSync(i18nDir).filter(f => f.endsWith('.js'));
    files.forEach(file => {
      try {
        const content = fs.readFileSync(path.join(i18nDir, file), 'utf8');
        const result = extractTranslations(content);
        if (result) {
          translations[result.code] = result.translations;
        }
      } catch (e) {
        console.warn(`Failed to load ${file}:`, e.message);
      }
    });
  } catch (e) {
    console.warn('Failed to read i18n directory:', e.message);
  }
  
  return translations;
}

function extractScripts(html) {
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  return matches.map((match) => {
    const srcMatch = match[0].match(/src=["']([^"']+)["']/);
    return {
      src: srcMatch ? srcMatch[1] : null,
      inline: match[1] ? match[1].trim() : '',
    };
  });
}

const TEST_ALWAYS_LOAD_SCRIPTS = [
  'scripts/app-reorder.js',
  'scripts/app-snapshot.js',
  'scripts/app-import-export.js',
  'scripts/app-backup.js',
  'scripts/app-history.js',
  'scripts/app-block-manager.js',
  'scripts/app-team-manager.js',
];

const TEST_LANGUAGE_SCRIPTS = [
  'scripts/i18n/en.js',
  'scripts/i18n/es.js',
  'scripts/i18n/fr.js',
  'scripts/i18n/pig.js',
];

function injectAlwaysLoadedScriptsForTests(orderedScripts) {
  const existing = new Set();
  orderedScripts.forEach((script) => {
    if (script && script.src) {
      existing.add(script.src);
    }
  });

  const appI18nIndex = orderedScripts.findIndex((script) => script.src && script.src.includes('app-i18n'));
  let languageInsertIndex = appI18nIndex >= 0 ? appI18nIndex + 1 : orderedScripts.length;
  TEST_LANGUAGE_SCRIPTS.forEach((src) => {
    if (existing.has(src)) {
      return;
    }
    orderedScripts.splice(languageInsertIndex, 0, { src: src, inline: '' });
    existing.add(src);
    languageInsertIndex += 1;
  });

  TEST_ALWAYS_LOAD_SCRIPTS.forEach((src) => {
    if (existing.has(src)) {
      return;
    }
    orderedScripts.push({ src: src, inline: '' });
    existing.add(src);
  });
}

function buildContext(seed = {}) {
  const localStorage = createStorage(seed);
  const elements = new Map();

  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        children: [],
        props: {},
        styles: {},
        textContent: '',
        htmlContent: '',
        value: '',
      });
    }
    return elements.get(id);
  }

  function createChild(parent) {
    const child = {
      remove() {
        const index = parent.children.indexOf(child);
        if (index > -1) {
          parent.children.splice(index, 1);
        }
      },
    };
    parent.children.push(child);
  }

  function parseIds(markup) {
    if (typeof markup !== 'string') {
      return;
    }
    const idRegex = /id=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g;
    let match = idRegex.exec(markup);
    while (match) {
      const id = match[1] || match[2] || match[3];
      if (id) {
        getElement(id);
      }
      match = idRegex.exec(markup);
    }
  }

  function wrap(element) {
    return {
      append(content) {
        parseIds(content);
        createChild(element);
        return this;
      },
      children() {
        return element.children;
      },
      html(value) {
        if (value === undefined) {
          return element.htmlContent;
        }
        element.htmlContent = String(value);
        return this;
      },
      text(value) {
        if (value === undefined) {
          return element.textContent;
        }
        element.textContent = String(value);
        return this;
      },
      val(value) {
        if (value === undefined) {
          return element.value;
        }
        element.value = String(value);
        return this;
      },
      prop(name, value) {
        if (value === undefined) {
          return element.props[name];
        }
        element.props[name] = value;
        return this;
      },
      controlgroup() {
        return this;
      },
      accordion() {
        return this;
      },
      keypress() {
        return this;
      },
      css() {
        if (arguments.length === 1) {
          return element.styles[arguments[0]];
        }
        if (arguments.length >= 2) {
          element.styles[arguments[0]] = arguments[1];
        }
        return this;
      },
      show() {
        element.styles.display = 'block';
        return this;
      },
      hide() {
        element.styles.display = 'none';
        return this;
      },
      trigger() {
        return this;
      },
      focus() {
        return this;
      },
      addClass(className) {
        if (!element.classes) {
          element.classes = new Set();
        }
        element.classes.add(className);
        return this;
      },
      removeClass(className) {
        if (element.classes) {
          element.classes.delete(className);
        }
        return this;
      },
      hasClass(className) {
        return element.classes ? element.classes.has(className) : false;
      },
    };
  }

  const noop = () => {};
  const document = {
    createTextNode(text) {
      return { nodeValue: text };
    },
    createElement() {
      return {
        _child: null,
        appendChild(node) {
          this._child = node;
        },
        get innerHTML() {
          return this._child ? String(this._child.nodeValue ?? '') : '';
        },
      };
    },
    addEventListener: noop,
    removeEventListener: noop,
  };
  const jqueryStub = (selector) => {
    if (selector === document) {
      return { ready: noop };
    }
    if (typeof selector === 'string' && selector.startsWith('#')) {
      return wrap(getElement(selector.slice(1)));
    }
    return { ready: noop };
  };

  const windowStub = {
    confirm: () => true,
    alert: noop,
    File: function File() {},
    FileReader: function FileReader() {},
    FileList: function FileList() {},
    Blob: function Blob() {},
    Event: function Event() {},
    dispatchEvent: noop,
    indexedDB: undefined, // Force fallback to localStorage
    yjsModulesLoaded: true, // Pretend Yjs loaded
  };

  // Create a test-friendly setTimeout that executes immediately
  const immediateSetTimeout = (fn) => {
    fn();
    return 1;
  };

  const silentConsole = {
    log: noop,
    warn: noop,
    error: noop,
    info: noop,
    debug: noop,
  };
  const testConsole = process.env.TEST_LOGS ? console : silentConsole;

  const context = {
    console: testConsole,
    JSON,
    localStorage,
    document,
    window: windowStub,
    Blob: function Blob() {},
    URL: {
      createObjectURL: () => 'blob:fake',
    },
    $: jqueryStub,
    crypto,
    Event: function Event() {},
    setTimeout: immediateSetTimeout,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    alert: noop,
    confirm: () => true,
  };

  windowStub.window = windowStub;
  windowStub.document = document;
  windowStub.addEventListener = noop;
  windowStub.removeEventListener = noop;

  return { context, localStorage };
}

function loadApp(seed = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

  // Check if seed is a Yjs config object (has _yjsConfig marker)
  const isYjsSeed = seed && seed._yjsConfig === true;

  if (isYjsSeed) {
    // New Yjs-based test - load app with Yjs config
    const { context, localStorage } = buildContext({});
    vm.createContext(context);

    // Pre-load i18n translations into the context
    const i18nTranslations = loadI18nTranslations();
    context._preloadedI18nTranslations = i18nTranslations;

    const scripts = extractScripts(html);
    if (!scripts.length) {
      throw new Error('Inline script or script source not found in index.html');
    }

    // Load all scripts (skip auto-init)
    // First pass: collect scripts and reorder so app-i18n.js loads before i18n/*.js files
    const orderedScripts = [];
    const i18nLanguageScripts = [];
    
    scripts.forEach((script) => {
      if (script.src) {
        if (script.src.includes('i18n/') && !script.src.includes('app-i18n')) {
          // Language files - defer until after app-i18n.js
          i18nLanguageScripts.push(script);
        } else {
          orderedScripts.push(script);
        }
      }
    });
    
    // Insert language scripts right after app-i18n.js
    const appI18nIndex = orderedScripts.findIndex(s => s.src && s.src.includes('app-i18n'));
    if (appI18nIndex >= 0) {
      orderedScripts.splice(appI18nIndex + 1, 0, ...i18nLanguageScripts);
    } else {
      // If no app-i18n.js found, add at end
      orderedScripts.push(...i18nLanguageScripts);
    }
    injectAlwaysLoadedScriptsForTests(orderedScripts);
    
    orderedScripts.forEach((script) => {
      if (script.src) {
        if (script.src.includes('jquery')) {
          return;
        }
        const content = fs.readFileSync(path.join(__dirname, '..', '..', script.src), 'utf8');

        // Load yjs bundle first
        if (script.src.includes('yjs-bundle')) {
          vm.runInContext(content, context);
          // After loading yjs, Y should be on window - expose it globally in the context
          vm.runInContext('Y = window.Y;', context);
          return;
        }

        // Load app-*.js files, i18n language files, but not app.js (which auto-initializes)
        if (script.src.includes('app-globals') || script.src.includes('app-') || script.src.includes('i18n/')) {
          vm.runInContext(content, context);
          // After loading app-i18n.js, inject the pre-loaded translations as backup
          if (script.src.includes('app-i18n') && !script.src.includes('i18n/')) {
            vm.runInContext(`
              if (_preloadedI18nTranslations) {
                // Merge preloaded translations with any registered ones
                for (var lang in _preloadedI18nTranslations) {
                  if (!i18n_translations[lang]) {
                    i18n_translations[lang] = _preloadedI18nTranslations[lang];
                  }
                }
              }
            `, context);
          }
        }
        return;
      }
      if (script.inline) {
        // Skip inline scripts that might auto-initialize
      }
    });

    // Build the Yjs doc inside the VM context using the config
    if (context.Y) {
      // Pass the config to the VM and create the doc there
      context._seedConfig = seed;

      // Create Y.Doc using the Y instance in the VM - all sessions use v5 (UUID-based) structure
      const buildScript = `
        // V5 SESSION STRUCTURE (UUID-based with deterministic question IDs)
        // Initialize global doc
        setYdoc(new Y.Doc());
        
        // Initialize DocManager
        DocManager.globalDoc = ydoc;
        DocManager.sessionDocs = new Map();
        DocManager.sessionProviders = new Map();
        
        ydoc.transact(() => {
          const meta = ydoc.getMap('meta');
          meta.set('dataVersion', '5.0');
          
          // sessionOrder will hold UUIDs in display order
          const sessionOrder = [];
          
          if (_seedConfig.sessions) {
            _seedConfig.sessions.forEach((sessionConfig, index) => {
              // Generate a test UUID for each session
              const sessionId = 'test-session-' + (index + 1);
              sessionOrder.push(sessionId);
              
              // Create a separate Y.Doc for this session
              const sessionDoc = new Y.Doc();
              const session = sessionDoc.getMap('session');
              
              // Store session ID and metadata
              session.set('id', sessionId);
              session.set('name', sessionConfig.name || 'Test Session');
              session.set('createdAt', Date.now());
              session.set('lastModified', Date.now());
              session.set('dataVersion', '5.0');

              // Config
              const configMap = new Y.Map();
              configMap.set('maxPointsPerQuestion', sessionConfig.maxPointsPerQuestion || 12);
              configMap.set('rounding', sessionConfig.rounding || false);
              configMap.set('timerFirstPointSeconds', Number.isFinite(sessionConfig.timerFirstPointSeconds) ? sessionConfig.timerFirstPointSeconds : 30);
              configMap.set('timerSubsequentPointSeconds', Number.isFinite(sessionConfig.timerSubsequentPointSeconds) ? sessionConfig.timerSubsequentPointSeconds : 10);
              configMap.set('timerWarningFlashSeconds', Number.isFinite(sessionConfig.timerWarningFlashSeconds) ? sessionConfig.timerWarningFlashSeconds : 10);
              session.set('config', configMap);

              // Initialize UUID structures
              const teamsById = new Y.Map();
              const teamOrder = new Y.Array();
              const questionsById = new Y.Map();
              const questionOrder = new Y.Array();
              const blocksById = new Y.Map();
              const blockOrder = new Y.Array();
              
              session.set('teamsById', teamsById);
              session.set('teamOrder', teamOrder);
              session.set('questionsById', questionsById);
              session.set('questionOrder', questionOrder);
              session.set('blocksById', blocksById);
              session.set('blockOrder', blockOrder);
              
              // Track question numbers for deterministic IDs
              let nextQuestionNumber = 1;

              // Create blocks (0-indexed in config)
              const blockNames = sessionConfig.blocks || ['No Block/Group'];
              const blockIdMap = {}; // Map block index to block ID
              blockNames.forEach((blockName, blockIndex) => {
                const blockId = 'b-test-' + (index + 1) + '-' + (blockIndex + 1);
                blockIdMap[blockIndex] = blockId;
                
                const block = new Y.Map();
                block.set('id', blockId);
                block.set('name', blockName);
                block.set('isDefault', blockIndex === 0);
                block.set('createdAt', Date.now());
                block.set('deleted', false);
                block.set('sortOrder', blockIndex);
                
                blocksById.set(blockId, block);
                blockOrder.push([blockId]);
              });

              // Create teams
              const teamNames = sessionConfig.teams || ['Team 1'];
              const teamIdMap = {}; // Map team index to team ID
              teamNames.forEach((teamName, teamIndex) => {
                const teamId = 't-test-' + (index + 1) + '-' + (teamIndex + 1);
                teamIdMap[teamIndex] = teamId;
                
                const team = new Y.Map();
                team.set('id', teamId);
                team.set('name', teamName);
                team.set('createdAt', Date.now());
                team.set('deleted', false);
                team.set('sortOrder', teamIndex);
                
                teamsById.set(teamId, team);
                teamOrder.push([teamId]);
              });

              // Create questions
              const questionConfigs = sessionConfig.questions || [];
              questionConfigs.forEach((qConfig, qIndex) => {
                const questionId = 'q-' + nextQuestionNumber;
                nextQuestionNumber++;
                
                const question = new Y.Map();
                question.set('id', questionId);
                question.set('name', qConfig.name || '');
                question.set('score', qConfig.score || 0);
                question.set('blockId', blockIdMap[qConfig.block || 0] || blockIdMap[0]);
                question.set('ignore', qConfig.ignore || false);
                question.set('createdAt', Date.now());
                
                // Initialize team scores
                const teamScores = new Y.Map();
                teamNames.forEach((teamName, teamIndex) => {
                  const teamId = teamIdMap[teamIndex];
                  const scoreData = new Y.Map();
                  const qTeamScore = qConfig.teamScores && qConfig.teamScores[teamIndex] ? qConfig.teamScores[teamIndex] : {};
                  scoreData.set('score', qTeamScore.score || 0);
                  scoreData.set('extraCredit', qTeamScore.extraCredit || 0);
                  teamScores.set(teamId, scoreData);
                });
                question.set('teamScores', teamScores);
                
                questionsById.set(questionId, question);
                questionOrder.push([questionId]);
              });
              
              // Store nextQuestionNumber
              session.set('nextQuestionNumber', nextQuestionNumber);
              
              // Initialize empty history for this session
              session.set('historyLog', new Y.Array());
              
              // Store session doc in DocManager
              DocManager.sessionDocs.set(sessionId, sessionDoc);
            });
          }
          
          meta.set('sessionOrder', sessionOrder);
          
          // Create sessionNames cache for instant UI updates
          const sessionNamesMap = new Y.Map();
          _seedConfig.sessions.forEach((sessionConfig, index) => {
            const sessionId = 'test-session-' + (index + 1);
            sessionNamesMap.set(sessionId, sessionConfig.name || 'Test Session');
          });
          meta.set('sessionNames', sessionNamesMap);
          
          // Set current session to first one
          const currentSessionId = sessionOrder[_seedConfig.currentSession - 1] || sessionOrder[0];
          meta.set('currentSession', currentSessionId);
          
          // Set active session in DocManager
          DocManager.activeSessionId = currentSessionId;
          
          // Set current_question_index from the current session's config
          if (_seedConfig.sessions && _seedConfig.sessions.length > 0) {
            const currentSessionConfig = _seedConfig.sessions[_seedConfig.currentSession - 1] || _seedConfig.sessions[0];
            current_question_index = (currentSessionConfig && currentSessionConfig.currentQuestion) || 1;
          } else {
            current_question_index = 1;
          }
          
          // Initialize global history array
          ydoc.getArray('globalHistory');
        }, 'test');
        
        yjsReady = true;
        window.stateInitialized = true;
      `;

      vm.runInContext(buildScript, context);
    }

    return { context, localStorage, ydoc: context.ydoc };
  } else {
    // Legacy localStorage-based test - keep existing behavior
    const { context, localStorage } = buildContext(seed);
    vm.createContext(context);

    // Pre-load i18n translations into the context
    const i18nTranslations = loadI18nTranslations();
    context._preloadedI18nTranslations = i18nTranslations;

    const scripts = extractScripts(html);
    if (!scripts.length) {
      throw new Error('Inline script or script source not found in index.html');
    }

    // Reorder scripts so app-i18n.js loads before i18n/*.js files
    const orderedScripts = [];
    const i18nLanguageScripts = [];
    
    scripts.forEach((script) => {
      if (script.src) {
        if (script.src.includes('i18n/') && !script.src.includes('app-i18n')) {
          // Language files - defer until after app-i18n.js
          i18nLanguageScripts.push(script);
        } else {
          orderedScripts.push(script);
        }
      }
    });
    
    // Insert language scripts right after app-i18n.js
    const appI18nIndex = orderedScripts.findIndex(s => s.src && s.src.includes('app-i18n'));
    if (appI18nIndex >= 0) {
      orderedScripts.splice(appI18nIndex + 1, 0, ...i18nLanguageScripts);
    } else {
      orderedScripts.push(...i18nLanguageScripts);
    }
    injectAlwaysLoadedScriptsForTests(orderedScripts);

    orderedScripts.forEach((script) => {
      if (script.src) {
        if (script.src.includes('jquery')) {
          return;
        }
        const content = fs.readFileSync(path.join(__dirname, '..', '..', script.src), 'utf8');

        // Load yjs bundle first (needed for migration from localStorage to Yjs)
        if (script.src.includes('yjs-bundle')) {
          vm.runInContext(content, context);
          // After loading yjs, Y should be on window - expose it globally in the context
          vm.runInContext('Y = window.Y;', context);
          return;
        }

        // Load app-*.js files, i18n language files, but not app.js (which auto-initializes)
        if (script.src.includes('app-') || script.src.includes('i18n/') || !script.src.includes('app.js')) {
          vm.runInContext(content, context);
          // After loading app-i18n.js, inject the pre-loaded translations as backup
          if (script.src.includes('app-i18n') && !script.src.includes('i18n/')) {
            vm.runInContext(`
              if (_preloadedI18nTranslations) {
                for (var lang in _preloadedI18nTranslations) {
                  if (!i18n_translations[lang]) {
                    i18n_translations[lang] = _preloadedI18nTranslations[lang];
                  }
                }
              }
            `, context);
          }
        }
        return;
      }
      if (script.inline) {
        // Skip inline scripts that might auto-initialize
      }
    });

    // Force synchronous initialization for tests
    // Since IndexedDB is not available, we need to manually set up Yjs
    // The scripts define global variables ydoc and yjsReady
    if (context.Y) {
      // Set up Yjs manually for tests - use setter functions to sync with DocManager
      vm.runInContext('setYdoc(new Y.Doc()); setYjsReady(true);', context);

      // Now manually run initialization which will trigger migration from localStorage
      vm.runInContext('initialize_state();', context);

      // For tests, we need to sync Yjs changes back to localStorage so tests can verify
      // that data was properly updated - use multi-doc v5.0 architecture
      vm.runInContext(`
        // After each transaction, sync Yjs state back to localStorage for test verification
        if (typeof ydoc !== 'undefined' && ydoc) {
          ydoc.on('update', function() {
            // Sync current session data back to localStorage for test verification
            // Using v5.0 multi-doc architecture
            const meta = ydoc.getMap('meta');
            const currentSessionId = meta.get('currentSession');
            const sessionOrder = meta.get('sessionOrder') || [];
            const currentSessionIndex = sessionOrder.indexOf(currentSessionId) + 1;
            
            // Get session from DocManager using the session ID
            const sessionDoc = DocManager.sessionDocs.get(currentSessionId);
            if (sessionDoc) {
              const session = sessionDoc.getMap('session');
              
              // Sync team data
              const teams = session.get('teams');
              if (teams) {
                for (let t = 1; t < teams.length; t++) {
                  const team = teams.get(t);
                  if (team && team.get('name')) {
                    localStorage.setItem('session_' + currentSessionIndex + '_team_' + t + '_name', JSON.stringify(team.get('name')));
                  }
                }
              }
              
              // Sync question data
              const questions = session.get('questions');
              if (questions) {
                for (let q = 1; q < questions.length; q++) {
                  const question = questions.get(q);
                  if (question) {
                    localStorage.setItem('session_' + currentSessionIndex + '_question_' + q + '_score', JSON.stringify(question.get('score')));
                    localStorage.setItem('session_' + currentSessionIndex + '_question_' + q + '_block', JSON.stringify(question.get('block')));
                    localStorage.setItem('session_' + currentSessionIndex + '_question_' + q + '_ignore', JSON.stringify(question.get('ignore')));
                    
                    const questionTeams = question.get('teams');
                    if (questionTeams) {
                      for (let qt = 1; qt < questionTeams.length; qt++) {
                        const teamScore = questionTeams.get(qt);
                        if (teamScore) {
                          localStorage.setItem('session_' + currentSessionIndex + '_question_' + q + '_team_' + qt + '_score', JSON.stringify(teamScore.get('score')));
                          localStorage.setItem('session_' + currentSessionIndex + '_question_' + q + '_team_' + qt + '_extra_credit', JSON.stringify(teamScore.get('extraCredit')));
                        }
                      }
                    }
                  }
                }
              }
            }
          });
        }
      `, context);
    }

    return { context, localStorage, ydoc: context.ydoc };
  }
}

// Helper function to export Yjs document data to localStorage-compatible format
// Uses v5.0 multi-doc architecture
function exportYjsToLocalStorageFormat(ydoc, DocManager) {
  const result = {};
  
  if (!ydoc) return result;
  
  const meta = ydoc.getMap('meta');
  const sessionOrder = meta.get('sessionOrder') || [];
  const currentSessionId = meta.get('currentSession');
  const currentSessionIndex = sessionOrder.indexOf(currentSessionId) + 1;
  
  // Add metadata
  result.data_version = JSON.stringify(3.0);
  result.current_session = JSON.stringify(currentSessionIndex);
  
  // Build session names array from DocManager
  const sessionNames = [''];
  for (let i = 0; i < sessionOrder.length; i++) {
    const sessionId = sessionOrder[i];
    const sessionDoc = DocManager && DocManager.sessionDocs ? DocManager.sessionDocs.get(sessionId) : null;
    if (sessionDoc) {
      const session = sessionDoc.getMap('session');
      sessionNames.push(session ? session.get('name') : '');
    } else {
      sessionNames.push('');
    }
  }
  result.session_names = JSON.stringify(sessionNames);
  
  // Export each session from DocManager
  for (let s = 0; s < sessionOrder.length; s++) {
    const sessionId = sessionOrder[s];
    const sessionDoc = DocManager && DocManager.sessionDocs ? DocManager.sessionDocs.get(sessionId) : null;
    if (!sessionDoc) continue;
    
    const session = sessionDoc.getMap('session');
    if (!session) continue;
    
    const sessionIndex = s + 1; // 1-based index for localStorage compatibility
    
    const config = session.get('config');
    const teams = session.get('teams');
    const blocks = session.get('blocks');
    const questions = session.get('questions');
    
    // Config
    if (config) {
      result[`session_${sessionIndex}_max_points_per_question`] = JSON.stringify(config.get('maxPointsPerQuestion'));
      result[`session_${sessionIndex}_rounding`] = JSON.stringify(config.get('rounding'));
      result[`session_${sessionIndex}_timer_first_point_seconds`] = JSON.stringify(config.get('timerFirstPointSeconds'));
      result[`session_${sessionIndex}_timer_subsequent_point_seconds`] = JSON.stringify(config.get('timerSubsequentPointSeconds'));
      result[`session_${sessionIndex}_timer_warning_flash_seconds`] = JSON.stringify(config.get('timerWarningFlashSeconds'));
    }
    
    // Teams
    if (teams) {
      const teamNames = [''];
      for (let t = 1; t < teams.length; t++) {
        const team = teams.get(t);
        teamNames.push(team ? team.get('name') : '');
      }
      result[`session_${sessionIndex}_team_names`] = JSON.stringify(teamNames);
    }
    
    // Blocks
    if (blocks) {
      const blockNames = [];
      for (let b = 0; b < blocks.length; b++) {
        const block = blocks.get(b);
        blockNames.push(block ? block.get('name') : '');
      }
      result[`session_${sessionIndex}_block_names`] = JSON.stringify(blockNames);
    }
    
    // Questions
    if (questions) {
      const questionNames = [''];
      for (let q = 1; q < questions.length; q++) {
        const question = questions.get(q);
        if (!question) continue;
        
        questionNames.push(question.get('name') || '');
        result[`session_${sessionIndex}_question_${q}_score`] = JSON.stringify(question.get('score'));
        result[`session_${sessionIndex}_question_${q}_block`] = JSON.stringify(question.get('block'));
        result[`session_${sessionIndex}_question_${q}_ignore`] = JSON.stringify(question.get('ignore'));
        
        // Team scores for this question
        const questionTeams = question.get('teams');
        if (questionTeams) {
          for (let qt = 1; qt < questionTeams.length; qt++) {
            const teamScore = questionTeams.get(qt);
            if (teamScore) {
              result[`session_${sessionIndex}_question_${q}_team_${qt}_score`] = JSON.stringify(teamScore.get('score'));
              result[`session_${sessionIndex}_question_${q}_team_${qt}_extra_credit`] = JSON.stringify(teamScore.get('extraCredit'));
            }
          }
        }
      }
      result[`session_${sessionIndex}_question_names`] = JSON.stringify(questionNames);
      result[`session_${sessionIndex}_current_question`] = JSON.stringify(session.get('currentQuestion'));
    }
  }
  
  return result;
}

module.exports = { buildContext, loadApp, exportYjsToLocalStorageFormat };
