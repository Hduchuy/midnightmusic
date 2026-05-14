/* =========================== [visual effects] ============================= */
function setupCanvas(canvas){
  const dpr = getMobileDPR();
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return ctx;
}

const effects = (function(){
  const map = new Map(); // name -> {running,rafId,ctx,draw,canvas}

  function stop(name){
    const e = map.get(name);
    if(!e || !e.running) return;
    e.running = false;
    if(e.rafId) cancelAnimationFrame(e.rafId);
    e.rafId = 0;
  }

  function suspendAll(){
    state.effects.suspended = true;
    map.forEach((_,name)=>stop(name));
  }

  function resumeAll(){
    state.effects.suspended = false;
    if(state.effects.active){
      state.effects.active.forEach(name => {
        if(map.has(name)) start(name);
      });
    }
  }

  function start(name){
    if(state.effects.suspended) return;
    const e = map.get(name);
    if(e?.running) return;
    if(e && !e.ctx){
      e.ctx = setupCanvas(e.canvas);
    }
    if(e){
      e.running = true;
      let lastTime = 0;
      const loop = (time)=>{
        if(!e.running) return;
        
        // Performance throttling for mobile
        const tier = getPerformanceTier();
        const frameSkip = tier === 'low' ? 32 : (tier === 'mid' ? 16 : 0);
        
        if(state.effects.mobilePerformanceMode || tier !== 'high') {
          const threshold = frameSkip || 32;
          if(time - lastTime < threshold) {
            e.rafId = requestAnimationFrame(loop);
            return;
          }
          lastTime = time;
        }

        e.draw();
        e.rafId = requestAnimationFrame(loop);
      };
      e.rafId = requestAnimationFrame(loop);
    }
  }

  function register(name, canvas, draw){
    map.set(name,{running:false,rafId:0,ctx:null,canvas,draw});
  }

  function resizeAll(){
    map.forEach(e=>{
      if(e.canvas){
        e.ctx = setupCanvas(e.canvas);
      }
    });
    // Specific re-seeding for stars if initialized
    if (typeof _seedStars === 'function') _seedStars();
  }

  function has(name){ return map.has(name); }

  return {register,start,stop,suspendAll,resumeAll,resizeAll,has};
})();

let _seedStars = null;

// Stars (previously unused canvas): lightweight starfield, paused when tab hidden
function initStars(){
  const canvas = $.canvas.stars;
  if (!canvas) return; // safeguard
  const ctx = setupCanvas(canvas);
  const stars = [];
  function seed(){
    stars.length = 0;
    const tier = getPerformanceTier();
    const count = tier === 'low' ? 20 : (tier === 'mid' ? 45 : 90);
    for(let i=0;i<count;i++){
      stars.push({
        x:Math.random()*window.innerWidth,
        y:Math.random()*window.innerHeight,
        r:Math.random()*1.1 + 0.2,
        a:Math.random()*0.6 + 0.1,
        tw:(Math.random()*0.015 + 0.004) * (Math.random() > 0.5 ? 1 : -1)
      });
    }
  }
  _seedStars = seed;
  seed();

  effects.register('stars',canvas,()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const s of stars){
      s.a = clamp(s.a + s.tw,0.08,0.75);
      ctx.beginPath();
      ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.fill();
    }
  });
}

// Global resize listener for all background effects
window.addEventListener('resize', debounce(() => {
  effects.resizeAll();
}, 200), { passive: true });

