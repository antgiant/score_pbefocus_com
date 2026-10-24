/**
 * Active focus state for preservation during sync updates
 * @typedef {Object} FocusState
 * @property {string|null} id - Element ID (null if no focused element)
 * @property {string|null} selector - CSS selector for the focused element
 * @property {number|null} selectionStart - Cursor start position (for inputs)
 * @property {number|null} selectionEnd - Cursor end position (for inputs)
 * @property {Object|null} contentEditableSelection - Range info for contenteditable
 * @property {boolean} isContentEditable - Whether element is contenteditable
 */

/**
 * Capture the current focus state including cursor/selection position.
 * Works with both regular inputs and contenteditable elements.
 * @returns {FocusState} The current focus state
 */
function getActiveFocusState() {
  var activeEl = document.activeElement;
  var state = {
    id: null,
    selector: null,
    selectionStart: null,
    selectionEnd: null,
    contentEditableSelection: null,
    isContentEditable: false
  };
  
  if (!activeEl || activeEl === document.body) {
    return state;
  }
  
  // Check if it's an editable element
  var isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA';
  var isContentEditable = activeEl.contentEditable === 'true';
  
  if (!isInput && !isContentEditable) {
    return state;
  }
  
  state.id = activeEl.id || null;
  state.selector = activeEl.id ? '#' + activeEl.id : null;
  state.isContentEditable = isContentEditable;
  
  if (isInput) {
    // Standard input element - save cursor position
    try {
      state.selectionStart = activeEl.selectionStart;
      state.selectionEnd = activeEl.selectionEnd;
    } catch (e) {
      // Some input types don't support selection
    }
  } else if (isContentEditable && typeof window !== 'undefined' && window.getSelection) {
    // Contenteditable element - save selection range
    var selection = window.getSelection();
    if (selection.rangeCount > 0) {
      var range = selection.getRangeAt(0);
      // Store text-based offsets relative to element
      state.contentEditableSelection = {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        collapsed: range.collapsed
      };
    }
  }
  
  return state;
}

/**
 * Restore focus and cursor/selection position from a saved state.
 * @param {FocusState} state - The focus state to restore
 */
function restoreFocusState(state) {
  if (!state || !state.id) {
    return;
  }
  
  var element = document.getElementById(state.id);
  if (!element) {
    return;
  }
  
  // Focus the element
  try {
    element.focus();
  } catch (e) {
    return;
  }
  
  if (state.isContentEditable && state.contentEditableSelection) {
    // Restore contenteditable selection
    if (typeof window !== 'undefined' && window.getSelection) {
      var selection = window.getSelection();
      try {
        var range = document.createRange();
        var textNode = element.firstChild || element;
        var textLength = textNode.textContent ? textNode.textContent.length : 0;
        var startOffset = Math.min(state.contentEditableSelection.startOffset, textLength);
        var endOffset = Math.min(state.contentEditableSelection.endOffset, textLength);
        
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        // Selection restore failed, focus is still set
      }
    }
  } else if (state.selectionStart !== null) {
    // Restore input cursor position
    try {
      var textLength = element.value ? element.value.length : 0;
      var start = Math.min(state.selectionStart, textLength);
      var end = Math.min(state.selectionEnd, textLength);
      element.setSelectionRange(start, end);
    } catch (e) {
      // Some input types don't support setSelectionRange
    }
  }
}

/**
 * Check if an element ID is currently focused and being edited.
 * @param {string} elementId - The element ID to check
 * @param {FocusState} focusState - The current focus state
 * @returns {boolean} True if the element is focused
 */
function isElementFocused(elementId, focusState) {
  if (!focusState || !focusState.id) {
    return false;
  }
  return focusState.id === elementId;
}

/**
 * Debounced version of sync_data_to_display for sync updates.
 * Waits 100ms before refreshing to batch rapid updates and avoid interrupting user input.
 * @type {number|null}
 */
var _syncDisplayDebounceTimer = null;

/**
 * Trigger a debounced sync refresh. Used by sync update listener.
 * Multiple calls within 100ms will be batched into a single refresh.
 */
function sync_data_to_display_debounced() {
  if (_syncDisplayDebounceTimer) {
    clearTimeout(_syncDisplayDebounceTimer);
  }
  _syncDisplayDebounceTimer = setTimeout(function() {
    _syncDisplayDebounceTimer = null;
    sync_data_to_display();
  }, 100);
}

function initialize_scores_tabs() {
  if (typeof document === "undefined" || typeof $ === "undefined") {
    return;
  }
  if (typeof document.getElementById !== "function") {
    return;
  }
  var root = document.documentElement;
  var tabsElement = document.getElementById("scores_tabs");
  var accordion = document.getElementById("accordion");
  var tabsPlaceholder = document.getElementById("scores_tabs_placeholder");
  var tabsHeader = document.getElementById("accordion_scores_tabs_header");
  var tabsPanel = document.getElementById("accordion_scores_tabs_panel");
  if (!root || !tabsElement) {
    return;
  }

  var panelMappings = [
    { contentId: "team_scores", classicPanelId: "accordion_score_by_team_exact_panel", tabPanelId: "scores_tab_team_exact" },
    { contentId: "rounded_team_scores", classicPanelId: "accordion_score_by_team_rounded_panel", tabPanelId: "scores_tab_team_rounded" },
    { contentId: "block_scores", classicPanelId: "accordion_score_by_block_panel", tabPanelId: "scores_tab_by_block" },
    { contentId: "team_and_block_scores", classicPanelId: "accordion_score_by_team_and_block_panel", tabPanelId: "scores_tab_team_block" },
    { contentId: "scores", classicPanelId: "accordion_score_by_question_history_panel", tabPanelId: "scores_tab_history" }
  ];

  function ensure_tabs_initialized() {
    var $tabs = $("#scores_tabs");
    if (typeof $tabs.tabs !== "function") {
      return $tabs;
    }
    if (!$tabs.hasClass("ui-tabs")) {
      $tabs.tabs();
    }
    return $tabs;
  }

  function move_tabs_section(isDefault) {
    if (!tabsHeader || !tabsPanel) {
      return;
    }
    if (isDefault && accordion) {
      var reference = document.getElementById("accordion_score_by_team_exact");
      if (reference && reference.parentNode === accordion) {
        accordion.insertBefore(tabsHeader, reference);
        accordion.insertBefore(tabsPanel, reference);
      } else {
        accordion.appendChild(tabsHeader);
        accordion.appendChild(tabsPanel);
      }
      return;
    }
    if (tabsPlaceholder) {
      tabsPlaceholder.appendChild(tabsHeader);
      tabsPlaceholder.appendChild(tabsPanel);
    }
  }

  function move_score_panels(isDefault) {
    for (var i = 0; i < panelMappings.length; i++) {
      var mapping = panelMappings[i];
      var content = document.getElementById(mapping.contentId);
      var targetId = isDefault ? mapping.tabPanelId : mapping.classicPanelId;
      var target = document.getElementById(targetId);
      if (!content || !target) {
        continue;
      }
      if (content.parentNode !== target) {
        target.appendChild(content);
      }
    }
  }

  function apply_layout_for_mode() {
    var isDefault = root.getAttribute("data-ui-mode") === "default";
    var $tabs = ensure_tabs_initialized();
    move_tabs_section(isDefault);
    move_score_panels(isDefault);
    if (typeof $tabs.tabs === "function") {
      try {
        $tabs.tabs("refresh");
      } catch (e) {
        // Tabs not initialized yet.
      }
    }
    try {
      $("#accordion").accordion("refresh");
    } catch (e) {
      // Accordion not initialized yet.
    }
    update_scores_tabs_for_rounding();
  }

  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "data-ui-mode") {
          apply_layout_for_mode();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });
  }

  apply_layout_for_mode();
}

function update_scores_tabs_for_block_count(blockCount) {
  if (typeof document === "undefined" || typeof $ === "undefined") {
    return;
  }
  if (typeof document.getElementById !== "function") {
    return;
  }
  var tabsElement = document.getElementById("scores_tabs");
  if (!tabsElement) {
    return;
  }

  var hideBlockTabs = blockCount === 1;
  var toggleTargets = [
    { tabId: "scores_tab_by_block_tab", panelId: "scores_tab_by_block" },
    { tabId: "scores_tab_team_block_tab", panelId: "scores_tab_team_block" }
  ];

  for (var i = 0; i < toggleTargets.length; i++) {
    var target = toggleTargets[i];
    var tab = document.getElementById(target.tabId);
    var panel = document.getElementById(target.panelId);
    if (tab) {
      tab.style.display = hideBlockTabs ? "none" : "";
    }
    if (panel) {
      panel.style.display = hideBlockTabs ? "none" : "";
    }
  }

  var $tabs = $("#scores_tabs");
  if (typeof $tabs.tabs === "function" && $tabs.hasClass("ui-tabs")) {
    $tabs.tabs("refresh");
    if (hideBlockTabs) {
      var $activeTab = $tabs.find(".ui-tabs-nav li.ui-tabs-active");
      if ($activeTab.length && $activeTab.css("display") === "none") {
        var $firstVisible = $tabs.find(".ui-tabs-nav li").filter(function() {
          return $(this).css("display") !== "none";
        }).first();
        if ($firstVisible.length) {
          $tabs.tabs("option", "active", $firstVisible.index());
        }
      }
    }
  }
}

function update_scores_tabs_for_rounding(roundingEnabled) {
  if (typeof document === "undefined" || typeof $ === "undefined") {
    return;
  }
  if (typeof document.getElementById !== "function") {
    return;
  }
  var root = document.documentElement;
  if (!root || root.getAttribute("data-ui-mode") !== "default") {
    return;
  }
  var tabsElement = document.getElementById("scores_tabs");
  if (!tabsElement) {
    return;
  }

  var isRounded = roundingEnabled === true;
  if (typeof roundingEnabled !== "boolean") {
    var session = (typeof get_current_session === "function") ? get_current_session() : null;
    var config = session ? session.get("config") : null;
    if (config) {
      isRounded = config.get("rounding") === true;
    }
  }

  var exactTab = document.getElementById("scores_tab_team_exact_tab");
  var exactPanel = document.getElementById("scores_tab_team_exact");
  var roundedTab = document.getElementById("scores_tab_team_rounded_tab");
  var roundedPanel = document.getElementById("scores_tab_team_rounded");

  if (exactTab) {
    exactTab.style.display = isRounded ? "none" : "";
  }
  if (exactPanel) {
    exactPanel.style.display = isRounded ? "none" : "";
  }
  if (roundedTab) {
    roundedTab.style.display = isRounded ? "" : "none";
  }
  if (roundedPanel) {
    roundedPanel.style.display = isRounded ? "" : "none";
  }

  var $tabs = $("#scores_tabs");
  if (typeof $tabs.tabs === "function" && $tabs.hasClass("ui-tabs")) {
    $tabs.tabs("refresh");
    var $activeTab = $tabs.find(".ui-tabs-nav li.ui-tabs-active");
    if ($activeTab.length && $activeTab.css("display") === "none") {
      var $firstVisible = $tabs.find(".ui-tabs-nav li").filter(function() {
        return $(this).css("display") !== "none";
      }).first();
      if ($firstVisible.length) {
        $tabs.tabs("option", "active", $firstVisible.index());
      }
    }
  }
}

function initialize_config_accordion_for_ui_mode() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") {
    return;
  }
  var root = document.documentElement;
  var accordion = document.getElementById("accordion");
  var configHeader = document.getElementById("accordion_config_header");
  var configPanel = document.getElementById("session_configuration");
  if (!root || !accordion || !configHeader || !configPanel) {
    return;
  }

  function is_default_mode_for_config_accordion() {
    return root.getAttribute("data-ui-mode") === "default";
  }

  function set_config_accordion_visibility(isDefault) {
    configHeader.style.display = isDefault ? "none" : "";
    configPanel.style.display = isDefault ? "none" : "";
  }

  function set_active_first_visible_config_section() {
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
      return;
    }
    if (typeof accordion.querySelectorAll !== "function") {
      return;
    }
    var headers = accordion.querySelectorAll("h3");
    if (!headers.length) {
      return;
    }
    var firstVisibleIndex = -1;
    for (var i = 0; i < headers.length; i++) {
      var style = window.getComputedStyle(headers[i]);
      if (style && style.display !== "none") {
        firstVisibleIndex = i;
        break;
      }
    }
    if (firstVisibleIndex < 0 || typeof $ === "undefined") {
      return;
    }
    try {
      var currentActive = $("#accordion").accordion("option", "active");
      if (currentActive !== firstVisibleIndex) {
        $("#accordion").accordion("option", "active", firstVisibleIndex);
      }
    } catch (e) {
      // Accordion not initialized yet.
    }
  }

  function sync_config_accordion_for_mode() {
    var isDefault = is_default_mode_for_config_accordion();
    set_config_accordion_visibility(isDefault);
    if (typeof $ !== "undefined") {
      try {
        $("#accordion").accordion("refresh");
      } catch (e) {
        // Accordion not initialized yet.
      }
    }
    if (isDefault) {
      set_active_first_visible_config_section();
    }
  }

  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "data-ui-mode") {
          sync_config_accordion_for_mode();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });
  }

  sync_config_accordion_for_mode();
}

