/* ============================= [panels UI] ================================ */
function closeAllPanels(){
  document.querySelectorAll('.side-panel').forEach(p=>p.classList.remove('open'));
  document.body.classList.remove('sidebar-open');
}

function openPanel(id){
  const p = document.getElementById(id);
  const wasOpen = p && p.classList.contains('open');
  closeAllPanels();
  if(!wasOpen){
    p?.classList.add('open');
    document.body.classList.add('sidebar-open');
  }
}

function closePanel(id){
  document.getElementById(id)?.classList.remove('open');
  if(!document.querySelector('.side-panel.open')){
    document.body.classList.remove('sidebar-open');
  }
}

/* =========================== [audio system] =============================== */
function setMusicPlaying(active){
  document.body.classList.toggle('music-playing',active);
}

function keepPlayerOpenState(){
  if(!state.playerMinimized) showPlayer();
}

function hidePlayer(){
  state.playerMinimized = true;
  $.bottom.classList.add('hidden-player');
  $.playerToggle.setAttribute('aria-label','Expand player');
}

function showPlayer(){
  state.playerMinimized = false;
  $.bottom.classList.remove('hidden-player');
  $.playerToggle.setAttribute('aria-label','Minimize player');
}

function togglePlayerVisibility(){
  state.playerMinimized ? showPlayer() : hidePlayer();
}

function updateProgressFill(){
  const max = parseFloat($.progress.max) || $.audio.duration || 0;
  const value = parseFloat($.progress.value) || 0;
  const percent = max ? clamp((value / max) * 100,0,100) : 0;
  $.progress.style.setProperty('--progress-fill',`${percent}%`);
}

function syncPlayerUI(){
  if($.playBtn) $.playBtn.textContent = state.isPlaying ? '⏸' : '▶';
  if($.visualizer) $.visualizer.style.opacity = state.isPlaying ? '.28' : '0';
  setMusicPlaying(state.isPlaying);
  if($.volumeBtn) {
    $.volumeBtn.classList.toggle('is-muted',state.isMuted);
    $.volumeBtn.setAttribute('aria-label',state.isMuted ? 'Unmute' : 'Mute');
  }
}

async function safePlay(){
  try{
    if(!$.audio) return false;
    const p = $.audio.play();
    if(p && typeof p.then === 'function'){
      await p;
    }
    state.isPlaying = true;
    keepPlayerOpenState();
    syncPlayerUI();
    return true;
  }catch{
    state.isPlaying = false;
    syncPlayerUI();
    notify('Chạm nút Play để bắt đầu phát');
    return false;
  }
}

function updatePlayerUI({title,artist,subLabel}){
  $.songTitle.textContent = title || 'Midnight Mood';
  $.songMood.textContent = artist || subLabel || '';
}

function setTrackSrc(src){
  if (!src) return false;
  // Browser handles Unicode paths natively - no encoding needed
  const next = toAbsUrl(src);
  const current = toAbsUrl($.audio.src || '');
  if(next && next === current) return false;
  console.log("Resolved audio path:", src);
  $.audio.src = src;
  return true;
}

function getMoodPlaylist(mood){
  return Object.freeze({
    id:`mood:${mood}`,
    mood,
    trackIds:(MUSIC_LIBRARY[mood] || []).map(t=>t.id)
  });
}

function getPlaylistTrackIds(){
  return state.playlist?.trackIds || [];
}

function getCurrentTrackId(){
  if(state.currentTrackId && TRACK_BY_ID[state.currentTrackId]){
    return state.currentTrackId;
  }
  const ids = getPlaylistTrackIds();
  const i = clamp(state.trackIndex,0,Math.max(0,ids.length - 1));
  return ids[i] || null;
}

function getTrackById(id){
  return TRACK_BY_ID[id] || null;
}

function pushRecent(id){
  if(!id) return;
  state.recent.unshift(id);
  const cap = isMobileView() ? 6 : 10;
  if(state.recent.length > cap) state.recent.length = cap;
}

function getRandomTrackId({excludeIds=[]} = {}){
  const ids = getPlaylistTrackIds().filter(Boolean);
  if(ids.length === 0) return null;
  if(ids.length === 1) return ids[0];

  const currentId = getCurrentTrackId();
  const avoid = new Set([...excludeIds, ...state.recent, currentId]);
  let candidates = ids.filter(id=>!avoid.has(id));
  if(candidates.length === 0){
    // playlist is small: allow repeats but avoid immediate same first
    candidates = ids.filter(id=>id !== currentId);
    if(candidates.length === 0) candidates = ids.slice();
  }
  return candidates[Math.floor(Math.random()*candidates.length)];
}

