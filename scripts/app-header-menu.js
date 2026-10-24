var HEADER_MENU_OPEN_CLASS = "is-open";

function initialize_header_menu() {
  if (typeof document === "undefined") {
    return;
  }

  var root = document.documentElement;
  if (root && root.dataset && root.dataset.headerMenuInitialized === "true") {
    return;
  }
  var toggle = document.getElementById("header_menu_toggle");
  var panel = document.getElementById("header_menu_panel");
  var sessionFieldset = document.getElementById("session_fieldset");
  var sessionSlot = document.getElementById("header_menu_session_slot");
  var sessionPlaceholder = document.getElementById("session_fieldset_placeholder");
  var roundingFieldset = document.getElementById("rounding_fieldset");
  var roundingSlot = document.getElementById("header_menu_rounding_slot");
  var roundingPlaceholder = document.getElementById("rounding_fieldset_placeholder");
  var timerFieldset = document.getElementById("timer_fieldset");
  var timerSlot = document.getElementById("header_menu_timer_slot");
  var timerPlaceholder = document.getElementById("timer_fieldset_placeholder");
  var questionFieldset = document.getElementById("header_menu_question_fieldset");
  var scoreEntryAdvancedPanel = document.getElementById("score_entry_advanced_options");
  var scoreEntryAdvancedPlaceholder = document.getElementById("score_entry_advanced_placeholder");
  var scoreEntryReorderButton = document.getElementById("score_entry_reorder_button");
  if (!root || !toggle || !panel) {
    return;
  }

  if (root.dataset) {
    root.dataset.headerMenuInitialized = "true";
  }

  var menuSwipeStartX = 0;
  var menuSwipeStartY = 0;
  var menuSwipeTracking = false;
  var menuOpenSwipeStartX = 0;
  var menuOpenSwipeStartY = 0;
  var menuOpenSwipeTracking = false;

  function reset_menu_swipe_tracking() {
    menuSwipeTracking = false;
    menuSwipeStartX = 0;
    menuSwipeStartY = 0;
  }

  function reset_menu_open_swipe_tracking() {
    menuOpenSwipeTracking = false;
    menuOpenSwipeStartX = 0;
    menuOpenSwipeStartY = 0;
  }

  function is_default_mode() {
    return root.getAttribute("data-ui-mode") === "default";
  }

  function set_menu_state(isOpen) {
    if (isOpen) {
      panel.classList.add(HEADER_MENU_OPEN_CLASS);
    } else {
      panel.classList.remove(HEADER_MENU_OPEN_CLASS);
    }

    if (is_default_mode()) {
      panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  }

  function move_session_fieldset_for_mode() {
    if (!sessionFieldset || !sessionSlot || !sessionPlaceholder) {
      return;
    }
    if (is_default_mode()) {
      if (!sessionSlot.contains(sessionFieldset)) {
        sessionSlot.appendChild(sessionFieldset);
      }
      return;
    }
    if (sessionPlaceholder.parentNode && !sessionPlaceholder.parentNode.contains(sessionFieldset)) {
      sessionPlaceholder.parentNode.insertBefore(sessionFieldset, sessionPlaceholder.nextSibling);
    }
  }

  function move_rounding_fieldset_for_mode() {
    if (!roundingFieldset || !roundingSlot || !roundingPlaceholder) {
      return;
    }
    if (is_default_mode()) {
      if (!roundingSlot.contains(roundingFieldset)) {
        roundingSlot.appendChild(roundingFieldset);
      }
      return;
    }
    if (roundingPlaceholder.parentNode && !roundingPlaceholder.parentNode.contains(roundingFieldset)) {
      roundingPlaceholder.parentNode.insertBefore(roundingFieldset, roundingPlaceholder.nextSibling);
    }
  }

  function move_timer_fieldset_for_mode() {
    if (!timerFieldset || !timerSlot || !timerPlaceholder) {
      return;
    }
    if (is_default_mode()) {
      if (!timerSlot.contains(timerFieldset)) {
        timerSlot.appendChild(timerFieldset);
      }
      return;
    }
    if (timerPlaceholder.parentNode && !timerPlaceholder.parentNode.contains(timerFieldset)) {
      timerPlaceholder.parentNode.insertBefore(timerFieldset, timerPlaceholder.nextSibling);
    }
  }

  function move_reorder_button_for_mode() {
    if (!scoreEntryReorderButton || !scoreEntryAdvancedPanel || !sessionFieldset) {
      return;
    }
    if (is_default_mode()) {
      if (sessionFieldset.lastChild !== scoreEntryReorderButton) {
        sessionFieldset.appendChild(scoreEntryReorderButton);
      }
      return;
    }
    if (!scoreEntryAdvancedPanel.contains(scoreEntryReorderButton)) {
      scoreEntryAdvancedPanel.insertBefore(scoreEntryReorderButton, scoreEntryAdvancedPanel.firstChild);
    }
  }

  function move_question_options_for_mode() {
    if (!questionFieldset || !scoreEntryAdvancedPanel || !scoreEntryAdvancedPlaceholder) {
      return;
    }
    if (is_default_mode()) {
      if (!questionFieldset.contains(scoreEntryAdvancedPanel)) {
        questionFieldset.appendChild(scoreEntryAdvancedPanel);
      }
      return;
    }
    if (scoreEntryAdvancedPlaceholder.parentNode && !scoreEntryAdvancedPlaceholder.parentNode.contains(scoreEntryAdvancedPanel)) {
      scoreEntryAdvancedPlaceholder.parentNode.insertBefore(scoreEntryAdvancedPanel, scoreEntryAdvancedPlaceholder.nextSibling);
    }
  }

  function sync_menu_for_mode() {
    if (is_default_mode()) {
      set_menu_state(false);
      move_session_fieldset_for_mode();
      move_rounding_fieldset_for_mode();
      move_timer_fieldset_for_mode();
      move_reorder_button_for_mode();
      move_question_options_for_mode();
      return;
    }

    panel.classList.remove(HEADER_MENU_OPEN_CLASS);
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "false");
    move_session_fieldset_for_mode();
    move_rounding_fieldset_for_mode();
    move_timer_fieldset_for_mode();
    move_reorder_button_for_mode();
    move_question_options_for_mode();
  }

  toggle.addEventListener("click", function(event) {
    if (!is_default_mode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    set_menu_state(!panel.classList.contains(HEADER_MENU_OPEN_CLASS));
  });

  document.addEventListener("click", function(event) {
    if (!is_default_mode()) {
      return;
    }
    if (!panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      return;
    }
    if (panel.contains(event.target) || toggle.contains(event.target)) {
      return;
    }
    set_menu_state(false);
  });

  document.addEventListener("keydown", function(event) {
    if (!is_default_mode()) {
      return;
    }
    if (event.key !== "Escape") {
      return;
    }
    if (panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      set_menu_state(false);
      toggle.focus();
    }
  });

  document.addEventListener("touchstart", function(event) {
    if (!is_default_mode()) {
      return;
    }
    if (panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      reset_menu_open_swipe_tracking();
      return;
    }
    if (!event.touches || event.touches.length !== 1) {
      reset_menu_open_swipe_tracking();
      return;
    }

    var startX = event.touches[0].clientX;
    if (startX > 28) {
      reset_menu_open_swipe_tracking();
      return;
    }

    menuOpenSwipeStartX = startX;
    menuOpenSwipeStartY = event.touches[0].clientY;
    menuOpenSwipeTracking = true;
  });

  document.addEventListener("touchend", function(event) {
    if (!menuOpenSwipeTracking) {
      return;
    }
    if (!event.changedTouches || !event.changedTouches.length) {
      reset_menu_open_swipe_tracking();
      return;
    }

    var deltaX = event.changedTouches[0].clientX - menuOpenSwipeStartX;
    var deltaY = event.changedTouches[0].clientY - menuOpenSwipeStartY;
    var horizontalDistance = Math.abs(deltaX);
    var verticalDistance = Math.abs(deltaY);
    var isOpenSwipe = deltaX >= 70 && horizontalDistance > verticalDistance * 1.2;

    if (isOpenSwipe && !panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      set_menu_state(true);
    }

    reset_menu_open_swipe_tracking();
  });

  document.addEventListener("touchcancel", function() {
    reset_menu_open_swipe_tracking();
  });

  panel.addEventListener("touchstart", function(event) {
    if (!is_default_mode()) {
      return;
    }
    if (!panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      return;
    }
    if (!event.touches || event.touches.length !== 1) {
      reset_menu_swipe_tracking();
      return;
    }
    menuSwipeStartX = event.touches[0].clientX;
    menuSwipeStartY = event.touches[0].clientY;
    menuSwipeTracking = true;
  });

  panel.addEventListener("touchend", function(event) {
    if (!menuSwipeTracking) {
      return;
    }
    if (!event.changedTouches || !event.changedTouches.length) {
      reset_menu_swipe_tracking();
      return;
    }

    var deltaX = event.changedTouches[0].clientX - menuSwipeStartX;
    var deltaY = event.changedTouches[0].clientY - menuSwipeStartY;
    var horizontalDistance = Math.abs(deltaX);
    var verticalDistance = Math.abs(deltaY);
    var isHorizontalSwipe = horizontalDistance >= 60 && horizontalDistance > verticalDistance * 1.2;

    if (isHorizontalSwipe && panel.classList.contains(HEADER_MENU_OPEN_CLASS)) {
      set_menu_state(false);
    }

    reset_menu_swipe_tracking();
  });

  panel.addEventListener("touchcancel", function() {
    reset_menu_swipe_tracking();
  });

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === "data-ui-mode") {
        sync_menu_for_mode();
        break;
      }
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-ui-mode"] });

  sync_menu_for_mode();
}
