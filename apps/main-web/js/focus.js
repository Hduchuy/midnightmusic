/* ============================ [focus mode] ================================ */
function getFullscreenElement(){
  return document.fullscreenElement ||
    document.webkitFullscreenElement ||
    (document.webkitIsFullScreen ? document.documentElement : null);
}

function clearFocusTimer(){
  if(state.focus.intervalId){
    clearInterval(state.focus.intervalId);
    state.focus.intervalId = null;
  }
}

function resetFocusUI(){
  document.body.classList.remove('focus-mode');
  document.documentElement.classList.remove('focus-mode');
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  $.focusRingWrap.classList.remove('active');
}

function stopFocusMode({notifyText='',exitFullscreen=false} = {}){
  const wasRunning = state.focus.running;
  clearFocusTimer();
  state.focus.running = false;
  state.focus.secondsLeft = 0;
  resetFocusUI();
  
  if (typeof updateQuoteMood === 'function') {
    updateQuoteMood(state.currentMood || 'chill');
  }
  $.audio.muted = state.focus.prevMuted;
  state.isMuted = state.focus.prevMuted;
  syncPlayerUI();

  if(exitFullscreen && getFullscreenElement()){
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
  }

  if(notifyText && wasRunning){
    notify(notifyText);
  }
}

function handleFullscreenChange(){
  if(!getFullscreenElement() && state.focus.running){
    stopFocusMode({notifyText:'Đã thoát focus mode'});
  }
}

function updateFocusTimeUI(){
  const safe = Math.max(0,state.focus.secondsLeft);
  $.focusTime.textContent = `${pad2(Math.floor(safe/60))}:${pad2(safe%60)}`;
}

function startFocus(btn){
  const min = parseInt($.focusMin.value,10);
  if(!min) {
    notify('Vui lòng nhập số phút');
    return;
  }

  if(state.focus.running) return;

  if(btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    const originalText = btn.textContent;
    btn.textContent = 'Đang chuẩn bị...';
    
    // Enable back later
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = originalText;
    }, 1000);
  }

  state.focus.prevMuted = $.audio.muted;
  clearFocusTimer();
  
  stopMainPlayer();
  deactivateSoundCloudMode();
  $.audio.muted = true;
  state.isMuted = true;
  syncPlayerUI();

  state.focus.running = true;
  state.focus.secondsLeft = min * 60;
  state.focus.totalSeconds = min * 60;

  closeAllPanels();

  const requestFullscreen =
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen;

  if(requestFullscreen){
    const fullscreenRequest = requestFullscreen.call(document.documentElement);
    fullscreenRequest?.catch?.((err)=>{
      console.warn("Fullscreen request warning:", err);
    });
  }

  // Update UI classes synchronously
  document.body.classList.add('focus-mode');
  document.documentElement.classList.add('focus-mode');
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  $.focusRingWrap.classList.add('active');

  if (typeof updateQuoteMood === 'function') {
    updateQuoteMood('focus');
  }

  updateFocusTimeUI();

  state.focus.intervalId = setInterval(()=>{
    state.focus.secondsLeft--;
    updateFocusTimeUI();
    if(state.focus.secondsLeft <= 0){
      stopFocusMode({exitFullscreen:true});
      notify('Hoàn thành focus 🎉');
    }
  },1000);
}

