/* ========================================================================== *
 *  Midnight Mood (single-file app)
 *  Refactor goals:
 *  - keep UI/UX + features unchanged
 *  - cleaner architecture (sections)
 *  - safer Todo (no XSS)
 *  - better mobile performance & fewer leaks
 * ========================================================================== */

/* ============================== [constants] =============================== */

const recommendedPlaylists = Object.freeze([
  {
    id:"kirimi",
    title:"Kirimi Remix Playlist",
    mood:"Remix",
    artist:"Kai Hirota",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2013898965&color=%23ff5500&auto_play=true"
  },
  {
    id:"tiktok-remix",
    title:"TikTok Remix 2026",
    mood:"Remix",
    artist:"Văn Tường Vi",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2163616280&color=%23ff5500&auto_play=true"
  },
  {
    id:"sleep",
    title:"SLEEP",
    mood:"Sleep",
    artist:"Hoàng Đức Huy",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2233490129&color=%23ff5500&auto_play=true"
  },
  {
    id:"chill",
    title:"CHILL",
    mood:"Chill",
    artist:"Hoàng Đức Huy",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2233489058&color=%23ff5500&auto_play=true"
  },
  {
    id:"sad",
    title:"SAD",
    mood:"Sad",
    artist:"Hoàng Đức Huy",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2233489847&color=%23ff5500&auto_play=true"
  },
  {
    id:"happy",
    title:"HAPPI",
    mood:"Happy",
    artist:"Hoàng Đức Huy",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2233489628&color=%23ff5500&auto_play=true"
  },
  {
    id:"study",
    title:"STUDY",
    mood:"Study",
    artist:"Hoàng Đức Huy",
    embed:"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/soundcloud%253Aplaylists%253A2233489751&color=%23ff5500&auto_play=true"
  }
]);

// Add new moods freely here; UI mood buttons currently expose 5 moods.
// Extra moods are future-ready for playlists/custom UI later.
const MOODS = Object.freeze(['sad','happy','chill','sleep','study','rain','lofi','jazz']);

const MOOD_META = Object.freeze({
  sad:{emoji:'🌧',label:'sad'},
  happy:{emoji:'☀',label:'happy'},
  chill:{emoji:'🌙',label:'chill'},
  sleep:{emoji:'✨',label:'sleep'},
  study:{emoji:'📚',label:'study'}
});

