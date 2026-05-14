/* ============================ [storage utils] ============================= */
const StorageHelper = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? JSON.parse(value) : defaultValue;
    } catch {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
};

function loadTodos(){
  try{
    const data = StorageHelper.get(STORAGE_KEYS.TODOS, []);
    if(!Array.isArray(data)) return [];
    const now = Date.now();
    return data.map((x,index)=>{
      if(typeof x === 'string'){
        return {
          id:`legacy-${now}-${index}`,
          text:x,
          dueAt:null,
          completed:false,
          completedAt:null,
          snoozeUntil:null,
          lastReminderAt:null,
          createdAt:now + index
        };
      }
      return {
        id:String(x.id || `task-${now}-${index}`),
        text:String(x.text || '').trim(),
        dueAt:Number.isFinite(x.dueAt) ? x.dueAt : null,
        completed:Boolean(x.completed),
        completedAt:Number.isFinite(x.completedAt) ? x.completedAt : null,
        snoozeUntil:Number.isFinite(x.snoozeUntil) ? x.snoozeUntil : null,
        lastReminderAt:Number.isFinite(x.lastReminderAt) ? x.lastReminderAt : null,
        createdAt:Number.isFinite(x.createdAt) ? x.createdAt : (now + index)
      };
    }).filter(t=>t.text);
  }catch{
    return [];
  }
}

function saveTodos(){
  StorageHelper.set(STORAGE_KEYS.TODOS, state.todos);
}