function queueNextTrackId(){
  const ids = getPlaylistTrackIds();
  if(ids.length === 0) return null;

  // For mood-based system we always move randomly within current mood playlist.
  return getRandomTrackId();
}

const preloader = new Audio();
preloader.preload = 'metadata';

function preloadSongById(id){
  const track = getTrackById(id);
  if(!track || !track.file) return;
  if(state.preloadId === id) return;
  state.preloadId = id;
  try{
    preloader.src = track.file;
    preloader.load();
  }catch{
    // ignore preload errors
  }
}

async function playSong(track, { autoplay = true, reason = '', remote = false } = {}) {
  if (!track) return false;

  if (state.soundcloud.active) {
    deactivateSoundCloudMode();
  }
  state.source = 'local';
  state.currentTrackId = track.id || null;
  updatePlayerUI({ title: track.title, artist: track.artist });

  const changed = setTrackSrc(track.file);
  if (changed) $.audio.currentTime = 0;

  // Sync to room
  if (!remote && window.RoomManager?.emitPlayerState) {
    window.RoomManager.emitPlayerState({
      currentTrackId: state.currentTrackId,
      isPlaying: autoplay
    });
  }

  // preload next lightly for smoother "next" UX
  const nextId = queueNextTrackId();
  if (nextId) preloadSongById(nextId);

  if (autoplay) {
    const ok = await safePlay();
    if (!ok && reason) notify(reason);
    return ok;
  }

  syncPlayerUI();
  return true;
}

async function playTrackById(id, { autoplay = true, reason = '', remote = false } = {}) {
  const track = getTrackById(id);
  if (!track) return false;
  const idx = getPlaylistTrackIds().indexOf(id);
  if (idx >= 0) state.trackIndex = idx;
  return await playSong(track, { autoplay, reason, remote });
}

async function ensureLocalPlayback(){
  let id = getCurrentTrackId();
  if(!id){
    id = getRandomTrackId();
  }
  if(!id) return;
  await playTrackById(id,{autoplay:true});
}

async function togglePlay() {
  if (state.isPlaying) {
    $.audio.pause();
    state.isPlaying = false;
    syncPlayerUI();
    if (window.RoomManager?.emitPlayerState) window.RoomManager.emitPlayerState({ isPlaying: false });
    return;
  }

  if (!$.audio.src) {
    await ensureLocalPlayback();
    return;
  }

  const ok = await safePlay();
  if (ok && window.RoomManager?.emitPlayerState) window.RoomManager.emitPlayerState({ isPlaying: true });
}

async function prevSong(){
  if(state.source !== 'local'){
    await ensureLocalPlayback();
    notify('Quay về nhạc mood');
    // continue to previous local track after switching back
  }

  // If we have history, go back; otherwise keep old UX (restart)
  const prevId = state.history.shift();
  if(prevId){
    const ids = getPlaylistTrackIds();
    const idx = ids.indexOf(prevId);
    if(idx >= 0) state.trackIndex = idx;
    await playTrackById(prevId,{autoplay:true});
    notify('Previous track');
    return;
  }

  $.audio.currentTime = 0;
  await safePlay();
  notify('Replay');
}

async function nextSong(){
  if(state.source !== 'local'){
    await ensureLocalPlayback();
    notify('Quay về nhạc mood');
    // continue to next local track after switching back
  }

  await playNextLocal({manual:true});
}

async function playNextLocal({manual=false,fromError=false} = {}){
  const ids = getPlaylistTrackIds();
  if(ids.length === 0) return;

  const currentId = getCurrentTrackId();
  let nextId = queueNextTrackId();
  if(!nextId){
    state.isPlaying = false;
    syncPlayerUI();
    return;
  }

  // When file errors, attempt a few skips safely
  const maxSkips = Math.min(6,ids.length);
  for(let attempt=0; attempt<maxSkips; attempt++){
    if(currentId){
      state.history.unshift(currentId);
      if(state.history.length > (isMobileView() ? 20 : 40)) state.history.length = (isMobileView() ? 20 : 40);
      pushRecent(currentId);
    }

    const idx = ids.indexOf(nextId);
    if(idx >= 0) state.trackIndex = idx;

    const ok = await playTrackById(nextId,{autoplay:true});
    if(ok){
      if(manual) notify('Next track');
      return;
    }

    // if play() was blocked, don't loop aggressively
    if(!fromError) return;

    // pick another candidate quickly
    pushRecent(nextId);
    nextId = getRandomTrackId({excludeIds:[nextId]}) || queueNextTrackId();
    if(!nextId) break;
  }

  if(manual){
    notify('Không thể phát bài tiếp theo');
  }
}

function toggleMute(){
  state.isMuted = !state.isMuted;
  $.audio.muted = state.isMuted;
  syncPlayerUI();
}

