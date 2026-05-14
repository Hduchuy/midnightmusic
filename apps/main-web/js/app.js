/* ================================ [state] ================================= */
const state = {
  currentMood:'chill',
  // local playback uses folder-based mood playlists
  playlist:{
    id:'mood:chill',
    mood:'chill',
    trackIds:(MUSIC_LIBRARY.chill || []).map(t=>t.id)
  },
  currentTrackId:null, // actual currently loaded local track id
  trackIndex:0, // index into playlist.trackIds
  history:[], // stack of played track ids (for previous)
  recent:[],  // recent window to avoid repeats on shuffle
  preloadId:null, // next track id preloaded (metadata)

  isPlaying:false,
  isMuted:false,
  playerMinimized:false,
  source:'local', // 'local' | 'soundcloud'

  focus:{
    running:false,
    intervalId:null,
    secondsLeft:0,
    prevMuted:false
  },

  todos:loadTodos(),

  soundcloud:{
    active:false,
    currentUrl:'',
    currentEmbed:'',
    title:'SoundCloud Player',
    artist:'SoundCloud Source',
    thumbnail:''
  },

  effects:{
    suspended:false,
    active:['stars'],
    mobilePerformanceMode: isMobileView()
  },

  reminder:{
    activeTaskId:null,
    intervalId:null
  }
};

/* ============================= [cache DOM] ================================ */
const $ = {
  audio:document.getElementById('audio'),
  progress:document.getElementById('music-progress'),
  currentTime:document.getElementById('current-time'),
  durationTime:document.getElementById('duration-time'),
  volumeBtn:document.getElementById('volume-btn'),
  playBtn:document.getElementById('play-btn'),
  playerToggle:document.getElementById('player-toggle'),
  bottom:document.getElementById('bottom'),
  visualizer:document.getElementById('visualizer'),
  notif:document.getElementById('notif'),

  welcome:document.getElementById('welcome'),
  app:document.getElementById('app'),
  moodChip:document.getElementById('mood-chip'),
  songTitle:document.getElementById('song-title'),
  songMood:document.getElementById('song-mood'),

  focusMin:document.getElementById('focus-min'),
  focusRingWrap:document.getElementById('focus-ring-wrap'),
  focusTime:document.getElementById('focus-time'),

  todoInput:document.getElementById('todo-input'),
  todoDate:document.getElementById('todo-date'),
  todoTime:document.getElementById('todo-time'),
  todoCreateNote:document.getElementById('todo-create-note'),
  todoNoteForm:document.getElementById('todo-note-form'),
  todoNoteContent:document.getElementById('todo-note-content'),
  todoList:document.getElementById('todo-list'),
  todoDoneList:document.getElementById('todo-done-list'),
  todoReminder:document.getElementById('todo-reminder'),
  todoReminderText:document.getElementById('todo-reminder-text'),
  todoReminderTime:document.getElementById('todo-reminder-time'),
  todoSnoozeRow:document.getElementById('todo-snooze-row'),

  soundcloudInput:document.getElementById('soundcloud-input'),
  soundcloudPlayer:document.getElementById('soundcloud-player'),
  soundcloudStatus:document.getElementById('soundcloud-status'),
  scSearchResults:document.getElementById('sc-search-results'),
  scSearchInput:document.getElementById('sc-search-input'),
  scRecoList:document.getElementById('sc-reco-list'),
  scStageTitle:document.getElementById('sc-stage-title'),
  scStageSub:document.getElementById('sc-stage-sub'),
  scStageThumb:document.getElementById('sc-stage-thumb'),

  canvas:{
    stars:document.getElementById('stars'),
    rain:document.getElementById('rain'),
    bubbles:document.getElementById('bubbles'),
    leaves:document.getElementById('leaves'),
    meteors:document.getElementById('meteors')
  }
};

/* ============================ [mood system] =============================== */
// Note: Mood functions (setEffectState, selectMood) have been moved to mood-manager.js

/* =========================== [event bindings] ============================= */

function bindPlayerControls(){
  const disabledInSoundCloud = new Set(['prev','play','next','volume']);
  const actions = {
    prev:()=>prevSong(),
    play:()=>togglePlay(),
    next:()=>nextSong(),
    volume:()=>toggleMute(),
    minimize:()=>togglePlayerVisibility()
  };
  document.querySelectorAll('[data-player-action]').forEach(btn=>{
    const action = actions[btn.dataset.playerAction];
    if(!action) return;
    btn.addEventListener('click',(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(state.soundcloud.active && disabledInSoundCloud.has(btn.dataset.playerAction)){
        notify('Đang phát bằng SoundCloud');
        return;
      }
      action();
    });
  });
}

