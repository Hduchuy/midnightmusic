/**
 * Room Transition Feel System v3
 * Bug-fixed, safe navigation layer.
 * 
 * Key fixes:
 * - Safe fallback navigation (transition never blocks routing)
 * - Timeout protection for stuck transitions
 * - Debug logging for troubleshooting
 * - No silent failures
 */

const RoomTransition = (function() {
  'use strict';

  // ── DEBUG ─────────────────────────────────────────────────
  const DEBUG = window.MM_DEBUG || false;
  function log(...args) {
    if (DEBUG || true) console.log('[RoomTransition]', ...args);
  }

  // ── TIMING SYSTEM ────────────────────────────────────────
  const TIMING = {
    fadeIn:   500,
    hold:     400,
    fadeOut:  450,
    total:    1350,
    // Safety timeout - max time before auto-proceed
    safetyTimeout: 3000,
  };

  // ── CONFIG ────────────────────────────────────────────────
  const CONFIG = {
    timing: TIMING,
    particleCount: 12,
    particleCountLow: 6,
    zIndex: 99998,
    debounceMs: 150,
  };

  // ── STATE ─────────────────────────────────────────────────
  let _overlay = null;
  let _isActive = false;
  let _isHiding = false;
  let _pendingNavigation = null;
  let _timers = [];
  let _safetyTimer = null;
  let _lastCall = 0;

  // ── PERFORMANCE ──────────────────────────────────────────
  const _perf = {
    isLowEnd: (function() {
      const memory = navigator.deviceMemory;
      const hw = navigator.hardwareConcurrency;
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (memory && memory <= 2) return true;
      if (hw && hw <= 2) return true;
      if (mobile && (!memory || memory <= 4)) return true;
      return false;
    })(),
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  };

  // ── TEXT VARIATIONS ────────────────────────────────────────
  const MESSAGES = {
    roomHub: [
      { main: 'Entering RoomHub', sub: 'Deepening into the listening space' },
      { main: 'Opening Hub', sub: 'Stepping into the collective' },
      { main: 'RoomHub', sub: 'Finding your space' },
      { main: 'Loading Hub', sub: 'Connecting listeners' },
    ],
    room: [
      { main: 'Entering room', sub: 'Syncing with the space' },
      { main: 'Joining session', sub: 'Waiting for the beat' },
      { main: 'Connecting', sub: 'Finding your frequency' },
      { main: 'Entering', sub: 'Tuning in together' },
      { main: 'Joining', sub: 'The session awaits' },
    ],
    home: [
      { main: 'Returning home', sub: 'Back to midnight' },
      { main: 'Going home', sub: 'Finding your quiet' },
      { main: 'Home', sub: 'Your midnight awaits' },
    ],
    reconnect: [
      { main: 'Reconnecting', sub: 'Hold on...' },
      { main: 'Reconnecting', sub: 'Almost there...' },
    ],
    leave: [
      { main: 'Leaving', sub: 'Until next time' },
    ],
    roomClosed: [
      { main: 'Room closed', sub: 'Heading back to hub' },
    ],
  };

  // ── TIMER HELPERS ─────────────────────────────────────────
  function _clearTimers() {
    _timers.forEach(t => clearTimeout(t));
    _timers = [];
    if (_safetyTimer) {
      clearTimeout(_safetyTimer);
      _safetyTimer = null;
    }
  }

  function _addTimer(fn, delay) {
    const id = setTimeout(fn, delay);
    _timers.push(id);
    return id;
  }

  // ── DOM ──────────────────────────────────────────────────
  function _createOverlay() {
    if (_overlay) return;
    log('Creating overlay');

    _overlay = document.createElement('div');
    _overlay.id = 'room-transition';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', 'Loading');

    _injectStyles();
    _overlay.innerHTML = _buildHTML();
    _applyPerformanceLayers();

    // CRITICAL: pointer-events none by default
    _overlay.style.pointerEvents = 'none';
    
    document.body.appendChild(_overlay);
    log('Overlay created and appended');
  }

  function _buildHTML() {
    const count = _perf.isLowEnd ? CONFIG.particleCountLow : CONFIG.particleCount;
    
    const particles = Array.from({ length: count }, (_, i) => {
      const positions = [8, 15, 23, 32, 42, 55, 63, 72, 81, 88, 95, 5];
      const delays = [0, 1.2, 2.5, 0.8, 3.1, 1.7, 2.9, 0.4, 2.2, 1.5, 3.4, 2.8];
      const pos = positions[i % positions.length];
      const delay = delays[i % delays.length];
      const size = i % 4 === 0 ? 'bright' : (i % 3 === 0 ? 'dim' : '');
      const duration = 7 + (i % 4);
      return `<span class="transition-particle ${size}" style="left:${pos}%;animation-delay:${delay}s;animation-duration:${duration}s"></span>`;
    }).join('');

    const waveformBars = Array.from({ length: 12 }, (_, i) => {
      const heights = [20, 35, 25, 40, 30, 38, 22, 32, 28, 36, 24, 30];
      return `<span class="transition-waveform-bar" style="height:${heights[i]}px;animation-delay:${i * 0.1}s"></span>`;
    }).join('');

    return `
      <div class="transition-bg"></div>
      <div class="transition-glow transition-glow--purple"></div>
      <div class="transition-glow transition-glow--cyan"></div>
      <div class="transition-glow transition-glow--pink"></div>
      <div class="transition-pulse-ring"></div>
      <div class="transition-pulse-ring"></div>
      <div class="transition-pulse-ring"></div>
      <div class="transition-particles">${particles}</div>
      <div class="transition-waveform">${waveformBars}</div>
      <div class="transition-text">
        <div class="transition-text-main" data-text="main"></div>
        <div class="transition-text-sub" data-text="sub"></div>
      </div>
    `;
  }

  function _applyPerformanceLayers() {
    if (!_overlay) return;
    
    _overlay.style.contain = 'strict';
    
    if (_perf.isLowEnd) {
      _overlay.querySelector('.transition-particles')?.remove();
      _overlay.querySelectorAll('.transition-pulse-ring').forEach(el => el.remove());
      const pinkGlow = _overlay.querySelector('.transition-glow--pink');
      if (pinkGlow) pinkGlow.style.display = 'none';
    }
    
    if (_perf.prefersReducedMotion) {
      _overlay.querySelectorAll('.transition-glow, .transition-particle, .transition-waveform-bar, .transition-pulse-ring')
        .forEach(el => el.style.animation = 'none');
    }
  }

  function _injectStyles() {
    if (document.getElementById('room-transition-styles')) return;
    const link = document.createElement('link');
    link.id = 'room-transition-styles';
    link.rel = 'stylesheet';
    link.href = '/css/transition.css?v=20260512_3';
    document.head.appendChild(link);
  }

  // ── MESSAGE SELECTION ─────────────────────────────────────
  function _getMessage(key) {
    const pool = MESSAGES[key] || MESSAGES.room;
    const index = Math.floor((Date.now() / 1000) % pool.length);
    return pool[index];
  }

  // ── NAVIGATE (CRITICAL) ───────────────────────────────────
  function _navigate(url) {
    log('Navigating to:', url);
    window.location.href = url;
  }

  // ── DEBOUNCE ─────────────────────────────────────────────
  function _shouldProceed() {
    const now = Date.now();
    if (now - _lastCall < CONFIG.debounceMs) {
      log('Debounced:', now - _lastCall, 'ms since last call');
      return false;
    }
    _lastCall = now;
    return true;
  }

  // ── SHOW ─────────────────────────────────────────────────
  function _show(key = 'roomHub', customMain = null, customSub = null) {
    return new Promise((resolve) => {
      log('Show:', key);
      
      _clearTimers();
      _createOverlay();
      
      _isActive = true;
      _isHiding = false;
      
      const msg = customMain 
        ? { main: customMain, sub: customSub || '' } 
        : _getMessage(key);
      
      const mainEl = _overlay.querySelector('[data-text="main"]');
      const subEl = _overlay.querySelector('[data-text="sub"]');
      if (mainEl) mainEl.textContent = msg.main;
      if (subEl) subEl.textContent = msg.sub;
      _overlay.setAttribute('aria-label', msg.main);

      // Reset animations
      _overlay.querySelectorAll('.transition-text-main, .transition-text-sub').forEach(el => {
        el.style.animation = 'none';
        void el.offsetHeight;
        el.style.animation = '';
      });

      // Force reflow
      void _overlay.offsetWidth;

      // SHOW - set pointer-events before adding class
      _overlay.style.pointerEvents = 'all';
      _overlay.classList.add('active');
      
      log('Overlay shown, setting safety timer');

      // Safety timeout - navigate even if promise hangs
      _safetyTimer = _addTimer(() => {
        log('SAFETY TIMEOUT - forcing proceed');
        _isActive = false;
        resolve();
      }, TIMING.safetyTimeout);

      // Resolve after transition should complete
      _addTimer(() => {
        log('Transition timer resolved');
        resolve();
      }, TIMING.fadeIn + TIMING.hold);
    });
  }

  // ── HIDE ─────────────────────────────────────────────────
  function _hide() {
    return new Promise((resolve) => {
      log('Hide called, isActive:', _isActive);
      
      if (!_overlay || !_isActive) {
        log('Hide: no overlay or not active');
        resolve();
        return;
      }

      _isActive = false;
      _isHiding = true;
      _clearTimers();
      
      // Hide - remove pointer-events first
      _overlay.style.pointerEvents = 'none';
      _overlay.classList.remove('active');
      
      log('Overlay hidden, waiting for fade out');
      
      _addTimer(() => {
        log('Hide complete');
        resolve();
      }, TIMING.fadeOut);
    });
  }

  // ── FORCE HIDE (EMERGENCY) ─────────────────────────────
  function _forceHide() {
    log('Force hide');
    _clearTimers();
    _isActive = false;
    _isHiding = false;
    
    if (_overlay) {
      _overlay.style.pointerEvents = 'none';
      _overlay.classList.remove('active');
      _overlay.style.opacity = '0';
      _overlay.style.visibility = 'hidden';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // All navigation functions have SAFE FALLBACK
  // If transition fails, navigation STILL happens
  // ═══════════════════════════════════════════════════════════

  /**
   * Navigate with transition (SAFE)
   */
  function to(url, message, subMessage) {
    log('to() called with:', url);
    
    // Debounce
    if (!_shouldProceed()) {
      log('to() blocked by debounce');
      return;
    }
    
    // Already transitioning?
    if (_isActive) {
      log('to() blocked - already active');
      // SAFETY: Still navigate even if stuck
      _navigate(url);
      return;
    }
    
    _pendingNavigation = url;
    
    // Show transition
    _show('roomHub', message, subMessage)
      .then(() => {
        log('to() transition complete, navigating');
        if (_pendingNavigation === url) {
          _pendingNavigation = null;
          _navigate(url);
        }
      })
      .catch((err) => {
        log('to() error:', err);
        // SAFETY: Navigate on error
        _navigate(url);
      });
    
    // DOUBLE SAFETY: Timeout fallback
    _addTimer(() => {
      log('Double safety timeout - checking pending:', _pendingNavigation);
      if (_pendingNavigation === url) {
        log('Double safety: forcing navigation');
        _pendingNavigation = null;
        _forceHide();
        _navigate(url);
      }
    }, TIMING.safetyTimeout);
  }

  /**
   * Navigate to RoomHub (SAFE)
   */
  function toRoomHub() {
    log('toRoomHub() called');
    to('/room-hub.html');
  }

  /**
   * Navigate to RoomHub with auto-join for a specific room.
   * - Sets mm_pending_room so RoomHub auto-joins on load
   * - All error flows return cleanly to /room-hub.html
   */
  function toRoom(roomId, roomName) {
    log('toRoom() called:', roomId);
    const main = roomName ? `Entering ${roomName}` : null;
    to(`/room-hub.html?join=${encodeURIComponent(roomId)}`, main);
  }

  /**
   * Navigate home (SAFE)
   */
  function toHome() {
    log('toHome() called');
    to('/');
  }

  /**
   * Leave room with transition (SAFE)
   */
  function leave() {
    log('leave() called');
    if (!_shouldProceed()) return;

    // Clear ALL join-related transient state to prevent cross-flow contamination
    try {
      sessionStorage.removeItem('mm_pending_room');
      sessionStorage.removeItem('mm_auto_join');
      sessionStorage.removeItem('mm_deep_link_target');
      sessionStorage.removeItem('mm_reconnect_room');
      // Clear join password for all rooms (pattern: mm_joinPw_*)
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('mm_joinPw_')) {
          sessionStorage.removeItem(key);
        }
      }
      console.log('[LEAVE] Cleared join state');
    } catch (_) {}

    _show('leave').then(() => {
      _navigate('/room-hub.html');
    }).catch(() => {
      _navigate('/room-hub.html');
    });

    // Safety timeout
    _addTimer(() => {
      _navigate('/room-hub.html');
    }, TIMING.safetyTimeout);
  }

  /**
   * Room closed handler (SAFE)
   */
  function roomClosed() {
    log('roomClosed() called');

    // Clear session marker to prevent stale session reuse
    try {
      sessionStorage.removeItem('mm_pending_room');
      sessionStorage.removeItem('mm_auto_join');
      // Clear join passwords for all rooms
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('mm_joinPw_')) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (_) {}

    _show('roomClosed').then(() => {
      _navigate('/room-hub.html');
    }).catch(() => {
      _navigate('/room-hub.html');
    });

    _addTimer(() => {
      _navigate('/room-hub.html');
    }, TIMING.safetyTimeout);
  }

  /**
   * Show reconnecting overlay
   */
  function reconnecting() {
    log('reconnecting() called, isActive:', _isActive);
    if (_isActive) return;
    _show('reconnect');
  }

  /**
   * Hide reconnecting overlay
   */
  function reconnected() {
    log('reconnected() called');
    return _hide();
  }

  /**
   * Manual hide
   */
  function hide() {
    log('hide() called');
    return _hide();
  }

  /**
   * Emergency force hide
   */
  function forceHide() {
    log('forceHide() called');
    _forceHide();
  }

  /**
   * Check state
   */
  function isActive() {
    return _isActive;
  }

  /**
   * Preload assets
   */
  function preload(url) {
    if (!url) return;
    const hrefs = [];
    if (url === '/') hrefs.push('/css/main.css');
    else if (url.includes('/room') && !url.includes('/r/')) {
      hrefs.push('/css/room-hub.css?v=20260512');
      hrefs.push('/css/transition.css?v=20260512_3');
    } else if (url.includes('/r/')) {
      hrefs.push('/css/room-page.css?v=20260512_5');
      hrefs.push('/css/transition.css?v=20260512_3');
    }
    
    hrefs.forEach(href => {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'style';
      link.href = href;
      document.head.appendChild(link);
    });
  }

  // ── EVENT HANDLERS ───────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _isActive) {
      log('Page hidden while transitioning');
    }
  });

  window.addEventListener('beforeunload', () => _forceHide());
  window.addEventListener('popstate', () => {
    if (_isActive) {
      log('Back button during transition');
      _forceHide();
    }
  });

  // ── AUTO INIT ────────────────────────────────────────────
  function _init() {
    log('Auto init, readyState:', document.readyState);
    _forceHide();
    if (document.readyState !== 'complete') {
      _addTimer(_forceHide, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ── EXPOSE API ────────────────────────────────────────────
  return {
    to: to,
    toRoomHub: toRoomHub,
    toRoom: toRoom,
    toHome: toHome,
    leave: leave,
    roomClosed: roomClosed,
    reconnecting: reconnecting,
    reconnected: reconnected,
    hide: hide,
    forceHide: forceHide,
    isActive: isActive,
    preload: preload,
    CONFIG: CONFIG,
    TIMING: TIMING,
  };

})();

// Debug helper
window.MM_DEBUG = true;
