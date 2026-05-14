/**
 * room-page.js — Integrated Search Edition
 * Search/Input bây giờ nằm TRONG playlist panel.
 * Player dùng đúng ID từ homepage (#play-btn, #music-progress...)
 */

/* ── Shims for mood-manager.js / visualizer.js ── */
window.state = {
  currentMood: 'chill',
  effects: { 
    suspended: false, 
    active: ['stars'],
    mobilePerformanceMode: (window.innerWidth <= 768) || (navigator.deviceMemory && navigator.deviceMemory <= 4),
    tier: (function() {
      const t = typeof getPerformanceTier === 'function' ? getPerformanceTier() : 'mid';
      document.body.classList.add(`tier-${t}`);
      return t;
    })()
  },
  isPlaying: false, soundcloud: { active: false },
  focus: { running: false }, playerMinimized: false,
};
window.$ = {
  canvas: {
    stars:   document.getElementById('stars'),
    rain:    document.getElementById('rain'),
    bubbles: document.getElementById('bubbles'),
    leaves:  document.getElementById('leaves'),
    meteors: document.getElementById('meteors'),
  },
  notif:   document.getElementById('notif'),
  welcome: { classList: { add: () => {}, remove: () => {} } },
  app:     { classList: { add: () => {}, remove: () => {} } },
  moodChip: document.getElementById('mood-chip') || { textContent: '' },
};
window.MOODS     = ['sad','happy','chill','sleep','study'];
window.MOOD_META = {
  sad:  { emoji: '🌧', label: 'Sad'   },
  happy:{ emoji: '☀️', label: 'Happy' },
  chill:{ emoji: '🌙', label: 'Chill' },
  sleep:{ emoji: '✨', label: 'Sleep' },
  study:{ emoji: '📚', label: 'Study' },
};
window.getMoodPlaylist   = () => ({ id:'room', mood:'room', trackIds:[] });
window.getRandomTrackId  = () => null;
window.getPlaylistTrackIds = () => [];
window.playTrackById     = async () => {};
window.updatePlayerUI    = () => {};
window.syncPlayerUI      = () => {};
window.closeAllPanels    = () => document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));

/* ── Room state ── */
const room = {
  id: null, socket: null, ytPlayer: null, ytReady: false,
  currentVideoId: null, isPlaying: false, playlist: [], members: [],
  currentMood: null,  // set from joined-room, used for fallback check
  isHost: false, hostId: null,
  myName: localStorage.getItem('mm_room_username') || ('Guest_' + Math.floor(Math.random()*9000+1000)),
  myAvatar: '',  // set from guest-profile or join-room emit
  // Stable browser identity: read mm_client_id directly (shared between all tabs)
  // Uses crypto.randomUUID if available, falls back to timestamp+random string.
  // guest-profile.js stores it under 'mm_client_id'; this is the single source of truth.
  myClientId: (() => {
    try {
      const raw = localStorage.getItem('mm_client_id');
      if (raw) return raw;
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem('mm_client_id', id);
      return id;
    } catch (_) {
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  })(),
  trackVersion: 0,
  currentTrackIndex: -1,
};

let _lastAppliedTrackVersion = 0;
let _lastAppliedTrackId = null;
let _isApplyingTrackChange = false;
let _isRemoteSync = false;
let _pendingVideoId  = null;
let _pendingTime     = 0;
let _pendingPlaying  = false;
let _forceSourceLoadTimer = null;
let _ytPlayerInitialized = false;
let _qualityAppliedForVideoId = null;
// Debounce: skip playlist from joined-room if we just received a fresh playlist-updated
let _skipPlaylistOnJoinedRoom = false;
let _skipPlaylistTimer = null;
// Search results: stored to rerender after playlist changes
let _lastSearchResults = null;
let _serverTimeOffset = 0;
let _progressIntervalId = null;
let _lastHeartbeatTime = 0;
let _iframeInteractionMode = false;
let _iframeInteractionTimer = null;

// ── PENDING ROOM STATE ──────────────────────────────────
// Queue room state khi player chưa ready
let _pendingRoomState = null;

// ── HYBRID SYNC STATE ─────────────────────────────────────
// Anti-over-sync: throttling và threshold-based correction
let _lastCorrectionTime = 0;          // Thời điểm correction cuối
let _isSoftSyncing = false;           // Đang trong quá trình soft correction
let _softCorrectionTimer = null;       // Timer để reset playbackRate
let _lastAppliedPlaybackRate = 1.0;   // Lưu playbackRate gốc để restore

// ── ACTION VERSIONING ───────────────────────────────────
// Chống stale state overwrite newer state
let _lastAppliedActionId = 0;         // Action ID đã apply cuối
let _hardSyncLockUntil = 0;           // 10s action lock sau hard sync
let _seekCooldownUntil = 0;           // Không nhận seek sync trong X ms

// ── AUTHORITATIVE ACTION TRACKING ────────────────────────
let _lastAuthoritativeAction = null;  // { actionId, actionType, actorSocketId, timestamp }

// ── CONTROLLER STATE ────────────────────────────────────
let _controllerIds = []; // Danh sách user có quyền điều khiển

// ── ROOM LIFECYCLE STATE ──────────────────────────────
// Track if room is still valid (not closed, not dead)
let _roomIsValid = true;
// Track if we're currently in a reconnect attempt
let _isReconnecting = false;

// ── ROOM LIFECYCLE HELPERS ─────────────────────────────

/**
 * redirectToRoomHub()
 * Clean redirect to RoomHub subdomain, clearing all room state.
 */
function redirectToRoomHub() {
  console.log('[ROOM_LIFECYCLE] Redirecting to RoomHub');

  // Mark room as invalid to prevent any further socket operations
  _roomIsValid = false;

  // Clear all room state
  try {
    sessionStorage.removeItem('mm_active_room');
    sessionStorage.removeItem('mm_pending_room');
    sessionStorage.removeItem('mm_createState_' + room.id);
    // Clear all join passwords
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('mm_joinPw_')) {
        sessionStorage.removeItem(key);
      }
    }
    // Clear host tokens for this room
    sessionStorage.removeItem('hostToken_' + room.id);
  } catch (e) {
    console.warn('[ROOM_LIFECYCLE] Failed to clear sessionStorage:', e);
  }

  // Disconnect socket
  if (room.socket) {
    room.socket.disconnect();
    room.socket = null;
  }

  // Navigate to RoomHub
  window.location.href = getRoomHubUrl();
}

/**
 * showRoomDeadMessage(msg)
 * Show a message before redirecting to RoomHub.
 */
function showRoomDeadMessage(msg) {
  console.log('[ROOM_LIFECYCLE] Showing dead message:', msg);
  _roomIsValid = false;

  // Stop any player
  try { room.ytPlayer?.stopVideo?.(); } catch (_) {}

  // Show toast
  showToast(msg, 'warning');

  // Redirect after delay
  setTimeout(() => {
    redirectToRoomHub();
  }, 2000);
}

// ── Simple autoplay: always start muted, require click to unmute ──────────
function autoplayVideo(p) {
  if (!p) return;

  // Always start muted - requires user click to unmute
  p.mute();
  p.playVideo();
}

  // ── AUDIO UNLOCK STATE ─────────────────────────────────
let _audioUnlocked = false;
let _hasUserInteracted = false;

// ── Toggle mute / unlock audio ─────────────────────────
function toggleMute() {
  if (!room.ytPlayer) return;

  const isMuted = room.ytPlayer.isMuted?.();

  if (isMuted) {
    room.ytPlayer.unMute?.();
    room.ytPlayer.setVolume?.(100);
    _audioUnlocked = true;
    console.log('[AUDIO_UNLOCKED_STATE]', _audioUnlocked);

    // Ẩn button unlock
    const btn = document.querySelector('.unlock-audio-btn');
    if (btn) btn.style.display = 'none';

    console.log('[AUDIO][UNMUTED]');
    showToast('Đã bật âm thanh');
  } else {
    room.ytPlayer.mute?.();
    console.log('[AUDIO][MUTED]');
    showToast('Đã tắt âm thanh');
  }
}

/* ── YouTube iframe interaction mode (for native settings/quality menu) ── */
function enableIframeInteractionMode() {
  if (_iframeInteractionMode) return;
  _iframeInteractionMode = true;
  document.body.classList.add('yt-iframe-mode');

  const btn = document.getElementById('yt-quality-btn');
  if (btn) btn.classList.add('active');

  // Belt-and-suspenders: explicitly set inline styles
  const overlay = document.getElementById('youtube-overlay');
  const iframe = document.getElementById('youtube-player');
  if (overlay) {
    overlay.style.pointerEvents = 'none';
    console.log('[YT][OVERLAY_DISABLED]', getComputedStyle(overlay).pointerEvents);
  }
  if (iframe) {
    iframe.style.pointerEvents = 'auto';
    console.log('[YT][IFRAME_POINTER_AUTO]', getComputedStyle(iframe).pointerEvents);
  }

  console.log('[YT][INTERACTION_MODE_ON]');

  // Auto-exit after 8 seconds of no interaction
  _iframeInteractionTimer = setTimeout(() => {
    disableIframeInteractionMode();
  }, 8000);
}

function disableIframeInteractionMode() {
  if (!_iframeInteractionMode) return;
  _iframeInteractionMode = false;
  document.body.classList.remove('yt-iframe-mode');

  const btn = document.getElementById('yt-quality-btn');
  if (btn) btn.classList.remove('active');

  // Restore inline styles
  const overlay = document.getElementById('youtube-overlay');
  const iframe = document.getElementById('youtube-player');
  if (overlay) {
    overlay.style.pointerEvents = 'auto';
    console.log('[YT][OVERLAY_ENABLED]', getComputedStyle(overlay).pointerEvents);
  }
  if (iframe) {
    iframe.style.pointerEvents = 'none';
    console.log('[YT][IFRAME_POINTER_NONE]', getComputedStyle(iframe).pointerEvents);
  }

  if (_iframeInteractionTimer) {
    clearTimeout(_iframeInteractionTimer);
    _iframeInteractionTimer = null;
  }

  console.log('[YT][INTERACTION_MODE_OFF]');

  // Resync current state to room after exiting interaction mode
  if (room.currentVideoId && room.ytPlayer && room.ytReady) {
    const currentTime = room.ytPlayer.getCurrentTime?.() || 0;
    const isPlaying = room.ytPlayer.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
    console.log('[SYNC][RESUMED_AFTER_IFRAME_INTERACTION] emitting current state');
    room.socket?.emit('sync-video', {
      currentVideoId: room.currentVideoId,
      currentTime,
      isPlaying,
      trackVersion: room.trackVersion,
    });
  }
}

function setupIframeInteraction() {
  const btn = document.getElementById('yt-quality-btn');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[YT][QUALITY_BTN_CLICK]');
    if (_iframeInteractionMode) {
      disableIframeInteractionMode();
    } else {
      enableIframeInteractionMode();
    }
  });

  // Click outside iframe → exit interaction mode
  document.getElementById('youtube-overlay')?.addEventListener('click', (e) => {
    if (_iframeInteractionMode && e.target.id === 'youtube-overlay') {
      disableIframeInteractionMode();
    }
  });

  // User interacts with iframe (mousemove/mousedown inside) → reset auto-exit timer
  document.getElementById('youtube-player')?.addEventListener('mousemove', () => {
    if (!_iframeInteractionMode) return;
    if (_iframeInteractionTimer) {
      clearTimeout(_iframeInteractionTimer);
      _iframeInteractionTimer = setTimeout(() => {
        disableIframeInteractionMode();
      }, 8000);
    }
  });
  document.getElementById('youtube-player')?.addEventListener('mousedown', () => {
    if (!_iframeInteractionMode) return;
    if (_iframeInteractionTimer) {
      clearTimeout(_iframeInteractionTimer);
      _iframeInteractionTimer = setTimeout(() => {
        disableIframeInteractionMode();
      }, 8000);
    }
  });
}

// ── Helper: kiểm tra quyền điều khiển ─────────────────
function canControlPlayer() {
  const myId = room.socket?.id;
  const isHost = room.isHost;
  const hasControllerRight = _controllerIds.includes(myId);
  const canControl = isHost || hasControllerRight;
  console.log(`[CAN_CONTROL] isHost=${isHost} hasController=${hasControllerRight} canControl=${canControl}`);
  return canControl;
}

// ── Permission feedback ───────────────────────────────────
let _lastPermissionToast = 0;

function showPermissionDeniedToast(action = 'hành động này') {
  const now = Date.now();
  if (now - _lastPermissionToast < 1500) return; // debounce 1.5s
  _lastPermissionToast = now;
  console.log(`[PERMISSION][DENIED] action=${action}`);
  showToast('Chỉ những người được host cấp quyền mới có thể tương tác');
}

/** Timer to apply default mood if socket never fires */
/* ── DOM cache ── */
const el = {
  roomIdDisplay:  document.getElementById('room-id-display'),
  roomNameDisplay: document.getElementById('room-name-display'),
  memberCountNum: document.getElementById('member-count-num'),
  // Member panel
  memberListBtn:   document.getElementById('member-list-btn'),
  memberPanel:    document.getElementById('member-panel'),
  memberPanelClose: document.getElementById('member-panel-close'),
  memberList:      document.getElementById('member-list'),
  // Player (homepage IDs)
  songTitle:      document.getElementById('song-title'),
  songMood:       document.getElementById('song-mood'),
  dockThumb:      document.querySelector('.room-dock-thumb'),
  playBtn:        document.getElementById('play-btn'),
  prevBtn:        document.getElementById('prev-btn'),
  nextBtn:        document.getElementById('next-btn'),
  volumeBtn:      document.getElementById('volume-btn'),
  musicProgress:  document.getElementById('music-progress'),
  currentTime:    document.getElementById('current-time'),
  durationTime:   document.getElementById('duration-time'),
  notif:          document.getElementById('notif'),
  // Panel tabs
  plistTabs:      document.querySelectorAll('.plist-tab'),
  // Search refs — populated in setupSearch() after DOM is ready
  ytSearchInput:  null,
  ytResults:      null,  // = #search-results-list (search tab scroll container)
  ytSearchBtn:    null,
  ytRefreshBtn:   null,
  // Playlist
  sharedQueue:    document.getElementById('shared-queue'),
  queueCount:     document.getElementById('queue-count'),
  // Now Playing bar (playlist tab)
  nowPlayingBar:  document.getElementById('now-playing-bar'),
  npbThumb:       document.getElementById('npb-thumb'),
  npbTitle:       document.getElementById('npb-title'),
  npbArtist:      document.getElementById('npb-artist'),
  // Chat
  roomMessages:   document.getElementById('room-messages'),
  chatInput:      document.getElementById('chat-input'),
  sendMsgBtn:     document.getElementById('send-msg-btn'),
  // Mood
  toggleMoodBtn:  document.getElementById('toggle-mood-btn'),
  moodPanel:      document.getElementById('mood-panel'),
  moodPanelClose: document.getElementById('mood-panel-close'),
  // Leave + reactions
  leaveBtn:       document.getElementById('leave-btn'),
  reactBtns:      document.querySelectorAll('.react-btn'),
  moodSyncBtns:   document.querySelectorAll('.mood-sync-btn'),
  // Suggestion chips (inside search tab)
  chips:          document.querySelectorAll('.plist-chip'),
  // Player toggle
  playerToggle:   document.getElementById('player-toggle'),
  bottom:         document.getElementById('bottom'),
};

