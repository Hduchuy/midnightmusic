/**
 * room-constants.js
 * Centralized constants for the multiplayer room system.
 */

window.ROOM_EVENTS = {
  // Client -> Server
  CREATE_ROOM:         'create-room',
  JOIN_ROOM:           'join-room',
  CHECK_ROOM_ACCESS:   'check-room-access',
  SYNC_MOOD:           'sync-mood',
  ADD_TO_PLAYLIST:     'add-to-playlist',
  REMOVE_FROM_PLAYLIST: 'remove-from-playlist',
  REQUEST_TRACK_CHANGE: 'request-track-change',
  SYNC_VIDEO:          'sync-video',
  HEARTBEAT:           'room-heartbeat',
  CHAT_MSG:            'chat-msg',
  SEND_REACTION:       'send-reaction',
  CLOSE_ROOM:          'close-room',
  TOGGLE_CONTROLLER:   'toggle-controller',

  // Server -> Client
  ROOM_CREATED:        'room-created',
  JOINED_ROOM:         'joined-room',
  ROOM_ERROR:          'room-error',
  ROOM_ACCESS_CHECKED: 'room-access-checked',
  MEMBER_JOINED:       'member-joined',
  MEMBER_LEFT:         'member-left',
  PLAYLIST_UPDATED:    'playlist-updated',
  TRACK_CHANGED:       'track-changed',
  VIDEO_SYNCED:        'video-synced',
  CHAT_MSG_RECEIVED:   'chat-msg',
  REACTION_RECEIVED:   'reaction-received',
  MOOD_CHANGED:        'mood-changed',
  ROOM_CLOSED:         'room-closed',
  HOST_CHANGED:        'host-changed',
  ROOM_STATE_UPDATED:  'room-state-updated',
  PLAYBACK_STATE:      'playback-state',
};

// ── HYBRID SYNC Configuration ─────────────────────────────────────
// Ưu tiên smooth playback NHƯNG session phải cùng timeline
// Drift lớn phải tự kéo về, action mới nhất phải authoritative

window.HYBRID_SYNC = {
  // ── Drift Thresholds (seconds) ──────────────────────────────
  // < SMALL_DRIFT_THRESHOLD → hoàn toàn bỏ qua (playback mượt)
  SMALL_DRIFT_THRESHOLD: 5,    // < 5s → IGNORE (smooth playback)
  // >= MEDIUM_DRIFT_THRESHOLD → soft playbackRate correction
  MEDIUM_DRIFT_THRESHOLD: 20,  // 5-20s → soft playbackRate correction
  // >= LARGE_DRIFT_THRESHOLD → hard seek sync
  LARGE_DRIFT_THRESHOLD: 20,   // > 20s → hard seek sync

  // ── Playback Rate Adjustment ───────────────────────────────
  // Soft correction bằng playbackRate (không seek)
  FAST_RATE:  1.05,  // Catch up nhẹ
  SLOW_RATE:  0.95,  // Slow down nhẹ
  SOFT_CORRECT_DURATION: 5000,  // Áp dụng trong 5s rồi về 1.0

  // ── Cooldowns ─────────────────────────────────────────────
  // Sau hard sync: không nhận sync mới trong X ms (tránh seek loop)
  HARD_SYNC_LOCK_MS: 10000,   // 10s action lock sau hard sync
  SOFT_CORRECT_COOLDOWN_MS: 8000,  // 8s cooldown sau soft correction
  SEEK_COOLDOWN_MS: 10000,    // 10s cooldown sau seek

  // ── Periodic Sync ─────────────────────────────────────────
  // Chỉ dùng để reconnect recovery, KHÔNG chase playback
  PERIODIC_RECOVERY_MS: 60000,   // 60s - chỉ để keep alive

  // ── Buffering Tolerance ───────────────────────────────────
  BUFFERING_IGNORE: true,

  // ── Play/Pause Time Sync ────────────────────────────────────
  // Khi play/pause: PHẢI sync currentTime
  SYNC_TIME_ON_PLAY_PAUSE: true,
};

// Backward compatibility alias
window.SOFT_SYNC = window.HYBRID_SYNC;

window.ROOM_STORAGE = {
  USERNAME:      'mm_room_username',
  HOST_TOKEN:    'hostToken_',   // prefix
  JOIN_PASSWORD: 'joinPw_',      // prefix (sessionStorage)
};

window.ROOM_MOODS = {
  sad:   { emoji: '🌧', label: 'Sad'   },
  happy: { emoji: '☀️', label: 'Happy' },
  chill: { emoji: '🌙', label: 'Chill' },
  sleep: { emoji: '✨', label: 'Sleep' },
  study: { emoji: '📚', label: 'Study' },
};