function initialize_score_entry_advanced_toggle() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") {
    return;
  }
  var toggle = document.getElementById("score_entry_advanced_toggle");
  var panel = document.getElementById("score_entry_advanced_options");
  if (!toggle || !panel) {
    return;
  }

  function set_expanded_state(isExpanded) {
    panel.classList.toggle("is-open", isExpanded);
    toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  }

  toggle.addEventListener("click", function() {
    set_expanded_state(!panel.classList.contains("is-open"));
  });

  set_expanded_state(false);
}

function initialize_score_entry_reorder_controls() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") {
    return;
  }
  var button = document.getElementById("score_entry_reorder_button");
  if (!button) {
    return;
  }
  button.addEventListener("click", function() {
    showScoreEntryReorderDialog();
  });
}

function initialize_rounding_toggle_switch() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") {
    return;
  }
  var roundingContainer = document.getElementById("rounding");
  if (!roundingContainer || typeof roundingContainer.querySelector !== "function") {
    return;
  }
  var switchElement = roundingContainer.querySelector(".rounding-switch");
  var roundingYes = document.getElementById("rounding_yes");
  var roundingNo = document.getElementById("rounding_no");
  if (!switchElement || !roundingYes || !roundingNo) {
    return;
  }

  function toggleRounding() {
    var target = roundingYes.checked ? roundingNo : roundingYes;
    target.checked = true;
    local_data_update(target);
  }

  switchElement.addEventListener("click", function(event) {
    event.preventDefault();
    event.stopPropagation();
    toggleRounding();
  });
}

function sync_rounding_toggle_labels() {
  var exactLabel = t("rounding.no");
  var roundedLabel = t("rounding.yes");

  if (typeof $ !== "undefined") {
    $("#rounding_no_label").text(exactLabel);
    $("#rounding_yes_label").text(roundedLabel);

    var roundingNo = $("#rounding_no");
    var roundingYes = $("#rounding_yes");
    if (typeof roundingNo.checkboxradio === "function") {
      try {
        roundingNo.checkboxradio("option", "label", exactLabel);
      } catch (e) {
        // Checkboxradio not initialized yet.
      }
    }
    if (typeof roundingYes.checkboxradio === "function") {
      try {
        roundingYes.checkboxradio("option", "label", roundedLabel);
      } catch (e) {
        // Checkboxradio not initialized yet.
      }
    }
  }
}

function initialize_timer_toggle_switch() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") {
    return;
  }
  var timerContainer = document.getElementById("timer_enabled_toggle");
  if (!timerContainer || typeof timerContainer.querySelector !== "function") {
    return;
  }
  var switchElement = timerContainer.querySelector(".timer-enabled-switch");
  var timerEnabledYes = document.getElementById("timer_enabled_yes");
  var timerEnabledNo = document.getElementById("timer_enabled_no");
  if (!switchElement || !timerEnabledYes || !timerEnabledNo) {
    return;
  }

  function toggleTimerEnabled() {
    var target = timerEnabledYes.checked ? timerEnabledNo : timerEnabledYes;
    target.checked = true;
    local_data_update(target);
  }

  switchElement.addEventListener("click", function(event) {
    event.preventDefault();
    event.stopPropagation();
    toggleTimerEnabled();
  });
}