/* ============================================================
   REUSABLE HELPERS
   ============================================================ */

/**
 * isTrackInPlaylist(id) — single source of truth for duplicate detection.
 * Always checks live room.playlist array.
 */
function isTrackInPlaylist(id) {
  return room.playlist.some(t => t.id === id);
}

/** Set of videoIds known to be non-embeddable/broken at runtime */
const _blockedIds = new Set();

/** Returns true if this video should never be played */
function isVideoBlocked(id) {
  return _blockedIds.has(id);
}

/**
 * showToast(message, type) — glassmorphism toast.
 * type: 'success' | 'warning' | 'info'  (default: 'info')
 * Auto-hides after 2 seconds.
 */
let _toastTimer = null;
function showToast(msg, type = 'info') {
  const el_ = el.notif;
  if (!el_) return;

  // Color coding via CSS class
  el_.classList.remove('toast-success', 'toast-warning', 'toast-info');
  el_.classList.add(`toast-${type}`);

  el_.textContent = msg;
  el_.classList.add('show');

  // Reset any pending hide
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el_?.classList.remove('show'), 2000);
}

/** Legacy wrapper — keep internal calls working */
function notify(msg) { showToast(msg, 'info'); }

/* ── Player Collapse — reuse homepage logic (hidePlayer/showPlayer) ── */
let playerMinimized = false;

function hidePlayer() {
  playerMinimized = true;
  el.bottom?.classList.add('hidden-player');
  el.playerToggle?.setAttribute('aria-label', 'Expand player');
  try { localStorage.setItem('mm_room_player_minimized', '1'); } catch {}
}

function showPlayer() {
  playerMinimized = false;
  el.bottom?.classList.remove('hidden-player');
  el.playerToggle?.setAttribute('aria-label', 'Minimize player');
  try { localStorage.setItem('mm_room_player_minimized', '0'); } catch {}
}

function togglePlayerVisibility() {
  playerMinimized ? showPlayer() : hidePlayer();
}

function setupPlayerToggle() {
  el.playerToggle?.addEventListener('click', togglePlayerVisibility);
  // Restore state from last session
  try {
    if (localStorage.getItem('mm_room_player_minimized') === '1') hidePlayer();
  } catch {}
}

/* ── Panel Tabs ── */
window._currentTab = 'search'; // Default tab

function setupPlistTabs() {
  // Initialize current tab based on active class
  const initialTab = Array.from(el.plistTabs).find(t => t.classList.contains('active'));
  if (initialTab) window._currentTab = initialTab.dataset.tab;

  el.plistTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      window._currentTab = tab.dataset.tab;
      
      // Clear unread state if chat tab is opened
      if (window._currentTab === 'chat') {
        tab.classList.remove('unread');
      }

      // Toggle tab button active state
      el.plistTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // Toggle content active state (CSS handles opacity+visibility, no layout jump)
      document.querySelectorAll('.plist-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById('plist-content-' + tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

/* ── Mood Panel ── */
function setupMoodPanel() {
  el.toggleMoodBtn?.addEventListener('click', () => {
    _toggleSidePanel(el.moodPanel);
  });
  el.moodPanelClose?.addEventListener('click', () => {
    el.moodPanel?.classList.remove('open');
  });
  el.moodSyncBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      applyMood(btn.dataset.mood);
      room.socket?.emit('sync-mood', btn.dataset.mood);
      el.moodPanel?.classList.remove('open');
    });
  });
  document.addEventListener('click', e => {
    if (!el.moodPanel?.contains(e.target) && e.target !== el.toggleMoodBtn)
      el.moodPanel?.classList.remove('open');
  }, true);
}

/**
 * applyMood(mood) — authoritative mood setter for room page.
 * 1. Applies body CSS class (controls theme/colors/gradients)
 * 2. Triggers visual particle effects (rain, bubbles, leaves, meteors...)
 * 3. Updates mood chip display
 * 4. Updates active button highlights in mood panel
 * 5. Syncs window.state.currentMood
 *
 * Works standalone (no dependency on homepage mood-manager.js)
 */
function applyMood(mood, { remote = false } = {}) {
  if (!window.MOODS?.includes(mood)) return;

  // Ensure effects are resumed if they were suspended during load/background tab
  if (typeof effects !== 'undefined') effects.resumeAll();

  // 1. Body class → drives CSS theme variables
  document.body.classList.remove('mood-sad','mood-happy','mood-chill','mood-sleep','mood-study');
  document.body.classList.add(`mood-${mood}`);

  // 2. Mood chip label
  const meta = window.MOOD_META?.[mood];
  if (meta && window.$?.moodChip) {
    window.$.moodChip.textContent = `${meta.emoji} ${meta.label}`;
  }

  // 3. Particle effects via canvas opacity + effect start/stop
  const cvs = window.$.canvas;
  const _set = (el, val) => { if (el) el.style.opacity = val; };

  // Hide all first
  _set(cvs.rain,    0);
  _set(cvs.bubbles, 0);
  _set(cvs.leaves,  0);
  _set(cvs.meteors, 0);

  // Sleep / Study decorations
  const sleepDecor = document.getElementById('sleep-decor');
  const studyDecor = document.getElementById('study-decor');
  if (sleepDecor) { sleepDecor.style.opacity = 0; sleepDecor.classList.add('hidden-decor'); }
  if (studyDecor) { studyDecor.style.opacity = 0; studyDecor.classList.add('hidden-decor'); }

  // Stop previous loops
  if (typeof effects !== 'undefined') {
    ['rain','bubbles','leaves','meteors'].forEach(n => effects.stop?.(n));
  }

  // Start the correct effect
  const effectMap = {
    sad:   () => { _set(cvs.rain,    0.55); if(typeof startRain    === 'function') startRain();    if(typeof effects !== 'undefined') effects.start?.('rain'); },
    happy: () => { _set(cvs.bubbles, 0.80); if(typeof startBubbles === 'function') startBubbles(); if(typeof effects !== 'undefined') effects.start?.('bubbles'); },
    chill: () => { _set(cvs.leaves,  0.90); if(typeof startLeaves  === 'function') startLeaves();  if(typeof effects !== 'undefined') effects.start?.('leaves'); },
    sleep: () => {
      _set(cvs.meteors, 0.90);
      if(typeof startMeteors === 'function') startMeteors();
      if(typeof effects !== 'undefined') effects.start?.('meteors');
      if(sleepDecor) { sleepDecor.classList.remove('hidden-decor'); sleepDecor.style.opacity = 1; }
    },
    study: () => {
      if(studyDecor) { studyDecor.classList.remove('hidden-decor'); studyDecor.style.opacity = 0.95; }
    },
  };
  effectMap[mood]?.();

  // 4. Update active highlight on mood-sync-btn buttons
  document.querySelectorAll('.mood-sync-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mood === mood);
  });

  // 5. Sync window.state
  if (window.state) {
    window.state.currentMood = mood;
    const active = ['stars'];
    if (mood === 'sad') active.push('rain');
    if (mood === 'happy') active.push('bubbles');
    if (mood === 'chill') active.push('leaves');
    if (mood === 'sleep') active.push('meteors');
    window.state.effects.active = active;
  }
  room.currentMood = mood;
}

/** Update active highlight on mood-sync-btn buttons */

/* ── YouTube Search (on Enter / button click — NOT realtime) ── */
let _lastQuery        = '';
let _lastContinuation = null;

function setupSearch() {
  // Bind DOM refs (in new Search tab)
  el.ytSearchInput = document.getElementById('yt-search-input');
  el.ytResults     = document.getElementById('search-results-list'); // scroll container in Search tab
  el.ytSearchBtn   = document.getElementById('yt-search-btn');
  el.ytRefreshBtn  = document.getElementById('yt-refresh-btn');

  // Search on Enter
  el.ytSearchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (!q) return;
      // URL paste → add directly
      if (q.includes('youtube.com/') || q.includes('youtu.be/')) {
        const id = extractVideoId(q);
        if (id) {
          addTrack(id, 'YouTube Video', '', `https://img.youtube.com/vi/${id}/mqdefault.jpg`);
          fetchOEmbed(id).then(meta => {
            const t = room.playlist.find(t => t.id === id);
            if (t && meta.title) { t.title = meta.title; t.author = meta.author; renderQueue(); }
          });
          e.target.value = '';
        }
        return;
      }
      doSearch(q);
    }
  });

  // Search button
  el.ytSearchBtn?.addEventListener('click', () => {
    const q = el.ytSearchInput?.value.trim();
    if (q) doSearch(q);
  });

  // Refresh button → next page
  el.ytRefreshBtn?.addEventListener('click', () => {
    if (_lastContinuation) doSearchContinuation(_lastContinuation);
    else if (_lastQuery) doSearch(_lastQuery);
  });

  // Chips: fill input + search
  el.chips.forEach(chip => {
    chip.addEventListener('click', () => {
      el.chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const q = chip.dataset.query;
      if (el.ytSearchInput) el.ytSearchInput.value = q;
      doSearch(q);
    });
  });
}

async function fetchOEmbed(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!r.ok) return {};
    const d = await r.json();
    return { title: d.title, author: d.author_name };
  } catch { return {}; }
}

async function doSearch(q) {
  _lastQuery = q;
  _lastContinuation = null;
  showResultsLoading(`Đang tìm "${q}"...`);
  try {
    const url = window.CONFIG.YT_SEARCH_URL + `?q=${encodeURIComponent(q)}`;
    const res  = await fetch(url);
    const data = await res.json();
    _lastContinuation = data.nextPageToken || null;
    renderResults(data.collection || [], `Kết quả: "${q}"`);
  } catch (err) {
    showResultsMsg('Tìm kiếm thất bại. Thử lại sau.');
    console.error('[Search] error:', err);
  }
}

async function doSearchContinuation(token) {
  showResultsLoading('Đang tải thêm...');
  try {
    const url = window.CONFIG.YT_SEARCH_URL + `?q=${encodeURIComponent(_lastQuery)}&continuation=${encodeURIComponent(token)}`;
    const res  = await fetch(url);
    const data = await res.json();
    _lastContinuation = data.nextPageToken || null;
    renderResults(data.collection || [], `Kết quả khác: "${_lastQuery}"`);
  } catch (err) {
    showResultsMsg('Không tải được. Thử lại sau.');
  }
}

function showResultsLoading(msg) {
  if (!el.ytResults) return;
  el.ytResults.innerHTML = `<div class="yt-results-msg">⏳ ${msg}</div>`;
  if (el.ytRefreshBtn) el.ytRefreshBtn.style.display = 'none';
}

function showResultsMsg(msg) {
  if (!el.ytResults) return;
  el.ytResults.innerHTML = `<div class="yt-results-msg">${msg}</div>`;
}

function renderResults(items, label) {
  if (!el.ytResults) return;

  // Store for rerender after playlist changes
  _lastSearchResults = items;

  if (!items.length) {
    showResultsMsg('Không tìm thấy kết quả nào.');
    if (el.ytRefreshBtn) el.ytRefreshBtn.style.display = 'none';
    return;
  }

  // Show/hide refresh btn — always show after results loaded
  if (el.ytRefreshBtn) {
    el.ytRefreshBtn.style.display = 'flex';
    // Update tooltip to reflect action
    el.ytRefreshBtn.title = _lastContinuation
      ? '10 kết quả tiếp theo'
      : 'Tìm lại (kết quả ngẫu nhiên)';
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const inQueue   = isTrackInPlaylist(item.id);
    const isPlaying = item.id === room.currentVideoId;
    const div = document.createElement('div');
    div.className = `yt-result-item ${isPlaying ? 'playing' : ''}`;
    div.dataset.id = item.id;
    div.dataset.title = encodeURIComponent(item.title);
    div.dataset.author = encodeURIComponent(item.author || '');
    div.dataset.thumb = item.thumb;
    div.innerHTML = `
      <img class="yt-result-thumb" src="${item.thumb}" alt="" loading="lazy">
      <div class="yt-result-info">
        <span class="yt-result-title">${item.title}</span>
        <div class="yt-result-meta">
          ${isPlaying ? `<span class="yt-eq-bars"><span></span><span></span><span></span></span>` : ''}
          <span class="yt-result-author">${item.author || ''}</span>
          ${item.duration ? `<span class="yt-result-sep">·</span><span class="yt-result-duration">${item.duration}</span>` : ''}
        </div>
      </div>
      <button class="yt-add-btn ${inQueue ? 'duplicate' : ''}"
        title="${inQueue ? 'Đã có trong playlist' : 'Thêm vào playlist'}"
        aria-label="${inQueue ? 'Đã có trong playlist' : 'Thêm vào playlist'}">
        ${inQueue
          ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
        }
      </button>`;
    fragment.appendChild(div);
  });
  el.ytResults.innerHTML = '';
  el.ytResults.appendChild(fragment);

  // ── Event delegation: ONE handler on container (no stacking) ──
  el.ytResults.onclick = e => {
    const btn = e.target.closest('.yt-add-btn');
    const row = e.target.closest('.yt-result-item');
    if (!row) return;

    const id     = row.dataset.id;
    const title  = decodeURIComponent(row.dataset.title);
    const author = decodeURIComponent(row.dataset.author);
    const thumb  = row.dataset.thumb;

    if (btn) {
      // ── "+ Add" button: only add to playlist, do NOT play ──
      e.stopPropagation();

      if (btn.classList.contains('duplicate') || isTrackInPlaylist(id)) {
        showToast('⚠️ Bài này đã có trong playlist', 'warning');
        return;
      }
      addTrack(id, title, author, thumb);
      _setBtnAdded(btn);
      setTimeout(() => _setBtnDuplicate(btn), 1500);

    } else {
      // ── Card body: play immediately ──
      playFromSearch(id, title, author, thumb);
    }
  };
}

/* Update a single add-button to ✔ Added state */
function _setBtnAdded(btn) {
  btn.classList.remove('duplicate');
  btn.classList.add('added');
  btn.disabled = true;
  btn.title = 'Đã thêm';
  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
}

/* Lock button permanently as duplicate (in-queue) */
function _setBtnDuplicate(btn) {
  btn.classList.remove('added');
  btn.classList.add('duplicate');
  btn.disabled = false;
  btn.title = 'Đã có trong playlist';
  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
}

/**
 * _syncSearchActiveUI(activeId)
 * Update .playing class + equalizer bars on search result cards WITHOUT re-rendering.
 * Preserves scroll position. Call after any track switch.
 */
function _syncSearchActiveUI(activeId) {
  if (!el.ytResults) return;
  // Use children instead of querySelectorAll for speed
  const rows = el.ytResults.children;
  if (!rows.length) return;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.classList.contains('yt-result-item')) continue;

    const isActive = row.dataset.id === activeId;
    // Only touch DOM if state actually changes
    if (row.classList.contains('playing') !== isActive) {
      row.classList.toggle('playing', isActive);
      const meta = row.querySelector('.yt-result-meta');
      const existingBars = row.querySelector('.yt-eq-bars');

      if (isActive && !existingBars && meta) {
        meta.insertAdjacentHTML('afterbegin',
          `<span class="yt-eq-bars">`+
          `<span></span><span></span><span></span>`+
          `</span>`);
      } else if (!isActive && existingBars) {
        existingBars.remove();
      }
    }
  }
}

