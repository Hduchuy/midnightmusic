// =========================================================================
// CẤU HÌNH HỆ THỐNG
// =========================================================================

const isLocal = location.hostname === "localhost" || 
                location.hostname === "127.0.0.1" || 
                location.hostname.startsWith("192.168.") || 
                location.hostname.startsWith("10.") || 
                /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(location.hostname);

const RENDER_BACKEND = "https://api.music.hduchuy.id.vn";

// Optional override (e.g. staging): set before loading config.js — window.MM_BACKEND_URL = 'https://...'
const backendBase =
  (typeof window !== "undefined" && window.MM_BACKEND_URL) || RENDER_BACKEND;

window.CONFIG = {
  // Backend URL for APIs
  BACKEND_URL: isLocal ? "http://localhost:3001" : backendBase,

  // Socket.io URL — connect to backend server (NOT frontend static server)
  SOCKET_URL: isLocal ? "http://localhost:3001" : backendBase,

  // SoundCloud search proxy
  SOUNDCLOUD_PROXY_URL: isLocal
    ? "http://localhost:3001/api/search"
    : `${backendBase}/api/search`,

  // YouTube search
  YT_SEARCH_URL: isLocal
    ? "http://localhost:3001/api/yt-search"
    : `${backendBase}/api/yt-search`,
};

window.STORAGE_KEYS = {
  TODOS: 'todos',
  STICKY_NOTES: 'sticky-notes-v2',
  MOOD_PREF: 'midnight_mood_pref',
  MUSIC_HISTORY: 'midnight_history',
};

/** Single source for “local dev host” — other scripts must not redeclare `const isLocal`. */
window.MM_IS_LOCAL = isLocal;