function parse_non_negative_integer(value, fallback) {
  var parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function get_timer_enabled_storage_key(sessionId) {
  return "pbe_timer_enabled_" + sessionId;
}

function get_timer_auto_start_storage_key(sessionId) {
  return "pbe_timer_auto_start_" + sessionId;
}

function get_local_timer_enabled(sessionId) {
  if (!sessionId || typeof localStorage === "undefined" || !localStorage) {
    return true;
  }
  try {
    var storedValue = localStorage.getItem(get_timer_enabled_storage_key(sessionId));
    if (storedValue === null) {
      return true;
    }
    return storedValue === "true";
  } catch (error) {
    return true;
  }
}

function set_local_timer_enabled(sessionId, enabled) {
  if (!sessionId || typeof localStorage === "undefined" || !localStorage) {
    return;
  }
  try {
    localStorage.setItem(get_timer_enabled_storage_key(sessionId), enabled ? "true" : "false");
  } catch (error) {
    // Ignore storage errors and keep runtime behavior unchanged.
  }
}

function get_local_timer_auto_start(sessionId) {
  if (!sessionId || typeof localStorage === "undefined" || !localStorage) {
    return false;
  }
  try {
    var storedValue = localStorage.getItem(get_timer_auto_start_storage_key(sessionId));
    if (storedValue === null) {
      return false;
    }
    return storedValue === "true";
  } catch (error) {
    return false;
  }
}

function set_local_timer_auto_start(sessionId, autoStart) {
  if (!sessionId || typeof localStorage === "undefined" || !localStorage) {
    return;
  }
  try {
    localStorage.setItem(get_timer_auto_start_storage_key(sessionId), autoStart ? "true" : "false");
  } catch (error) {
    // Ignore storage errors and keep runtime behavior unchanged.
  }
}

function get_question_timer_adjustment_seconds(question) {
  if (!question || typeof question.get !== "function") {
    return 0;
  }
  var adjustment = Math.floor(Number(question.get("timerAdjustmentSeconds")));
  if (!Number.isFinite(adjustment)) {
    return 0;
  }
  return adjustment;
}

function get_timer_config_values(session, config) {
  var firstPointDefault = (typeof TIMER_DEFAULT_FIRST_POINT_SECONDS !== "undefined") ? TIMER_DEFAULT_FIRST_POINT_SECONDS : 30;
  var subsequentDefault = (typeof TIMER_DEFAULT_SUBSEQUENT_POINT_SECONDS !== "undefined") ? TIMER_DEFAULT_SUBSEQUENT_POINT_SECONDS : 10;
  var warningFlashDefault = (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10;
  var sessionId = session && typeof session.get === "function" ? session.get("id") : null;
  if (!config) {
    return {
      enabled: get_local_timer_enabled(sessionId),
      autoStart: get_local_timer_auto_start(sessionId),
      firstPointSeconds: firstPointDefault,
      subsequentPointSeconds: subsequentDefault,
      warningFlashSeconds: warningFlashDefault
    };
  }
  return {
    enabled: get_local_timer_enabled(sessionId),
    autoStart: get_local_timer_auto_start(sessionId),
    firstPointSeconds: parse_non_negative_integer(config.get("timerFirstPointSeconds"), firstPointDefault),
    subsequentPointSeconds: parse_non_negative_integer(config.get("timerSubsequentPointSeconds"), subsequentDefault),
    warningFlashSeconds: parse_non_negative_integer(config.get("timerWarningFlashSeconds"), warningFlashDefault)
  };
}

function calculate_question_timer_base_duration_seconds(questionPoints, timerConfig) {
  var points = parse_non_negative_integer(questionPoints, 0);
  if (points <= 0) {
    return 0;
  }
  return timerConfig.firstPointSeconds + ((points - 1) * timerConfig.subsequentPointSeconds);
}

function calculate_question_timer_duration_seconds(questionPoints, timerConfig, timerAdjustmentSeconds) {
  var baseDuration = calculate_question_timer_base_duration_seconds(questionPoints, timerConfig);
  var adjustment = Math.floor(Number(timerAdjustmentSeconds));
  if (!Number.isFinite(adjustment)) {
    adjustment = 0;
  }
  return Math.max(0, baseDuration + adjustment);
}

function format_question_timer_seconds(seconds) {
  var safeSeconds = Math.max(0, parse_non_negative_integer(seconds, 0));
  return String(safeSeconds);
}

function clear_question_timer_interval() {
  if (question_timer_interval) {
    clearInterval(question_timer_interval);
    question_timer_interval = null;
  }
}

function get_question_timer_panel_element() {
  if (typeof document !== "undefined" && typeof document.getElementById === "function") {
    return document.getElementById("question_timer_panel");
  }
  if (typeof $ === "function") {
    var panel = $("#question_timer_panel");
    if (panel && panel.length > 0) {
      return panel[0];
    }
  }
  return null;
}

function clear_question_timer_warning_flash() {
  if (question_timer_warning_flash_timeout) {
    clearTimeout(question_timer_warning_flash_timeout);
    question_timer_warning_flash_timeout = null;
  }
  if (typeof $ === "function") {
    var timerPanelJq = $("#question_timer_panel");
    if (timerPanelJq && typeof timerPanelJq.removeClass === "function") {
      timerPanelJq.removeClass("question-timer-panel-warning-flash");
      return;
    }
  }
  var timerPanel = get_question_timer_panel_element();
  if (timerPanel && timerPanel.classList) {
    timerPanel.classList.remove("question-timer-panel-warning-flash");
  }
}

function trigger_question_timer_ten_second_flash() {
  if (question_timer_warning_flash_timeout) {
    clearTimeout(question_timer_warning_flash_timeout);
    question_timer_warning_flash_timeout = null;
  }

  if (typeof $ === "function") {
    var timerPanelJq = $("#question_timer_panel");
    if (timerPanelJq && typeof timerPanelJq.addClass === "function") {
      timerPanelJq.addClass("question-timer-panel-warning-flash");
    } else {
      var timerPanelNode = get_question_timer_panel_element();
      if (!timerPanelNode || !timerPanelNode.classList) {
        return;
      }
      timerPanelNode.classList.add("question-timer-panel-warning-flash");
    }
  } else {
    var timerPanel = get_question_timer_panel_element();
    if (!timerPanel || !timerPanel.classList) {
      return;
    }
    timerPanel.classList.add("question-timer-panel-warning-flash");
  }

  question_timer_warning_flash_timeout = setTimeout(function() {
    if (typeof $ === "function") {
      var flashPanelJq = $("#question_timer_panel");
      if (flashPanelJq && typeof flashPanelJq.removeClass === "function") {
        flashPanelJq.removeClass("question-timer-panel-warning-flash");
      } else {
        var flashPanelNode = get_question_timer_panel_element();
        if (flashPanelNode && flashPanelNode.classList) {
          flashPanelNode.classList.remove("question-timer-panel-warning-flash");
        }
      }
    } else {
      var flashPanel = get_question_timer_panel_element();
      if (flashPanel && flashPanel.classList) {
        flashPanel.classList.remove("question-timer-panel-warning-flash");
      }
    }
    question_timer_warning_flash_timeout = null;
  }, 500);
}

function should_trigger_question_timer_warning_flash() {
  return question_timer_warning_flash_trigger_seconds > 0 &&
    question_timer_remaining_seconds === question_timer_warning_flash_trigger_seconds;
}

function begin_question_timer_countdown() {
  clear_question_timer_interval();
  if (question_timer_duration_seconds <= 0 || question_timer_remaining_seconds <= 0) {
    question_timer_running = false;
    clear_question_timer_warning_flash();
    if (question_timer_duration_seconds <= 0) {
      question_timer_expired = false;
    }
    render_question_timer_panel(true);
    return;
  }

  question_timer_expired = false;
  question_timer_running = true;
  if (should_trigger_question_timer_warning_flash()) {
    trigger_question_timer_ten_second_flash();
  }
  question_timer_interval = setInterval(function() {
    if (question_timer_remaining_seconds > 0) {
      question_timer_remaining_seconds = question_timer_remaining_seconds - 1;
    }
    if (should_trigger_question_timer_warning_flash()) {
      trigger_question_timer_ten_second_flash();
    }
    if (question_timer_remaining_seconds <= 0) {
      question_timer_remaining_seconds = 0;
      question_timer_running = false;
      question_timer_expired = true;
      clear_question_timer_interval();
    }
    render_question_timer_panel(true);
  }, 1000);

  render_question_timer_panel(true);
}

function render_question_timer_panel(timerEnabled) {
  var isEnabled = timerEnabled === true;
  var timerPanel = $("#question_timer_panel");
  if (isEnabled) {
    timerPanel.show();
  } else {
    timerPanel.hide();
  }
  if (isEnabled && question_timer_expired) {
    timerPanel.addClass("question-timer-panel-expired");
  } else {
    timerPanel.removeClass("question-timer-panel-expired");
  }
  $("#question_timer_display").text(format_question_timer_seconds(question_timer_remaining_seconds));
  $("#question_timer_play_pause").text(question_timer_running ? "⏸️" : "▶️");
  $("#question_timer_restart").prop("disabled", !isEnabled || question_timer_duration_seconds <= 0);
  $("#question_timer_play_pause").prop("disabled", !isEnabled || question_timer_duration_seconds <= 0);
  $("#question_timer_decrease").prop("disabled", !isEnabled || !question_timer_question_id);
  $("#question_timer_increase").prop("disabled", !isEnabled || !question_timer_question_id);
}

function stop_question_timer(resetToDuration) {
  clear_question_timer_interval();
  clear_question_timer_warning_flash();
  question_timer_running = false;
  question_timer_expired = false;
  if (resetToDuration) {
    question_timer_remaining_seconds = question_timer_duration_seconds;
  } else {
    question_timer_remaining_seconds = 0;
  }
}

function sync_question_timer_with_current_question(questionId, questionPoints, timerConfig, timerAdjustmentSeconds) {
  if (!timerConfig.enabled || !questionId) {
    stop_question_timer(false);
    question_timer_duration_seconds = 0;
    question_timer_question_id = questionId || null;
    question_timer_warning_flash_trigger_seconds = (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10;
    question_timer_expired = false;
    render_question_timer_panel(false);
    return;
  }

  question_timer_warning_flash_trigger_seconds = parse_non_negative_integer(
    timerConfig.warningFlashSeconds,
    (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10
  );

  var nextDuration = calculate_question_timer_duration_seconds(questionPoints, timerConfig, timerAdjustmentSeconds);
  if (question_timer_question_id !== questionId) {
    stop_question_timer(true);
    question_timer_question_id = questionId;
    question_timer_duration_seconds = nextDuration;
    question_timer_remaining_seconds = nextDuration;
    question_timer_expired = false;
  } else if (question_timer_duration_seconds !== nextDuration) {
    var durationDelta = nextDuration - question_timer_duration_seconds;
    question_timer_duration_seconds = nextDuration;
    question_timer_remaining_seconds = question_timer_remaining_seconds + durationDelta;
    if (question_timer_remaining_seconds > nextDuration) {
      question_timer_remaining_seconds = nextDuration;
    }
    if (question_timer_remaining_seconds <= 0) {
      question_timer_remaining_seconds = 0;
      if (question_timer_running) {
        question_timer_running = false;
        clear_question_timer_interval();
      }
      question_timer_expired = nextDuration > 0;
    } else {
      question_timer_expired = false;
    }
  }

  render_question_timer_panel(true);
}

function get_current_question_for_timer() {
  var session = get_current_session();
  if (!session || !isUUIDSession(session)) {
    return null;
  }
  var questions = getOrderedQuestions(session);
  if (current_question_index < 1 || current_question_index > questions.length) {
    return null;
  }
  return questions[current_question_index - 1];
}

function start_question_timer_from_question_points(questionPoints, forceStart) {
  var session = get_current_session();
  if (!session || !isUUIDSession(session)) {
    return;
  }
  var config = session.get("config");
  var timerConfig = get_timer_config_values(session, config);
  if (!timerConfig.enabled) {
    return;
  }
  if (forceStart !== true && timerConfig.autoStart !== true) {
    return;
  }

  var question = get_current_question_for_timer();
  if (!question) {
    return;
  }

  var duration = calculate_question_timer_duration_seconds(
    questionPoints,
    timerConfig,
    get_question_timer_adjustment_seconds(question.data)
  );
  question_timer_warning_flash_trigger_seconds = parse_non_negative_integer(
    timerConfig.warningFlashSeconds,
    (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10
  );
  question_timer_question_id = question.id;
  question_timer_duration_seconds = duration;
  question_timer_remaining_seconds = duration;
  question_timer_expired = false;
  begin_question_timer_countdown();
}

function restart_question_timer_from_current_question() {
  var session = get_current_session();
  if (!session || !isUUIDSession(session)) {
    return;
  }
  var question = get_current_question_for_timer();
  if (!question) {
    return;
  }
  var config = session.get("config");
  var timerConfig = get_timer_config_values(session, config);
  if (!timerConfig.enabled) {
    return;
  }
  question_timer_warning_flash_trigger_seconds = parse_non_negative_integer(
    timerConfig.warningFlashSeconds,
    (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10
  );
  question_timer_question_id = question.id;
  question_timer_duration_seconds = calculate_question_timer_duration_seconds(
    question.data.get("score") || 0,
    timerConfig,
    get_question_timer_adjustment_seconds(question.data)
  );
  stop_question_timer(true);
  render_question_timer_panel(true);
}

function stop_question_timer_from_user() {
  stop_question_timer(false);
  render_question_timer_panel(true);
}

function toggle_question_timer_play_pause() {
  var session = get_current_session();
  if (!session || !isUUIDSession(session)) {
    return;
  }
  var config = session.get("config");
  var timerConfig = get_timer_config_values(session, config);
  if (!timerConfig.enabled) {
    return;
  }
  question_timer_warning_flash_trigger_seconds = parse_non_negative_integer(
    timerConfig.warningFlashSeconds,
    (typeof TIMER_DEFAULT_WARNING_FLASH_SECONDS !== "undefined") ? TIMER_DEFAULT_WARNING_FLASH_SECONDS : 10
  );

  if (question_timer_running) {
    clear_question_timer_interval();
    question_timer_running = false;
    question_timer_expired = false;
    render_question_timer_panel(true);
    return;
  }

  if (question_timer_duration_seconds <= 0) {
    var question = get_current_question_for_timer();
    if (!question) {
      return;
    }
    question_timer_question_id = question.id;
    question_timer_duration_seconds = calculate_question_timer_duration_seconds(
      question.data.get("score") || 0,
      timerConfig,
      get_question_timer_adjustment_seconds(question.data)
    );
  }
  if (question_timer_remaining_seconds <= 0) {
    question_timer_remaining_seconds = question_timer_duration_seconds;
  }
  question_timer_expired = false;
  begin_question_timer_countdown();
}

function adjust_question_timer_for_current_question(deltaSeconds) {
  var delta = Math.floor(Number(deltaSeconds));
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }

  var session = get_current_session();
  var sessionDoc = getActiveSessionDoc();
  if (!session || !sessionDoc || !isUUIDSession(session)) {
    return;
  }

  var question = get_current_question_for_timer();
  if (!question) {
    return;
  }

  var config = session.get("config");
  var timerConfig = get_timer_config_values(session, config);
  if (!timerConfig.enabled) {
    return;
  }

  var questionScore = question.data.get("score") || 0;
  var baseDuration = calculate_question_timer_base_duration_seconds(questionScore, timerConfig);
  var minAdjustment = -baseDuration;
  var currentAdjustment = get_question_timer_adjustment_seconds(question.data);
  var nextAdjustment = Math.max(minAdjustment, currentAdjustment + delta);

  if (typeof updateQuestionTimerAdjustment === "function") {
    updateQuestionTimerAdjustment(sessionDoc, session, question.id, nextAdjustment);
  }
}

function initialize_display() {
  initialize_scores_tabs();
  initialize_default_session_frame();
  initialize_default_question_frame();

  //Set up Accordion display
  $("#accordion").accordion({
    heightStyle: "content",
    animate: false
  });
  initialize_config_accordion_for_ui_mode();

  //Set up score entry buttons
  $( "#question_score" ).controlgroup();
  $( "#question_block" ).controlgroup();
  $( "#rounding" ).controlgroup();
  $( "#import" ).controlgroup();

  // Set up click-to-edit for max points
  initialize_max_points_edit();
  
  initialize_language_controls();
  initialize_theme_controls();
  initialize_ui_mode_controls();
  initialize_max_points_controls_for_ui_mode();
  if (typeof initialize_block_manager === "function") {
    initialize_block_manager();
  }
  if (typeof initialize_team_manager === "function") {
    initialize_team_manager();
  }
  initialize_score_entry_field_order_for_ui_mode();
  initialize_score_entry_field_reorder();
  initialize_score_entry_advanced_toggle();
  initialize_score_entry_reorder_controls();
  initialize_rounding_toggle_switch();
  initialize_timer_toggle_switch();
  sync_data_to_display();
  if (typeof initialize_reorder_controls === "function") {
    initialize_reorder_controls();
  }
  if (typeof initialize_history_viewer === "function") {
    initialize_history_viewer();
  }

  if (typeof setup_file_import === "function") {
    setup_file_import();
  }
  
  // Set up hover/click handlers for blocks that cannot be deleted (show notice on row hover/click)
  $("#block_names").on("mouseenter", ".reorder-item", function() {
    var deleteBtn = $(this).find(".item-delete-btn");
    if (deleteBtn.prop("disabled")) {
      var blockName = deleteBtn.attr("data-block-name");
      if (blockName) {
        // Block is in use by questions
        $("#block_in_use_notice").text(t('blocks.in_use_notice', {name: blockName})).show();
      } else {
        // Block is the only one (minimum required)
        $("#block_minimum_notice").show();
      }
    }
  });
  $("#block_names").on("mouseleave", ".reorder-item", function() {
    $("#block_in_use_notice").hide();
    $("#block_minimum_notice").hide();
  });
  $("#block_names").on("click", ".reorder-item", function(e) {
    // Don't trigger on input/button clicks
    if ($(e.target).is("input, button")) return;
    var deleteBtn = $(this).find(".item-delete-btn");
    if (deleteBtn.prop("disabled")) {
      var blockName = deleteBtn.attr("data-block-name");
      if (blockName) {
        $("#block_in_use_notice").text(t('blocks.in_use_notice', {name: blockName})).show();
      } else {
        $("#block_minimum_notice").show();
      }
      // Auto-hide after a few seconds
      setTimeout(function() {
        $("#block_in_use_notice").hide();
        $("#block_minimum_notice").hide();
      }, 3000);
    }
  });

  // Set up hover/click handlers for teams that cannot be deleted (show notice on row hover/click)
  $("#team_names").on("mouseenter", ".reorder-item", function() {
    var deleteBtn = $(this).find(".item-delete-btn");
    if (deleteBtn.prop("disabled")) {
      $("#team_minimum_notice").show();
    }
  });
  $("#team_names").on("mouseleave", ".reorder-item", function() {
    $("#team_minimum_notice").hide();
  });
  $("#team_names").on("click", ".reorder-item", function(e) {
    // Don't trigger on input/button clicks
    if ($(e.target).is("input, button")) return;
    var deleteBtn = $(this).find(".item-delete-btn");
    if (deleteBtn.prop("disabled")) {
      $("#team_minimum_notice").show();
      // Auto-hide after a few seconds
      setTimeout(function() {
        $("#team_minimum_notice").hide();
      }, 3000);
    }
  });

  // Show continue/new session dialog if returning user with existing data
  // Only in browser environment with proper DOM support
  if (typeof hasExistingDataOnLoad !== 'undefined' && hasExistingDataOnLoad && 
      typeof document !== 'undefined' && document.getElementById) {
    hasExistingDataOnLoad = false; // Reset flag so it doesn't show again
    checkAndShowContinueOrNewDialog();
  }

  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.removeAttribute("data-initializing");
  }
}

function initialize_default_session_frame() {
  if (typeof document === "undefined") {
    return;
  }
  var root = document.documentElement;
  var fieldset = document.getElementById("default_session_fieldset");
  var slot = document.getElementById("default_session_entry_slot");
  var placeholder = document.getElementById("score_entry_fieldset_placeholder");
  var content = document.getElementById("score_entry_content");
  if (!root || !fieldset || !slot || !placeholder || !content) {
    return;
  }

  function is_default_mode_for_session_frame() {
    return root.getAttribute("data-ui-mode") === "default";
  }

  function sync_frame_for_mode() {
    if (is_default_mode_for_session_frame()) {
      fieldset.setAttribute("aria-hidden", "false");
      if (!slot.contains(content)) {
        slot.appendChild(content);
      }
      return;
    }
    fieldset.setAttribute("aria-hidden", "true");
    if (placeholder.parentNode && content.parentNode !== placeholder.parentNode) {
      placeholder.parentNode.insertBefore(content, placeholder.nextSibling);
    }
  }

  if (typeof MutationObserver === "undefined") {
    sync_frame_for_mode();
    return;
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === "data-ui-mode") {
        sync_frame_for_mode();
        break;
      }
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });

  sync_frame_for_mode();
}

function initialize_default_question_frame() {
  if (typeof document === "undefined") {
    return;
  }
  var root = document.documentElement;
  var fieldset = document.getElementById("default_question_fieldset");
  var slot = document.getElementById("default_question_slot");
  var bottomSlot = document.getElementById("default_question_bottom_slot");
  var placeholder = document.getElementById("score_entry_content_body_placeholder");
  var content = document.getElementById("score_entry_content_body");
  var bottomNav = document.getElementById("score_entry_bottom_nav");
  var bottomNavPlaceholder = document.getElementById("score_entry_bottom_nav_placeholder");
  var prevButton = document.getElementById("previous_question");
  var nextButton = document.getElementById("next_question");
  var prevButtonSecondary = document.getElementById("previous_question_2");
  var nextButtonSecondary = document.getElementById("next_question_2");
  var prevPlaceholder = document.getElementById("previous_question_placeholder");
  var nextPlaceholder = document.getElementById("next_question_placeholder");
  var prevSlot = document.getElementById("default_question_prev_slot");
  var nextSlot = document.getElementById("default_question_next_slot");
  var titleSpan = document.getElementById("current_question_title_count");
  var titlePlaceholder = document.getElementById("current_question_title_placeholder");
  var titleSlot = document.getElementById("default_question_title_slot");
  if (!root || !fieldset || !slot || !placeholder || !content) {
    return;
  }

  function is_default_mode_for_question_frame() {
    return root.getAttribute("data-ui-mode") === "default";
  }

  function update_question_nav_labels(useShortLabels) {
    var prevKey = useShortLabels ? "score_entry.previous_short" : "score_entry.previous";
    var nextKey = useShortLabels ? "score_entry.next_short" : "score_entry.next";
    var buttons = [prevButton, prevButtonSecondary];
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i]) {
        buttons[i].setAttribute("data-i18n", prevKey);
      }
    }
    buttons = [nextButton, nextButtonSecondary];
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j]) {
        buttons[j].setAttribute("data-i18n", nextKey);
      }
    }
    if (typeof translate_page === "function") {
      translate_page();
    }
  }

  function sync_question_frame_for_mode() {
    if (is_default_mode_for_question_frame()) {
      fieldset.setAttribute("aria-hidden", "false");
      if (!slot.contains(content)) {
        slot.appendChild(content);
      }
      if (prevSlot && prevButton && prevSlot.firstChild !== prevButton) {
        prevSlot.appendChild(prevButton);
      }
      if (titleSlot && titleSpan && titleSlot.firstChild !== titleSpan) {
        titleSlot.appendChild(titleSpan);
      }
      if (nextSlot && nextButton && nextSlot.firstChild !== nextButton) {
        nextSlot.appendChild(nextButton);
      }
      if (bottomSlot && bottomNav && bottomSlot.firstChild !== bottomNav) {
        bottomSlot.appendChild(bottomNav);
      }
      update_question_nav_labels(true);
      return;
    }
    fieldset.setAttribute("aria-hidden", "true");
    if (placeholder.parentNode && content.parentNode !== placeholder.parentNode) {
      placeholder.parentNode.insertBefore(content, placeholder.nextSibling);
    }
    if (prevPlaceholder && prevButton && prevPlaceholder.parentNode) {
      prevPlaceholder.parentNode.insertBefore(prevButton, prevPlaceholder.nextSibling);
    }
    if (titlePlaceholder && titleSpan && titlePlaceholder.parentNode) {
      titlePlaceholder.parentNode.insertBefore(titleSpan, titlePlaceholder.nextSibling);
    }
    if (nextPlaceholder && nextButton && nextPlaceholder.parentNode) {
      nextPlaceholder.parentNode.insertBefore(nextButton, nextPlaceholder.nextSibling);
    }
    if (bottomNavPlaceholder && bottomNav && bottomNavPlaceholder.parentNode) {
      bottomNavPlaceholder.parentNode.insertBefore(bottomNav, bottomNavPlaceholder.nextSibling);
    }
    update_question_nav_labels(false);
  }

  if (typeof MutationObserver === "undefined") {
    sync_question_frame_for_mode();
    return;
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === "data-ui-mode") {
        sync_question_frame_for_mode();
        break;
      }
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });

  sync_question_frame_for_mode();
}