/**
 * playFromSearch(id, title, author, thumb)
 * Instantly play a track directly from search results.
 * Auto-injects into playlist if not already there.
 * Does NOT cause search list re-render.
 */
function playFromSearch(id, title, author, thumb) {
  if (isVideoBlocked(id)) {
    showToast('⚠️ Video này không thể phát', 'warning');
    return;
  }

  // Auto-inject into playlist silently if not present
  if (!isTrackInPlaylist(id)) {
    const track = { id, title, author, thumb };
    room.playlist.push(track);
    renderQueue();
    room.socket?.emit('add-to-playlist', { id, title, author, thumb });

    // Update + button state
    const row = el.ytResults?.querySelector(`.yt-result-item[data-id="${id}"]`);
    if (row) {
      const btn = row.querySelector('.yt-add-btn');
      if (btn) _setBtnDuplicate(btn);
    }
  }

  // Same track? Toggle play/pause
  if (id === room.currentVideoId) {
    togglePlayback();
    return;
  }

  // Switch track (uses existing playTrack which handles all state)
  playTrack(id);

  // Update search active UI (no re-render)
  _syncSearchActiveUI(id);
}

function extractVideoId(url) {
  // Cover: watch?v=, youtu.be/, /v/, /embed/, shorts/
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  const id = m ? m[1] : null;
  return id;
}

function addTrack(id, title, author, thumb) {
  console.log(`[ADD-TRACK] id=${id} title=${title} author=${author}`);
  if (isVideoBlocked(id)) {
    showToast('⚠️ Video này bị chặn (không thể nhúng)', 'warning');
    return;
  }
  if (isTrackInPlaylist(id)) {
    showToast('⚠️ Bài này đã có trong playlist', 'warning');
    return;
  }

  // 1. Push to local state immediately
  const track = { id, title, author, thumb };
  room.playlist.push(track);
  console.log(`[ADD-TRACK] afterPush playlistLength=${room.playlist.length} ids=${room.playlist.map(v => v.id).join(',')}`);

  // 2. Update UI immediately
  renderQueue();

  // ── 3. Sync playlist to server first ──
  room.socket?.emit('add-to-playlist', { id, title, author, thumb });

  // ── 4. Host requests authoritative track change AFTER server processes add ──
  // NOTE: We don't check room.playlist.length here (race condition with server).
  // The server auto-sets currentVideoId when playlist goes 0→1.
  // We still emit request-track-change as a fallback for non-empty→non-empty adds
  // by the host (e.g. host adds a 2nd+ track and wants it to play immediately).
  if (room.isHost) {
    const isFirst = room.playlist.length === 1;
    if (isFirst) {
      console.log(`[ADD-TRACK][PLAYLIST][FIRST_TRACK] playlist length=${room.playlist.length} → emitting request-track-change`);
      room.socket?.emit('request-track-change', { action: 'select', trackId: id });
    } else {
      console.log(`[ADD-TRACK] non-first track (length=${room.playlist.length}), server will auto-start if needed`);
    }
  }

  // ── 5. Toast ──
  showToast('🎵 Đã thêm: ' + title, 'success');
}

/* ── Queue UI ── */

function renderQueue() {
  if (!el.sharedQueue) return;
  if (el.queueCount) el.queueCount.textContent = `(${room.playlist.length})`;

  console.log(`[PLAYLIST][FULL_RERENDER] count=${room.playlist.length} currentVideo=${room.currentVideoId}`);
  console.log(`[PLAYLIST][RENDER_IDS] ${room.playlist.map(t => t.id).join(', ')}`);

  if (!room.playlist.length) {
    el.sharedQueue.innerHTML = `<div class="plist-empty">Chưa có bài nào — tìm trong tab Tìm để thêm!</div>`;
    return;
  }

  // Always full re-render from room.playlist (no DOM reuse — order can change on move)
  const fragment = document.createDocumentFragment();
  room.playlist.forEach((t, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === room.playlist.length - 1;
    const isActive = t.id === room.currentVideoId;
    console.log(`[PLAYLIST][RENDER_ITEM] idx=${idx} id=${t.id} active=${isActive} title=${t.title.substring(0, 30)}`);

    const div = document.createElement('div');
    div.className = `plist-track-item${isActive ? ' active' : ''}`;
    div.dataset.id = t.id;
    div.dataset.idx = idx;
    div.innerHTML = `
      <img class="plist-track-thumb" src="${t.thumb}" alt="" loading="lazy">
      <div class="plist-track-info">
        <span class="plist-track-title">${t.title}</span>
        <div class="plist-track-sub">
          <span class="plist-track-author">${t.author}</span>
        </div>
      </div>
      <div class="plist-track-actions">
        <button class="plist-move-up" data-move="up" data-track-id="${t.id}" title="Chuyển lên" ${isFirst ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="plist-move-down" data-move="down" data-track-id="${t.id}" title="Chuyển xuống" ${isLast ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="plist-remove-btn" data-remove="${t.id}" title="Xóa khỏi playlist">×</button>
      </div>`;
    fragment.appendChild(div);
  });
  el.sharedQueue.innerHTML = '';
  el.sharedQueue.appendChild(fragment);

  // Use event delegation on the container (no listener stacking after re-render)
  el.sharedQueue.onclick = e => {
    // Move up button
    const moveUpBtn = e.target.closest('.plist-move-up');
    if (moveUpBtn) {
      e.stopPropagation();
      if (!canControlPlayer()) {
        showPermissionDeniedToast('di chuyển bài');
        return;
      }
      const trackId = moveUpBtn.dataset.trackId;
      console.log(`[PLAYLIST][MOVE_UP] trackId=${trackId}`);
      room.socket?.emit('move-playlist-item', { trackId, direction: 'up' });
      return;
    }

    // Move down button
    const moveDownBtn = e.target.closest('.plist-move-down');
    if (moveDownBtn) {
      e.stopPropagation();
      if (!canControlPlayer()) {
        showPermissionDeniedToast('di chuyển bài');
        return;
      }
      const trackId = moveDownBtn.dataset.trackId;
      console.log(`[PLAYLIST][MOVE_DOWN] trackId=${trackId}`);
      room.socket?.emit('move-playlist-item', { trackId, direction: 'down' });
      return;
    }

    // Remove button
    const removeBtn = e.target.closest('.plist-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      if (!canControlPlayer()) {
        showPermissionDeniedToast('xóa bài');
        return;
      }
      const trackId = removeBtn.dataset.remove;
      console.log('[PLAYLIST][REMOVE_EMIT] id:', trackId);
      room.socket?.emit('remove-from-playlist', { trackId });
      return;
    }

    const row = e.target.closest('.plist-track-item');
    if (!row) return;
    const id = row.dataset.id;
    console.log('[QUEUE] Click → id:', id, '| current:', room.currentVideoId);
    if (id === room.currentVideoId) {
      console.log('[QUEUE] Same track — restarting');
      _loadVideo(id, 0, true);
    } else {
      playTrack(id);
    }
  };
}

/**
 * playTrack(id) — authoritative track-switching function.
 * Updates ALL state together, no stale refs.
 */
function playTrack(id) {
  console.log(`[PLAY-TRACK] called id=${id} currentVideoId=${room.currentVideoId} isHost=${room.isHost}`);
  const track = room.playlist.find(t => t.id === id);
  if (!track) {
    console.warn('[PLAY-TRACK] track not found in playlist:', id);
    return;
  }

  console.log('[PLAY-TRACK] →', id, '|', track.title);

  if (room.isHost) {
    const index = room.playlist.findIndex(t => t.id === id);
    console.log(`[PLAY-TRACK] emitting request-track-change (select) index=${index}`);
    room.socket?.emit('request-track-change', { action: 'select', trackId: id });
    return;
  }

  // Non-host: cannot change track (only host controls playback)
  console.log('[PLAY-TRACK] ignored: not host');
  showPermissionDeniedToast('chọn bài để phát');
}

/* ── Player meta ── */
function updatePlayerMeta(videoId) {
  const t = room.playlist.find(t => t.id === videoId);
  const title  = t?.title  || 'YouTube';
  const author = t?.author || videoId;

  // Thumbnail: prefer maxresdefault → hqdefault → mqdefault
  const bestThumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const hqThumb   = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const mqThumb   = t?.thumb || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  if (el.songTitle) el.songTitle.textContent = title;
  if (el.songMood)  el.songMood.textContent  = author;
  if (el.dockThumb) {
    el.dockThumb.src = bestThumb;
    el.dockThumb.style.display = 'block';
    el.dockThumb.onerror = () => {
      el.dockThumb.onerror = () => { el.dockThumb.src = mqThumb; el.dockThumb.onerror = null; };
      el.dockThumb.src = hqThumb;
    };
  }

  // Update now-playing bar in playlist tab
  updateNowPlayingBar(videoId, title, author, t?.thumb || mqThumb);
}

/**
 * updateNowPlayingBar(videoId, title, author, thumb)
 * Update the "Now Playing" header card in the Playlist tab.
 * Does NOT re-render the playlist list — only touches the bar elements.
 */
function updateNowPlayingBar(videoId, title, author, thumb) {
  const bar = el.nowPlayingBar;
  if (!bar) return;

  if (!videoId) {
    bar.style.display = 'none';
    return;
  }

  // Fade out → update → fade in
  bar.style.opacity = '0';
  bar.style.transform = 'translateY(-4px)';

  requestAnimationFrame(() => {
    if (el.npbTitle)  el.npbTitle.textContent  = title  || '—';
    if (el.npbArtist) el.npbArtist.textContent = author || '—';
    if (el.npbThumb) {
      const best = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      const hq   = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      el.npbThumb.src = thumb || best;
      el.npbThumb.onerror = () => {
        el.npbThumb.onerror = () => { el.npbThumb.src = hq; el.npbThumb.onerror = null; };
        el.npbThumb.src = hq;
      };
    }

    bar.style.display = 'block';
    // Trigger reflow then fade in
    requestAnimationFrame(() => {
      bar.style.transition = 'opacity .25s ease, transform .25s ease';
      bar.style.opacity    = '1';
      bar.style.transform  = 'translateY(0)';
    });
  });
}

/* ── Player controls ── */
function setupPlayerControls() {
  el.playBtn?.addEventListener('click', togglePlayback);
  el.prevBtn?.addEventListener('click', () => skipTrack(-1));
  el.nextBtn?.addEventListener('click', () => skipTrack(1));
  el.volumeBtn?.addEventListener('click', () => {
    console.log('[VOLUME_TOGGLE]');
    toggleMute();
  });
  el.musicProgress?.addEventListener('input', e => {
    if (!room.ytPlayer || !room.ytReady) return;
    if (!canControlPlayer()) {
      showPermissionDeniedToast('tua video');
      return;
    }
    const seek = (e.target.value / 100) * (room.ytPlayer.getDuration?.() || 0);
    room.ytPlayer.seekTo?.(seek, true);
    console.log(`[SEEK_SYNC] host=${room.isHost} video=${room.currentVideoId} seek=${seek}`);
    _throttledSyncVideo({ currentVideoId: room.currentVideoId, isPlaying: room.isPlaying, currentTime: seek });
  });
}

function togglePlayback() {
  if (!room.ytPlayer || !room.ytReady) {
    console.log(`[TOGGLE-PLAYBACK][SKIP] ytPlayer=${!!room.ytPlayer} ytReady=${!!room.ytReady}`);
    return;
  }
  if (!room.currentVideoId) {
    console.log(`[TOGGLE-PLAYBACK] ignored ytPlayer=${!!room.ytPlayer} currentVideoId=${room.currentVideoId}`);
    return;
  }

  // Chỉ host hoặc controller mới được điều khiển
  if (!canControlPlayer()) {
    console.log(`[TOGGLE-PLAYBACK] ignored: no control permission`);
    showPermissionDeniedToast('phát/tạm dừng');
    return;
  }

  const playing = room.ytPlayer.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
  const currentTime = room.ytPlayer.getCurrentTime?.() || 0;
  console.log(`[TOGGLE-PLAYBACK] currentVideoId=${room.currentVideoId} currentlyPlaying=${playing} currentTime=${currentTime}`);

  // Local trigger (Immediate — satisfies mobile user gesture)
  console.log('[PLAY_TOGGLE]');
  if (playing) {
    console.log('[TOGGLE-PLAYBACK] calling pauseVideo()');
    room.ytPlayer.pauseVideo();
  } else {
    // Chỉ unlock audio khi CHƯA unlock lần nào
    if (!_audioUnlocked) {
      room.ytPlayer.unMute?.();
      room.ytPlayer.setVolume?.(100);
      _audioUnlocked = true;
      console.log('[AUDIO_UNLOCKED]', _audioUnlocked);
      // Ẩn button unlock
      const btn = document.querySelector('.unlock-audio-btn');
      if (btn) btn.style.display = 'none';
    }
    console.log('[TOGGLE-PLAYBACK] calling playVideo()');
    room.ytPlayer.playVideo();
    // Hide sync overlay if user manually clicked play
    document.getElementById('sync-overlay')?.classList.add('hidden');
  }

  const nextState = {
    currentVideoId: room.currentVideoId, isPlaying: !playing,
    currentTime,
  };
  console.log(`[TOGGLE-PLAYBACK] syncing isPlaying=${nextState.isPlaying} currentTime=${nextState.currentTime}`);
  _throttledSyncVideo(nextState);
}

/**
 * _throttledSyncVideo
 * Prevents rapid-fire socket emits during scrub/spam.
 */
let _lastSyncTime = 0;
let _lastPlaybackSyncKey = '';
function _throttledSyncVideo(data) {
  // Chỉ host hoặc controller mới được sync
  if (!canControlPlayer()) {
    console.log('[SYNC-THROTTLE] blocked: no control permission');
    return;
  }

  const now = Date.now();
  const delta = now - _lastSyncTime;
  const roundedTime = Math.round((data?.currentTime || 0) * 10) / 10;
  const syncKey = `${data?.currentVideoId || 'none'}|${!!data?.isPlaying}|${roundedTime}`;

  if (syncKey === _lastPlaybackSyncKey) {
    console.log(`[SYNC_SKIPPED_DUPLICATE] playback sync key=${syncKey}`);
    return;
  }

  if (delta < 250) {
    console.log(`[SYNC-THROTTLE] blocked delta=${delta}ms videoId=${data?.currentVideoId} isPlaying=${data?.isPlaying} currentTime=${data?.currentTime}`);
    return; // limit to 4 per second
  }

  _lastSyncTime = now;
  _lastPlaybackSyncKey = syncKey;
  console.log(`[SYNC-THROTTLE] emit delta=${delta}ms videoId=${data?.currentVideoId} isPlaying=${data?.isPlaying} currentTime=${data?.currentTime}`);
  console.log('[PLAYER_SYNC_EMIT]', { action: 'sync', userId: room.socket?.id });

  // Pause sync while user is interacting with iframe settings
  if (_iframeInteractionMode) {
    console.log('[SYNC][PAUSED_FOR_IFRAME_INTERACTION] sync-video blocked');
    return;
  }

  // Host và controller đều được emit sync-video
  room.socket?.emit('sync-video', {
    ...data,
    trackVersion: room.trackVersion,
    lastTrackChangeAt: room._lastTrackChangeAt || 0,
  });
}

