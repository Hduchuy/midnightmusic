/* ======================= [soundcloud-api] ========================= */
function isSoundCloudUrl(url){
  try{
    const u = new URL(url);
    return /(^|\.)soundcloud\.com$/i.test(u.hostname) ||
      /^on\.soundcloud\.com$/i.test(u.hostname) ||
      /^w\.soundcloud\.com$/i.test(u.hostname);
  }catch{
    return false;
  }
}

function normalizeSoundCloudEmbed(input){
  const raw = (input || '').trim();
  if(!raw) return null;
  if(!isSoundCloudUrl(raw)) return null;

  if(/^https:\/\/w\.soundcloud\.com\/player\/\?/i.test(raw)){
    let out = raw;
    if(!/(?:\?|&)auto_play=/.test(out)) out += '&auto_play=true';
    if(!/(?:\?|&)visual=/.test(out)) out += '&visual=false';
    if(!/(?:\?|&)show_artwork=/.test(out)) out += '&show_artwork=false';
    if(!/(?:\?|&)show_comments=/.test(out)) out += '&show_comments=false';
    if(!/(?:\?|&)show_user=/.test(out)) out += '&show_user=true';
    if(!/(?:\?|&)show_reposts=/.test(out)) out += '&show_reposts=false';
    if(!/(?:\?|&)hide_related=/.test(out)) out += '&hide_related=true';
    return out;
  }
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(raw)}&color=%23ff5500&auto_play=true&visual=false&show_artwork=false&hide_related=true&show_comments=false&show_reposts=false`;
}

function extractSourceFromEmbed(embedUrl){
  try{
    const u = new URL(embedUrl);
    const src = u.searchParams.get('url');
    return src ? decodeURIComponent(src) : embedUrl;
  }catch{
    return embedUrl;
  }
}

async function fetchSoundCloudMeta(url){
  try{
    const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(extractSourceFromEmbed(url))}`;
    const r = await fetch(endpoint);
    if(!r.ok) return null;
    const d = await r.json();
    return {
      title:d.title || 'SoundCloud Player',
      thumbnail:d.thumbnail_url || ''
    };
  }catch{
    return null;
  }
}

async function searchSoundCloud(query, retryCount = 1) {
  const list = $.scSearchResults;
  const footer = document.getElementById('sc-search-footer');
  const emptyWrap = document.getElementById('sc-search-empty');

  // search soundcloud

  if(!query) {
    if(list) list.classList.add('hidden');
    if(footer) footer.classList.add('hidden');
    if(emptyWrap) emptyWrap.classList.remove('hidden');
    return;
  }
  
  if(footer) footer.classList.add('hidden');
  if(emptyWrap) emptyWrap.classList.add('hidden');
  
  list.innerHTML = '<div class="sc-loading-state"><div class="sc-spinner"></div><span>Đang tìm nhạc...</span></div>';
  list.classList.remove('hidden');
  
  // Fetch up to 50 items so we can paginate locally
  const url = `${CONFIG.SOUNDCLOUD_PROXY_URL}?q=${encodeURIComponent(query)}&limit=50`;
  
  // calling API
  
  try {
    const res = await fetch(url);
    // Response Status
    
    if(!res.ok) {
      if(res.status === 401) {
        console.error("Lỗi 401: Client ID đã hết hạn hoặc không hợp lệ.");
        list.innerHTML = '<div class="sc-error-state">Client ID không hợp lệ</div>';
        return;
      }
      if(res.status === 403) {
        console.error("Lỗi 403: SoundCloud chặn request (CORS/Forbidden).");
        list.innerHTML = '<div class="sc-error-state">SoundCloud chặn request</div>';
        return;
      }
      console.error("Lỗi HTTP:", res.status);
      throw new Error(`HTTP Error: ${res.status}`);
    }
    
    const data = await res.json();
    // API response
    
    state.soundcloud.searchBatch = data.collection || [];
    state.soundcloud.searchOffset = 0;
    
    // render results
    renderSearchBatch();
  } catch(err) {
    console.error("Fetch Error:", err);
    if (retryCount > 0) {
      // Retrying SoundCloud search
      setTimeout(() => searchSoundCloud(query, retryCount - 1), 1000);
      return;
    }
    list.innerHTML = '<div class="sc-error-state">Lỗi mạng hoặc không thể kết nối</div>';
  }
}