/**
 * Check if user has meaningful data and show the continue/new session dialog
 */
function checkAndShowContinueOrNewDialog() {
  const session = get_current_session();
  if (!session) return;

  // Get session name and creation date for the dialog
  const sessionName = session.get('name') || t('defaults.unnamed_session');
  const sessionCreatedAt = session.get('createdAt');
  
  // Check if session has meaningful data (more than just the initial question)
  let questionCount = 0;
  if (!isUUIDSession(session)) {
    const sessionDoc = getActiveSessionDoc();
    if (sessionDoc) {
      ensureSessionIsV5(sessionDoc);
    }
  }

  const orderedQuestions = getOrderedQuestions(session);
  questionCount = orderedQuestions.length;
  if (questionCount > 0 && orderedQuestions[questionCount - 1].data.get('score') === 0) {
    questionCount--;
  }

  // Auto-apply the default choice (continue if created today, otherwise start new)
  if (questionCount >= 2) {
    const defaultToContinue = isFromToday(sessionCreatedAt);
    if (!defaultToContinue) {
      createNewSession().then(function(newSessionId) {
        if (newSessionId) {
          sync_data_to_display();
        }
      });
    }
  }
}

function sync_data_to_display() {

  if (typeof stateInitialized !== 'undefined' && !stateInitialized) {
    return;
  }
  
  // Save focus state before any DOM updates to preserve user's editing position
  var focusState = getActiveFocusState();
  
  //Load "Universal" DB data into variables from Yjs
  var session_names = get_session_names();
  var session_count = session_names.length - 1;
  const session = get_current_session();
  if (!session) {
    console.error('No current session found');
    return;
  }
  const config = session.get('config');
  if (!config) {
    console.error('No config found in current session');
    return;
  }
  var max_points = config.get('maxPointsPerQuestion');
  var rounding = config.get('rounding');
  var timer_config = get_timer_config_values(session, config);
  var team_names = get_team_names();
  var team_count = team_names.length - 1;
  var block_names = get_block_names();
  var block_count = block_names.length - 1;
  var question_names = get_question_names();
  var question_count = question_names.length - 1;
  
  if (!isUUIDSession(session)) {
    const sessionDoc = getActiveSessionDoc();
    if (sessionDoc) {
      ensureSessionIsV5(sessionDoc);
    }
  }
  if (!isUUIDSession(session)) {
    console.error('Session not upgraded to v5');
    return;
  }

  const orderedQuestions = getOrderedQuestions(session);
  const orderedBlocks = getOrderedBlocks(session);
  const orderedTeams = getOrderedTeams(session);
  
  // Get current question data
  var current_question = current_question_index;
  var currentQuestionObj, current_selected_block, question_max_points, ignore_question, current_question_id, question_timer_adjustment_seconds;
  
  if (orderedQuestions.length > 0 && orderedQuestions[orderedQuestions.length - 1].data.get('score') === 0) {
    question_count--;
  }
  
  if (current_question >= 1 && current_question <= orderedQuestions.length) {
    const q = orderedQuestions[current_question - 1];
    currentQuestionObj = q.data;
    current_question_id = q.id;
    question_max_points = currentQuestionObj.get('score');
    ignore_question = currentQuestionObj.get('ignore') || false;
    question_timer_adjustment_seconds = get_question_timer_adjustment_seconds(currentQuestionObj);
    
    const blockId = currentQuestionObj.get('blockId');
    current_selected_block = 0;
    for (let i = 0; i < orderedBlocks.length; i++) {
      if (orderedBlocks[i].id === blockId) {
        current_selected_block = i;
        break;
      }
    }
  } else {
    current_question = 1;
    current_question_index = 1;
    if (orderedQuestions.length > 0) {
      const q = orderedQuestions[0];
      currentQuestionObj = q.data;
      current_question_id = q.id;
      question_max_points = currentQuestionObj.get('score');
      ignore_question = currentQuestionObj.get('ignore') || false;
      question_timer_adjustment_seconds = get_question_timer_adjustment_seconds(currentQuestionObj);
      current_selected_block = 0;
    } else {
      question_max_points = 0;
      ignore_question = false;
      current_selected_block = 0;
      current_question_id = null;
      question_timer_adjustment_seconds = 0;
    }
  }
  
  function getTeamScoreForDisplay(teamIndex) {
    if (teamIndex >= 1 && teamIndex <= orderedTeams.length && current_question >= 1 && current_question <= orderedQuestions.length) {
      const teamId = orderedTeams[teamIndex - 1].id;
      const questionId = orderedQuestions[current_question - 1].id;
      const scoreData = getTeamScore(session, questionId, teamId);
      return scoreData ? scoreData.score : 0;
    }
    return 0;
  }
  
  function getTeamExtraCreditForDisplay(teamIndex) {
    if (teamIndex >= 1 && teamIndex <= orderedTeams.length && current_question >= 1 && current_question <= orderedQuestions.length) {
      const teamId = orderedTeams[teamIndex - 1].id;
      const questionId = orderedQuestions[current_question - 1].id;
      const scoreData = getTeamScore(session, questionId, teamId);
      return scoreData ? scoreData.extraCredit : 0;
    }
    return 0;
  }
  
  function getQuestionBlockIndex(questionIndex) {
    if (questionIndex >= 1 && questionIndex <= orderedQuestions.length) {
      const q = orderedQuestions[questionIndex - 1];
      const blockId = q.data.get('blockId');
      for (let i = 0; i < orderedBlocks.length; i++) {
        if (orderedBlocks[i].id === blockId) {
          return i;
        }
      }
    }
    return 0;
  }
  
  function getQuestionIgnore(questionIndex) {
    if (questionIndex >= 1 && questionIndex <= orderedQuestions.length) {
      return orderedQuestions[questionIndex - 1].data.get('ignore') || false;
    }
    return false;
  }
  
  function getQuestionScore(questionIndex) {
    if (questionIndex >= 1 && questionIndex <= orderedQuestions.length) {
      return orderedQuestions[questionIndex - 1].data.get('score') || 0;
    }
    return 0;
  }

  const currentSessionIndex = get_current_session_index();
  
  // Sessions that sync to a cloud folder on this device get a ☁️ indicator
  var cloudSessionIds = get_session_order();
  function sessionUsesCloudFolder(index) {
    try { return !!localStorage.getItem('pbe-folder-sync:' + cloudSessionIds[index - 1]); } catch (e) { return false; }
  }

  //Set up Session quick navigation
  var session_quick_nav = '<select name="session_quick_nav" id="session_quick_nav" class="config-select" onchange="local_data_update(this)"">';
  let temp_count = (currentSessionIndex>session_count?currentSessionIndex:session_count);
  for (let i=1; i <= temp_count; i++) {
    var syncIndicator = sessionUsesCloudFolder(i) ? ' (☁️)' : '';
    if (i==currentSessionIndex) {
      session_quick_nav += '<option value="'+i+'" selected>'+i+' of '+session_count+syncIndicator+' - '+HTMLescape(session_names[i])+'</option>';
    } else {
      session_quick_nav += '<option value="'+i+'">'+i+' of '+session_count+syncIndicator+' - '+HTMLescape(session_names[i])+'</option>';
    }
  }
  session_quick_nav += '</select>';
  $("#session_display_count").html(session_quick_nav);

  //Disable Next Session Button if this Session has no data
  if (question_count > 1) {
    $("#new_session").prop("disabled", false);
  } else {
    $("#new_session").prop("disabled", true);
  }

  if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
    var sessionTitle = session.get('name') || t('defaults.unnamed_session');
    var sessionTitleEls = [
      document.getElementById("default_session_title"),
      document.getElementById("default_results_session_title")
    ];
    for (var i = 0; i < sessionTitleEls.length; i++) {
      if (sessionTitleEls[i]) {
        sessionTitleEls[i].textContent = sessionTitle;
      }
    }
    var prevSessionLabel = t('session_nav.previous');
    var prevSessionButtons = [
      document.getElementById("session_prev_button"),
      document.getElementById("results_session_prev_button")
    ];
    for (var j = 0; j < prevSessionButtons.length; j++) {
      if (prevSessionButtons[j]) {
        prevSessionButtons[j].textContent = prevSessionLabel;
        prevSessionButtons[j].setAttribute('aria-label', prevSessionLabel);
        prevSessionButtons[j].setAttribute('title', prevSessionLabel);
        prevSessionButtons[j].disabled = currentSessionIndex <= 1;
      }
    }
    var hasNextSession = currentSessionIndex < session_count;
    var canCreateSession = question_count > 1;
    var nextSessionLabel = hasNextSession ? t('session_nav.next') : t('config.new_session');
    var nextSessionButtons = [
      document.getElementById("session_next_button"),
      document.getElementById("results_session_next_button")
    ];
    for (var k = 0; k < nextSessionButtons.length; k++) {
      if (nextSessionButtons[k]) {
        nextSessionButtons[k].textContent = nextSessionLabel;
        nextSessionButtons[k].setAttribute('aria-label', nextSessionLabel);
        nextSessionButtons[k].setAttribute('title', nextSessionLabel);
        nextSessionButtons[k].disabled = !hasNextSession && !canCreateSession;
      }
    }
  }
  
  //Set up Summary Stats here so that those calculations can be reused elsewhere
  //Update Team Scores
  let team_score_summary = get_team_score_summary();
  
  //Fill in Team Placement and create output table
  let temp_output = "<table><thead><tr><th>"+t('table.team_name')+"</th><th>"+t('table.percent')+"</th><th>"+t('table.score')+"</th><th>"+t('table.placement')+"</th></tr></thead><tbody>";
  for (let i=1; i <= team_count; i++) {
    temp_output = temp_output+"<tr><td>"+HTMLescape(team_score_summary[i][0])+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][1]+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][2]+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][3]+"</td></tr>\n"
  }
  temp_output = temp_output+"</tbody></table>";

  //Update displayed Team Scores
  $("#team_scores").html(temp_output);

  //Update Rounded Team Scores  
  //Fill in Team Placement and create output table
  temp_output = "<table><thead><tr><th>"+t('table.team_name')+"</th><th>"+t('table.percent')+"</th><th>"+t('table.score')+"</th><th>"+t('table.placement')+"</th></tr></thead><tbody>";
  for (let i=1; i <= team_count; i++) {
    temp_output = temp_output+"<tr><td>"+HTMLescape(team_score_summary[i][0])+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][7]+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][8]+"</td>";
    temp_output = temp_output+"<td>"+team_score_summary[i][9]+"</td></tr>\n"
  }
  temp_output = temp_output+"</tbody></table>";

  //Update displayed Team Scores
  $("#rounded_team_scores").html(temp_output);

  //Update Block/Group Scores
  let block_score_summary = get_block_score_summary();

  //Fill in Block/Group Placement and create output table
  temp_output = "<table><thead><tr><th>"+t('table.block_name')+"</th><th>"+t('table.percent')+"</th><th>"+t('table.score')+"</th></tr></thead><tbody>";
  for (let i=1; i < block_score_summary.length; i++) {
    temp_output = temp_output+"<tr><td>"+HTMLescape(block_score_summary[i][0])+"</td>";
    temp_output = temp_output+"<td>"+block_score_summary[i][1]+"</td>";
    temp_output = temp_output+"<td>"+block_score_summary[i][2]+"</td></tr>\n"
  }
  temp_output = temp_output+"</tbody></table>";

  //Update displayed Block/Group Scores
  $("#block_scores").html(temp_output);


  //Update Team and Block/Group Scores
  let team_and_block_score_summary = get_team_and_block_score_summary();

  //Fill in Team and Block/Group scores and create output table
  temp_output = "<table><thead><tr><th>"+t('table.team_name')+"</th><th>"+t('table.block_name')+"</th><th>"+t('table.percent')+"</th><th>"+t('table.score')+"</th></tr></thead><tbody>";
  for (let i=1; i < team_and_block_score_summary.length; i++) {
    temp_output = temp_output+"<tr><td>"+HTMLescape(team_and_block_score_summary[i][0])+"</td>";
    temp_output = temp_output+"<td>"+HTMLescape(team_and_block_score_summary[i][1])+"</td>";
    temp_output = temp_output+"<td>"+team_and_block_score_summary[i][2]+"</td>";
    temp_output = temp_output+"<td>"+team_and_block_score_summary[i][3]+"</td></tr>\n";
  }
  temp_output = temp_output+"</tbody></table>";

  //Update displayed Team and Block/Group Scores
  $("#team_and_block_scores").html(temp_output);

  //Update displayed Question Log
  //Create empty summary array
  let question_log_summary = get_question_log();
  
  //Fill in Team and Block/Group scores and create output table
  temp_output = "<table><thead><tr><th>"+t('table.question')+"</th><th>"+t('table.block_name')+"</th><th>"+t('table.possible_points')+"</th>";
  for (let i=1; i <= team_count; i++) {
    temp_output = temp_output + "<th>"+HTMLescape(team_names[i])+" "+t('table.score')+"</th>";
  }
  temp_output = temp_output + "</tr></thead><tbody>";
  for (var i=1; i < question_log_summary.length; i++) {
    if (question_log_summary[i][3] === false) {
      temp_output = temp_output+"<tr><td>"+HTMLescape(question_log_summary[i][0])+"</td>";
      temp_output = temp_output+"<td>"+HTMLescape(question_log_summary[i][1])+"</td>";
      temp_output = temp_output+"<td>"+question_log_summary[i][2]+"</td>";
      for (let j=1; j <= team_count; j++) {
        temp_output = temp_output+"<td>"+question_log_summary[i][j+3]+"</td>";
      }
    }
    temp_output = temp_output+"</tr>\n"
  }
  temp_output = temp_output+"</tbody></table>";

  //Update displayed Question History
  $("#scores").html(temp_output);
  //Set up Teams

  //Show Team Count and update legend
  $("#total_teams").text(format_number(team_count));
  if (team_count == 1) {
    $("#total_teams_text").text(t('teams.team'));
  } else {
    $("#total_teams_text").text(t('teams.teams'));
  }
  if (typeof document !== "undefined" && typeof document.getElementById === "function") {
    var teamsLegend = document.getElementById("teams_legend");
    if (teamsLegend) {
      teamsLegend.setAttribute("data-i18n-count", team_count);
    }
    var scoreEntryTeamLabel = document.getElementById("score_entry_team_label");
    if (scoreEntryTeamLabel) {
      scoreEntryTeamLabel.setAttribute("data-i18n-count", team_count);
    }
  }
  $("#teams_legend").text(t('teams.title', { count: team_count }));
  $("#score_entry_team_label").text(t('score_entry.team', { count: team_count }));

  //Set up Team Name Editing
  let displayed_teams_count = $("#team_names").children().length;
  if (displayed_teams_count < team_count) {
    for (let i=displayed_teams_count + 1;i<=team_count;i++) {
      //Add new
      let teamName = team_names[i] || t('defaults.team_name', {number: i});
      let deleteDisabled = team_count <= 1 ? ' disabled' : '';
      $("#team_names").append('<div class="reorder-item" data-index="'+i+'"><button type="button" class="drag-handle" draggable="true" aria-label="'+t('teams.name_label', {number: i}).replace(':', '')+'">&equiv; &#8597;</button><label><input type = "text" name = "team_'+i+'_name" id = "team_'+i+'_name" onchange="local_data_update(this)" value = "'+teamName.replace('"', "&quote")+'"></label><button type="button" class="item-delete-btn" id="delete_team_'+i+'" onclick="local_data_update(this)" aria-label="'+t('teams.delete_aria', {name: teamName}).replace(/"/g, '&quot;')+'" title="'+t('teams.delete_aria', {name: teamName}).replace(/"/g, '&quot;')+'"'+deleteDisabled+'>🗑</button></div>');
      let initialScoreLabel = teamName.slice(-1).toLowerCase() === 's' ? t('teams.score_label_s', {name: teamName}) : t('teams.score_label', {name: teamName});
      $("#question_teams").append('<fieldset><legend id=team_'+i+'_points_label>'+HTMLescape(initialScoreLabel)+'</legend><div id="team_'+i+'_score"></div>'+
                                   '<legend id=team_'+i+'_extra_credit_label style="display:none">'+t('defaults.extra_credit')+'<div><button id="team_'+i+'_extra_credit_decrease" onclick="local_data_update(this)" >-</button><span id="team_'+i+'_extra_credit" class="extra_credit_amount">0</span><button id ="team_'+i+'_extra_credit_increase" onclick="local_data_update(this)" >+</button></div></legend></fieldset>');
      $("#team_"+i+"_score").append('<label><input type="radio" id="team_'+i+'_score_0" name="team_'+i+'_score" value=0 onchange="local_data_update(this)">0</label>');
      $( "#team_"+i+"_score" ).controlgroup();
    }
  } else if (displayed_teams_count > team_count) {
    //remove extra
    for (let i=displayed_teams_count;i>team_count;i--) {
      $("#team_names").children()[i - 1].remove();
      $("#question_teams").children()[i - 1].remove();
    }
  } else {
    //Already have the right number do nothing
  }

  //Update Team Names and delete button states (Yes this is ineffecient but the numbers are so small it doesn't really matter)
  for (let i=1;i<=team_count;i++) {
    let team_input = $("#team_"+i+"_name");
    if (typeof team_input.closest === "function") {
      let team_item = team_input.closest(".reorder-item");
      if (team_item.length) {
        team_item.attr("data-index", i);
        team_item.find(".drag-handle").attr("aria-label", t('teams.name_label', {number: i}).replace(':', ''));
        // Update delete button state
        let deleteBtn = team_item.find(".item-delete-btn");
        let currentTeamName = team_names[i] || t('defaults.team_name', {number: i});
        deleteBtn.attr("id", "delete_team_"+i);
        deleteBtn.attr("aria-label", t('teams.delete_aria', {name: currentTeamName}));
        deleteBtn.attr("title", t('teams.delete_aria', {name: currentTeamName}));
        deleteBtn.prop("disabled", team_count <= 1);
        $("#team_names").append(team_item);
      }
    }
    var question_earned = 0;
    //Get total points earned for this question
    for (var j=1; j <= team_count; j++) {
      question_earned += getTeamScoreForDisplay(j);
    }
    let temp_current_question_number = current_question;
    //Go back one question if no one has answered this one yet
    if (question_count == current_question && question_count > 0 && question_earned == 0) {
      temp_current_question_number--;
    }
    let temp_team_score_summary = get_team_score_summary(temp_current_question_number);
    let temp_team_and_block_score_summary = get_team_and_block_score_summary(temp_current_question_number);
    
    // Find the row for this team and block combination (now that filtered data doesn't have predictable indices)
    let team_and_block_row = -1;
    let currentTeamName = team_names[i] || t('defaults.team_name', {number: i});
    for (let j = 1; j < temp_team_and_block_score_summary.length; j++) {
      if (temp_team_and_block_score_summary[j][0] === currentTeamName && 
          temp_team_and_block_score_summary[j][1] === block_names[current_selected_block]) {
        team_and_block_row = j;
        break;
      }
    }
    
    let temp_team_score = "";
    if (temp_team_score_summary[i][5] > 0) {
      if (rounding === true) {
        temp_team_score += " "+temp_team_score_summary[i][7];
      } else {
        temp_team_score += " "+temp_team_score_summary[i][1];
      }
    }
    if (temp_team_and_block_score_summary[team_and_block_row] && temp_team_and_block_score_summary[team_and_block_row][5] > 0) {
      temp_team_score +=" ("+
                    block_names[current_selected_block]+" "+
                    temp_team_and_block_score_summary[team_and_block_row][2]+")";
    }
    if (currentTeamName.slice(-1).toLowerCase() === "s") {
      $("#team_"+i+"_points_label").text(t('teams.score_label_s', {name: currentTeamName})+temp_team_score);
    } else {
      $("#team_"+i+"_points_label").text(t('teams.score_label', {name: currentTeamName})+temp_team_score);
    }
    // Skip updating value if this input is currently focused (user is typing)
    if (!isElementFocused("team_"+i+"_name", focusState)) {
      $("#team_"+i+"_name").val(currentTeamName);
    }
  }

  for (let i=1;i<=team_count;i++) {
    let team_score = $("#team_"+i+"_score");
    if (typeof team_score.closest === "function") {
      let team_fieldset = team_score.closest("fieldset");
      if (team_fieldset.length) {
        $("#question_teams").append(team_fieldset);
      }
    }
  }

  //Set up Blocks/Groups
  
  // Calculate which blocks are in use (can't be deleted)
  // This tracks the highest block index that has questions assigned
  let smallest_valid_number_of_blocks = 0;
  for (let i = 1; i <= question_count; i++) {
    let temp_max_blocks = getQuestionBlockIndex(i);
    if (smallest_valid_number_of_blocks < temp_max_blocks) {
      smallest_valid_number_of_blocks = temp_max_blocks;
    }
  }
  
  //Show block/group count and update legend
  $("#total_blocks").text(format_number(block_count));
  if (block_count == 1) {
    $("#total_blocks_text").text(t('blocks.block'));
  } else {
    $("#total_blocks_text").text(t('blocks.blocks'));
  }
  if (typeof document !== "undefined" && typeof document.getElementById === "function") {
    var blocksLegend = document.getElementById("blocks_legend");
    if (blocksLegend) {
      blocksLegend.setAttribute("data-i18n-count", block_count);
    }
    var scoreEntryBlockLabel = document.getElementById("score_entry_block_label");
    if (scoreEntryBlockLabel) {
      scoreEntryBlockLabel.setAttribute("data-i18n-count", block_count);
    }
  }
  $("#blocks_legend").text(t('blocks.title', { count: block_count }));
  $("#score_entry_block_label").text(t('score_entry.block_group', { count: block_count }));
  
  // Hide the notices by default (shown on hover/click of items that can't be deleted)
  $("#block_in_use_notice").hide();
  $("#block_minimum_notice").hide();

  //Set up Block/Group renaming
  let displayed_block_count = $("#block_names").children().length;
  if (displayed_block_count < block_count) {
    for (let i=displayed_block_count + 1;i<=block_count;i++) {
      //Add new
      let blockName = block_names[i] || t('defaults.block_name', {number: i});
      let isDisabled = (block_count <= 1 || i <= smallest_valid_number_of_blocks);
      let deleteDisabled = isDisabled ? ' disabled' : '';
      let dataBlockName = isDisabled ? ' data-block-name="'+HTMLescape(blockName)+'"' : '';
      $("#block_names").append('<div class="reorder-item" data-index="'+i+'"><button type="button" class="drag-handle" draggable="true" aria-label="'+t('blocks.name_label', {number: i}).replace(':', '')+'">&equiv; &#8597;</button><label><input type = "text" name = "block_'+i+'_name" id = "block_'+i+'_name" onchange="local_data_update(this)" value = "'+blockName.replace('"', "&quote")+'"></label><button type="button" class="item-delete-btn" id="delete_block_'+i+'" onclick="local_data_update(this)" aria-label="'+t('blocks.delete_aria', {name: blockName}).replace(/"/g, '&quot;')+'" title="'+t('blocks.delete_aria', {name: blockName}).replace(/"/g, '&quot;')+'"'+deleteDisabled+dataBlockName+'>🗑</button></div>');
      $("#question_block").append('<label><input type="radio" id="question_block_'+i+'" name="question_block" value="'+i+'" onchange="local_data_update(this)"><span id="block_'+i+'_label">'+HTMLescape(blockName)+'</span></label>');
    }
  }
  else if (displayed_block_count > block_count) {
    //remove extra
    for (let i=displayed_block_count;i>block_count;i--) {
      const blockChild = $("#block_names").children()[i - 1];
      const questionBlockChild = $("#question_block").children()[i - 1];
      if (blockChild) blockChild.remove();
      if (questionBlockChild) questionBlockChild.remove();
    }
  } else {
    //Already have the right number do nothing
  }

  //Update Block/Group Names and delete button states (Yes this is ineffecient but the numbers are so small it doesn't really matter)
  try {
    $( "#question_block" ).controlgroup( "destroy" );
  } catch(e) {
    // Controlgroup not initialized yet, that's okay
  }
  for (let i=1;i<=block_count;i++) {
    let block_input = $("#block_"+i+"_name");
    if (typeof block_input.closest === "function") {
      let block_item = block_input.closest(".reorder-item");
      if (block_item.length) {
        block_item.attr("data-index", i);
        block_item.find(".drag-handle").attr("aria-label", t('blocks.name_label', {number: i}).replace(':', ''));
        // Update delete button state
        let deleteBtn = block_item.find(".item-delete-btn");
        let currentBlockName = block_names[i] || t('defaults.block_name', {number: i});
        let isDisabled = block_count <= 1 || i <= smallest_valid_number_of_blocks;
        deleteBtn.attr("id", "delete_block_"+i);
        deleteBtn.attr("aria-label", t('blocks.delete_aria', {name: currentBlockName}));
        deleteBtn.attr("title", t('blocks.delete_aria', {name: currentBlockName}));
        // Disable if this is the only block or if block is in use by questions
        deleteBtn.prop("disabled", isDisabled);
        // Store block name for in-use notice on disabled buttons
        if (isDisabled && block_count > 1) {
          deleteBtn.attr("data-block-name", currentBlockName);
        } else {
          deleteBtn.removeAttr("data-block-name");
        }
        $("#block_names").append(block_item);
      }
    }
    let currentBlockName = block_names[i] || t('defaults.block_name', {number: i});
    $("#block_"+i+"_label").text(currentBlockName);
    let question_block = $("#question_block_"+i);
    if (typeof question_block.closest === "function") {
      $("#question_block").append(question_block.closest("label"));
    }

    // Skip updating value if this input is currently focused (user is typing)
    if (!isElementFocused("block_"+i+"_name", focusState)) {
      $("#block_"+i+"_name").val(currentBlockName);
    }
    //Check off saved block/group
    if (i == current_selected_block) {
      $("#question_block_"+i).prop("checked", true);
    } else {
      $("#question_block_"+i).prop("checked", false);
    }
  }
  $( "#question_block" ).controlgroup();

  // Handle single block scenario - hide block-related UI elements
  if (block_count === 1) {
    // Auto-select the only block if not already selected
    if (current_selected_block !== 1) {
      currentQuestionObj.set('block', 1);
    }
    $("#question_block_1").prop("checked", true);
    
    // Hide the entire block selector container (including drag handle) in score entry
    $("#score_entry_block_container").css('display', 'none');
    
    // Hide all drag handles since there's nothing to reorder with only one field visible
    // Add single-block class to container which hides handles via CSS
    $("#score_entry_fields").addClass('single-block');
    
    // Hide the Score by Block and Score by Team & Block accordion sections
    // Use inline style to hide - accordion will be refreshed
    $("#accordion_score_by_block").css('display', 'none');
    $("#accordion_score_by_block_panel").css('display', 'none');
    $("#accordion_score_by_team_and_block").css('display', 'none');
    $("#accordion_score_by_team_and_block_panel").css('display', 'none');
  } else {
    // Show block-related UI elements when there are multiple blocks
    $("#score_entry_block_container").css('display', '');
    // Remove single-block class to show drag handles
    $("#score_entry_fields").removeClass('single-block');
    // Remove inline display style to let accordion control visibility
    $("#accordion_score_by_block").css('display', '');
    $("#accordion_score_by_block_panel").css('display', '');
    $("#accordion_score_by_team_and_block").css('display', '');
    $("#accordion_score_by_team_and_block_panel").css('display', '');
  }

  update_scores_tabs_for_block_count(block_count);
  update_scores_tabs_for_rounding(rounding);
  
  // Refresh accordion to account for visibility changes
  try {
    $("#accordion").accordion("refresh");
  } catch(e) {
    // Accordion not initialized yet
  }

  //Set up Question quick navigation
  let question_quick_nav = '<select name="question_quick_nav" id="question_quick_nav" class="config-select" onchange="local_data_update(this)"">';
  temp_count = (current_question>question_count?current_question:question_count);
  for (let i=1; i <= temp_count; i++) {
    let temp_ignore_question = getQuestionIgnore(i);
    if (i==current_question) {
      question_quick_nav += '<option value="'+i+'" selected>'+(temp_ignore_question === true?"🚫":"")+i+" of "+question_count+' - '+HTMLescape(question_names[i])+'</option>';
    } else {
      question_quick_nav += '<option value="'+i+'">'+(temp_ignore_question === true?"🚫":"")+i+" of "+question_count+' - '+HTMLescape(question_names[i])+'</option>';
    }
  }
  question_quick_nav += '</select>';
  var isDefaultUi = false;
  if (typeof document !== "undefined") {
    var root = document.documentElement;
    isDefaultUi = !!(root && root.getAttribute("data-ui-mode") === "default");
  }
  if (isDefaultUi) {
    $("#current_question_title_count").text(t('score_entry.question_title', { number: current_question }));
    $("#question_quick_nav_container").html(question_quick_nav);
  } else {
    $("#current_question_title_count").html(question_quick_nav);
    $("#question_quick_nav_container").html("");
  }

  //Set up Max Points per Question

  // Calculate the minimum valid max points (highest score across all questions)
  let smallest_valid_max_points = 1;
  for (let i = 1; i <= question_count; i++) {
    let temp_max_points = getQuestionScore(i);
    if (smallest_valid_max_points < temp_max_points) {
      smallest_valid_max_points = temp_max_points;
    }
  }

  // Auto-repair: if max_points is below the highest question score (can happen after sync),
  // automatically raise it to match the highest score
  if (max_points < smallest_valid_max_points) {
    const sessionDoc = getActiveSessionDoc();
    if (sessionDoc) {
      const oldMaxPoints = max_points;
      sessionDoc.transact(() => {
        config.set('maxPointsPerQuestion', smallest_valid_max_points);
        add_history_entry('edit_log.actions.change_max_points', 'edit_log.details_templates.auto_increased_max_points', { old: oldMaxPoints, new: smallest_valid_max_points });
      }, 'local');
      max_points = smallest_valid_max_points;
    }
  }

  //Show max points count
  $("#max_points").text(format_number(max_points));
  if (max_points <= smallest_valid_max_points) {
    // At minimum due to scores - disable button and show notice
    $("#max_points_decrease").prop("disabled", true);
    if (smallest_valid_max_points > 1) {
      // Only show notice if the constraint is due to scores, not just being at 1
      $("#max_points_minimum_notice").show().text(t('points.minimum_notice'));
    } else {
      $("#max_points_minimum_notice").hide();
    }
  } else {
    $("#max_points_decrease").prop("disabled", false);
    $("#max_points_minimum_notice").hide();
  }
  
  // Update points text for singular/plural
  if (max_points == 1) {
    $("#max_points_text").text(t('points.point'));
  } else {
    $("#max_points_text").text(t('points.points'));
  }

  //Set up max possible points for all questions
  let current_max_possible_points = $("#question_score").children().length;
  if (current_max_possible_points < max_points) {
    for (let i=current_max_possible_points + 1;i<=max_points;i++) {
      //Add new
      $("#question_score").append('<label><input type="radio" id="question_score_'+i+'" name="question_score" value='+i+' onchange="local_data_update(this)">'+i+'</label>');
    }
  }
  else if (current_max_possible_points > max_points) {
    //remove extra
    for (let i=current_max_possible_points;i>max_points;i--) {
      $("#question_score").children()[i - 1].remove();
    }
  } else {
    //Already have the right number do nothing
  }
  //Select actual score if possible
  for (let i=0; i<=max_points; i++) {
    if (i == question_max_points) {
      $("#question_score_" + i).prop("checked", true);
    } else {
      $("#question_score_" + i).prop("checked", false);
    }
  }

  //Disable selecting max possible score lower than already earned score
  let temp_max = 0;
  for (let i = 1; i <= team_count; i++) {
    const teamScore = getTeamScoreForDisplay(i);
    if (temp_max < teamScore) {
      temp_max = teamScore;
    }
  }
  for (let i = 0; i < max_points; i++) {
    if (i < temp_max) {
      $("#question_score_" + i).prop("disabled", true);
    } else {
      $("#question_score_" + i).prop("disabled", false);
    }
  }

  //Add fancy options to new buttons
  try {
    $( "#question_score" ).controlgroup( "refresh" );
  } catch(e) {
    // Controlgroup not initialized yet
  }

  //Set up max possible points on this question (for each team)
  for (let i=1;i<=team_count;i++) {
    let current_team_and_question_score = getTeamScoreForDisplay(i);
    let current_point_count = $("#team_"+i+"_score").children().length - 1;
    if (current_point_count < question_max_points) {
      //Add new
      for (let j = current_point_count; j <= question_max_points - 1; j++) {
        $("#team_"+i+"_score").append('<label><input type="radio" id="team_'+i+'_score_'+(j + 1)+'" name="team_'+i+'_score" value='+(j + 1)+' onchange="local_data_update(this)">'+(j + 1)+'</label>');
      }
    } else if (current_point_count > question_max_points) {
      //remove extra
      for (let j = current_point_count; j > question_max_points; j--) {
        $("#team_"+i+"_score").children()[j].remove();
      }
    } else {
      //Already have the right number do nothing
    }

    //Check off saved score
    $("#team_"+i+"_score_" + current_team_and_question_score).prop("checked", true);

    //Add corrected point options
    try {
      $( "#team_"+i+"_score" ).controlgroup("refresh");
    } catch(e) {
      // Controlgroup not initialized yet
    }
  }


  //Show rounding status
  if (rounding === true) {
    $("#rounding_yes").prop("checked", true);
  } else {
    $("#rounding_no").prop("checked", true);
  }

  $("#timer_enabled").prop("checked", timer_config.enabled);
  $("#timer_enabled_yes").prop("checked", timer_config.enabled);
  $("#timer_enabled_no").prop("checked", !timer_config.enabled);
  if (timer_config.enabled) {
    $("#timer_enabled_toggle").addClass("is-enabled");
    $("#timer_enabled_toggle").removeClass("is-disabled");
  } else {
    $("#timer_enabled_toggle").addClass("is-disabled");
    $("#timer_enabled_toggle").removeClass("is-enabled");
  }
  $("#timer_first_point_seconds").val(timer_config.firstPointSeconds);
  $("#timer_subsequent_point_seconds").val(timer_config.subsequentPointSeconds);
  $("#timer_warning_flash_seconds").val(timer_config.warningFlashSeconds);
  $("#timer_auto_start").prop("checked", timer_config.autoStart);
  $("#timer_first_point_seconds").prop("disabled", !timer_config.enabled);
  $("#timer_subsequent_point_seconds").prop("disabled", !timer_config.enabled);
  $("#timer_warning_flash_seconds").prop("disabled", !timer_config.enabled);
  $("#timer_auto_start").prop("disabled", !timer_config.enabled);
  sync_question_timer_with_current_question(current_question_id, question_max_points, timer_config, question_timer_adjustment_seconds);

  const roundingToggle = $("#rounding");
  if (rounding === true) {
    roundingToggle.addClass("is-rounded");
    roundingToggle.removeClass("is-exact");
  } else {
    roundingToggle.addClass("is-exact");
    roundingToggle.removeClass("is-rounded");
  }
  sync_rounding_toggle_labels();

  //Show ignore status
  if (ignore_question === true) {
    $("#ignore_question").prop("checked", true);
    $("#ignore_question_warning").show();
    $("#ignored_question").css("opacity", 0.25);
    $("#ignored_question").css("pointer-events", "none");
    $("#extra_credit").prop("disabled", true);
  } else {
    $("#ignore_question").prop("checked", false);
    $("#ignore_question_warning").hide();
    $("#ignored_question").css("opacity", 1);
    $("#ignored_question").css("pointer-events", "initial");
    $("#extra_credit").prop("disabled", false);
  }

  //Manage extra credit status
  let temp_extra_credit = 0;
  let temp = 0;
  for (let i=1;i<=team_count;i++) {
    temp = getTeamExtraCreditForDisplay(i);
    $('#team_'+i+'_extra_credit').text(format_number(temp));
    temp_extra_credit += temp;
  }

  if (temp_extra_credit > 0 || $("#extra_credit").prop("checked")) {
    //Show Extra Credit
    $("#extra_credit").prop("checked", true);
    for (let i=1;i<=team_count;i++) {
      $('#team_'+i+'_extra_credit_label').show();
    }
  } else {
    //Hide Extra Credit
    $("#extra_credit").prop("checked", false);
    for (let i=1;i<=team_count;i++) {
      $('#team_'+i+'_extra_credit_label').hide();
    }
  }

  //Refresh display
  try {
    $( "#rounding" ).controlgroup("refresh");
  } catch(e) {
    // Controlgroup not initialized yet
  }

  //Disable Previous Question Button if this is the first Question
  if (current_question == 1) {
    $("#previous_question").prop("disabled", true);
    $("#previous_question_2").prop("disabled", true);
  } else {
    $("#previous_question").prop("disabled", false);
    $("#previous_question_2").prop("disabled", false);
  }

  //Change Next Question to New Question if that is reality
  var useShortQuestionLabels = false;
  if (typeof document !== "undefined" && document.documentElement) {
    useShortQuestionLabels = document.documentElement.getAttribute("data-ui-mode") === "default";
  }
  if (current_question >= question_count) {
    var nextLabelKey = useShortQuestionLabels ? 'score_entry.new_short' : 'score_entry.new';
    $("#next_question").text(t(nextLabelKey));
    $("#next_question_2").text(t(nextLabelKey));
  } else {
    var nextKey = useShortQuestionLabels ? 'score_entry.next_short' : 'score_entry.next';
    $("#next_question").text(t(nextKey));
    $("#next_question_2").text(t(nextKey));
  }

  //Disable Next Question Button if max possible points is not set
  if (question_max_points == 0) {
    $("#next_question").prop("disabled", true);
    $("#next_question_2").prop("disabled", true);
  } else {
    $("#next_question").prop("disabled", false);
    $("#next_question_2").prop("disabled", false);
  }

  // Update Auto Merge button visibility based on duplicate sessions
  if (typeof updateAutoMergeButtonVisibility === 'function') {
    updateAutoMergeButtonVisibility();
  }
  
  // Restore focus state that was saved at the beginning
  restoreFocusState(focusState);
}
/**
 * Show loading indicator
 * @param {string} message - Loading message to display
 */
