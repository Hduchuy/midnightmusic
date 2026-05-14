/* ============================ [mood system] =============================== */
function setEffectState({rain=0,bubbles=0,leaves=0,meteors=0,sleep=0,study=0}){
  $.canvas.rain.style.opacity = rain;
  $.canvas.bubbles.style.opacity = bubbles;
  $.canvas.leaves.style.opacity = leaves;
  $.canvas.meteors.style.opacity = meteors;
  
  const sleepDecor = document.getElementById('sleep-decor');
  sleepDecor.style.opacity = sleep;
  clearTimeout(sleepDecor.fadeTimeout);
  if(sleep === 0) sleepDecor.fadeTimeout = setTimeout(()=>sleepDecor.classList.add('hidden-decor'), 500);
  else sleepDecor.classList.remove('hidden-decor');
  
  const studyDecor = document.getElementById('study-decor');
  studyDecor.style.opacity = study;
  clearTimeout(studyDecor.fadeTimeout);
  if(study === 0) studyDecor.fadeTimeout = setTimeout(()=>studyDecor.classList.add('hidden-decor'), 500);
  else studyDecor.classList.remove('hidden-decor');

  // update active list and stop hidden loops gracefully after fade
  const active = ['stars'];
  
  ['rain','bubbles','leaves','meteors'].forEach(name => {
    const intensity = {rain, bubbles, leaves, meteors}[name];
    clearTimeout(state.effects[`${name}Timeout`]);
    if(intensity > 0) {
      active.push(name);
    } else {
      state.effects[`${name}Timeout`] = setTimeout(() => effects.stop(name), 500);
    }
  });
  
  state.effects.active = active;
}

async function applyMood(mood, { remote = false } = {}) {
  if (!MOODS.includes(mood)) return;

  state.currentMood = mood;
  state.playlist = getMoodPlaylist(mood);
  state.currentTrackId = null;
  state.trackIndex = -1;
  state.history = [];
  state.recent = [];
  state.preloadId = null;

  if (!state.soundcloud.active) {
    state.source = 'local';
  }

  // apply mood theme
  document.body.classList.remove('mood-sad', 'mood-happy', 'mood-chill', 'mood-sleep', 'mood-study');
  document.body.classList.add(`mood-${mood}`);

  // show app
  $.welcome.classList.add('hidden');
  $.app.classList.add('visible');

  // chip
  const meta = MOOD_META[mood];
  $.moodChip.textContent = `${meta.emoji} ${meta.label}`;

  // update dynamic quotes
  if (typeof updateQuoteMood === 'function') {
    updateQuoteMood(mood);
  }

  // effects per mood
  const effectsByMood = {
    sad: () => { setEffectState({ rain: .55 }); startRain(); },
    happy: () => { setEffectState({ bubbles: .8 }); startBubbles(); },
    chill: () => { setEffectState({ leaves: .9 }); startLeaves(); },
    sleep: () => { setEffectState({ meteors: .9, sleep: 1 }); startMeteors(); },
    study: () => { setEffectState({ study: .95 }); }
  };
  effectsByMood[mood]?.();

  // update active buttons (homepage + room sync)
  document.querySelectorAll('.mood-btn, .mood-sync-btn').forEach(btn => {
    if (btn.dataset.mood === mood) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  closeAllPanels();

  // Sync to room if not a remote action
  if (!remote && window.RoomManager?.emitMoodChange) {
    window.RoomManager.emitMoodChange(mood);
  }

  // PRIORITY LOGIC: Do not interrupt SoundCloud if it's active
  if (state.soundcloud.active) {
    if (typeof notify === 'function') {
      notify(`Đã đổi không gian sang ${meta.label}. Vẫn giữ audio từ SoundCloud.`);
    }
    return; // Early return to prevent local audio playback
  }

  // random first track in selected mood folder
  const id = getRandomTrackId();
  if (id) {
    const idx = getPlaylistTrackIds().indexOf(id);
    if (idx >= 0) state.trackIndex = idx;
    await playTrackById(id, { autoplay: true, remote }); // Forward remote flag to prevent sync loops
  } else {
    updatePlayerUI({ title: 'No tracks in this mood', artist: 'Add files to mood folder' });
    state.isPlaying = false;
    syncPlayerUI();
  }
}

function initEffects(){
  // Ensure we are not in a suspended state from early visibility changes
  if(typeof effects !== 'undefined') effects.resumeAll();
  
  if(typeof initStars === 'function') initStars();
  if(typeof effects !== 'undefined') effects.start('stars');
}