function onGlobalActionClick(e){
  const t = e.target.closest('[data-action],[data-panel]');
  if(!t) return;

  const action = t.dataset.action;
  if(action === 'open-panel'){
    openPanel(t.dataset.panel);
    return;
  }
  if(action === 'close-panel'){
    closePanel(t.dataset.panel);
    return;
  }
  if(action === 'select-mood'){
    applyMood(t.dataset.mood);
    return;
  }
  if(action === 'set-focus-preset'){
    const min = parseInt(t.dataset.preset, 10);
    if(min) {
      document.getElementById('focus-min').value = min;
      document.querySelectorAll('.focus-preset-btn').forEach(b => b.classList.remove('active'));
      t.classList.add('active');
    }
    return;
  }
  if(action === 'start-focus'){
    startFocus(t); // Pass the button to handle loading state
    return;
  }
  if(action === 'add-todo'){
    addTodo();
    return;
  }
  if(action === 'remove-todo'){
    removeTodoById(t.dataset.id);
    return;
  }
  if(action === 'todo-toggle-complete'){
    toggleTodoCompleteById(t.dataset.id);
    return;
  }
  if(action === 'todo-complete-from-reminder'){
    completeReminderTask();
    return;
  }
  if(action === 'todo-open-snooze'){
    $.todoSnoozeRow.classList.toggle('show');
    return;
  }
  if(action === 'todo-snooze'){
    const m = parseInt(t.dataset.minutes,10);
    if(Number.isFinite(m)) snoozeReminderTask(m);
    return;
  }
  if(action === 'search-soundcloud'){
    const q = $.scSearchInput ? $.scSearchInput.value.trim() : "";
    if(q && typeof searchSoundCloud === 'function') searchSoundCloud(q);
    return;
  }
  if(action === 'refresh-soundcloud-search'){
    if(typeof refreshSearchBatch === 'function') refreshSearchBatch();
    return;
  }
  if(action === 'play-soundcloud'){
    playSoundCloud();
    return;
  }
  if(action === 'play-soundcloud-reco'){
    const item = recommendedPlaylists.find(x=>x.id === t.dataset.id);
    if(!item) return;
    $.soundcloudInput.value = item.embed;
    playSoundCloud(item.embed);
    return;
  }
  if(action === 'exit-soundcloud'){
    deactivateSoundCloudMode({notifyText:'Đã quay lại nhạc mood'});
    return;
  }
  
  // Room Actions
  if(action === 'create-room'){
    if(typeof RoomManager !== 'undefined') RoomManager.createRoom();
    return;
  }
  if(action === 'join-room'){
    if(typeof RoomManager !== 'undefined') RoomManager.joinRoom();
    return;
  }
  if(action === 'leave-room'){
    if(typeof RoomManager !== 'undefined') RoomManager.leaveRoom();
    return;
  }
  if(action === 'send-chat'){
    if(typeof RoomManager !== 'undefined') RoomManager.sendChat();
    return;
  }
}

/* ============================= [init app] ================================ */
function buildVisualizerBars(){
  const bars = particleCount(70,42,28);
  $.visualizer.replaceChildren();
  for(let i=0;i<bars;i++){
    const b = document.createElement('div');
    b.className = 'bar';
    const maxHeight = isMobileView() ? 52 : 100;
    b.style.setProperty('--h',(12 + Math.random()*maxHeight) + 'px');
    b.style.animationDuration = (isMobileView() ? 1.1 : .7) + Math.random()*.9 + 's';
    $.visualizer.appendChild(b);
  }
}