function skipTrack(dir) {
  console.log(`[SKIP-TRACK] dir=${dir} isHost=${room.isHost} playlistLength=${room.playlist.length}`);
  if (!canControlPlayer()) {
    console.log('[SKIP-TRACK] ignored: no control permission');
    showPermissionDeniedToast('chuyển bài');
    return;
  }
  if (!room.playlist.length) {
    console.log('[SKIP-TRACK] ignored: playlist empty');
    return;
  }

  const idx = room.playlist.findIndex(t => t.id === room.currentVideoId);
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= room.playlist.length) {
    console.log(`[SKIP-TRACK] no track at index ${nextIdx}`);
    return;
  }

  const action = dir === 1 ? 'next' : 'prev';
  console.log(`[HOST_${action.toUpperCase()}] currentIndex=${idx} nextIndex=${nextIdx} videoId=${room.playlist[nextIdx].id}`);
  room.socket?.emit('request-track-change', { action, direction: dir });
}

function updatePlayBtn() {
  const playerState = room.ytPlayer?.getPlayerState?.();
  const playing = playerState === window.YT?.PlayerState?.PLAYING;
  console.log(`[UPDATE-PLAY-BTN] playerState=${playerState} playing=${playing} currentVideoId=${room.currentVideoId}`);
  if (el.playBtn) el.playBtn.textContent = playing ? '⏸' : '▶';
  document.body.classList.toggle('music-playing', !!playing);
  room.isPlaying = !!playing;
}

/* ── Progress loop ── */
function startProgressLoop() {
  if (_progressIntervalId) clearInterval(_progressIntervalId);
  _progressIntervalId = setInterval(() => {
    if (document.hidden) return;
    const p = room.ytPlayer;
    if (!p || !room.ytReady || !room.currentVideoId) return;

    // Update UI
    updatePlayBtn();
    const cur = p.getCurrentTime?.() || 0;
    const dur = p.getDuration?.() || 0;
    if (!dur) return;
    if (el.musicProgress) el.musicProgress.value = (cur / dur) * 100;
    if (el.currentTime)   el.currentTime.textContent = formatTime(cur);
    if (el.durationTime)  el.durationTime.textContent = formatTime(dur);

    // ── Host/Controller: emit heartbeat mỗi 3 giây ──
    // [FIX] Gửi heartbeat cho CẢ host và controller để server có accurate time
    const canEmitHeartbeat = room.isHost || _controllerIds.includes(room.socket?.id);

    if (canEmitHeartbeat) {
      const now = Date.now();
      if (now - _lastHeartbeatTime >= 3000) {
        _lastHeartbeatTime = now;
        const currentTime = p.getCurrentTime?.() || 0;
        const isPlaying = p.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
        console.log(`[HEARTBEAT][EMIT] time=${currentTime.toFixed(1)} playing=${isPlaying} isHost=${room.isHost}`);
        room.socket?.emit('room-heartbeat', currentTime);
      }
    }
  }, 600);
}

/* ── Utility ── */
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

/* ── YouTube IFrame API ── */

/**
 * _applyMaxQuality(retryCount)
 * Force highest available playback quality.
 * Preference: hd2160 > hd1440 > hd1080 > hd720 > large > medium
 *
 * Important: getAvailableQualityLevels() returns [] until enough video
 * has buffered, so we retry up to 4 times with increasing delays.
 */
// Quality preference: target hd1080, fallback to best below it.
// Higher qualities (4K/1440p) are intentionally excluded from auto-selection
// so users with slower connections are not forced into them.
// Users can always manually select higher quality via YouTube's native settings menu.
const QUALITY_TARGET  = 'hd1080';                               // ideal quality
const QUALITY_BELOW   = ['hd720', 'large', 'medium', 'small']; // fallbacks, best-first
const QUALITY_RETRY_DELAYS = [800, 1500, 3000, 5000];           // ms — increasingly longer

function _applyMaxQuality(retryCount = 0) {
  const p = room.ytPlayer;
  if (!p?.getAvailableQualityLevels) return;

  const available = p.getAvailableQualityLevels();

  // If empty — video hasn't buffered enough yet, retry if budget allows
  if (!available.length) {
    if (retryCount < QUALITY_RETRY_DELAYS.length) {
      const delay = QUALITY_RETRY_DELAYS[retryCount];
      console.log(`[YT Quality] Available list empty — retry ${retryCount + 1} in ${delay}ms`);
      setTimeout(() => _applyMaxQuality(retryCount + 1), delay);
    } else {
      console.log('[YT Quality] Exhausted retries — leaving quality as auto');
    }
    return;
  }

  console.log('[YT Quality] Available:', available.join(', '));

  // 1. Try the ideal target (1080p) first
  let chosen = null;
  if (available.includes(QUALITY_TARGET)) {
    chosen = QUALITY_TARGET;
  } else {
    // 2. 1080p not available — pick the best quality below it
    chosen = QUALITY_BELOW.find(q => available.includes(q)) || null;
    if (chosen) {
      console.log(`[YT Quality] hd1080 not available — using best fallback: ${chosen}`);
    }
  }

  const current = p.getPlaybackQuality?.();
  console.log('[YT Quality] current:', current, '| target:', chosen ?? 'none (auto)');

  if (chosen && current !== chosen) {
    p.setPlaybackQuality?.(chosen);
    // setPlaybackQualityRange deprecated — wrap in try/catch
    try { p.setPlaybackQualityRange?.(chosen, chosen); } catch (_) {}
    console.log('[YT Quality] ✓ Applied:', chosen);

    // One follow-up check in case YouTube overrides our setting
    if (retryCount === 0) {
      setTimeout(() => _applyMaxQuality(QUALITY_RETRY_DELAYS.length - 1), 2000);
    }
  } else if (!chosen) {
    console.log('[YT Quality] No suitable level found in available list — using auto');
  } else {
    console.log('[YT Quality] Already at target quality:', current);
  }
}

function createYTPlayer() {
  console.log('[YT][INIT] createYTPlayer called');

  // CRITICAL: check BOTH flag AND DOM element to prevent double-init
  if (_ytPlayerInitialized) {
    console.log('[YT][INIT] BLOCKED — _ytPlayerInitialized=true (iframe already exists)');
    return;
  }
  const container = document.getElementById('youtube-player');
  if (!container) {
    console.error('[YT][INIT] BLOCKED — #youtube-player element NOT found in DOM');
    return;
  }
  if (container.querySelector('iframe')) {
    console.warn('[YT][INIT] BLOCKED — iframe already exists inside #youtube-player');
    _ytPlayerInitialized = true;
    return;
  }

  // Mark initialized NOW so re-entrant calls (e.g. onReady during this function) are blocked
  _ytPlayerInitialized = true;
  console.log('[YT][INIT] Creating YT.Player...');

  const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);

  room.ytPlayer = new YT.Player('youtube-player', {
    height: '100%',
    width:  '100%',
    videoId: '',
    playerVars: {
      autoplay:       1,
      controls:       1,  // 1 = show YT native controls (quality gear accessible)
      disablekb:      1,
      modestbranding: 1,
      rel:            0,
      fs:             0,
      iv_load_policy: 3,
      playsinline:    1,
      enablejsapi:    1,
      origin:         origin,
      vq:             'hd1080',
    },
    events: {
      onReady: () => {
        console.log('[YT][READY] Player ready ✓');
        room.ytReady = true;

        if (_forceSourceLoadTimer) {
          clearTimeout(_forceSourceLoadTimer);
          _forceSourceLoadTimer = null;
        }

        applyPendingRoomState();
      },
      onStateChange: e => {
        const states = { [-1]:'unstarted', 0:'ended', 1:'playing', 2:'paused', 3:'buffering', 5:'cued' };
        console.log('[YT] State changed →', states[e.data] ?? e.data);
        updatePlayBtn();

        if (e.data === window.YT?.PlayerState?.PLAYING) {
          const vid = room.ytPlayer?.getVideoData?.()?.video_id;
          if (vid && vid !== _qualityAppliedForVideoId) {
            _qualityAppliedForVideoId = vid;
            _applyMaxQuality(0);
            console.log('[YT Quality] Starting quality sequence for:', vid);
          }
        }

        if (e.data === window.YT?.PlayerState?.ENDED) {
          if (room.isHost && !_isApplyingTrackChange) {
            console.log('[YT] Video ended (host) → triggering next');
            skipTrack(1);
          } else if (!room.isHost) {
            console.log('[YT] Video ended (listener) → waiting for server sync');
          } else {
            console.log('[YT] Video ended during track change → blocked');
          }
        }
      },
      onError: e => {
        const code = e.data;
        console.warn('[YT] Player error code:', code, '| videoId:', room.currentVideoId);

        const nonEmbeddable = (code === 101 || code === 150);
        const notFound      = (code === 100 || code === 2);

        if (nonEmbeddable) {
          showToast('⚠️ Video này không thể phát (bị chặn nhúng)', 'warning');
        } else if (notFound) {
          showToast('⚠️ Video không tìm thấy hoặc đã bị xóa', 'warning');
        }

        if (nonEmbeddable || notFound) {
          _blockedIds.add(room.currentVideoId);
          console.log('[YT] Blocked id added:', room.currentVideoId);

          room.playlist = room.playlist.filter(t => t.id !== room.currentVideoId);
          renderQueue();

          setTimeout(() => skipTrack(1), 500);
        }
      },
    },
  });

  console.log('[YT][INIT] new YT.Player() returned — iframe creation in progress');
}

// Called once YT API script fires its ready callback
window.onYouTubeIframeAPIReady = () => {
  console.log('[YT][API] onYouTubeIframeAPIReady fired');
  console.log('[YT][API] window.YT:', !!window.YT, '| YT.Player:', typeof window.YT?.Player);
  // Reset flag if script reloads or was partially initialized
  _ytPlayerInitialized = false;
  room.ytReady = false;
  room.ytPlayer = null;
  createYTPlayer();
};

// If API was already loaded before this script ran, bootstrap immediately
if (window.YT && typeof window.YT.Player === 'function') {
  console.log('[YT][API] API already available at page load — calling createYTPlayer()');
  createYTPlayer();
} else {
  console.log('[YT][API] YT.Player not yet available, waiting for onYouTubeIframeAPIReady');
}

/* ═══════════════════════════════════════════════════════════
   SYNC PLAYER SYSTEM v2
   ═══════════════════════════════════════════════════════════ */

