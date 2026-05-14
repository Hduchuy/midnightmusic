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
      isAutoNext: true // Cờ xác nhận đây là luồng tự động chuyển bài
    });
  }
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
      
      widget.load(url, {
        auto_play: true,
        show_artwork: false,
        visual: false,
        hide_related: true,
        show_comments: false,
        show_reposts: false
      });
      
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
    widget.bind(SC.Widget.Events.FINISH, () => {
      if (state.soundcloud.queue && state.soundcloud.queue.length > 0) {
        // Gọi TRỰC TIẾP, không dùng setTimeout để tránh bị browser throttle/pause khi ở background tab
        playNextSoundCloudQueue();
      }
    });
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

  // --- MOBILE PANEL AUTO-CLOSE ---
  // Đóng panel trên thiết bị di động ngay lập tức để trình duyệt nhận diện iframe hiển thị và cho phép autoplay
  if (typeof isMobileView === 'function' && isMobileView()) {
    if (typeof closePanel === 'function') {
      closePanel('music-panel');
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