function startRain(){
  if(effects.has('rain')) return effects.start('rain');
  const canvas = $.canvas.rain;
  const ctx = setupCanvas(canvas);
  const rainDrops = [];
  const tier = getPerformanceTier();
  const count = tier === 'low' ? 40 : (tier === 'mid' ? 85 : 180);
  for(let i=0;i<count;i++){
    rainDrops.push({
      x:Math.random()*window.innerWidth,
      y:Math.random()*window.innerHeight,
      len:Math.random()*(isMobileView() ? 14 : 20)+8,
      speed:Math.random()*(isMobileView() ? 4 : 6)+3,
      opacity:Math.random()*.35+.15
    });
  }
  effects.register('rain',canvas,()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const r of rainDrops){
      ctx.beginPath();
      ctx.moveTo(r.x,r.y);
      ctx.lineTo(r.x-2,r.y+r.len);
      ctx.strokeStyle = `rgba(210,230,255,${r.opacity})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      r.y += r.speed;
      if(r.y > window.innerHeight){
        r.y = -20;
        r.x = Math.random()*window.innerWidth;
      }
    }
  });
  effects.start('rain');
}

function startLeaves(){
  if(effects.has('leaves')) return effects.start('leaves');
  const canvas = $.canvas.leaves;
  const ctx = setupCanvas(canvas);
  const leaves = [];
  const tier = getPerformanceTier();
  const count = tier === 'low' ? 8 : (tier === 'mid' ? 18 : 35);
  for(let i=0;i<count;i++){
    leaves.push({
      x:Math.random()*window.innerWidth,
      y:Math.random()*window.innerHeight,
      size:Math.random()*(isMobileView() ? 11 : 16)+8,
      speed:Math.random()*(isMobileView() ? .85 : 1.2)+0.45,
      drift:Math.random()*2+1,
      angle:Math.random()*360
    });
  }
  effects.register('leaves',canvas,()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const l of leaves){
      ctx.save();
      ctx.translate(l.x,l.y);
      ctx.rotate(l.angle*Math.PI/180);
      ctx.fillStyle = 'rgba(210,245,255,.82)';
      ctx.beginPath();
      ctx.moveTo(0,-l.size);
      ctx.quadraticCurveTo(l.size*.9,-l.size*.2,0,l.size);
      ctx.quadraticCurveTo(-l.size*.9,-l.size*.2,0,-l.size);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0,-l.size*.8);
      ctx.lineTo(0,l.size*.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0,-l.size*.1);
      ctx.lineTo(l.size*.35,l.size*.15);
      ctx.moveTo(0,l.size*.15);
      ctx.lineTo(-l.size*.35,l.size*.38);
      ctx.stroke();
      ctx.restore();

      l.y += l.speed;
      l.x += Math.sin(l.y*.01)*l.drift;
      l.angle += .6;
      if(l.y > window.innerHeight+30){
        l.y = -30;
        l.x = Math.random()*window.innerWidth;
      }
    }
  });
  effects.start('leaves');
}

function startMeteors(){
  if(effects.has('meteors')) return effects.start('meteors');
  const canvas = $.canvas.meteors;
  const ctx = setupCanvas(canvas);
  const meteors = [];
  const tier = getPerformanceTier();
  const count = tier === 'low' ? 3 : (tier === 'mid' ? 6 : 12);
  for(let i=0;i<count;i++){
    meteors.push({
      x:Math.random()*window.innerWidth,
      y:Math.random()*window.innerHeight*.25,
      len:Math.random()*(isMobileView() ? 78 : 140)+(isMobileView() ? 70 : 120),
      speed:Math.random()*(isMobileView() ? 4 : 7)+4,
      size:Math.random()*2+1,
      opacity:Math.random()*.5+.3
    });
  }
  effects.register('meteors',canvas,()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const m of meteors){
      const grad = ctx.createLinearGradient(m.x,m.y,m.x-m.len,m.y-m.len*.18);
      grad.addColorStop(0,`rgba(255,255,255,${m.opacity})`);
      grad.addColorStop(1,'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.moveTo(m.x,m.y);
      ctx.lineTo(m.x-m.len,m.y-m.len*.18);
      ctx.strokeStyle = grad;
      ctx.lineWidth = m.size;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.x,m.y,m.size*1.4,0,Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${m.opacity})`;
      ctx.fill();
      m.x += m.speed;
      m.y += m.speed*.18;
      if(m.x > window.innerWidth + 200 || m.y > window.innerHeight*.45){
        m.x = -200;
        m.y = Math.random()*window.innerHeight*.22;
      }
    }
  });
  effects.start('meteors');
}

function startBubbles(){
  if(effects.has('bubbles')) return effects.start('bubbles');
  const canvas = $.canvas.bubbles;
  const ctx = setupCanvas(canvas);
  const bubbles = [];
  const tier = getPerformanceTier();
  const count = tier === 'low' ? 10 : (tier === 'mid' ? 22 : 45);
  for(let i=0;i<count;i++){
    bubbles.push({
      x:Math.random()*window.innerWidth,
      y:Math.random()*window.innerHeight,
      r:Math.random()*(isMobileView() ? 14 : 22)+7,
      speed:Math.random()*(isMobileView() ? 1 : 1.5)+0.45,
      drift:(Math.random()-.5)*0.8,
      opacity:Math.random()*.35+.2
    });
  }
  effects.register('bubbles',canvas,()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const b of bubbles){
      ctx.beginPath();
      ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
      ctx.strokeStyle = `rgba(255,255,255,${b.opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x-b.r/3,b.y-b.r/3,b.r/6,0,Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${b.opacity*.7})`;
      ctx.fill();
      b.y -= b.speed;
      b.x += b.drift;
      if(b.y < -50){
        b.y = window.innerHeight + 40;
        b.x = Math.random()*window.innerWidth;
      }
    }
  });
  effects.start('bubbles');
}

// Automatically pause/resume effects when tab is hidden to save battery
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    effects.suspendAll();
  } else {
    effects.resumeAll();
  }
});