// ── Helper: chờ player IFrame ready ──────────────────────
function waitForPlayerReady(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (room.ytPlayer && room.ytReady) { resolve(); return; }

    const startTime = Date.now();
    const check = () => {
      if (room.ytPlayer && room.ytReady) {
        console.log(`[PLAYER_READY] after ${Date.now() - startTime}ms`);
        resolve(); return;
      }
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`[PLAYER_READY] Timeout`);
        reject(new Error('Player ready timeout')); return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// ── Helper: chờ video load xong ────────────────────────
function waitForVideoLoad(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const p = room.ytPlayer;
    if (!p) { resolve(); return; }

    const startTime = Date.now();
    let tries = 0;
    const maxTries = Math.floor(timeoutMs / 200);

    const check = () => {
      tries++;
      const duration = p.getDuration?.() || 0;
      if (duration > 0) {
        console.log(`[VIDEO_LOADED] after ${Date.now() - startTime}ms, duration=${duration}s`);
        resolve(); return;
      }
      if (tries > maxTries) {
        console.warn(`[VIDEO_LOADED] Timeout`);
        resolve(); return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

// ── Helper: chờ player state PLAYING ─────────────────
function waitForPlayingState(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const p = room.ytPlayer;
    if (!p) { reject(new Error('No player')); return; }

    const started = Date.now();

    const interval = setInterval(() => {
      try {
        const state = p.getPlayerState?.();
        // YT.PlayerState.PLAYING === 1
        if (state === 1) {
          clearInterval(interval);
          resolve(true);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Playing state timeout'));
        }
      } catch (e) {}
    }, 150);
  });
}

// ── Autoplay muted flow ────────────────────────────────────
async function safeAutoplay(p, { showOverlayOnFail = true } = {}) {
  if (!p) return false;
  if (!room.ytReady) {
    console.log('[AUTOPLAY][SKIP] player not ready');
    return false;
  }
  console.log('[AUTOPLAY_ATTEMPT]');
  console.log('[AUDIO_UNLOCKED_STATE]', _audioUnlocked);

  try {
    // Chỉ mute khi audio chưa unlock (autoplay lần đầu)
    if (!_audioUnlocked) {
      p.mute();
    } else {
      console.log('[REMOTE_SYNC_NO_REMUTE]');
    }

    const result = p.playVideo();
    console.log('[SYNC][APPLY_PLAY] isPlaying=true');

    if (result instanceof Promise) {
      await result.catch((err) => {
        console.log('[AUTOPLAY_BLOCKED]', err);
      });
    }

    // Đợi player playing
    try {
      await waitForPlayingState(10000);
      console.log('[AUTOPLAY_PLAYING]');
    } catch (playErr) {
      console.log('[AUTOPLAY_PLAYING_TIMEOUT]', playErr.message);
      // Autoplay bị chặn — hiển thị overlay để user click
      if (showOverlayOnFail) {
        const overlay = document.getElementById('sync-overlay');
        if (overlay) {
          overlay.classList.remove('hidden');
          console.log('[SYNC_OVERLAY][SHOWN] — autoplay blocked by browser');
        }
      }
    }

    console.log('[AUTOPLAY_SUCCESS]');
    return true;

  } catch (err) {
    console.log('[AUTOPLAY_FAILED]', err);
    if (showOverlayOnFail) {
      document.getElementById('sync-overlay')?.classList.remove('hidden');
    }
    return false;
  }
}

// ── Toast: unlock audio ───────────────────────────────────
let _audioUnlockToastId = null;
function showAudioUnlockToast() {
  if (_audioUnlockToastId) return; // Đã có toast
  if (_hasUserInteracted) return; // Đã unlock rồi

  _audioUnlockToastId = 'audio-unlock-toast';
  notify('Chạm để bật âm thanh', 'info', 5000);
}

// ── User interaction unlock audio ──────────────────────────
function setupAudioUnlock() {
  // Chỉ unlock 1 lần
  if (_hasUserInteracted) return;

  const cleanupListeners = () => {
    window.removeEventListener('pointerdown', handlePointerDown, { passive: true });
    window.removeEventListener('keydown', handlePointerDown);
    window.removeEventListener('mousemove', handleMouseMove);
  };

  const handlePointerDown = () => {
    if (_hasUserInteracted) return;
    _hasUserInteracted = true;

    console.log('[USER_INTERACTION_UNLOCK]');

    try {
      room.ytPlayer.unmute?.();
      room.ytPlayer.setVolume?.(100);
      console.log('[PLAYER_UNMUTED]');
      _audioUnlockToastId = null;
    } catch (err) {
      console.log('[UNMUTE_FAILED]', err);
    }

    cleanupListeners();
  };

  let _mouseMoved = false;

  const handleMouseMove = () => {
    if (_hasUserInteracted) return;
    if (_mouseMoved) return;

    _mouseMoved = true;
    handlePointerDown();
  };

  window.addEventListener('pointerdown', handlePointerDown, { passive: true });
  window.addEventListener('keydown', handlePointerDown);
  window.addEventListener('mousemove', handleMouseMove, { passive: true });
}

// ── Load video ───────────────────────────────────────────
function _loadVideo(videoId, startSeconds, shouldPlay) {
  console.log(`[_LOAD-VIDEO] ${videoId} start=${startSeconds}s play=${shouldPlay}`);

  if (!room.ytPlayer || !room.ytReady) {
    console.log('[_LOAD-VIDEO][SKIP] player not ready ytPlayer=' + !!room.ytPlayer + ' ytReady=' + !!room.ytReady);
    _pendingVideoId  = videoId;
    _pendingTime    = startSeconds || 0;
    _pendingPlaying = shouldPlay;
    return;
  }

  const p = room.ytPlayer;

  // Same video?
  if (p.getVideoData?.()?.video_id === videoId) {
    console.log('[LOAD-VIDEO] Same video, sync state');
    if (shouldPlay) safeAutoplay(p);
    else p.pauseVideo?.();
    return;
  }

  // Load new video
  _qualityAppliedForVideoId = null;
  _pendingVideoId  = videoId;
  _pendingTime    = startSeconds || 0;
  _pendingPlaying = shouldPlay;

  console.log('[LOAD-VIDEO] Calling loadVideoById');
  p.loadVideoById({ videoId, startSeconds: startSeconds || 0, suggestedQuality: 'hd1080' });

  // Chờ video load rồi seek/play
  waitForVideoLoad(8000).then(() => {
    console.log('[LOAD-VIDEO] Video ready, syncing state...');

    const targetTime = startSeconds || 0;
    const localTime = p.getCurrentTime?.() || 0;
    const drift = Math.abs(localTime - targetTime);

    if (drift > 1) {
      console.log(`[LOAD-VIDEO] Seeking to ${targetTime}s (drift=${drift.toFixed(1)}s)`);
      p.seekTo?.(targetTime, true);
    }

    if (shouldPlay) safeAutoplay(p);
    else p.pauseVideo?.();

    _pendingVideoId = null;
  }).catch(err => {
    console.error('[LOAD-VIDEO] Error:', err.message);
    if (shouldPlay) safeAutoplay(p);
  });
}

// ── Sync player từ room state (cho user mới join) ─────────
async function syncPlayerFromRoomState(state) {
  if (!state) { console.log('[SYNC] No state'); return; }

  const videoId     = state?.currentVideoId || null;
  const isPlaying   = !!state?.isPlaying;
  const currentTime = Number.isFinite(state?.currentTime) ? state.currentTime : 0;

  console.log(`[SYNC] video=${videoId} play=${isPlaying} time=${currentTime.toFixed(1)}`);

  if (!videoId) { console.log('[SYNC] No video'); return; }

  // Nếu player chưa ready → QUEUE toàn bộ state
  if (!room.ytPlayer || !room.ytReady) {
    console.log('[SYNC] Player not ready, queueing state');
    _pendingRoomState = state;
    updatePlayerMeta(videoId);
    renderQueue();
    return;
  }

  _isRemoteSync = true;

  try {
    const p = room.ytPlayer;

    // 1. Load video nếu khác
    const currentVideo = p.getVideoData?.()?.video_id || null;
    if (currentVideo !== videoId) {
      console.log(`[SYNC] Loading: ${videoId}`);
      _qualityAppliedForVideoId = null;
      p.loadVideoById({ videoId, startSeconds: 0, suggestedQuality: 'hd1080' });
      await waitForVideoLoad();
    }

    // 2. Seek
    const localTime = p.getCurrentTime?.() || 0;
    const drift = Math.abs(localTime - currentTime);
    if (drift > 1) {
      console.log(`[SYNC] Seeking to ${currentTime.toFixed(1)}s (drift=${drift.toFixed(1)}s)`);
      p.seekTo?.(currentTime, true);
    }

    // 3. Play/Pause
    if (isPlaying) {
      await safeAutoplay(p);
    } else {
      console.log('[SYNC] Pausing');
      p.pauseVideo?.();
    }

    // 4. Cập nhật state & UI
    room.currentVideoId = videoId;
    room.isPlaying     = isPlaying;
    room.trackVersion = typeof state?.trackVersion === 'number' ? state.trackVersion : room.trackVersion;
    room.currentTrackIndex = Number.isInteger(state?.currentTrackIndex) ? state.currentTrackIndex : -1;

    updatePlayerMeta(videoId);
    renderQueue();
    _syncSearchActiveUI(videoId);
    updatePlayBtn();

    console.log('[SYNC] ✓ Complete');

  } finally {
    setTimeout(() => { _isRemoteSync = false; }, 300);
  }
}

// ── Apply pending state khi player ready ─────────────────
function applyPendingRoomState() {
  if (!_pendingRoomState) return;
  console.log('[APPLY_PENDING_SYNC]', JSON.stringify(_pendingRoomState));
  const state = _pendingRoomState;
  _pendingRoomState = null;
  syncPlayerFromRoomState(state);
}

// ── Sync video state (same-track: play/pause/seek) ──────────
// HYBRID SYNC: smooth playback NHƯNG session phải cùng timeline
// Drift lớn phải tự kéo về, action mới nhất phải authoritative
async function syncVideoState(state) {
  if (!state || typeof state !== 'object') { console.log('[VIDEO_SYNC] Invalid'); return; }

  const videoId     = state?.currentVideoId || null;
  const isPlaying   = !!state?.isPlaying;
  const currentTime = Number.isFinite(state?.currentTime) ? state.currentTime : 0;
  const actionId    = state?.lastActionId || 0;
  const actionType  = state?.actionType || 'heartbeat';
  const actorSocketId = state?.actorSocketId || null;

  console.log(`[VIDEO_SYNC] video=${videoId} play=${isPlaying} actionId=${actionId} type=${actionType}`);

  if (!videoId) return;
  if (videoId !== room.currentVideoId) { console.log('[VIDEO_SYNC] Track mismatch'); return; }

  // ── Action Version Check ──────────────────────────────────
  if (_shouldIgnoreStaleAction(actionId)) {
    console.log('[VIDEO_SYNC] Stale action ignored');
    return;
  }

  // ── Hard Sync Lock Check ──────────────────────────────────
  // 10s action lock sau hard sync
  const cfg = window.HYBRID_SYNC || window.SOFT_SYNC || {};
  const now = Date.now();
  if (now < _hardSyncLockUntil) {
    console.log(`[VIDEO_SYNC][HARD_LOCK] blocked - action lock until ${((_hardSyncLockUntil - now) / 1000).toFixed(1)}s remaining`);
    // Still update state but skip correction
  }

  // Queue nếu player chưa ready
  if (!room.ytPlayer || !room.ytReady) {
    console.log('[VIDEO_SYNC] Player not ready, queueing...');
    _pendingRoomState = state;
    return;
  }

  _isRemoteSync = true;

  try {
    const p = room.ytPlayer;

    // ── Play/Pause — LUÔN LUÔN sync state VÀ currentTime ─────
    // Theo yêu cầu: play/pause PHẢI sync currentTime
    const latency = ((Date.now() + (_serverTimeOffset || 0)) - (state?.syncedAt || Date.now())) / 1000;
    const targetTime = currentTime + Math.max(0, Math.min(3, latency));
    const localTime = p.getCurrentTime?.() || 0;
    const drift = localTime - targetTime;
    const driftAbs = Math.abs(drift);

    // Determine if this is an explicit action
    const isExplicitAction = ['play', 'pause', 'seek'].includes(actionType);

    if (isExplicitAction) {
      console.log(`[VIDEO_SYNC][${actionType.toUpperCase()}] isPlaying=${isPlaying} targetTime=${targetTime.toFixed(1)}s localTime=${localTime.toFixed(1)}s drift=${drift.toFixed(1)}s`);

      // Play: phải sync time từ điểm pause/play
      if (isPlaying) {
        await safeAutoplay(p);
        // Sync time khi play
        if (driftAbs > 1) {
          console.log(`[VIDEO_SYNC][PLAY_TIME_SYNC] seeking to ${targetTime.toFixed(1)}s (drift=${driftAbs.toFixed(1)}s)`);
          p.seekTo?.(targetTime, true);
        }
      } else {
        // Pause: phải sync đến đúng thời điểm pause
        console.log(`[VIDEO_SYNC][PAUSE_TIME_SYNC] seeking to ${targetTime.toFixed(1)}s then pausing`);
        p.pauseVideo?.();
        if (driftAbs > 1) {
          p.seekTo?.(targetTime, true);
        }
      }

      // Update authoritative action tracking
      _lastAuthoritativeAction = {
        actionId,
        actionType,
        actorSocketId,
        timestamp: state?.syncedAt || Date.now(),
      };
    } else {
      // Heartbeat / periodic sync - softer approach
      console.log(`[VIDEO_SYNC][HEARTBEAT] targetTime=${targetTime.toFixed(1)}s localTime=${localTime.toFixed(1)}s drift=${drift.toFixed(1)}s`);

      // Only apply play/pause state
      if (isPlaying) {
        await safeAutoplay(p);
      } else {
        p.pauseVideo?.();
      }
    }

    // ── Drift Correction (chỉ khi đang playing và KHÔNG có hard lock) ───
    if (isPlaying && now >= _hardSyncLockUntil) {
      const smallDrift  = cfg.SMALL_DRIFT_THRESHOLD  || 5;
      const mediumDrift = cfg.MEDIUM_DRIFT_THRESHOLD || 15;
      const largeDrift  = cfg.LARGE_DRIFT_THRESHOLD  || 20;

      console.log(`[VIDEO_SYNC][DRIFT_CHECK] drift=${drift.toFixed(1)}s small=<${smallDrift}s medium=${smallDrift}-${mediumDrift}s large=>${largeDrift}s`);

      if (!_shouldIgnoreSync()) {
        if (driftAbs <= smallDrift) {
          // Drift nhỏ → ignore
          console.log(`[VIDEO_SYNC][IGNORE] drift ${driftAbs.toFixed(1)}s < ${smallDrift}s threshold`);
        } else if (driftAbs > largeDrift) {
          // Drift lớn → hard seek (cả forward và backward)
          console.log(`[VIDEO_SYNC][HARD_SEEK] drift=${driftAbs.toFixed(1)}s > ${largeDrift}s → seeking to ${targetTime.toFixed(1)}s`);
          _applyHardSeek(targetTime, localTime);
        } else {
          // Drift vừa → soft correction
          console.log(`[VIDEO_SYNC][SOFT_CORRECT] drift=${driftAbs.toFixed(1)}s → playbackRate adjustment`);
          _applySoftCorrection(targetTime, localTime);
        }
      }
    }

    // Update state
    room.isPlaying = isPlaying;
    updatePlayBtn();

    // Cập nhật action ID
    if (actionId > _lastAppliedActionId) {
      _lastAppliedActionId = actionId;
    }

    console.log('[VIDEO_SYNC] ✓ Applied');

  } finally {
    setTimeout(() => { _isRemoteSync = false; }, 300);
  }
}

// ── HYBRID SYNC Functions ─────────────────────────────────────────
// HYBRID SYNC: smooth playback NHƯNG session phải cùng timeline
// Drift lớn phải tự kéo về, action mới nhất phải authoritative

// Kiểm tra xem có nên bỏ qua correction không
function _shouldIgnoreSync() {
  const cfg = window.HYBRID_SYNC || window.SOFT_SYNC || {};
  const now = Date.now();

  // Hard sync lock check - sau hard seek, không nhận sync mới trong X ms
  if (now < _hardSyncLockUntil) {
    console.log(`[SYNC][HARD_LOCK] skipping - action lock until ${((_hardSyncLockUntil - now) / 1000).toFixed(1)}s remaining)`);
    return true;
  }

  // Seek cooldown check
  if (now < _seekCooldownUntil) {
    console.log(`[SYNC][SEEK_COOLDOWN] skipping - seek cooldown until ${_seekCooldownUntil} (${((_seekCooldownUntil - now) / 1000).toFixed(1)}s remaining)`);
    return true;
  }

  // Soft correction cooldown check
  if (now - _lastCorrectionTime < (cfg.SOFT_CORRECT_COOLDOWN_MS || 8000)) {
    console.log(`[SYNC][COOLDOWN] skipping - last correction was ${((now - _lastCorrectionTime) / 1000).toFixed(1)}s ago`);
    return true;
  }

  // Đang trong quá trình soft sync thì bỏ qua
  if (_isSoftSyncing) {
    console.log('[SYNC][ACTIVE] skipping - already in soft sync');
    return true;
  }

  return false;
}

// Kiểm tra xem player có đang buffering không
function _isPlayerBuffering() {
  const p = room.ytPlayer;
  if (!p) return false;
  const state = p.getPlayerState?.();
  // YT.PlayerState.BUFFERING = 3
  return state === 3;
}

// Kiểm tra action version - ignore stale events
function _shouldIgnoreStaleAction(incomingActionId) {
  if (!incomingActionId || incomingActionId <= 0) {
    // No action ID - might be periodic sync, check with relaxed rules
    return false;
  }

  if (incomingActionId <= _lastAppliedActionId) {
    console.log(`[SYNC][STALE_ACTION] ignoring - incoming=${incomingActionId} lastApplied=${_lastAppliedActionId}`);
    return true;
  }

  return false;
}

// Áp dụng soft correction bằng playbackRate
// Drift 5-20s: điều chỉnh tốc độ phát nhẹ
function _applySoftCorrection(targetTime, localTime) {
  const p = room.ytPlayer;
  const cfg = window.HYBRID_SYNC || window.SOFT_SYNC || {};
  if (!p) return false;

  // Kiểm tra player state
  const playerState = p.getPlayerState?.();
  if (playerState !== window.YT?.PlayerState?.PLAYING) {
    console.log('[SYNC][SKIP] Player not playing');
    return false;
  }

  // Bỏ qua nếu đang buffering
  if (cfg.BUFFERING_IGNORE && _isPlayerBuffering()) {
    console.log('[SYNC][SKIP] Player is buffering');
    return false;
  }

  const drift = localTime - targetTime;

  console.log(`[SYNC][SOFT_CORRECT] hostTime=${targetTime.toFixed(1)}s guestTime=${localTime.toFixed(1)}s drift=${drift.toFixed(1)}s → applying playbackRate`);

  _isSoftSyncing = true;
  _lastCorrectionTime = Date.now();

  // Chọn playbackRate - tăng hoặc giảm tốc tùy drift direction
  let rate;
  if (drift < 0) {
    // Guest behind - speed up
    rate = cfg.FAST_RATE || 1.05;
  } else {
    // Guest ahead - slow down
    rate = cfg.SLOW_RATE || 0.95;
  }
  console.log(`[SYNC][RATE] Setting playbackRate=${rate} for ${cfg.SOFT_CORRECT_DURATION}ms`);

  // Lưu playbackRate gốc
  if (_lastAppliedPlaybackRate === 1.0) {
    _lastAppliedPlaybackRate = p.getPlaybackRate?.() || 1.0;
  }

  // Áp dụng playbackRate mới
  p.setPlaybackRate?.(rate);

  // Reset sau khoảng thời gian
  if (_softCorrectionTimer) clearTimeout(_softCorrectionTimer);
  _softCorrectionTimer = setTimeout(() => {
    console.log(`[SYNC][RATE_RESET] Restoring playbackRate to ${_lastAppliedPlaybackRate}`);
    p.setPlaybackRate?.(_lastAppliedPlaybackRate);
    _isSoftSyncing = false;
    _lastAppliedPlaybackRate = 1.0;
  }, cfg.SOFT_CORRECT_DURATION);

  // Show UI notice
  _showSyncNotice('đang đồng bộ...');
  return true;
}

// Áp dụng hard seek sync
// Drift > 20s: force seek KHÔNG phân biệt ahead hay behind
function _applyHardSeek(targetTime, localTime) {
  const p = room.ytPlayer;
  const cfg = window.HYBRID_SYNC || window.SOFT_SYNC || {};
  if (!p) return;

  const drift = localTime - targetTime;
  const driftAbs = Math.abs(drift);

  console.log(`[SYNC][HARD_SEEK] targetTime=${targetTime.toFixed(1)}s localTime=${localTime.toFixed(1)}s drift=${driftAbs.toFixed(1)}s → seeking`);

  _lastCorrectionTime = Date.now();
  _hardSyncLockUntil = Date.now() + (cfg.HARD_SYNC_LOCK_MS || 10000);
  _seekCooldownUntil = Date.now() + (cfg.SEEK_COOLDOWN_MS || 10000);
  _isSoftSyncing = false;

  // Cancel any pending soft correction
  if (_softCorrectionTimer) {
    clearTimeout(_softCorrectionTimer);
    _softCorrectionTimer = null;
  }

  // Restore playbackRate
  if (_lastAppliedPlaybackRate !== 1.0) {
    p.setPlaybackRate?.(1.0);
    _lastAppliedPlaybackRate = 1.0;
  }

  // Show notice trước khi seek
  _showSyncNotice('đang đồng bộ lại...');

  // Hard seek
  p.seekTo?.(targetTime, true);
  // Notice auto-hides via _showSyncNotice timeout
}

// Show sync notice (subtle, glassmorphism)
let _syncNoticeTimeout = null;
function _showSyncNotice(message) {
  let notice = document.getElementById('sync-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'sync-notice';
    notice.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      border-radius: 999px;
      background: rgba(18, 22, 38, 0.72);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(20px);
      color: rgba(255,255,255,0.88);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      z-index: 9999;
      opacity: 0;
      pointer-events: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.28);
      transition: opacity 0.25s ease;
    `;
    notice.innerHTML = `<span class="sync-pulse" style="width:8px;height:8px;border-radius:50%;background:#9b8cff;box-shadow:0 0 12px #9b8cff;flex-shrink:0;"></span><span class="sync-text"></span>`;
    document.body.appendChild(notice);
  }
  notice.querySelector('.sync-text').textContent = message;
  notice.style.opacity = '1';

  if (_syncNoticeTimeout) clearTimeout(_syncNoticeTimeout);
  _syncNoticeTimeout = setTimeout(() => {
    const n = document.getElementById('sync-notice');
    if (n) {
      n.style.opacity = '0';
      setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 300);
    }
  }, 2500);
}

function _hideSyncNotice() {
  const notice = document.getElementById('sync-notice');
  if (notice) notice.style.opacity = '0';
}

// ── Handle track changed (different track from host) ──────────
async function handleTrackChanged(payload) {
  if (!payload || typeof payload !== 'object') { console.log('[TRACK_CHANGE] Invalid'); return; }

  const videoId     = payload?.currentVideoId || null;
  const isPlaying   = !!payload?.isPlaying;
  const currentTime = Number.isFinite(payload?.currentTime) ? payload.currentTime : 0;
  const version     = typeof payload?.trackVersion === 'number' ? payload.trackVersion : -1;
  const actionId    = payload?.lastActionId || 0;
  const lastAuthAction = payload?.lastAuthoritativeAction || null;

  console.log(`[TRACK_CHANGE] video=${videoId} play=${isPlaying} v=${version} actionId=${actionId}`);

  if (!videoId) return;

  // Deduplication
  if (version >= 0 && version <= _lastAppliedTrackVersion) {
    console.log(`[TRACK_CHANGE] Stale v${version} <= ${_lastAppliedTrackVersion}`);
    return;
  }

  // Action version check
  if (_shouldIgnoreStaleAction(actionId)) {
    console.log('[TRACK_CHANGE] Stale action ignored');
    return;
  }

  _isApplyingTrackChange = true;

  try {
    // Cập nhật state
    room.trackVersion      = version;
    room.currentVideoId   = videoId;
    room.isPlaying        = isPlaying;
    room.currentTrackIndex = Number.isInteger(payload?.currentTrackIndex) ? payload.currentTrackIndex : -1;

    // Update authoritative action tracking
    if (lastAuthAction) {
      _lastAuthoritativeAction = lastAuthAction;
    }

    updatePlayerMeta(videoId);
    renderQueue();
    _syncSearchActiveUI(videoId);

    // Chờ player ready
    try { await waitForPlayerReady(); } catch (err) {
      console.error('[TRACK_CHANGE] Player never ready'); return;
    }

    const p = room.ytPlayer;
    if (!p) return;

    // Load video
    console.log(`[TRACK_CHANGE] Loading: ${videoId}`);
    _qualityAppliedForVideoId = null;
    p.loadVideoById({ videoId, startSeconds: 0, suggestedQuality: 'hd1080' });
    await waitForVideoLoad();

    // Seek & Play/Pause
    if (currentTime > 0) { p.seekTo?.(currentTime, true); }
    if (isPlaying) await safeAutoplay(p);
    else p.pauseVideo?.();

    updatePlayBtn();
    _lastAppliedTrackVersion = version;
    _lastAppliedTrackId = videoId;
    console.log('[TRACK_CHANGE] ✓ Applied');

  } finally {
    setTimeout(() => { _isApplyingTrackChange = false; }, 500);
  }
}

// ── Compatibility wrapper ────────────────────────────────
function applyInitialRoomState(state) {
  console.log('[INITIAL_SYNC] → syncPlayerFromRoomState');
  syncPlayerFromRoomState(state);
}

/* ── Member Panel — uses shared .side-panel from main.css ── */

/** Activate/deactivate transparent click-catcher */
function _setPanelCatcher(active) {
  const c = document.getElementById('panel-catcher');
  if (!c) return;
  if (active) c.classList.add('active');
  else c.classList.remove('active');
}

/** Toggle a side panel open/close */
function _toggleSidePanel(panel) {
  if (!panel) return;
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    _setPanelCatcher(false);
    // Also close the other panel
    if (panel.id === 'member-panel') el.moodPanel?.classList.remove('open');
    else el.memberPanel?.classList.remove('open');
  } else {
    // Close the other panel first
    if (panel.id === 'member-panel') el.moodPanel?.classList.remove('open');
    else el.memberPanel?.classList.remove('open');
    panel.classList.add('open');
    _setPanelCatcher(true);
    // Re-render member list fresh each time panel opens
    if (panel.id === 'member-panel') {
      try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
    }
  }
}

function setupMemberPanel() {
  el.memberListBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    _toggleSidePanel(el.memberPanel);
  });

  el.memberPanelClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.memberPanel?.classList.remove('open');
    _setPanelCatcher(false);
  });

  // Close on panel catcher click
  document.getElementById('panel-catcher')?.addEventListener('click', () => {
    el.memberPanel?.classList.remove('open');
    el.moodPanel?.classList.remove('open');
    _setPanelCatcher(false);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.memberPanel?.classList.remove('open');
      el.moodPanel?.classList.remove('open');
      _setPanelCatcher(false);
    }
  });
}

function renderMemberList() {
  if (!el.memberList) return;

  if (!room.members || room.members.length === 0) {
    el.memberList.innerHTML = '<div class="member-empty">Phòng trống</div>';
    return;
  }

  const myId = room.socket?.id;

  // Sort: host first → controllers → regular members
  const sorted = [...room.members].sort((a, b) => {
    const aHost = a.id === room.hostId ? 0 : (_controllerIds.includes(a.id) ? 1 : 2);
    const bHost = b.id === room.hostId ? 0 : (_controllerIds.includes(b.id) ? 1 : 2);
    return aHost - bHost;
  });

  // Crown SVG (shared inline) — Refined crown icon
  const crownSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`;

  el.memberList.innerHTML = sorted.map(member => {
    const isMe = member.id === myId;
    const isMemberHost = member.id === room.hostId;
    const hasController = _controllerIds.includes(member.id);

    // DEBUG: Confirm avatar data
    console.log('[MEMBER_AVATAR]', member.name, member.avatar);

    // Row CSS classes
    const rowClasses = [
      'member-item',
      isMemberHost ? 'is-host' : '',
      hasController ? 'is-controller' : '',
      isMe ? 'is-self' : '',
    ].filter(Boolean).join(' ');

    // Avatar — ensures path starts with /
    let avatarSrc = member.avatar || '';
    if (avatarSrc && !avatarSrc.startsWith('/') && !avatarSrc.startsWith('http')) {
      avatarSrc = '/' + avatarSrc;
    }

    const avatarEl = avatarSrc
      ? `<img class="member-avatar-img" src="${avatarSrc}" alt="${_esc(member.name || '')}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="member-avatar-fallback" style="display:none"></div>`
      : `<div class="member-avatar-fallback"></div>`;

    // Name
    const safeName = _esc(member.name || '?');
    const nameWrap = `<span class="member-name">${safeName}</span>`;

    // "You" tag
    const youTag = isMe ? `<span class="member-you-tag">bạn</span>` : '';

    // Controller badge (compact pill)
    const controllerPill = (hasController && !isMemberHost)
      ? `<span class="badge-controller">Ctrl</span>`
      : '';

    // Crown button — integrated row control
    const crownBtn = `<button class="member-crown-btn" data-user-id="${member.id}" title="${hasController ? 'Thu quyền' : 'Cấp quyền điều khiển'}">${crownSvg}</button>`;

    return `<div class="${rowClasses}" data-id="${member.id}">
      <div class="member-avatar-wrap">${avatarEl}</div>
      <div class="member-info">
        <div class="member-name-row">
          ${nameWrap}
          ${youTag}
        </div>
        ${controllerPill ? `<div class="member-meta-row">${controllerPill}</div>` : ''}
      </div>
      <div class="member-right">
        ${crownBtn}
      </div>
    </div>`;
  }).join('');

  // Crown click: only host can interact, only on OTHER members
  el.memberList.querySelectorAll('.member-crown-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!room.isHost) return; // safety
      const targetId = btn.dataset.userId;
      if (targetId === myId) return; // can't click own crown
      console.log('[CONTROLLER] Toggle for:', targetId);
      room.socket?.emit('toggle-controller', { roomId: room.id, targetUserId: targetId });
    });
  });
}