function showLoading(message) {
  const loadingMessage = message || t('alerts.loading');
  
  // Remove any existing loading overlay
  hideLoading();
  
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.className = 'sync-dialog-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="sync-dialog loading-dialog" role="alert" aria-live="polite">
      <div class="loading-spinner"></div>
      <p class="loading-message">${HTMLescape(loadingMessage)}</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.remove();
  }
}

/**
 * [FUTURE: Multi-doc] Show error message with recovery options
 * @param {string} message - Error message to display
 * @param {Array} recoveryOptions - Array of {label, action} recovery options
 */
function showError(message, recoveryOptions = []) {
  console.error('Error: ' + message);
  if (recoveryOptions.length > 0) {
    console.log('Recovery options:', recoveryOptions);
  }
}

/**
 * Disable session switching controls
 * Used when operations are in progress
 */
function disableSessionControls() {
  // Placeholder: Can be expanded to disable UI controls
}

/**
 * [FUTURE: Multi-doc] Enable session switching controls
 * Used when operations are complete
 */
function enableSessionControls() {
  // Placeholder: Can be expanded to enable UI controls
}

/**
 * Initialize click-to-edit behavior for max points
 */
function initialize_max_points_edit() {
  var maxPointsSpan = $("#max_points");
  
  // Handle click to switch to edit mode
  maxPointsSpan.on("click", function() {
    startMaxPointsEdit();
  });
  
  // Handle keyboard activation (Enter or Space)
  maxPointsSpan.on("keydown", function(e) {
    if (e.which === 13 || e.which === 32) { // Enter or Space
      e.preventDefault();
      startMaxPointsEdit();
    }
  });
}

