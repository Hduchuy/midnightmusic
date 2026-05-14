/* ======================= [soundcloud-ui] ========================= */
function renderSearchBatch() {
  const tracks = state.soundcloud.searchBatch || [];
  const offset = state.soundcloud.searchOffset || 0;
  const limit = 5;
  const list = $.scSearchResults;
  const footer = document.getElementById('sc-search-footer');
  const countText = document.getElementById('sc-search-count-text');
  const emptyWrap = document.getElementById('sc-search-empty');
  
  if(!tracks || tracks.length === 0) {
    list.innerHTML = '<div class="sc-empty-state">Không tìm thấy bài hát phù hợp</div>';
    if(footer) footer.classList.add('hidden');
    if(emptyWrap) emptyWrap.classList.add('hidden');
    return;
  }
  
  const currentBatch = tracks.slice(offset, offset + limit);
  
  if(footer) {
    footer.classList.remove('hidden');
    if(countText) countText.textContent = `Hiển thị ${currentBatch.length} kết quả`;
  }
  if(emptyWrap) emptyWrap.classList.add('hidden');
  
  list.innerHTML = '';
  // Clear list
  
  currentBatch.forEach(track => {
    const card = document.createElement('div');
    card.className = 'sc-result-card';
    
    // Some tracks might not have artwork, fallback to user avatar
    const thumbUrl = track.artwork_url || track.user?.avatar_url || 'assets/images/default-thumb.png';
    const artistName = track.user?.username || 'Unknown';
    
    card.innerHTML = `
      <img src="${thumbUrl}" class="sc-result-thumb" onerror="this.src='assets/images/default-thumb.png'">
      <div class="sc-result-info">
        <div class="sc-result-title" title="${track.title}">${track.title}</div>
        <div class="sc-result-artist" title="${artistName}">${artistName}</div>
      </div>
      <button class="sc-result-play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
    `;
    
    card.addEventListener('click', () => {
      if(track.permalink_url) {
        $.soundcloudInput.value = track.permalink_url;
        const allTracks = state.soundcloud.searchBatch || [];
        const index = allTracks.findIndex(t => t.id === track.id);
        playSoundCloud(track.permalink_url, { 
          isSearchQueue: true, 
          index: index !== -1 ? index : 0, 
          queue: allTracks 
        });
      }
    });
    
    list.appendChild(card);
  });
  
  // Render done
}

function refreshSearchBatch() {
  const tracks = state.soundcloud.searchBatch || [];
  if (tracks.length === 0) return;
  
  state.soundcloud.searchOffset += 5;
  if (state.soundcloud.searchOffset >= tracks.length) {
    state.soundcloud.searchOffset = 0; // loop back
  }
  
  renderSearchBatch();
}

function renderRecommendedPlaylists(){
  $.scRecoList.replaceChildren();
  recommendedPlaylists.forEach((item)=>{
    const card = document.createElement('div');
    card.className = 'sc-card';

    const head = document.createElement('div');
    head.className = 'sc-card-head';

    const icon = document.createElement('div');
    icon.className = 'sc-icon';
    icon.textContent = '☁';

    const textWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'sc-card-name';
    name.textContent = item.title;
    const meta = document.createElement('div');
    meta.className = 'sc-card-meta';
    meta.textContent = `${item.artist} • SoundCloud`;
    const mood = document.createElement('div');
    mood.className = 'sc-mood-chip';
    mood.textContent = item.mood;
    textWrap.appendChild(name);
    textWrap.appendChild(meta);
    textWrap.appendChild(mood);

    head.appendChild(icon);
    head.appendChild(textWrap);
    card.appendChild(head);

    const btn = document.createElement('button');
    btn.className = 'small-btn sc-play-btn';
    btn.dataset.action = 'play-soundcloud-reco';
    btn.dataset.id = item.id;
    btn.textContent = 'Phát ngay';
    card.appendChild(btn);

    $.scRecoList.appendChild(card);
  });
}
