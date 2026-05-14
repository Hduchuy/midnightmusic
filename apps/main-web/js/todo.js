/* ============================ [todo system] =============================== */
function toTaskStatus(task, nowMs = Date.now()){
  if(task.completed) return 'completed';
  if(task.dueAt && nowMs > task.dueAt) return 'overdue';
  return 'upcoming';
}

function formatTaskTime(task){
  if(!task.dueAt) return 'Không đặt giờ';
  return new Date(task.dueAt).toLocaleString('vi-VN',{
    day:'2-digit',
    month:'2-digit',
    hour:'2-digit',
    minute:'2-digit'
  });
}

function sortTasksForToday(list){
  return list.slice().sort((a,b)=>{
    const sa = toTaskStatus(a);
    const sb = toTaskStatus(b);
    const rank = {overdue:0,upcoming:1,completed:2};
    if(rank[sa] !== rank[sb]) return rank[sa] - rank[sb];
    const ta = a.dueAt ?? Number.MAX_SAFE_INTEGER;
    const tb = b.dueAt ?? Number.MAX_SAFE_INTEGER;
    if(ta !== tb) return ta - tb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function renderTaskLine(task){
  const line = document.createElement('div');
  const status = toTaskStatus(task);
  line.className = `todo-line is-${status}`;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'todo-check';
  check.dataset.action = 'todo-toggle-complete';
  check.dataset.id = task.id;
  check.setAttribute('aria-label',task.completed ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành');

  const main = document.createElement('div');
  main.className = 'todo-main';
  const text = document.createElement('div');
  text.className = 'todo-text';
  text.textContent = task.text;
  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  meta.textContent = formatTaskTime(task);
  main.appendChild(text);
  main.appendChild(meta);

  const badge = document.createElement('div');
  badge.className = 'todo-status-badge';
  badge.textContent = status === 'overdue' ? 'Quá hạn' : status === 'upcoming' ? 'Sắp tới' : 'Xong';

  const actions = document.createElement('div');
  actions.className = 'todo-actions';
  const delBtn = document.createElement('button');
  delBtn.className = 'todo-action-btn delete';
  delBtn.innerHTML = '🗑';
  delBtn.title = 'Xóa';
  delBtn.dataset.action = 'remove-todo';
  delBtn.dataset.id = task.id;
  actions.appendChild(delBtn);

  line.appendChild(check);
  line.appendChild(main);
  line.appendChild(badge);
  line.appendChild(actions);
  return line;
}

function renderTodos(){
  const container = document.getElementById('todo-tasks-container');
  if(!container) return;
  container.replaceChildren();

  const sorted = sortTasksForToday(state.todos);
  const overdue = sorted.filter(t=>!t.completed && toTaskStatus(t) === 'overdue');
  const upcoming = sorted.filter(t=>!t.completed && toTaskStatus(t) !== 'overdue');
  const done = sorted.filter(t=>t.completed).sort((a,b)=>(b.completedAt || 0) - (a.completedAt || 0));

  // Overdue section
  if(overdue.length > 0){
    const header = document.createElement('div');
    header.className = 'todo-section-header';
    header.innerHTML = '<span class="todo-section-title">Quá hạn</span><span class="todo-section-count">'+overdue.length+'</span>';
    container.appendChild(header);
    overdue.forEach(t=>container.appendChild(renderTaskLine(t)));
  }

  // Upcoming section
  if(upcoming.length > 0){
    const header = document.createElement('div');
    header.className = 'todo-section-header';
    header.innerHTML = '<span class="todo-section-title">Sắp tới</span><span class="todo-section-count">'+upcoming.length+'</span>';
    container.appendChild(header);
    upcoming.forEach(t=>container.appendChild(renderTaskLine(t)));
  }

  // Completed section
  if(done.length > 0){
    const header = document.createElement('div');
    header.className = 'todo-section-header';
    header.innerHTML = '<span class="todo-section-title">Hoàn thành</span><span class="todo-section-count">'+done.length+'</span>';
    container.appendChild(header);
    done.forEach(t=>container.appendChild(renderTaskLine(t)));
  }

  if(overdue.length === 0 && upcoming.length === 0 && done.length === 0){
    const empty = document.createElement('div');
    empty.className = 'todo-empty';
    empty.innerHTML = 'Chưa có công việc nào.<br>Thêm công việc mới bên trên!';
    container.appendChild(empty);
  }
}

function parseTodoDueAt(){
  const dateStr = ($.todoDate.value || '').trim();
  const timeStr = ($.todoTime.value || '').trim();
  if(!dateStr) return null;
  const composed = timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T23:59`;
  const ts = new Date(composed).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function addTodo(){
  const text = ($.todoInput.value || '').trim();
  if(!text) return;
  const dueAt = parseTodoDueAt();
  const createNote = $.todoCreateNote?.checked || false;

  state.todos.unshift({
    id:`task-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    text,
    dueAt,
    completed:false,
    completedAt:null,
    snoozeUntil:null,
    lastReminderAt:null,
    createdAt:Date.now()
  });
  $.todoInput.value = '';
  if($.todoCreateNote) $.todoCreateNote.checked = false;
  if($.todoNoteForm) $.todoNoteForm.classList.remove('show');
  saveTodos();
  renderTodos();

  if(createNote){
    const noteContent = ($.todoNoteContent && $.todoNoteContent.value) ? $.todoNoteContent.value.trim() : text;
    const pinImmediately = $.todoPinImmediate ? $.todoPinImmediate.checked : true;
    // create sticky note
    createStickyNote(noteContent, null, null, null, pinImmediately, null, true);
    if($.todoNoteContent) $.todoNoteContent.value = '';
    renderStickyManager();
  }
}

function getTodoById(id){
  return state.todos.find(t=>t.id === id) || null;
}

function toggleTodoCompleteById(id){
  const task = getTodoById(id);
  if(!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? Date.now() : null;
  task.lastReminderAt = null;
  task.snoozeUntil = null;
  if(task.completed && state.reminder.activeTaskId === task.id){
    closeReminderPopup();
  }
  saveTodos();
  renderTodos();
}

function removeTodoById(id){
  const idx = state.todos.findIndex(t=>t.id === id);
  if(idx < 0) return;
  state.todos.splice(idx,1);
  if(state.reminder.activeTaskId === id){
    closeReminderPopup();
  }
  saveTodos();
  renderTodos();
}

function triggerReminderFeedback(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035,ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  }catch{}
  navigator.vibrate?.(120);
}

function openReminderPopup(task){
  if(!task) return;
  state.reminder.activeTaskId = task.id;
  $.todoReminderText.textContent = task.text;
  $.todoReminderTime.textContent = formatTaskTime(task);
  $.todoSnoozeRow.classList.remove('show');
  $.todoReminder.classList.add('show');
  triggerReminderFeedback();
}

function closeReminderPopup(){
  state.reminder.activeTaskId = null;
  $.todoSnoozeRow.classList.remove('show');
  $.todoReminder.classList.remove('show');
}

function completeReminderTask(){
  const id = state.reminder.activeTaskId;
  if(!id) return;
  toggleTodoCompleteById(id);
  closeReminderPopup();
}

function snoozeReminderTask(minutes){
  const id = state.reminder.activeTaskId;
  if(!id) return;
  const task = getTodoById(id);
  if(!task) return;
  const now = Date.now();
  task.snoozeUntil = now + minutes * 60 * 1000;
  task.lastReminderAt = now;
  saveTodos();
  renderTodos();
  closeReminderPopup();
  notify(`Nhắc lại sau ${minutes} phút`);
}

function getDueTaskForReminder(){
  const now = Date.now();
  return sortTasksForToday(state.todos).find(task=>{
    if(task.completed) return false;
    const nextAt = task.snoozeUntil || task.dueAt;
    if(!nextAt) return false;
    if(nextAt > now) return false;
    if(task.lastReminderAt && now - task.lastReminderAt < 30_000) return false;
    return true;
  }) || null;
}

function tickTodoReminder(){
  if(state.reminder.activeTaskId) return;
  const task = getDueTaskForReminder();
  if(!task) return;
  task.lastReminderAt = Date.now();
  saveTodos();
  renderTodos();
  openReminderPopup(task);
}

function startTodoReminderLoop(){
  if(state.reminder.intervalId) return;
  state.reminder.intervalId = setInterval(tickTodoReminder,1000);
}