/**
 * Start editing max points - replace span with input
 */
function startMaxPointsEdit() {
  var maxPointsSpan = $("#max_points");
  
  // Don't start edit if already editing
  if (maxPointsSpan.find("input").length > 0) {
    return;
  }
  
  // Get current value (strip formatting)
  var currentValue = parseInt(maxPointsSpan.text().replace(/[^0-9]/g, ''), 10) || 1;
  
  // Create input element
  var input = $('<input type="number" class="editable-number-input" min="1" step="1">');
  input.val(currentValue);
  
  // Replace span content with input
  maxPointsSpan.empty().append(input);
  input.focus().select();
  
  // Handle blur - save the value
  input.on("blur", function() {
    finishMaxPointsEdit(input);
  });
  
  // Handle Enter key - save and blur
  input.on("keydown", function(e) {
    if (e.which === 13) { // Enter
      e.preventDefault();
      input.blur();
    } else if (e.which === 27) { // Escape - cancel
      e.preventDefault();
      // Restore original value and blur
      input.val(currentValue);
      input.blur();
    }
  });
}

/**
 * Finish editing max points - validate and save
 * @param {jQuery} input - The input element
 */
function finishMaxPointsEdit(input) {
  var newValue = parseInt(input.val(), 10);
  
  // Validate - must be positive integer
  if (isNaN(newValue) || newValue < 1) {
    newValue = 1;
  }
  
  // Round to integer
  newValue = Math.floor(newValue);
  
  // Update the display immediately
  var maxPointsSpan = $("#max_points");
  maxPointsSpan.text(format_number(newValue));
  
  // Save the new value via data update
  local_data_update({ id: "max_points_direct", value: newValue });
}

