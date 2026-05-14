/* ============================ [helper utils] ============================== */
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function pad2(n){ return String(n).padStart(2,'0'); }

function formatTime(sec){
  if(!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${pad2(s)}`;
}

function isMobileView(){
  return window.innerWidth <= 768 || matchMedia('(pointer: coarse)').matches;
}

function isTinyView(){
  return window.innerWidth <= 480 || window.innerHeight <= 640;
}

function particleCount(desktop, tablet, phone){
  if(isTinyView()) return phone;
  // Reduce tablet count if mobileView is detected
  if(isMobileView()) return Math.floor(tablet * 0.7); 
  return desktop;
}

function getMobileDPR() {
  const dpr = window.devicePixelRatio || 1;
  if (isTinyView()) return Math.min(dpr, 1.0);
  if (isMobileView()) return Math.min(dpr, 1.2);
  return Math.min(dpr, 2);
}

function getPerformanceTier() {
  // Logic to determine device capability
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const isMobile = isMobileView();
  const dpr = window.devicePixelRatio || 1;

  if (!isMobile) return 'high';
  
  // Mid-range: at least 6 cores or 6GB RAM, and not too high DPR
  if ((cores >= 6 || memory >= 6) && dpr <= 2.5) return 'mid';
  
  // Low-end: everything else
  return 'low';
}

function debounce(fn, waitMs){
  let t = null;
  return (...args)=>{
    if(t) clearTimeout(t);
    t = setTimeout(()=>fn(...args),waitMs);
  };
}

function isElementVisible(el){
  if(!el) return false;
  const opacity = parseFloat(getComputedStyle(el).opacity || '1');
  return opacity > 0.001;
}

function toAbsUrl(url){
  try{ return new URL(url,window.location.href).href; }catch{ return url; }
}

function notify(text){
  const notifEl = document.getElementById('notif');
  if (!notifEl) return;
  notifEl.textContent = text;
  notifEl.classList.add('show');
  window.setTimeout(() => notifEl.classList.remove('show'), 2000);
}