function updateClock(){
  const now = new Date();
  document.getElementById('live-clock').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function bindCoreEvents(){
  if($.scSearchInput){
    $.scSearchInput.addEventListener('keydown',(e)=>{
      if(e.key === 'Enter'){
        const q = $.scSearchInput.value.trim();
        if(q && typeof searchSoundCloud === 'function') searchSoundCloud(q);
      }
    });
  }

  document.addEventListener('click',onGlobalActionClick);
  document.addEventListener('fullscreenchange',handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange',handleFullscreenChange);

  // Tab switching
  document.querySelectorAll('.todo-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.todo-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.todoTab;
      document.getElementById('todo-tasks-content').style.display = tabName === 'tasks' ? 'block' : 'none';
      document.getElementById('todo-notes-content').style.display = tabName === 'notes' ? 'block' : 'none';
      if(tabName === 'notes') renderStickyManager();
    });
  });

  // Note toggle checkbox
  if($.todoCreateNote){
    $.todoCreateNote.addEventListener('change',()=>{
      if($.todoNoteForm){
        $.todoNoteForm.classList.toggle('show', $.todoCreateNote.checked);
      }
    });
  }

  // Size buttons
  document.querySelectorAll('.todo-size-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.todo-size-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Note: Sticky Notes Manager logic moved to sticky.js
  $.todoInput.addEventListener('keydown',(e)=>{
    if(e.key === 'Enter') addTodo();
  });
  $.todoTime.addEventListener('keydown',(e)=>{
    if(e.key === 'Enter') addTodo();
  });
  $.todoDate.addEventListener('keydown',(e)=>{
    if(e.key === 'Enter') addTodo();
  });
  $.focusMin.addEventListener('keydown',(e)=>{
    if(e.key === 'Enter') startFocus();
  });
  // audio -> UI sync
  $.audio.addEventListener('loadedmetadata',()=>{
    $.progress.min = 0;
    $.progress.max = $.audio.duration || 0;
    $.durationTime.textContent = formatTime($.audio.duration);
    updateProgressFill();
  });

  $.audio.addEventListener('timeupdate',()=>{
    if(!$.progress.matches(':active')){
      $.progress.value = $.audio.currentTime;
    }
    $.currentTime.textContent = formatTime($.audio.currentTime);
    updateProgressFill();
  });

  $.audio.addEventListener('ended',()=>{
    if(state.source === 'local'){
      playNextLocal({manual:false});
      return;
    }
    state.isPlaying = false;
    syncPlayerUI();
  });

  $.audio.addEventListener('error',()=>{
    console.error("Audio load error:", $.audio.src, "error code:", $.audio.error?.code);
    // If local file fails, skip to a different one (avoid crash/hang).
    if(state.source === 'local'){
      notify('Bài bị lỗi, đang chuyển bài khác…');
      playNextLocal({manual:false,fromError:true});
    }
  });

  $.progress.addEventListener('input',()=>{
    if(state.soundcloud.active) return;
    $.audio.currentTime = $.progress.value;
    updateProgressFill();
  });
  $.progress.addEventListener('touchstart',(e)=>e.stopPropagation(),{passive:true});
  $.progress.addEventListener('pointerdown',(e)=>e.stopPropagation());

  const onResize = debounce(()=>{
    effects.resizeAll();
    buildVisualizerBars();
  },180);
  window.addEventListener('resize',onResize,{passive:true});

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      effects.suspendAll();
    }else{
      effects.resumeAll();
    }
  });

  $.todoReminder.addEventListener('click',(e)=>{
    if(e.target === $.todoReminder){
      $.todoSnoozeRow.classList.remove('show');
    }
  });

  // todo delegation already via global click handler
}



function init(){
  try {
    // Initial UI state
    $.audio.muted = state.isMuted;
    $.audio.preload = 'metadata';
    
    const now = new Date();
    $.todoDate.value = now.toISOString().slice(0,10);
    $.todoTime.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    
    // Core systems
    syncPlayerUI();
    renderTodos();
    startTodoReminderLoop();
    renderRecommendedPlaylists();
    buildVisualizerBars();
    
    bindPlayerControls();
    bindCoreEvents();
    
    // Feature systems
    initEffects();
    initQuotes();
    loadStickyNotes();

    // Performance tier detection
    const tier = getPerformanceTier();
    document.body.classList.add(`tier-${tier}`);
    if (tier === 'low' || isTinyView()) {
      state.effects.mobilePerformanceMode = true;
      console.log(`[Perf] Tier: ${tier} — mobilePerformanceMode ON`);
    } else {
      console.log(`[Perf] Tier: ${tier}`);
    }

    // FPS Monitor — only active on mobile to avoid overhead on desktop
    if (isMobileView()) {
      let frameCount = 0;
      let lastFpsTime = performance.now();
      let lowFpsCount = 0;

      const monitorFPS = (now) => {
        frameCount++;
        if (now - lastFpsTime >= 1000) {
          const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
          if (fps < 40) {
            lowFpsCount++;
            if (lowFpsCount >= 3 && !state.effects.mobilePerformanceMode) {
              state.effects.mobilePerformanceMode = true;
              document.body.classList.add('fps-safe-mode');
              console.warn(`[FPS] Dropped to ${fps} — FPS-Safe Mode ON`);
              notify('⚡ Tự động tối ưu hiệu năng.');
            }
          } else {
            lowFpsCount = 0;
          }
          frameCount = 0;
          lastFpsTime = now;
        }
        requestAnimationFrame(monitorFPS);
      };
      requestAnimationFrame(monitorFPS);
    }
    
    // Data systems
    initWeather();
    
    updateClock();
    setInterval(updateClock, 1000);
    
    if(typeof validateSoundCloudClientId === 'function') validateSoundCloudClientId();
    
    console.log(`[MM] Initialized. Host: ${window.location.hostname} | Tier: ${getPerformanceTier()}`);
  } catch(e) { 
    console.error("Initialization failed:", e); 
  }
}

init();