var SCORE_ENTRY_REORDER_DIALOG_ID = "score-entry-reorder-dialog-overlay";
var scoreEntryReorderLastFocus = null;
var scoreEntryReorderKeyHandler = null;
var scoreEntryReorderObserver = null;

function is_default_mode_for_score_entry() {
  if (typeof document === "undefined") {
    return false;
  }
  var root = document.documentElement;
  return !!(root && root.getAttribute("data-ui-mode") === "default");
}

/**
 * Get the saved score entry field order from global doc
 * @returns {Array|null} - Array of field IDs in order, or null if not set
 */
function get_score_entry_field_order() {
  if (typeof getGlobalDoc !== "function") {
    return null;
  }
  var doc = getGlobalDoc();
  if (!doc) {
    return null;
  }
  var meta = doc.getMap("meta");
  var orderStr = meta.get("scoreEntryFieldOrder");
  if (typeof orderStr === "string") {
    try {
      var order = JSON.parse(orderStr);
      if (Array.isArray(order) && order.length > 0) {
        return order;
      }
    } catch (e) {
      // Invalid JSON
    }
  }
  return null;
}

/**
 * Get the saved score entry field order for default UI from global doc
 * @returns {Array|null} - Array of field IDs in order, or null if not set
 */
function get_saved_default_score_entry_field_order() {
  if (typeof getGlobalDoc !== "function") {
    return null;
  }
  var doc = getGlobalDoc();
  if (!doc) {
    return null;
  }
  var meta = doc.getMap("meta");
  var orderStr = meta.get("scoreEntryFieldOrderDefault");
  if (typeof orderStr === "string") {
    try {
      var order = JSON.parse(orderStr);
      if (Array.isArray(order) && order.length > 0) {
        return order;
      }
    } catch (e) {
      // Invalid JSON
    }
  }

  // Backward compatibility: reuse previously saved beta UI order.
  var legacyOrderStr = meta.get("scoreEntryFieldOrderBeta");
  if (typeof legacyOrderStr === "string") {
    try {
      var legacyOrder = JSON.parse(legacyOrderStr);
      if (Array.isArray(legacyOrder) && legacyOrder.length > 0) {
        return legacyOrder;
      }
    } catch (e) {
      // Invalid JSON
    }
  }

  return null;
}

/**
 * Set the score entry field order in global doc
 * @param {Array} order - Array of field IDs in order (e.g., ['points', 'block'])
 * @returns {boolean} - True if successfully set, false otherwise
 */
function set_score_entry_field_order(order) {
  if (typeof getGlobalDoc !== "function") {
    return false;
  }
  var doc = getGlobalDoc();
  if (!doc) {
    return false;
  }
  if (!Array.isArray(order) || order.length === 0) {
    return false;
  }
  var meta = doc.getMap("meta");
  doc.transact(function() {
    meta.set("scoreEntryFieldOrder", JSON.stringify(order));
  }, "scoreEntryFieldOrder");
  return true;
}

/**
 * Set the default score entry field order in global doc
 * @param {Array} order - Array of field IDs in order (e.g., ['points', 'block', 'teams'])
 * @returns {boolean} - True if successfully set, false otherwise
 */
function set_default_score_entry_field_order(order) {
  if (typeof getGlobalDoc !== "function") {
    return false;
  }
  var doc = getGlobalDoc();
  if (!doc) {
    return false;
  }
  if (!Array.isArray(order) || order.length === 0) {
    return false;
  }
  var meta = doc.getMap("meta");
  doc.transact(function() {
    meta.set("scoreEntryFieldOrderDefault", JSON.stringify(order));
  }, "scoreEntryFieldOrderDefault");
  return true;
}