function updateControlUI() {
  const canControl = canControlPlayer();
  console.log('[CONTROL_UI] canControl=' + canControl);

  if (canControl) {
    document.body.classList.remove('no-control');
  } else {
    document.body.classList.add('no-control');
  }

  const playerBtns = document.querySelectorAll('#play-btn, #prev-btn, #next-btn');
  playerBtns.forEach(btn => {
    if (canControl) {
      btn.classList.add('always-enabled');
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    } else {
      btn.classList.remove('always-enabled');
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '0.55';
    }
  });

  renderMemberList();
}

/* ── Reactions ── */
function setupReactions() {
  el.reactBtns.forEach(btn => btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    console.log(`[REACTION] sending emoji=${emoji}`);
    room.socket?.emit('send-reaction', emoji);
  }));
}
function spawnEmoji(emoji) {
  console.log(`[REACTION] received emoji=${emoji}`);
  const d = document.createElement('div');
  d.className = 'floating-emoji'; d.textContent = emoji;
  d.style.left = (15 + Math.random() * 70) + '%';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

/* ── Chat ── */
function setupChat() {
  el.sendMsgBtn?.addEventListener('click', sendChat);
  el.chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}
function sendChat() {
  const text = el.chatInput?.value.trim();
  if (!text) return;
  console.log(`[CHAT][SEND] text="${text.substring(0, 50)}" socketId=${room.socket?.id}`);
  room.socket?.emit('chat-msg', text);
  el.chatInput.value = '';
}
/** Escape HTML to prevent XSS from chat messages */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addChatLine(senderId, name, text, timestamp, avatar) {
  const isSystem = senderId === 'system';
  const isMine = !isSystem && senderId === room.socket?.id;

  console.log(`[CHAT][ADD_LINE] senderId=${senderId} isSystem=${isSystem} isMine=${isMine} name="${name}" text="${text?.substring(0, 30)}"`);

  const d = document.createElement('div');

  if (isSystem) {
    d.className = 'chat-message-system';
    d.innerHTML = `<div class="chat-bubble">${text}</div>`;
  } else {
    d.className = `chat-message ${isMine ? 'chat-message-mine' : 'chat-message-other'}`;
    const timeString = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const safeText = _esc(text);
    const safeName = _esc(name);

    let avatarEl = '';
    if (avatar) {
      avatarEl = `<img class="chat-avatar" src="${avatar}" alt="${safeName}" onerror="this.style.display='none'">`;
    }

    if (isMine) {
      // My messages: right-aligned, no avatar
      d.className = 'chat-message chat-message-mine';
      d.innerHTML = `
        <div class="chat-content chat-content-mine">
          <div class="chat-header">
            <span class="chat-bubble">${safeText}</span>
          </div>
          <span class="chat-time">${timeString}</span>
        </div>`;
    } else {
      // Other messages: left-aligned, with avatar
      d.className = 'chat-message chat-message-other';
      d.innerHTML = `
        <div class="chat-avatar-wrap">
          ${avatarEl}
        </div>
        <div class="chat-content">
          <div class="chat-header">
            <span class="chat-name">${safeName}</span>
            <span class="chat-time">${timeString}</span>
          </div>
          <div class="chat-bubble">${safeText}</div>
        </div>`;

      // Unread notification for messages from others
      if (window._currentTab !== 'chat') {
        const chatTab = Array.from(el.plistTabs).find(t => t.dataset.tab === 'chat');
        if (chatTab) chatTab.classList.add('unread');
      }
    }
  }

  el.roomMessages?.appendChild(d);
  // Scroll to bottom
  if (el.roomMessages) {
    el.roomMessages.scrollTop = el.roomMessages.scrollHeight;
  }
}

/* ── Socket ── */
let _socketReconnectCount = 0;
const MAX_RECONNECT_GUARD = 3;

function setupSocket() {
  const socketUrl = window.CONFIG?.SOCKET_URL || window.location.origin;
  room.socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  const s = room.socket;

  s.on('connect', () => {
    console.log(`[socket] connected id=${s.id} url=${socketUrl}`);
    _socketReconnectCount = 0; // Reset on successful connect
    _isReconnecting = false;

    // GUARD: If room was marked invalid, don't try to join
    if (!_roomIsValid) {
      console.log('[SOCKET][CONNECT] Room already marked invalid, disconnecting');
      s.disconnect();
      return;
    }

    // ── Build host-create-aware join payload ─────────────────────────────────
    // Priority:
    //  1. mm_createState_{roomId}  → just-created private room (host auto-join)
    //  2. hostToken_{roomId}       → existing stored host token (reconnect)
    //  3. mm_joinPw_{roomId}       → guest join password (from Hub join modal)
    let joinPassword = '';
    let hostToken    = '';

    // 1. Check for freshly-created room state (host auto-join path)
    try {
      const createRaw = sessionStorage.getItem('mm_createState_' + room.id);
      if (createRaw) {
        const createState = JSON.parse(createRaw);
        console.log(`[SOCKET][CREATE_STATE] room=${room.id} isPrivate=${createState.isPrivate}`);
        joinPassword = createState.password || '';
        // hostToken is still read from hostToken_ storage (saved by RoomLogic.createRoom)
        hostToken = sessionStorage.getItem('hostToken_' + room.id) || '';
        // Clear createState so it won't be reused in a stale way
        sessionStorage.removeItem('mm_createState_' + room.id);
        console.log(`[SOCKET][HOST_AUTO_JOIN] hostToken=${!!hostToken} joinPassword=${!!joinPassword}`);
      }
    } catch (e) {
      console.warn('[SOCKET][CREATE_STATE_PARSE_ERROR]', e);
    }

    // 2. Fall back to stored join password (guest private join flow)
    if (!joinPassword) {
      joinPassword = sessionStorage.getItem('mm_joinPw_' + room.id) || '';
    }

    // 3. Fall back to hostToken from storage (for reconnect scenarios)
    if (!hostToken) {
      hostToken = sessionStorage.getItem('hostToken_' + room.id) || '';
    }

    // 4. Load avatar from localStorage (set by hub or previous room-page visit)
    const joinAvatar = localStorage.getItem('mm_guest_avatar') || '';

    // CRITICAL DEBUG: trace what's being sent to server
    console.group('[SOCKET][JOIN-EMIT]');
    console.log('  room.id used:', room.id);
    console.log('  hostToken found:', !!hostToken, hostToken ? hostToken.substring(0,8)+'...' : null);
    console.log('  joinPassword found:', !!joinPassword);
    console.log('  joinAvatar found:', !!joinAvatar);
    console.log('  myName:', room.myName);
    console.log('  myClientId:', room.myClientId);
    console.groupEnd();

    s.emit('join-room', { roomId: room.id, name: room.myName, hostToken, password: joinPassword, avatar: joinAvatar, clientId: room.myClientId });
  });

  s.on('disconnect', (reason) => {
    console.log(`[socket] disconnected id=${s.id} reason=${reason}`);
    _isReconnecting = true;
    _socketReconnectCount++;

    // GUARD: If room is invalid, stop reconnecting
    if (!_roomIsValid) {
      console.log('[SOCKET][DISCONNECT] Room invalid, not attempting reconnect');
      return;
    }

    // GUARD: Too many reconnects → room is probably dead
    if (_socketReconnectCount > MAX_RECONNECT_GUARD) {
      console.log(`[SOCKET][RECONNECT_GUARD] Too many reconnects (${_socketReconnectCount}), room may be dead`);
      showRoomDeadMessage('Mất kết nối. Phòng có thể đã đóng.');
      return;
    }

    showToast('Kết nối bị ngắt — đang kết nối lại...', 'warning');
  });

  s.on('connect_error', (err) => {
    console.error(`[SOCKET][ERROR]`, err.message);
    _isReconnecting = true;
    _socketReconnectCount++;

    // GUARD: Stop reconnecting if room is invalid
    if (!_roomIsValid) {
      console.log('[SOCKET][ERROR] Room invalid, aborting reconnect');
      s.disconnect();
      return;
    }

    // GUARD: Too many errors
    if (_socketReconnectCount > MAX_RECONNECT_GUARD) {
      console.log(`[SOCKET][ERROR_GUARD] Too many errors (${_socketReconnectCount}), aborting`);
      showRoomDeadMessage('Không thể kết nối. Phòng có thể đã đóng.');
    }
  });

  s.on('joined-room', (payload) => {
    // Destructure với fallback an toàn
    const roomId          = payload?.roomId          || null;
    const roomName        = payload?.roomName        || 'Midnight Room';
    const isHost          = !!payload?.isHost;
    const hostId          = payload?.hostId          || null;
    const state           = payload?.state           || {};
    const playlist        = _skipPlaylistOnJoinedRoom ? room.playlist : (payload?.playlist || []);
    const members         = payload?.members         || [];
    const serverTime      = payload?.serverTime      || Date.now();
    const controllerIds   = payload?.controllerIds   || [];

    console.log(`[SOCKET][JOINED-ROOM] roomId=${roomId} roomName=${roomName} isHost=${isHost} hostId=${hostId} memberCount=${members.length} playlistSkipped=${_skipPlaylistOnJoinedRoom}`);
    console.log(`[ROOM_STATE_RECEIVED] videoId=${state?.currentVideoId} playing=${state?.isPlaying} time=${state?.currentTime} version=${state?.trackVersion} playlistLen=${playlist.length}`);
    console.log(`[ROOM_STATE_RECEIVED] full_payload`, JSON.stringify(payload, null, 2));

    // ── Fault-tolerant hydration pipeline ──────────────────────
    // Each step is wrapped individually so a render/UI crash does not kill state sync.
    try {
      // Cập nhật room state
      room.roomName          = roomName;
      room.playlist          = playlist;
      room.members           = members;
      room.isHost            = isHost;
      room.hostId            = hostId;
      room.trackVersion      = typeof state?.trackVersion === 'number' ? state.trackVersion : 0;
      room.currentTrackIndex = Number.isInteger(state?.currentTrackIndex) ? state.currentTrackIndex : -1;
      room.currentMood       = state?.mood || 'chill';

      // Khởi tạo controller state
      _controllerIds = controllerIds;
    } catch (e) { console.error('[HYDRATE][STATE]', e); }

    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
    try { updateControlUI(); } catch (e) { console.error('[HYDRATE][CONTROL]', e); }

    // Tính clock offset
    _serverTimeOffset = serverTime - Date.now();
    console.log('[SYNC] Server time offset:', _serverTimeOffset, 'ms');

    // Áp dụng mood
    try {
      if (typeof applyMood === 'function') {
        applyMood(room.currentMood, { remote: true });
      }
    } catch (e) { console.error('[HYDRATE][MOOD]', e); }

    // Cập nhật UI
    try {
      if (el.roomIdDisplay)      el.roomIdDisplay.textContent      = roomId;
      if (el.roomNameDisplay)    el.roomNameDisplay.textContent    = room.roomName;
      if (el.memberCountNum)    el.memberCountNum.textContent     = room.members.length;
    } catch (e) { console.error('[HYDRATE][UI]', e); }

    try { renderQueue(); } catch (e) { console.error('[HYDRATE][QUEUE]', e); }
    try { updateHostUI(); } catch (e) { console.error('[HYDRATE][HOST_UI]', e); }

    // Load video nếu có
    const currentVideoId = state?.currentVideoId || null;
    if (currentVideoId) {
      console.log(`[ROOM_STATE_RECEIVED] has video=${currentVideoId} playing=${state?.isPlaying} time=${state?.currentTime}`);
      try { applyInitialRoomState(state); } catch (e) { console.error('[HYDRATE][VIDEO]', e); }
    } else {
      console.log('[ROOM_STATE_RECEIVED] no current video, skip load');
      try { updatePlayBtn(); } catch (e) { console.error('[HYDRATE][PLAYBTN]', e); }
    }
    // Welcome message
    if (!window._welcomeShown) {
      window._welcomeShown = true;
      setTimeout(() => {
        addChatLine('system', null, '💡 Midnight Room khuyên dùng <a href="https://ublockorigin.com/" target="_blank" rel="noopener">uBlock Origin</a> hoặc trình duyệt cốccốc để hạn chế quảng cáo YouTube.');
      }, 500);
    }
  });

  s.on('mood-changed', mood => {
    console.log(`[SOCKET][MOOD-CHANGED] mood=${mood}`);
    applyMood(mood, { remote: true });
  });
  s.on('video-synced', state => {
    if (!state) return;
    console.log(`[SOCKET][VIDEO-SYNCED] actionId=${state.lastActionId || 0} play=${state.isPlaying} time=${state.currentTime}`);
    syncVideoState(state);
  });

  // ── HYBRID SYNC: playback-state handler ────────────────────────
  // Drift thresholds:
  // - < 5s → IGNORE (smooth playback)
  // - 5-20s → soft correction (playbackRate)
  // - > 20s → hard seek (cả forward và backward)
  s.on('playback-state', state => {
    if (!state) return;

    const cfg = window.HYBRID_SYNC || window.SOFT_SYNC || {};

    // Skip if we're the host/controller (we control our own playback)
    if (canControlPlayer()) return;

    // Skip if no video
    if (!state.currentVideoId) return;

    // Skip if this is about a different track
    if (state.currentVideoId !== room.currentVideoId) {
      console.log(`[SYNC][TRACK_MISMATCH] ours=${room.currentVideoId} theirs=${state.currentVideoId} → loading new track`);
      handleTrackChanged(state);
      return;
    }

    // Queue if player not ready
    if (!room.ytPlayer || !room.ytReady) {
      _pendingRoomState = state;
      return;
    }

    // ── Action Version Check ──────────────────────────────────
    const incomingActionId = state.lastActionId || 0;
    if (_shouldIgnoreStaleAction(incomingActionId)) {
      return;
    }

    const p = room.ytPlayer;
    const localTime = p.getCurrentTime?.() || 0;
    const serverTime = state.currentTime || 0;
    const isPlaying = !!state.isPlaying;
    const syncType = state.syncType || 'action';

    console.log(`[SYNC][RECV] actionId=${incomingActionId} syncType=${syncType} serverTime=${serverTime}s localTime=${localTime.toFixed(1)}s isPlaying=${isPlaying}`);

    // ── Periodic Recovery Mode ─────────────────────────────────
    // Chỉ dùng để reconnect recovery, KHÔNG chase playback
    if (syncType === 'periodic_recovery') {
      console.log('[SYNC][PERIODIC_RECOVERY] Skipping time sync - only for recovery');
      // Chỉ sync play/pause state nếu cần
      const playerState = p.getPlayerState?.();
      const ytPlaying = playerState === window.YT?.PlayerState?.PLAYING;
      if (isPlaying !== ytPlaying) {
        console.log(`[SYNC][RECOVERY_PLAY_STATE] isPlaying=${isPlaying} ytPlaying=${ytPlaying}`);
        if (isPlaying) {
          safeAutoplay(p).catch(() => {});
        } else {
          p.pauseVideo?.();
        }
      }
      return;
    }

    // ── Play/Pause Sync (always sync) ─────────────────────────
    const playerState = p.getPlayerState?.();
    const ytPlaying = playerState === window.YT?.PlayerState?.PLAYING;

    if (isPlaying !== ytPlaying) {
      console.log(`[SYNC][PLAY_STATE] isPlaying=${isPlaying} ytPlaying=${ytPlaying}`);
      if (isPlaying) {
        safeAutoplay(p).catch(() => {});
      } else {
        p.pauseVideo?.();
      }
      // Cập nhật action ID sau khi sync play/pause
      if (incomingActionId > _lastAppliedActionId) {
        _lastAppliedActionId = incomingActionId;
      }
    }

    // Skip time sync if not playing
    if (!isPlaying) return;

    // Skip time sync if server didn't send currentTime
    if (serverTime === null || serverTime === undefined) {
      console.log('[SYNC][NO_TIME] serverTime is null - skipping time sync');
      return;
    }

    // ── Drift Check ────────────────────────────────────────────
    const drift = localTime - serverTime;
    const driftAbs = Math.abs(drift);
    const smallDrift  = cfg.SMALL_DRIFT_THRESHOLD  || 5;
    const mediumDrift = cfg.MEDIUM_DRIFT_THRESHOLD || 20;
    const largeDrift  = cfg.LARGE_DRIFT_THRESHOLD  || 20;

    console.log(`[SYNC][DRIFT] guest=${localTime.toFixed(1)}s host=${serverTime.toFixed(1)}s drift=${driftAbs.toFixed(1)}s`);

    // < 5s: ignore
    if (driftAbs <= smallDrift) {
      console.log(`[SYNC][IGNORE] drift ${driftAbs.toFixed(1)}s <= ${smallDrift}s threshold`);
      return;
    }

    // Check cooldown
    if (_shouldIgnoreSync()) {
      return;
    }

    // Buffering tolerance
    if (cfg.BUFFERING_IGNORE && _isPlayerBuffering()) {
      console.log('[SYNC][BUFFERING] Skipping sync - player is buffering');
      return;
    }

    // 5-20s: soft correction
    if (driftAbs <= mediumDrift) {
      console.log(`[SYNC][SOFT_CORRECT] drift=${driftAbs.toFixed(1)}s → playbackRate adjustment`);
      _applySoftCorrection(serverTime, localTime);
      if (incomingActionId > _lastAppliedActionId) {
        _lastAppliedActionId = incomingActionId;
      }
    } else {
      // > 20s: hard seek (cả forward và backward)
      console.log(`[SYNC][HARD_SEEK] drift=${driftAbs.toFixed(1)}s > ${largeDrift}s → seeking to ${serverTime.toFixed(1)}s`);
      _applyHardSeek(serverTime, localTime);
      if (incomingActionId > _lastAppliedActionId) {
        _lastAppliedActionId = incomingActionId;
      }
    }
  });

  s.on('track-changed', payload => {
    console.log(`[SOCKET][TRACK-CHANGED]`, JSON.stringify(payload));
    if (!payload) {
      console.log('[SOCKET][TRACK-CHANGED] Invalid payload, skipped');
      return;
    }
    handleTrackChanged(payload);
  });
  s.on('playlist-updated',  list  => {
    if (!list) return;
    console.log(`[SOCKET][PLAYLIST-UPDATED] incomingLength=${list.length} localLength=${room.playlist.length} incomingIds=${list.map(v => v.id).join(',')}`);
    // Server is authoritative — always replace. Remove makes list shorter, add makes it longer.
    room.playlist = list;
    console.log('[PLAYLIST][RENDER]', room.playlist.map(x => x.id));
    // Debounce joined-room: if we just got a fresh playlist, skip the stale one from joined-room
    _skipPlaylistOnJoinedRoom = true;
    clearTimeout(_skipPlaylistTimer);
    _skipPlaylistTimer = setTimeout(() => { _skipPlaylistOnJoinedRoom = false; }, 2000);
    console.log('[SEARCH][PLAYLIST_CHECK] playlist updated, rerendering search results');
    renderQueue();
    if (_lastSearchResults) {
      console.log('[SEARCH][RERENDER_AFTER_PLAYLIST_UPDATE]', _lastSearchResults.length, 'items');
      renderResults(_lastSearchResults, 'search');
    }
  });
  s.on('reaction-received', ({ emoji }) => spawnEmoji(emoji));

  // [FIX] Chat: thêm debug logs để trace message flow
  s.on('chat-msg', (data) => {
    console.log(`[CHAT][RECEIVED] senderId=${data.senderId} name="${data.name}" text="${data.text?.substring(0, 50)}" mySocketId=${s.id}`);

    // Verify element exists before appending
    if (!el.roomMessages) {
      console.error('[CHAT][ERROR] el.roomMessages is null!');
      return;
    }

    addChatLine(data.senderId, data.name, data.text, data.timestamp, data.avatar);
  });

  s.on('member-joined',     ({ id, name, avatar, clientId }) => {
    console.log(`[SOCKET][MEMBER-JOINED] socket=${id} name=${name} avatar=${avatar} clientId=${clientId}`);
    // Prevent duplicate: same socket.id should not appear twice
    if (room.members.some(m => m.id === id)) {
      console.log('[SOCKET][MEMBER-JOINED] duplicate ignored:', id);
      return;
    }
    room.members.push({ id, name, avatar: avatar || '', clientId: clientId || null });
    if (el.memberCountNum) el.memberCountNum.textContent = room.members.length;
    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
  });
  // Authoritative members list — replaces entire local member array.
  // Sent by server on every join (including same-clientId reconnects) to ensure all
  // clients stay in sync: old tabs remove their ghost entry after replacement.
  s.on('members-updated', ({ members }) => {
    if (!Array.isArray(members)) return;
    const prevCount = room.members.length;
    room.members = members.map(m => ({
      id: m.id || m.socketId || String(Math.random()),
      name: m.name || '?',
      avatar: m.avatar || '',
      clientId: m.clientId || null,
    }));
    console.log(`[SOCKET][MEMBERS-UPDATED] prev=${prevCount} next=${room.members.length}`, room.members.map(m => ({ id: m.id, name: m.name, avatar: m.avatar ? 'HAS_AVATAR' : 'NO_AVATAR' })));
    if (el.memberCountNum) el.memberCountNum.textContent = room.members.length;
    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
  });
  s.on('member-left', id => {
    const left = room.members.find(m => m.id === id);
    console.log(`[SOCKET][MEMBER-LEFT] socket=${id} name=${left?.name || 'unknown'}`);
    room.members = room.members.filter(m => m.id !== id);
    if (el.memberCountNum) el.memberCountNum.textContent = room.members.length;
    // Xóa khỏi controller list nếu có
    _controllerIds = _controllerIds.filter(cid => cid !== id);
    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
  });
  s.on('room-state-updated', ({ hostId, controllerIds }) => {
    console.log(`[SOCKET][ROOM_STATE_UPDATED] hostId=${hostId} controllers=${JSON.stringify(controllerIds)}`);
    room.hostId = hostId;
    _controllerIds = controllerIds || [];
    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
    try { updateControlUI(); } catch (e) { console.error('[HYDRATE][CONTROL]', e); }
  });
  
  // Host disconnected and grace period expired - new host promoted
  s.on('host-changed', ({ newHostId, newHostName, newHostToken, resetControllers }) => {
    console.log(`[SOCKET][HOST-CHANGED] newHost=${newHostId}(${newHostName}) resetControllers=${resetControllers}`);
    
    const isNewHost = newHostId === room.socket?.id;
    
    room.hostId = newHostId;
    room.isHost = isNewHost;
    
    // Always reset controller list when host changes
    if (resetControllers) {
      _controllerIds = [];
    }
    
    if (isNewHost) {
      // We are the new host - save the new token
      sessionStorage.setItem(`hostToken_${room.id}`, newHostToken);
      showToast(`🎉 Bạn là host mới!`, 'success');
    } else {
      // Another member is now host
      showToast(`👑 ${newHostName} là host mới`, 'info');
      // Clear our host token if we were the old host
      sessionStorage.removeItem(`hostToken_${room.id}`);
    }
    
    // Update UI
    try { updateHostUI(); } catch (e) { console.error('[HYDRATE][HOST_UI]', e); }
    try { updateControlUI(); } catch (e) { console.error('[HYDRATE][CONTROL]', e); }
    try { renderMemberList(); } catch (e) { console.error('[HYDRATE][MEMBERS]', e); }
  });
  s.on('room-error', msg => {
    console.log(`[SOCKET][ROOM-ERROR] msg=${msg}`);
    notify(msg);
    // Critical join/room errors → redirect back to RoomHub
    if (msg.includes('không tìm thấy') || msg.includes('not found') ||
        msg.includes('mật khẩu sai') || msg.includes('wrong password') ||
        msg.includes('phòng không') || msg.includes('room not') ||
        msg.includes('đã hết') || msg.includes('expired')) {
      showRoomDeadMessage('Phòng không tồn tại hoặc đã đóng.');
    }
  });

  // Room was closed by host or inactivity
  s.on('room-closed', ({ reason } = {}) => {
    console.log(`[SOCKET][ROOM-CLOSED] reason=${reason}`);

    // Mark room as invalid immediately to prevent reconnect attempts
    _roomIsValid = false;

    // Cleanup: clear all timers and intervals
    if (_forceSourceLoadTimer) { clearTimeout(_forceSourceLoadTimer); _forceSourceLoadTimer = null; }
    if (_progressIntervalId) { clearInterval(_progressIntervalId); _progressIntervalId = null; }
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

    const msgs = {
      host:              '🚪 Host đã đóng phòng.',
      host_disconnected: '🚪 Host đã rời phòng — phòng đã đóng.',
      inactivity:        '⏰ Phòng tự đóng do không hoạt động.',
      no_online_host:   '⏰ Không có host trực tuyến — phòng đã đóng.',
      empty:            '🚪 Phòng trống — phòng đã đóng.',
    };
    const msg = msgs[reason] || 'Phòng đã đóng.';

    // Stop player
    try { room.ytPlayer?.stopVideo?.(); } catch (_) {}
    room.currentVideoId = null;
    room.isPlaying      = false;

    // Use the room dead message helper which handles all cleanup and redirect
    showRoomDeadMessage(msg);
  });
}

/**
 * updateHostUI()
 * Show/hide Close Room button based on host status.
 */
function updateHostUI() {
  const btn = document.getElementById('close-room-btn');
  if (!btn) return;
  btn.style.display = room.isHost ? 'inline-flex' : 'none';
}

/**
 * setupCloseRoom()
 * Wire up the Close Room button (only visible to host).
 */
function setupCloseRoom() {
  const btn = document.getElementById('close-room-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!room.isHost) return;
    openConfirmModal({
      type: 'close',
      title: 'Đóng phòng?',
      description: 'Tất cả thành viên sẽ bị ngắt kết nối khỏi không gian này.',
      confirmText: 'Đóng phòng',
      cancelText: 'Hủy',
      onConfirm: () => {
        room.socket?.emit('close-room');
      }
    });
  });
}

