/* ==========================================================================
   LOCAL MUSIC LIBRARY
   ========================================================================== */

(function () {
  const libPanel = document.getElementById('library-panel');
  const libList = document.getElementById('library-list');
  const searchInput = document.getElementById('library-search');
  const filterContainer = document.getElementById('library-filter');

  let currentFilter = 'all';
  let currentSearch = '';

  const MOOD_ICONS = {
    chill: '🌙',
    happy: '☀',
    sad: '🌧',
    sleep: '✨',
    study: '📚'
  };

  const CATEGORY_NAMES = {
    chill: 'Chill',
    happy: 'Happy',
    sad: 'Sad',
    sleep: 'Sleep',
    study: 'Study',
    others: 'Khác'
  };

  // Extract flat list of tracks
  let allTracks = [];
  let availableCategories = [];
  if (typeof MUSIC_LIBRARY !== 'undefined') {
    availableCategories = Object.keys(MUSIC_LIBRARY).filter(k => MUSIC_LIBRARY[k].length > 0);
    for (const category of availableCategories) {
      allTracks = allTracks.concat(MUSIC_LIBRARY[category]);
    }
  }

  function renderFilterButtons() {
    if (!filterContainer) return;

    filterContainer.innerHTML = '';

    // Add "All" button
    const btnAll = document.createElement('button');
    btnAll.className = 'library-filter-btn' + (currentFilter === 'all' ? ' active' : '');
    btnAll.dataset.filter = 'all';
    btnAll.textContent = 'Tất cả';
    btnAll.addEventListener('click', onFilterClick);
    filterContainer.appendChild(btnAll);

    // Add dynamic buttons
    availableCategories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'library-filter-btn' + (currentFilter === cat ? ' active' : '');
      btn.dataset.filter = cat;
      const displayName = CATEGORY_NAMES[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
      btn.textContent = displayName;
      btn.addEventListener('click', onFilterClick);
      filterContainer.appendChild(btn);
    });
  }

  function onFilterClick(e) {
    const btn = e.target;
    document.querySelectorAll('.library-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderLibrary();
  }

  function renderLibrary() {
    if (!libList) return;

    let filtered = allTracks;

    // Filter by mood
    if (currentFilter !== 'all') {
      filtered = filtered.filter(t => t.mood === currentFilter);
    }

    // Filter by search
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      filtered = filtered.filter(t =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q))
      );
    }

    libList.innerHTML = '';

    if (filtered.length === 0) {
      libList.innerHTML = `<div class="library-empty">Không tìm thấy bài hát nào.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    const activeId = typeof getCurrentTrackId === 'function' ? getCurrentTrackId() : null;

    filtered.forEach(track => {
      const el = document.createElement('div');
      el.className = 'library-track-item';
      if (track.id === activeId && state.source === 'local') {
        el.classList.add('active');
      }
      el.dataset.id = track.id;

      const thumb = document.createElement('div');
      thumb.className = 'library-track-thumb';
      thumb.textContent = MOOD_ICONS[track.mood] || '🎵';

      const idStr = String(track.id || track.title || Math.random());
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
      }
      const presets = [
        'rgba(168, 85, 247, 0.3)', // purple
        'rgba(59, 130, 246, 0.3)', // blue
        'rgba(236, 72, 153, 0.3)', // pink
        'rgba(249, 115, 22, 0.3)', // orange
        'rgba(20, 184, 166, 0.3)'  // teal
      ];
      thumb.style.background = presets[Math.abs(hash) % presets.length];

      const info = document.createElement('div');
      info.className = 'library-track-info';

      const titleLine = document.createElement('div');
      titleLine.className = 'library-track-title';
      titleLine.textContent = track.title || 'Unknown Title';

      const artistLine = document.createElement('div');
      artistLine.className = 'library-track-artist';
      artistLine.textContent = track.artist || 'Unknown Artist';

      info.appendChild(titleLine);
      info.appendChild(artistLine);

      const moodBadge = document.createElement('div');
      moodBadge.className = 'library-track-mood';
      moodBadge.textContent = track.mood;

      el.appendChild(thumb);
      el.appendChild(info);
      el.appendChild(moodBadge);

      el.addEventListener('click', async () => {
        if (typeof playTrackById === 'function') {
          // Update visual immediately
          document.querySelectorAll('.library-track-item').forEach(item => item.classList.remove('active'));
          el.classList.add('active');
          await playTrackById(track.id, { autoplay: true });

          if (typeof isMobileView === 'function' && isMobileView() && typeof closePanel === 'function') {
            closePanel('library-panel');
          }
        }
      });

      fragment.appendChild(el);
    });

    libList.appendChild(fragment);
  }

  function highlightCurrent() {
    if (!libList) return;
    const activeId = typeof getCurrentTrackId === 'function' ? getCurrentTrackId() : null;
    const items = libList.querySelectorAll('.library-track-item');
    items.forEach(item => {
      if (item.dataset.id === activeId && state.source === 'local') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  function scrollToActive() {
    if (!libList) return;
    const activeEl = libList.querySelector('.library-track-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Event Listeners
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      currentSearch = e.target.value;
      renderLibrary();
    }, 300));
  }

  // Watch for panel opening to scroll to active track
  if (libPanel) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          if (libPanel.classList.contains('open')) {
            highlightCurrent();
            setTimeout(scrollToActive, 100);
          }
        }
      });
    });
    observer.observe(libPanel, { attributes: true });
  }

  function updateStatus() {
    const statusText = document.getElementById('library-status-text');
    const waveform = document.getElementById('library-waveform');
    if (!statusText || !waveform) return;

    let isLocalPlaying = false;
    let trackTitle = 'Chưa phát nhạc';

    const isPlaying = (typeof state !== 'undefined' && state.isPlaying) || (audioEl && !audioEl.paused);
    const isLocalSource = (typeof state !== 'undefined' && state.source === 'local');

    if (isLocalSource) {
      const activeId = typeof getCurrentTrackId === 'function' ? getCurrentTrackId() : null;
      if (activeId && typeof TRACK_BY_ID !== 'undefined' && TRACK_BY_ID[activeId]) {
        trackTitle = TRACK_BY_ID[activeId].title;
        isLocalPlaying = isPlaying;
      }
    }

    if (isLocalPlaying) {
      statusText.textContent = trackTitle;
      waveform.style.display = 'flex';
    } else if (isLocalSource && trackTitle !== 'Chưa phát nhạc') {
      statusText.textContent = trackTitle;
      waveform.style.display = 'none';
    } else {
      statusText.textContent = 'Chưa phát nhạc';
      waveform.style.display = 'none';
    }
  }

  // Hook into audio events to update highlight and status
  const audioEl = document.getElementById('audio');
  if (audioEl) {
    audioEl.addEventListener('play', () => {
      highlightCurrent();
      updateStatus();
    });
    audioEl.addEventListener('pause', updateStatus);
    audioEl.addEventListener('ended', updateStatus);
  }

  // Custom polling for state changes if other components change state without native audio events
  setInterval(updateStatus, 1000);

  // Initial render
  setTimeout(() => {
    renderFilterButtons();
    renderLibrary();
  }, 500); // Wait for libraries to fully load

})();
