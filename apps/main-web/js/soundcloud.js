/* ======================= [soundcloud integration] ========================= */
function stopMainPlayer(){
  $.audio.pause();
  $.audio.currentTime = 0;
  state.isPlaying = false;
  $.progress.value = 0;
  updateProgressFill();
  syncPlayerUI();
}

function setSoundCloudMode(active){
  state.soundcloud.active = !!active;
  document.body.classList.toggle('soundcloud-mode', !!active);
  if (active) setupSoundCloudGlobalListeners();
}

let scGlobalListenersAdded = false;
let scLastPlayAttemptAt = 0;
let scPendingAutoplayTimer = null;
let scLastFinishedTrackId = null;
let scLastFinishAt = 0;

function setPendingAutoplay(value) {
  state.soundcloud.pendingAutoplay = value;
  if (scPendingAutoplayTimer) {
    clearTimeout(scPendingAutoplayTimer);
    scPendingAutoplayTimer = null;
  }
  
  if (value) {
    state.soundcloud.retryCount = 0;
    state.soundcloud.maxRetry = 3;
    scPendingAutoplayTimer = setTimeout(() => {
      if (state.soundcloud.pendingAutoplay) {
        state.soundcloud.pendingAutoplay = false;
        console.log('[SC] Auto cleared stale pendingAutoplay');
      }
    }, 15000);
  }
}

async function attemptSoundCloudResume(reason, ignoreVisibility = false) {
  if (!state.soundcloud.active || !state.soundcloud.pendingAutoplay) return;
  if (document.hidden && !ignoreVisibility) return; // Only retry if visible, unless forced

  const now = Date.now();
  if (now - scLastPlayAttemptAt < 2000) return; // Cooldown 2s

  const oldIframe = $.soundcloudPlayer?.querySelector('iframe');
  if (!oldIframe || typeof SC === 'undefined' || !SC.Widget) return;

  scLastPlayAttemptAt = now; // update cooldown immediately to debounce concurrent events

  const widget = SC.Widget(oldIframe);

  widget.isPaused((paused) => {
    if (!paused) {
      // Đã PLAYING -> Không retry nữa
      setPendingAutoplay(false);
      return;
    }
    
    // Pause other audio sources to prevent duplicate audio
    try {
      if ($.audio) $.audio.pause();
      document.querySelectorAll('video, audio').forEach(el => el.pause());
      if (window.room && room.ytPlayer) room.ytPlayer.pauseVideo?.();
    } catch(e) {}
    
    console.log(`[SC][PLAY_ATTEMPT] reason=${reason}`);
    widget.play();
    
    if (typeof state.soundcloud.retryCount === 'undefined') state.soundcloud.retryCount = 0;
    state.soundcloud.retryCount++;
    if (state.soundcloud.retryCount > state.soundcloud.maxRetry) {
      setPendingAutoplay(false);
      notify('Không thể tự phát khi tab nền');
      console.log('[SC][PLAY_FAILED] Max retries reached');
    }
  });
}

function setupSoundCloudGlobalListeners() {
  if (scGlobalListenersAdded) return;
  scGlobalListenersAdded = true;

  const triggerResume = (e) => attemptSoundCloudResume(e.type);

  window.addEventListener('pageshow', triggerResume);
  document.addEventListener('resume', triggerResume);
  document.addEventListener('visibilitychange', triggerResume);
  window.addEventListener('focus', triggerResume);
  document.addEventListener('pointerdown', triggerResume, { passive: true });
  document.addEventListener('click', triggerResume, { passive: true });
}

