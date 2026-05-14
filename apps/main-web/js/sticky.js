/* ======================= STICKY NOTES SYSTEM ======================= */
let stickyZIndex = 100;

// Color pairs (Header / Body) based on the image
const NOTE_THEMES = [
  { header: '#a881e6', bg: '#e8dcff' }, // Purple
  { header: '#ff8eaf', bg: '#ffe3eb' }, // Pink
  { header: '#fdd835', bg: '#fff9c4' }, // Yellow
  { header: '#81c784', bg: '#e8f5e9' }, // Green
  { header: '#64b5f6', bg: '#e3f2fd' }, // Blue
  { header: '#ffb74d', bg: '#fff3e0' }  // Orange
];

function saveStickyNotes(){
  const notes = [];
  document.querySelectorAll('#sticky-layer > .sticky-note').forEach(note=>{
    notes.push({
      id: note.dataset.id,
      content: note.querySelector('.sticky-content') ? note.querySelector('.sticky-content').innerHTML : '',
      x: parseFloat(note.style.left) || 0,
      y: parseFloat(note.style.top) || 0,
      zIndex: parseInt(note.style.zIndex) || 100,
      themeIndex: parseInt(note.dataset.themeIndex) || 2 // default yellow
    });
  });
  StorageHelper.set(STORAGE_KEYS.STICKY_NOTES, notes);
}

function loadStickyNotes(){
  const notes = StorageHelper.get(STORAGE_KEYS.STICKY_NOTES, []);
  if(Array.isArray(notes)){
    notes.forEach(n=>{
      createStickyNote(n.content, n.x, n.y, n.id, n.pinned, n.zIndex, false, n.themeIndex, n.pinColor);
    });
  }
}