/* ── Confirmation Modal ────────────────────────────────────────── */
let _confirmResolve = null;

function openConfirmModal({ type, title, description, confirmText, cancelText, onConfirm }) {
  const backdrop = document.getElementById('confirm-backdrop');
  const modal   = document.getElementById('confirm-modal');
  if (!backdrop || !modal) return;

  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = description;

  const confirmBtn = document.getElementById('confirm-confirm');
  const cancelBtn  = document.getElementById('confirm-cancel');

  // Set button text + style
  confirmBtn.textContent = confirmText || 'Xác nhận';
  confirmBtn.className  = 'confirm-btn danger' + (type === 'leave' ? ' leave' : '');

  cancelBtn.textContent  = cancelText || 'Hủy';
  cancelBtn.className    = 'confirm-btn cancel';

  // Dismiss helper
  const dismiss = () => {
    backdrop.classList.remove('open');
    backdrop.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeydown);
    _confirmResolve = null;
  };

  const onBackdropClick = (e) => {
    if (e.target === backdrop) dismiss();
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') dismiss();
  };

  // Swap handlers
  confirmBtn.replaceWith(confirmBtn.cloneNode(true));
  cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  const newConfirmBtn = document.getElementById('confirm-confirm');
  const newCancelBtn  = document.getElementById('confirm-cancel');

  newConfirmBtn.addEventListener('click', () => {
    dismiss();
    onConfirm?.();
  });

  newCancelBtn.addEventListener('click', dismiss);

  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeydown);

  backdrop.classList.add('open');
  newConfirmBtn.focus();
}

