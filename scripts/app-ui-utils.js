/**
 * Small UI helpers shared by dialogs: toast, screen reader announcements,
 * focus trapping and HTML escaping.
 */

/**
 * Announce message to screen readers using ARIA live region
 * @param {string} message - Message to announce
 * @param {string} [priority] - 'polite' or 'assertive'
 */
function announceToScreenReader(message, priority) {
  priority = priority || 'polite';
  var announcer = document.getElementById('sync-sr-announcer');
  
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'sync-sr-announcer';
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.className = 'visually-hidden';
    document.body.appendChild(announcer);
  }
  
  // Clear and set message to trigger announcement
  announcer.textContent = '';
  setTimeout(function() {
    announcer.textContent = message;
  }, 100);
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {number} [duration] - Duration in milliseconds
 */
function showToast(message, duration) {
  duration = duration || 3000;
  var toast = document.getElementById('sync-toast');
  
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sync-toast';
    toast.className = 'sync-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.add('visible');
  
  setTimeout(function() {
    toast.classList.remove('visible');
  }, duration);
}

/**
 * Trap focus within an element
 * @param {HTMLElement} element - Container to trap focus within
 */
function trapFocus(element) {
  var focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  var firstFocusable = focusableElements[0];
  var lastFocusable = focusableElements[focusableElements.length - 1];
  
  element.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        lastFocusable.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        firstFocusable.focus();
        e.preventDefault();
      }
    }
  });
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