function refreshSoundCloudMarquee() {
  if (!state.soundcloud.active) return;
  const msg = $.scStageSub.dataset.fullText || $.scStageSub.textContent;
  if (!msg) return;
  
  // Clear mọi nội dung cũ (bao gồm track/span nếu có) và reset
  $.scStageSub.textContent = msg;
  $.scStageSub.classList.remove('is-marquee');
  $.scStageSub.style.removeProperty('--marquee-time');

  // Dùng setTimeout thay vì requestAnimationFrame để tránh bị browser pause hoàn toàn ở background tab
  setTimeout(() => {
    const parent = $.scStageSub.parentElement;
    if (!parent) return;
    
    // Đo lường chính xác bằng cách ép display tạm thời
    $.scStageSub.style.display = 'inline-block';
    $.scStageSub.style.width = 'max-content';
    const textWidth = $.scStageSub.offsetWidth;
    
    // Khôi phục
    $.scStageSub.style.display = '';
    $.scStageSub.style.width = '';
    
    const containerWidth = parent.clientWidth;
    
    // Chỉ bật marquee nếu text thực sự dài hơn container (+2px buffer an toàn)
    if (textWidth > containerWidth + 2 && containerWidth > 0) {
      // Tốc độ: ~30px/giây dựa trên chiều dài text
      const duration = Math.max(5, textWidth / 30);
      
      // Tạo cấu trúc track lặp liên tục
      const track = document.createElement('div');
      track.className = 'sc-marquee-track';
      
      const span1 = document.createElement('span');
      span1.textContent = msg;
      
      const span2 = document.createElement('span');
      span2.textContent = msg;
      
      track.appendChild(span1);
      track.appendChild(span2);
      
      // Đưa track vào thẻ sub
      $.scStageSub.replaceChildren(track);
      $.scStageSub.style.setProperty('--marquee-time', `${duration}s`);
      $.scStageSub.classList.add('is-marquee');
    }
  }, 50);
}

function updateSoundCloudStatus(text){
  const msg = text || 'SoundCloud chưa hoạt động';
  const statusEl = document.getElementById('sc-status-text');
  if (statusEl) statusEl.textContent = msg;
  else if ($.soundcloudStatus) $.soundcloudStatus.textContent = msg;
  
  $.scStageSub.dataset.fullText = msg;
  refreshSoundCloudMarquee();
}

// Tự động recalculate marquee khi resize window hoặc xoay màn hình mobile
let scMarqueeResizeTimer = null;
window.addEventListener('resize', () => {
  if(!state.soundcloud.active) return;
  clearTimeout(scMarqueeResizeTimer);
  scMarqueeResizeTimer = setTimeout(refreshSoundCloudMarquee, 150);
});
window.addEventListener('orientationchange', () => {
  if(!state.soundcloud.active) return;
  clearTimeout(scMarqueeResizeTimer);
  scMarqueeResizeTimer = setTimeout(refreshSoundCloudMarquee, 150);
});

// Note: API functions moved to soundcloud-api.js

// =========================================================================
// Xem file js/config.js để cấu hình proxy
// =========================================================================

// Note: UI functions moved to soundcloud-ui.js

function deactivateSoundCloudMode({notifyText=''} = {}){
  if(!state.soundcloud.active && !$.soundcloudPlayer.childElementCount) return;
  setSoundCloudMode(false);
  state.source = 'local';
  state.soundcloud.currentUrl = '';
  state.soundcloud.currentEmbed = '';
  state.soundcloud.title = 'SoundCloud Player';
  state.soundcloud.artist = 'SoundCloud Source';
  state.soundcloud.thumbnail = '';
  $.soundcloudPlayer.replaceChildren();
  $.scStageTitle.textContent = 'SoundCloud';
  $.scStageThumb.removeAttribute('src');
  $.scStageThumb.style.display = 'none';
  updateSoundCloudStatus('SoundCloud đã tắt');
  const current = getTrackById(state.currentTrackId);
  if(current){
    updatePlayerUI({title:current.title,artist:current.artist});
  }else{
    updatePlayerUI({title:'Midnight Mood',artist:'mood: local'});
  }
  setMusicPlaying(state.isPlaying);
  if(notifyText) notify(notifyText);
}