/* ── Room Subdomain Config ── */
const ROOM_SUBDOMAIN = 'music.hduchuy.id.vn';

function getRoomHubUrl() {
  let dev = window.MM_IS_LOCAL;
  if (typeof dev !== 'boolean') {
    const h = location.hostname;
    dev = h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h);
  }
  if (dev) {
    return `${location.protocol}//${location.hostname}:3000/room-hub.html`;
  }
  return `https://${ROOM_SUBDOMAIN}/room-hub.html`;
}

/* ── Boot ── */
function boot() {
  // Hide any lingering transition overlay from previous navigation
  RoomTransition.hide();

  // ── SESSION VALIDATION ─────────────────────────────────────────────
  // room.html is a PRIVATE internal session endpoint.
  // Priority order for resolving roomId:
  //   1. mm_pending_room  (Tier 1) — Hub gateway flow: /room → /room.html (sessionStorage set)
  //   2. ?join= in URL    (Tier 2) — Deep-link flow: /r/:id → redirect → /room.html?join=:id
  //   3. URL pathname     (Tier 3) — Refresh/deep-link fallback: replaceState cleared ?join=, session cleared
  //      Use mm_active_room as the session marker to confirm this was a valid room session.
  // If NONE available → redirect to RoomHub (absolute URL).
  const pendingRoom  = sessionStorage.getItem('mm_pending_room') || '';
  const activeRoom   = sessionStorage.getItem('mm_active_room')  || '';
  const urlParams    = new URLSearchParams(window.location.search);
  const urlJoinId    = urlParams.get('join') || '';

  // Tier 3: Extract roomId from /r/:id in URL pathname
  // Covers: F5 after replaceState cleared ?join=, deep-link where ?join= was stripped, etc.
  let pathnameRoomId = '';
  const pathname = window.location.pathname;
  if (pathname.startsWith('/r/')) {
    const raw = pathname.slice(3).split('?')[0].split('/')[0];
    if (raw && raw.length >= 3 && raw !== 'room' && raw !== 'r') {
      pathnameRoomId = raw;
    }
  }

  console.group('[BOOT] Session Validation');
  console.log('  pathname:', pathname);
  console.log('  mm_pending_room:', pendingRoom || '(missing)');
  console.log('  mm_active_room:', activeRoom  || '(missing)');
  console.log('  ?join= from URL:', urlJoinId  || '(none)');
  console.log('  /r/ from pathname:', pathnameRoomId || '(none)');

  // Resolve in priority order
  let resolvedRoom = pendingRoom || urlJoinId;

  // Tier 3: Only use pathname if mm_active_room confirms this was a valid room session.
  // This prevents arbitrary /r/foo from being accepted when there's no session context.
  if (!resolvedRoom && pathnameRoomId && activeRoom) {
    console.log('  [TIER3] Using pathname fallback — mm_active_room confirmed valid session');
    resolvedRoom = pathnameRoomId;
  } else if (!resolvedRoom && pathnameRoomId && !activeRoom) {
    console.log('  [TIER3] WARNING: pathname roomId found BUT mm_active_room missing — treating as direct deep-link');
    resolvedRoom = pathnameRoomId;
  }

  // SECURITY: No session marker = direct access attempt → redirect to RoomHub (absolute URL)
  if (!resolvedRoom) {
    console.warn('[BOOT][REJECT] No session marker — direct access attempt blocked');
    window.location.replace(getRoomHubUrl());
    return;
  }

  // Validate roomId format
  if (resolvedRoom.length < 3 || resolvedRoom === 'room' || resolvedRoom === 'r') {
    console.warn('[BOOT] Invalid roomId → redirect to RoomHub');
    sessionStorage.removeItem('mm_pending_room');
    window.location.replace(getRoomHubUrl());
    return;
  }

  console.log('  session validated: YES — resolvedRoom:', resolvedRoom);
  console.groupEnd();

  room.id = resolvedRoom;

  // Set active room marker for refresh stability (RoomHub uses this to auto-restore session)
  sessionStorage.setItem('mm_active_room', room.id);

  // Clear pending marker after use (mm_active_room stays until leave)
  sessionStorage.removeItem('mm_pending_room');

  // ── SET CANONICAL ROOM URL ─────────────────────────────────────────
  // Browser URL must always show /r/:id so share/copy/invite links work.
  // replaceState does NOT trigger a page reload — socket connection stays intact.
  window.history.replaceState({}, '', '/r/' + room.id);

  // Seed avatar from guest-profile
  try {
    import('./guest-profile.js').then(({ getGuestProfile }) => {
      const profile = getGuestProfile();
      room.myAvatar = profile.avatar || '';
      localStorage.setItem('mm_guest_avatar', profile.avatar || '');
      console.log('[MEMBER_AVATAR] Seeded from profile:', room.myAvatar);
    }).catch(err => {
      console.error('[MEMBER_AVATAR] Import failed:', err);
    });
  } catch (_) {}
  setupMoodPanel();
  setupPlistTabs();
  setupSearch();
  setupPlayerControls();
  setupPlayerToggle();
  setupReactions();
  setupChat();
  setupMemberPanel();
  setupCloseRoom();
  setupIframeInteraction();
  setupAudioUnlock(); // Enable muted autoplay + unlock on first interaction
  el.leaveBtn?.addEventListener('click', () => {
    openConfirmModal({
      type: 'leave',
      title: 'Rời phòng?',
      description: 'Bạn sẽ quay trở lại RoomHub.',
      confirmText: 'Rời phòng',
      cancelText: 'Ở lại',
      onConfirm: () => {
        // Mark room as invalid
        _roomIsValid = false;

        // Cleanup trước khi rời trang
        try {
          sessionStorage.removeItem('mm_active_room');
          sessionStorage.removeItem('mm_pending_room');
          sessionStorage.removeItem('mm_createState_' + room.id);
          sessionStorage.removeItem('hostToken_' + room.id);
        } catch (_) {}

        // Clear all timers
        if (_forceSourceLoadTimer) { clearTimeout(_forceSourceLoadTimer); _forceSourceLoadTimer = null; }
        if (_progressIntervalId) { clearInterval(_progressIntervalId); _progressIntervalId = null; }
        if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

        // Disconnect socket
        if (room.socket) {
          room.socket.disconnect();
          room.socket = null;
        }

        // Navigate to RoomHub using leave API
        RoomTransition.leave();
      }
    });
  });
  setupSocket();
  
  // Setup sync overlay
  document.getElementById('sync-play-btn')?.addEventListener('click', () => {
    document.getElementById('sync-overlay')?.classList.add('hidden');
    room.ytPlayer?.playVideo?.();
  });
  
  if (typeof effects !== 'undefined') effects.resumeAll();
  if (typeof initStars === 'function') initStars();
  if (typeof effects !== 'undefined') effects.start('stars');
  // Wait for joined-room event to set the authoritative mood.
  startProgressLoop();
}

window.addEventListener('DOMContentLoaded', boot);