function createStickyNote(content, x, y, id, pinned = true, zIndex = null, animate = true, themeIndex, pinColor){
  // create sticky note called
  const note = document.createElement('div');
  const noteId = id || "sticky-" + Date.now() + "-" + Math.random().toString(36).slice(2,7);
  note.className = 'sticky-note';
  note.dataset.id = noteId;

  // Visual Aesthetics
  let tIdx = themeIndex !== undefined ? parseInt(themeIndex) : Math.floor(Math.random() * NOTE_THEMES.length);
  if (isNaN(tIdx) || tIdx < 0 || tIdx >= NOTE_THEMES.length) tIdx = 2; // Fallback to yellow
  
  if (isNaN(tIdx) || tIdx < 0 || tIdx >= NOTE_THEMES.length) tIdx = 2; // Fallback to yellow

  note.dataset.themeIndex = tIdx;

  function applyTheme(index) {
    note.style.setProperty('--note-header', NOTE_THEMES[index].header);
    note.style.setProperty('--note-bg', NOTE_THEMES[index].bg);
  }
  applyTheme(tIdx);

  const finalZ = zIndex || ++stickyZIndex;
  note.style.zIndex = finalZ;
  
  let initX = x !== undefined && x !== null ? x : Math.random() * (window.innerWidth - 250);
  let initY = y !== undefined && y !== null ? y : Math.random() * (window.innerHeight - 300);
  
  // Clamp initial position
  const maxX = Math.max(0, window.innerWidth - 220); // 220 is min-width
  const maxY = Math.max(0, window.innerHeight - 180); // 180 is min-height
  note.style.left = Math.max(0, Math.min(initX, maxX)) + 'px';
  note.style.top = Math.max(0, Math.min(initY, maxY)) + 'px';

  if(!animate){
    note.style.transition = 'none';
  }

  // --- HTML Structure ---
  // Header
  const header = document.createElement('div');
  header.className = 'sticky-header';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'sticky-drag-handle';
  dragHandle.innerHTML = '<svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg>';



  const actions = document.createElement('div');
  actions.className = 'sticky-actions';

  const btnSave = document.createElement('button');
  btnSave.className = 'action-save';
  btnSave.title = 'Lưu';
  btnSave.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';

  const btnColor = document.createElement('button');
  btnColor.className = 'action-color';
  btnColor.title = 'Đổi màu';
  btnColor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

  const btnDelete = document.createElement('button');
  btnDelete.className = 'action-delete';
  btnDelete.title = 'Xóa';
  btnDelete.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  actions.appendChild(btnSave);
  actions.appendChild(btnColor);
  actions.appendChild(btnDelete);

  header.appendChild(dragHandle);
  header.appendChild(actions);

  // Content
  const contentEl = document.createElement('div');
  contentEl.className = 'sticky-content';
  contentEl.contentEditable = 'true';
  contentEl.innerHTML = content || '';
  
  // Resize Handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sticky-resize-handle';

  note.appendChild(header);
  note.appendChild(contentEl);
  note.appendChild(resizeHandle);

  // --- Events ---
  // Auto Save
  contentEl.addEventListener('input', ()=>saveStickyNotes());
  contentEl.addEventListener('blur', ()=>saveStickyNotes());

  // Prevent drag inside content
  contentEl.addEventListener('mousedown', e => e.stopPropagation());
  contentEl.addEventListener('touchstart', e => e.stopPropagation(), {passive: false});

  // Buttons
  btnSave.addEventListener('click', (e)=>{
    e.stopPropagation();
    e.preventDefault();
    saveStickyNotes();
    if(typeof window.renderStickyManager === 'function') {
      window.renderStickyManager();
    }
    btnSave.style.transform = 'scale(1.15)';
    btnSave.style.color = '#a8ffb2';
    setTimeout(() => {
      btnSave.style.transform = '';
      btnSave.style.color = '';
    }, 250);
  });

  btnColor.addEventListener('click', (e)=>{
    e.stopPropagation();
    e.preventDefault();
    tIdx = (tIdx + 1) % NOTE_THEMES.length;
    note.dataset.themeIndex = tIdx;
    applyTheme(tIdx);
    saveStickyNotes();
  });

  btnDelete.addEventListener('click', (e)=>{
    e.stopPropagation();
    e.preventDefault();
    note.style.transform = 'scale(0)';
    note.style.opacity = '0';
    setTimeout(()=>{
      note.remove();
      saveStickyNotes();
    }, 200);
  });



  // Bring to front
  note.addEventListener('mousedown', ()=>{
    note.style.zIndex = ++stickyZIndex;
  });

  // --- Drag System (requestAnimationFrame) ---
  let isDragging = false;
  let startX, startY, origX, origY;
  let transformX = 0, transformY = 0;
  let animationFrameId = null;

  function updateTransform() {
    if (!isDragging) return;
    note.style.setProperty('--tx', transformX + 'px');
    note.style.setProperty('--ty', transformY + 'px');
    animationFrameId = requestAnimationFrame(updateTransform);
  }

  function dragStart(e){
    if(e.target.closest('.sticky-actions')) return;
    e.preventDefault();
    // dragStart
    isDragging = true;
    note.classList.add('dragging');
    note.style.zIndex = ++stickyZIndex;

    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    origX = note.offsetLeft;
    origY = note.offsetTop;
    transformX = 0;
    transformY = 0;
    
    // Start loop
    animationFrameId = requestAnimationFrame(updateTransform);
  }

  function dragMove(e){
    if(!isDragging) return;
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    transformX = point.clientX - startX;
    transformY = point.clientY - startY;
  }

  function dragEnd(){
    if(isDragging){
      // dragEnd
      isDragging = false;
      cancelAnimationFrame(animationFrameId);
      
      // Keep transform disabled to update left/top immediately
      note.style.left = (origX + transformX) + 'px';
      note.style.top = (origY + transformY) + 'px';
      note.style.setProperty('--tx', '0px');
      note.style.setProperty('--ty', '0px');
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          note.classList.remove('dragging');
          saveStickyNotes();
        });
      });
    }
  }

  header.addEventListener('mousedown', dragStart);
  header.addEventListener('touchstart', dragStart, {passive:false});
  document.addEventListener('mousemove', dragMove);
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('touchmove', dragMove, {passive:false});
  document.addEventListener('touchend', dragEnd);

  document.getElementById('sticky-layer').appendChild(note);

  // Re-clamp after append to get actual offsetWidth/Height
  requestAnimationFrame(() => {
    clampStickyPosition(note);
    saveStickyNotes();
  });

  return note;
}

function clampStickyPosition(note) {
  if (!note || note.classList.contains('minimized') || note.classList.contains('dragging')) return false;
  const width = note.offsetWidth || 220;
  const height = note.offsetHeight || 180;
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);
  
  let currentX = parseFloat(note.style.left) || 0;
  let currentY = parseFloat(note.style.top) || 0;
  
  const newX = Math.max(0, Math.min(currentX, maxX));
  const newY = Math.max(0, Math.min(currentY, maxY));
  
  if (currentX !== newX || currentY !== newY) {
    note.style.left = newX + 'px';
    note.style.top = newY + 'px';
    return true;
  }
  return false;
}