function get_score_entry_field_ids(container) {
  if (!container || typeof container.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(container.querySelectorAll(".score-entry-field")).map(function(field) {
    return field.dataset.field;
  }).filter(Boolean);
}

function get_default_score_entry_field_order(isDefault) {
  return isDefault ? ["points", "block", "timer", "teams"] : ["points", "block", "timer"];
}

function normalize_score_entry_field_order(order, available, isDefault) {
  var baseOrder = Array.isArray(order) && order.length > 0 ? order : get_default_score_entry_field_order(isDefault);
  if (!isDefault) {
    baseOrder = baseOrder.filter(function(fieldId) {
      return fieldId === "points" || fieldId === "timer" || fieldId === "block";
    });
  }
  var normalized = [];
  baseOrder.forEach(function(fieldId) {
    if (available.indexOf(fieldId) !== -1 && normalized.indexOf(fieldId) === -1) {
      normalized.push(fieldId);
    }
  });

  if (available.indexOf("timer") !== -1) {
    if (!isDefault) {
      normalized = normalized.filter(function(fieldId) {
        return fieldId !== "timer";
      });
      var blockIndex = normalized.indexOf("block");
      if (blockIndex !== -1) {
        normalized.splice(blockIndex + 1, 0, "timer");
      } else {
        var pointsIndex = normalized.indexOf("points");
        if (pointsIndex === -1) {
          normalized.unshift("timer");
        } else {
          normalized.splice(pointsIndex + 1, 0, "timer");
        }
      }
    } else if (normalized.indexOf("timer") === -1) {
      var defaultBlockIndex = normalized.indexOf("block");
      if (defaultBlockIndex !== -1) {
        normalized.splice(defaultBlockIndex + 1, 0, "timer");
      } else {
        var defaultPointsIndex = normalized.indexOf("points");
        if (defaultPointsIndex === -1) {
          normalized.unshift("timer");
        } else {
          normalized.splice(defaultPointsIndex + 1, 0, "timer");
        }
      }
    }
  }

  if (isDefault) {
    available.forEach(function(fieldId) {
      if (normalized.indexOf(fieldId) === -1) {
        normalized.push(fieldId);
      }
    });
    return normalized;
  }

  if (available.indexOf("teams") !== -1 && normalized.indexOf("teams") === -1) {
    normalized.push("teams");
  }
  return normalized;
}

function get_score_entry_field_order_for_mode(isDefault) {
  var container = document.getElementById("score_entry_fields");
  if (!container) {
    return null;
  }
  var available = get_score_entry_field_ids(container);
  var stored = isDefault ? get_saved_default_score_entry_field_order() : get_score_entry_field_order();
  return normalize_score_entry_field_order(stored, available, isDefault);
}

/**
 * Apply the saved score entry field order to the DOM
 */
function apply_score_entry_field_order() {
  var container = document.getElementById("score_entry_fields");
  if (!container) {
    return;
  }
  var order = get_score_entry_field_order_for_mode(is_default_mode_for_score_entry());
  if (!order || order.length === 0) {
    return;
  }
  var fields = Array.from(container.querySelectorAll(".score-entry-field"));
  var fieldMap = {};
  fields.forEach(function(field) {
    fieldMap[field.dataset.field] = field;
  });
  order.forEach(function(fieldId) {
    if (fieldMap[fieldId]) {
      container.appendChild(fieldMap[fieldId]);
    }
  });
}

function initialize_score_entry_field_order_for_ui_mode() {
  if (typeof document === "undefined") {
    return;
  }
  var root = document.documentElement;
  if (!root) {
    return;
  }

  function sync_field_order() {
    apply_score_entry_field_order();
  }

  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "data-ui-mode") {
          sync_field_order();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });
  }

  sync_field_order();
}

/**
 * Initialize drag and drop for score entry fields
 */
function initialize_score_entry_field_reorder() {
  var $container = $("#score_entry_fields");
  if ($container.length === 0) {
    return;
  }
  var container = $container[0];
  
  var draggedItem = null;
  var reorderableIds = ["points", "block"];

  function is_reorderable_field(field) {
    return !!(field && reorderableIds.indexOf(field.dataset.field) !== -1);
  }

  function get_reorderable_fields() {
    return Array.from(container.querySelectorAll(".score-entry-field")).filter(is_reorderable_field);
  }
  
  // Handle drag start
  container.addEventListener("dragstart", function(e) {
    if (is_default_mode_for_score_entry()) {
      return;
    }
    var handle = e.target.closest(".score-entry-drag-handle");
    if (!handle) {
      e.preventDefault();
      return;
    }
    draggedItem = handle.closest(".score-entry-field");
    if (draggedItem && is_reorderable_field(draggedItem)) {
      draggedItem.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", draggedItem.dataset.field);
    } else {
      draggedItem = null;
    }
  });
  
  // Handle drag over
  container.addEventListener("dragover", function(e) {
    if (is_default_mode_for_score_entry() || !draggedItem) {
      return;
    }
    var target = e.target.closest(".score-entry-field");
    if (target && target !== draggedItem && is_reorderable_field(target)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // Remove drag-over from all
      get_reorderable_fields().forEach(function(f) {
        f.classList.remove("drag-over");
      });
      target.classList.add("drag-over");
    }
  });
  
  // Handle drag leave
  container.addEventListener("dragleave", function(e) {
    var target = e.target.closest(".score-entry-field");
    if (target && is_reorderable_field(target)) {
      target.classList.remove("drag-over");
    }
  });
  
  // Handle drop
  container.addEventListener("drop", function(e) {
    if (is_default_mode_for_score_entry()) {
      return;
    }
    var target = e.target.closest(".score-entry-field");
    if (target && draggedItem && target !== draggedItem && is_reorderable_field(target)) {
      e.preventDefault();
      // Insert before or after based on position
      var targetRect = target.getBoundingClientRect();
      var dropY = e.clientY;
      if (dropY < targetRect.top + targetRect.height / 2) {
        container.insertBefore(draggedItem, target);
      } else {
        container.insertBefore(draggedItem, target.nextSibling);
      }
      // Save the new order
      save_score_entry_field_order();
    }
    // Clean up
    get_reorderable_fields().forEach(function(f) {
      f.classList.remove("drag-over");
    });
  });
  
  // Handle drag end
  container.addEventListener("dragend", function(e) {
    if (draggedItem) {
      draggedItem.classList.remove("dragging");
      draggedItem = null;
    }
    get_reorderable_fields().forEach(function(f) {
      f.classList.remove("drag-over");
    });
  });
  
  // Touch support for mobile
  var touchDraggedItem = null;
  var touchStartY = 0;
  var touchClone = null;
  
  container.addEventListener("touchstart", function(e) {
    if (is_default_mode_for_score_entry()) {
      return;
    }
    var handle = e.target.closest(".score-entry-drag-handle");
    if (!handle) {
      return;
    }
    e.preventDefault();
    touchDraggedItem = handle.closest(".score-entry-field");
    if (!is_reorderable_field(touchDraggedItem)) {
      touchDraggedItem = null;
      return;
    }
    touchStartY = e.touches[0].clientY;
    touchDraggedItem.classList.add("dragging");
  }, { passive: false });
  
  container.addEventListener("touchmove", function(e) {
    if (!touchDraggedItem) {
      return;
    }
    e.preventDefault();
    var touchY = e.touches[0].clientY;
    var fields = get_reorderable_fields();
    
    // Find which field we're over
    fields.forEach(function(f) {
      f.classList.remove("drag-over");
    });
    
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field === touchDraggedItem) continue;
      var rect = field.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        field.classList.add("drag-over");
        break;
      }
    }
  }, { passive: false });
  
  container.addEventListener("touchend", function(e) {
    if (!touchDraggedItem) {
      return;
    }
    var touchY = e.changedTouches[0].clientY;
    var fields = get_reorderable_fields();
    
    // Find target field
    var targetField = null;
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field === touchDraggedItem) continue;
      var rect = field.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        targetField = field;
        break;
      }
    }
    
    if (targetField) {
      var targetRect = targetField.getBoundingClientRect();
      if (touchY < targetRect.top + targetRect.height / 2) {
        container.insertBefore(touchDraggedItem, targetField);
      } else {
        container.insertBefore(touchDraggedItem, targetField.nextSibling);
      }
      save_score_entry_field_order();
    }
    
    // Clean up
    touchDraggedItem.classList.remove("dragging");
    get_reorderable_fields().forEach(function(f) {
      f.classList.remove("drag-over");
    });
    touchDraggedItem = null;
  });
}

/**
 * Save the current score entry field order to global doc
 */
function save_score_entry_field_order() {
  if (is_default_mode_for_score_entry()) {
    return;
  }
  var container = document.getElementById("score_entry_fields");
  if (!container) {
    return;
  }
  var fields = Array.from(container.querySelectorAll(".score-entry-field"));
  var order = fields.map(function(field) {
    return field.dataset.field;
  }).filter(function(fieldId) {
    return fieldId === "points" || fieldId === "block";
  });
  set_score_entry_field_order(order);
}

function get_score_entry_reorder_label(fieldId) {
  if (fieldId === "points") {
    return t("table.possible_points");
  }
  if (fieldId === "timer") {
    return t("timer.title");
  }
  if (fieldId === "block") {
    return t("score_entry.block_group", { count: 1 });
  }
  if (fieldId === "teams") {
    return t("score_entry.team", { count: 2 });
  }
  return "";
}

function showScoreEntryReorderDialog() {
  if (typeof document === "undefined") {
    return;
  }
  var root = document.documentElement;
  if (!root || root.getAttribute("data-ui-mode") !== "default") {
    return;
  }
  if (document.getElementById(SCORE_ENTRY_REORDER_DIALOG_ID)) {
    return;
  }

  var order = get_score_entry_field_order_for_mode(true);
  if (!order || order.length === 0) {
    return;
  }

  scoreEntryReorderLastFocus = document.activeElement || null;

  var overlay = document.createElement("div");
  overlay.id = SCORE_ENTRY_REORDER_DIALOG_ID;
  overlay.className = "sync-dialog-overlay score-entry-reorder-overlay";

  var dialog = document.createElement("div");
  dialog.className = "sync-dialog score-entry-reorder-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  var title = document.createElement("h2");
  title.id = "score-entry-reorder-title";
  title.textContent = t("score_entry.reorder_entry");

  var hint = document.createElement("p");
  hint.className = "score-entry-reorder-hint";
  hint.textContent = t("score_entry.reorder_entry_hint");

  var list = document.createElement("div");
  list.id = "score_entry_reorder_list";
  list.className = "score-entry-reorder-list";

  order.forEach(function(fieldId) {
    var label = get_score_entry_reorder_label(fieldId);
    if (!label) {
      return;
    }
    var item = document.createElement("div");
    item.className = "reorder-item";
    item.dataset.index = fieldId;

    var handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.setAttribute("draggable", "true");
    handle.setAttribute("aria-label", t("score_entry.reorder_entry_drag_aria", { name: label }));
    handle.innerHTML = "&#9776;";

    var text = document.createElement("span");
    text.className = "reorder-entry-label";
    text.textContent = label;

    item.appendChild(handle);
    item.appendChild(text);
    list.appendChild(item);
  });

  var buttonRow = document.createElement("div");
  buttonRow.className = "button-row";

  var closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "primary";
  closeButton.textContent = t("advanced.close_button");
  closeButton.addEventListener("click", closeScoreEntryReorderDialog);

  buttonRow.appendChild(closeButton);

  dialog.appendChild(title);
  dialog.appendChild(hint);
  dialog.appendChild(list);
  dialog.appendChild(buttonRow);
  dialog.setAttribute("aria-labelledby", title.id);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  setup_reorder_list("score_entry_reorder_list", {
    item_selector: ".reorder-item",
    handle_selector: ".drag-handle",
    get_expected_order: function() {
      return get_score_entry_field_order_for_mode(true) || get_default_score_entry_field_order(true);
    },
    on_reorder: function(updatedOrder) {
      set_default_score_entry_field_order(updatedOrder);
      apply_score_entry_field_order();
    }
  });

  closeButton.focus();

  scoreEntryReorderKeyHandler = function(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeScoreEntryReorderDialog();
    }
  };
  document.addEventListener("keydown", scoreEntryReorderKeyHandler);

  if (typeof MutationObserver !== "undefined" && root) {
    scoreEntryReorderObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "data-ui-mode") {
          if (root.getAttribute("data-ui-mode") !== "default") {
            closeScoreEntryReorderDialog();
          }
          break;
        }
      }
    });
    scoreEntryReorderObserver.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });
  }
}

function closeScoreEntryReorderDialog() {
  if (typeof document === "undefined") {
    return;
  }
  var overlay = document.getElementById(SCORE_ENTRY_REORDER_DIALOG_ID);
  if (!overlay) {
    return;
  }
  overlay.remove();

  if (scoreEntryReorderKeyHandler) {
    document.removeEventListener("keydown", scoreEntryReorderKeyHandler);
    scoreEntryReorderKeyHandler = null;
  }

  if (scoreEntryReorderObserver) {
    scoreEntryReorderObserver.disconnect();
    scoreEntryReorderObserver = null;
  }

  if (scoreEntryReorderLastFocus && typeof scoreEntryReorderLastFocus.focus === "function") {
    scoreEntryReorderLastFocus.focus();
  }
  scoreEntryReorderLastFocus = null;
}