function playNextSoundCloudQueue() {
  const queue = state.soundcloud.queue;
  if (!queue || queue.length === 0) return;
  
  let nextIndex = state.soundcloud.queueIndex + 1;
  if (nextIndex >= queue.length) {
    nextIndex = 0; // Loop queue
  }
  
  const nextTrack = queue[nextIndex];
  if (nextTrack && nextTrack.permalink_url) {
    $.soundcloudInput.value = nextTrack.permalink_url;
    playSoundCloud(nextTrack.permalink_url, { 
      isSearchQueue: true, 
      index: nextIndex, 
      queue: queue,
      isAutoNext: true, // Cờ xác nhận đây là luồng tự động chuyển bài
      trackId: nextTrack.id
    });
  }
}

let _isHandlingTrackEnd = false;

function bindSoundCloudWidgetEvents(widget, trackUrl) {
  // Unbind before binding to prevent duplicate listeners
  try {
    widget.unbind(SC.Widget.Events.READY);
    widget.unbind(SC.Widget.Events.PLAY);
    widget.unbind(SC.Widget.Events.ERROR);
    widget.unbind(SC.Widget.Events.FINISH);
  } catch(e) {}
  
  // Bind global READY event
  widget.bind(SC.Widget.Events.READY, () => {
    console.log('[SC][READY]');
    if (state.soundcloud.pendingAutoplay) {
      setTimeout(() => {
        attemptSoundCloudResume('ready_autoplay', true); // force resume even if hidden
      }, 300);
    }
  });

  widget.bind(SC.Widget.Events.PLAY, () => {
    console.log('[SC][PLAY_SUCCESS]');
    console.log('[SC][PLAY_EVENT]');
    setPendingAutoplay(false);
    state.soundcloud.retryCount = 0;
  });

  // We can also bind ERROR if available (SC Widget API error event)
  widget.bind(SC.Widget.Events.ERROR, (err) => {
    console.log('[SC][PLAY_FAILED]', err);
  });

  widget.bind(SC.Widget.Events.FINISH, () => {
    console.log('[SC][FINISH]');
    
    const now = Date.now();
    if (scLastFinishedTrackId === trackUrl && now - scLastFinishAt < 2000) {
       console.log('[SC][FINISH] Duplicate ignored');
       return;
    }
    scLastFinishedTrackId = trackUrl;
    scLastFinishAt = now;
    
    if (_isHandlingTrackEnd) {
       console.log('[SC][FINISH] Ignored - already handling track end');
       return;
    }
    
    _isHandlingTrackEnd = true;
    try {
      if (state.soundcloud.queue && state.soundcloud.queue.length > 0) {
        console.log('[SC][NEXT_TRACK]');
        playNextSoundCloudQueue();
      }
    } finally {
      setTimeout(() => { _isHandlingTrackEnd = false; }, 1000);
    }
  });
}