window.addEventListener('resize', () => {
  let changed = false;
  document.querySelectorAll('#sticky-layer > .sticky-note').forEach(note => {
    if (clampStickyPosition(note)) changed = true;
  });
  if (changed) saveStickyNotes();
});

// ======================= [Sticky Manager] =======================
function renderStickyManager(){
  const list = document.getElementById('sticky-notes-list');
  const count = document.getElementById('sticky-count');
  if(!list) return;

  const notes = Array.from(document.querySelectorAll('#sticky-layer > .sticky-note'));
  const searchEl = document.getElementById('sticky-search');
  const searchTerm = (searchEl && searchEl.value ? searchEl.value : '').toLowerCase();
  const activeFilterBtn = document.querySelector('.sticky-filter-btn.active');
  const filter = activeFilterBtn && activeFilterBtn.dataset.filter ? activeFilterBtn.dataset.filter : 'all';

  const filtered = notes.filter(n=>{
    const contentEl = n.querySelector('.sticky-content');
    const text = (contentEl && contentEl.innerText ? contentEl.innerText : '').trim();
    if(searchTerm && !text.toLowerCase().includes(searchTerm)) return false;
    return true;
  });

  if(count) count.textContent = `${notes.length} StickyNote`;

  if(filtered.length === 0){
    list.innerHTML = `
      <div class="sticky-manager-empty">
        <div class="sticky-empty-icon">📝</div>
        <div class="sticky-empty-title">${notes.length === 0 ? 'Chưa có StickyNote nào' : 'Không tìm thấy StickyNote'}</div>
        <div class="sticky-empty-text">${notes.length === 0 ? 'Tạo StickyNote đầu tiên từ tab Công việc!' : 'Thử tìm kiếm hoặc lọc khác.'}</div>
        ${notes.length === 0 ? '<button class="sticky-create-btn" onclick="document.querySelector(\'[data-todo-tab=tasks]\').click()">Tạo StickyNote đầu tiên</button>' : ''}
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(note=>{
    const contentEl = note.querySelector('.sticky-content');
    const text = (contentEl && contentEl.innerText ? contentEl.innerText : '').trim();
    const size = note.dataset.size || 'm';
    const id = note.dataset.id;
    const lines = text.split('\n').filter(l => l.trim());
    const displayTitle = lines[0] ? (lines[0].length > 25 ? lines[0].slice(0, 25) + '...' : lines[0]) : 'StickyNote trống';
    const displaySubtitle = lines.length > 1 ? lines.slice(1).join(' ').slice(0, 35) + '...' : '';

    const noteBg = note.style.getPropertyValue('--note-bg') || '#fff9c4';
    const noteHeader = note.style.getPropertyValue('--note-header') || '#fdd835';

    return `
      <div class="sticky-note-card" data-note-id="${id}">
        <div class="sticky-preview-wrap">
          <div class="sticky-preview" style="background: ${noteBg}; border-top: 6px solid ${noteHeader};">
            <div class="sticky-preview-text">${text || 'Trống'}</div>
          </div>
        </div>
        <div class="sticky-card-info">
          <div class="sticky-card-title">${displayTitle}</div>
          ${displaySubtitle ? `<div class="sticky-card-subtitle">${displaySubtitle}</div>` : ''}
          <div class="sticky-card-meta">
            <span class="sticky-card-size">${size}</span>
          </div>
        </div>
        <div class="sticky-card-actions">
          <button class="sticky-card-btn focus" title="Đi tới" onclick="focusStickyNote('${id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
          </button>
          <button class="sticky-card-btn delete" title="Xóa" onclick="deleteStickyNote('${id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.focusStickyNote = function(id){
  const note = document.querySelector(`[data-id="${id}"]`);
  if(note){
    note.style.zIndex = ++stickyZIndex;
    note.classList.add('dragging');
    setTimeout(()=>note.classList.remove('dragging'), 500);
    if(typeof closeAllPanels === 'function') closeAllPanels();
  }
};

window.deleteStickyNote = function(id){
  const note = document.querySelector(`[data-id="${id}"]`);
  if(note){
    note.style.transform = 'scale(0)';
    note.style.opacity = '0';
    setTimeout(()=>{
      note.remove();
      saveStickyNotes();
      renderStickyManager();
    }, 200);
  }
};

// Initialize listeners on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const stickySearch = document.getElementById('sticky-search');
  if(stickySearch) stickySearch.addEventListener('input', renderStickyManager);
  document.querySelectorAll('.sticky-filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.sticky-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderStickyManager();
    });
  });
});

window.renderStickyManager = renderStickyManager;