async function playSoundCloud(urlArg, options = {}){
  // Bỏ qua nếu là event object
  if (urlArg && typeof urlArg === 'object' && urlArg.type) {
    urlArg = undefined;
  }

  const url = (urlArg || $.soundcloudInput.value || '').trim();
  if(!url){
    notify('Nhập link SoundCloud');
    return;
  }
  const embedSrc = normalizeSoundCloudEmbed(url);
  if(!embedSrc){
    notify('Link không hợp lệ cho SoundCloud');
    return;
  }

  // Quản lý Queue cho Search Results
  if (options.isSearchQueue) {
    state.soundcloud.queue = options.queue || [];
    state.soundcloud.queueIndex = typeof options.index === 'number' ? options.index : 0;
  } else {
    // Xóa queue nếu play thủ công link khác
    state.soundcloud.queue = [];
    state.soundcloud.queueIndex = -1;
  }

  if(state.soundcloud.active && state.soundcloud.currentEmbed === embedSrc){
    notify('Playlist SoundCloud đang phát');
    return;
  }

  // --- REUSE PLAYER CHO AUTOPLAY BACKGROUND ---
  // Khi tự động chuyển bài trong queue, dùng SC.Widget.load thay vì tạo mới iframe.
  // Điều này giúp giữ nguyên Audio Context, vượt qua rào cản chặn Autoplay của Mobile Browser.
  if (options.isAutoNext && state.soundcloud.active && typeof SC !== 'undefined' && SC.Widget) {
    const oldIframe = $.soundcloudPlayer.querySelector('iframe');
    if (oldIframe) {
      const widget = SC.Widget(oldIframe);
      
      updateSoundCloudStatus('Đang tải bài hát kế tiếp...');
      state.soundcloud.currentUrl = url;
      state.soundcloud.currentEmbed = embedSrc;
      
      console.log('[SC][LOAD_NEXT]', url);
      state.soundcloud.retryCount = 0;
      state.soundcloud.currentAutoplayTrackId = options.trackId || url;
      console.log('[SC][PENDING] true');
      setPendingAutoplay(true);
      
      widget.load(url, {
        auto_play: false, // We'll manually play it to track success/failure
        show_artwork: false,
        visual: false,
        hide_related: true,
        show_comments: false,
        show_reposts: false
      });
      
      // MUST REBIND after load to prevent dropping listeners in chain autoplay
      bindSoundCloudWidgetEvents(widget, url);
      
      // Vẫn lấy metadata bình thường
      const meta = await fetchSoundCloudMeta(embedSrc);
      if(state.soundcloud.currentEmbed !== embedSrc) return;
      
      state.soundcloud.title = meta?.title || 'SoundCloud Player';
      state.soundcloud.artist = 'SoundCloud Source';
      state.soundcloud.thumbnail = meta?.thumbnail || '';
      
      if(state.soundcloud.thumbnail){
        $.scStageThumb.src = state.soundcloud.thumbnail;
        $.scStageThumb.style.display = 'block';
      }else{
        $.scStageThumb.removeAttribute('src');
        $.scStageThumb.style.display = 'none';
      }

      $.scStageTitle.textContent = state.soundcloud.title;
      updatePlayerUI({title:state.soundcloud.title,artist:'Đang phát bằng SoundCloud'});
      updateSoundCloudStatus(`Đang phát bằng SoundCloud • ${state.soundcloud.title}`);
      
      return; // Xong luồng Auto Next, dừng tại đây.
    }
  }

  // --- DESTROY/RESET PLAYER CŨ TRƯỚC KHI LOAD MỚI (Dành cho play manual) ---
  const oldIframes = $.soundcloudPlayer.querySelectorAll('iframe');
  oldIframes.forEach(ifr => {
    if (typeof SC !== 'undefined' && SC.Widget) {
      try {
        const oldWidget = SC.Widget(ifr);
        oldWidget.unbind(SC.Widget.Events.READY);
        oldWidget.unbind(SC.Widget.Events.PLAY);
        oldWidget.unbind(SC.Widget.Events.ERROR);
        oldWidget.unbind(SC.Widget.Events.FINISH);
      } catch(e) {}
    }
    ifr.src = 'about:blank';
    ifr.remove();
  });
  $.soundcloudPlayer.replaceChildren();

  updateSoundCloudStatus('Đang tải SoundCloud...');
  stopMainPlayer();
  state.source = 'soundcloud';
  setSoundCloudMode(true);
  state.soundcloud.currentUrl = url;
  state.soundcloud.currentEmbed = embedSrc;
  state.soundcloud.retryCount = 0;
  state.soundcloud.currentAutoplayTrackId = options.trackId || url;
  console.log('[SC][PENDING] true');
  setPendingAutoplay(true);
  
  // Clear thông tin bài cũ, gán tạm thời
  state.soundcloud.title = 'SoundCloud Player';
  state.soundcloud.artist = 'SoundCloud Source';
  state.soundcloud.thumbnail = '';
  
  $.scStageThumb.removeAttribute('src');
  $.scStageThumb.style.display = 'none';

  // --- MINIMAL FIX: Khởi tạo và append iframe ĐỒNG BỘ để giữ User Gesture cho autoplay ---
  const loading = document.createElement('div');
  loading.className = 'sc-loading';
  $.soundcloudPlayer.appendChild(loading);

  const wrap = document.createElement('div');
  wrap.className = 'sc-embed-wrap';

  const iframe = document.createElement('iframe');
  iframe.id = 'sc-widget-iframe-' + Date.now(); // Unique ID for safety
  iframe.width = '100%';
  iframe.height = '166';
  iframe.scrolling = 'no';
  iframe.setAttribute('frameborder','no');
  iframe.allow = 'autoplay';
  // Bỏ loading='lazy' để chắc chắn iframe luôn load ngay cả khi khuất

  wrap.appendChild(iframe);
  $.soundcloudPlayer.appendChild(wrap);

  // Set src SAU KHI iframe đã vào DOM
  iframe.src = embedSrc; 
  
  // Khởi tạo Widget API an toàn
  if (typeof SC !== 'undefined' && SC.Widget) {
    const widget = SC.Widget(iframe);
    bindSoundCloudWidgetEvents(widget, url);
  }

  iframe.addEventListener('load',()=>{
    if(loading.isConnected) loading.remove();
    updateSoundCloudStatus(`Đang phát bằng SoundCloud • ${state.soundcloud.title}`);
  });
  
  iframe.addEventListener('error',()=>{
    if(loading.isConnected) loading.remove();
    notify('Không thể nhúng SoundCloud, thử playlist khác');
  });
  
  setTimeout(()=>{
    if(loading.isConnected){
      loading.remove();
      updateSoundCloudStatus('SoundCloud đang phản hồi chậm...');
    }
  },8000);

  // --- MOBILE PANEL AUTO-CLOSE & OPTIMIZATION ---
  // Đóng panel trên thiết bị di động ngay lập tức để trình duyệt nhận diện iframe hiển thị và cho phép autoplay
  if (typeof isMobileView === 'function' && isMobileView()) {
    if (typeof closePanel === 'function') {
      closePanel('music-panel');
    }
    // Giảm animation nền trên mobile
    if (window.effects && typeof effects.suspendAll === 'function') {
      effects.suspendAll();
    }
  }

  // --- ROLLBACK: Giữ nguyên flow fetch metadata như cũ (await sau khi iframe đã gắn vào DOM) ---
  const meta = await fetchSoundCloudMeta(embedSrc);
  
  if(loading.isConnected) loading.remove();
  
  // Đảm bảo user chưa chuyển sang bài khác trong lúc đợi metadata
  if(state.soundcloud.currentEmbed !== embedSrc) return;

  state.soundcloud.title = meta?.title || 'SoundCloud Player';
  state.soundcloud.artist = 'SoundCloud Source';
  state.soundcloud.thumbnail = meta?.thumbnail || '';
  if(!meta){
    notify('Không lấy được metadata, vẫn thử phát SoundCloud');
  }

  if(state.soundcloud.thumbnail){
    $.scStageThumb.src = state.soundcloud.thumbnail;
    $.scStageThumb.style.display = 'block';
  }else{
    $.scStageThumb.removeAttribute('src');
    $.scStageThumb.style.display = 'none';
  }

  $.scStageTitle.textContent = state.soundcloud.title;
  updatePlayerUI({title:state.soundcloud.title,artist:'Đang phát bằng SoundCloud'});
  updateSoundCloudStatus(`Đang phát bằng SoundCloud • ${state.soundcloud.title}`);
  setMusicPlaying(true);
  notify('Đang phát bằng SoundCloud');
}

