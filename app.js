let logs = JSON.parse(localStorage.getItem('smoke_logs')) || [];
let settings = JSON.parse(localStorage.getItem('smoke_settings')) || { theme: 'default', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20 };
let triggers = ['💼 Work Stress', '🍽️ After Meal', '☕ Chai / Coffee', '🚗 Driving', '📱 Boredom', '👥 Social'];
let shields = parseInt(localStorage.getItem('smoke_shields')) || 0;
let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let appPin = localStorage.getItem('smoke_pin');
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;

window.onload = () => {
  applyTheme(settings.theme);
  if(appPin) {
    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('pinStatusBtn').innerText = "Remove PIN";
  } else {
    bootCore();
  }
};

function bootCore() {
  updateUI(); checkLock(); checkWave();
  if(mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    if(logs.length === 0) return;
    const diff = new Date().getTime() - logs[logs.length-1].timestamp;
    document.getElementById('stopwatch').innerText = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
    if(diff >= 86400000 && !localStorage.getItem('m24')) { localStorage.setItem('m24','1'); fireConfetti("1 Full Day Clean!"); }
    else if(diff >= 43200000 && !localStorage.getItem('m12')) { localStorage.setItem('m12','1'); fireConfetti("12 Hours Clean!"); }
  }, 1000);
}

function enterPin(n) {
  if(enteredPin.length < 4) { enteredPin += n; document.querySelectorAll('.pin-dot').forEach((el, i) => el.classList.toggle('bg-amber-500', i < enteredPin.length)); }
  if(enteredPin.length === 4) {
    setTimeout(() => {
      if(enteredPin === appPin) { document.getElementById('lockScreen').classList.add('hidden'); bootCore(); } 
      else { alert("Wrong PIN"); clearPin(); }
    }, 200);
  }
}
function clearPin() { enteredPin = ""; document.querySelectorAll('.pin-dot').forEach(el => el.classList.remove('bg-amber-500')); }
function setupPin() {
  if(appPin) { if(confirm("Remove PIN?")) { localStorage.removeItem('smoke_pin'); appPin=null; location.reload(); } }
  else { let p = prompt("New 4-digit PIN:"); if(p && p.length===4) { localStorage.setItem('smoke_pin',p); appPin=p; alert("Saved!"); location.reload(); } }
}

function handleLogClick() {
  if(new Date().getTime() < lockEndTime) return;
  if(settings.haptics && navigator.vibrate) navigator.vibrate(50);
  if(waveEndTime>0) { localStorage.removeItem('smoke_wave_end'); waveEndTime=0; clearInterval(waveTimer); document.getElementById('waveOverlay').classList.add('hidden'); }
  if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p => saveLog(p.coords.latitude, p.coords.longitude), () => saveLog(null,null), {timeout:3000});
  else saveLog(null,null);
}

function saveLog(lat, lng) {
  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : 0;
  logs.push({timestamp: now, gap: gap, trigger: '', lat, lng});
  localStorage.setItem('smoke_logs', JSON.stringify(logs));
  localStorage.removeItem('m12'); localStorage.removeItem('m24');
  if(settings.lockSecs>0) { lockEndTime = now + (settings.lockSecs*1000); localStorage.setItem('smoke_lock_end', lockEndTime); }
  updateUI(); openTriggerModal(); checkLock();
}

function checkLock() {
  const btn = document.getElementById('mainLogBtn');
  if(new Date().getTime() < lockEndTime) {
    btn.disabled=true; btn.classList.add('opacity-50');
    if(cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      let rem = Math.ceil((lockEndTime - new Date().getTime())/1000);
      if(rem<=0) { clearInterval(cooldownTimer); btn.disabled=false; btn.classList.remove('opacity-50'); btn.innerText='START SMOKING'; }
      else btn.innerText=`LOCKED (${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')})`;
    }, 1000);
  }
}

function toggleWaveMode() {
  if(new Date().getTime() < lockEndTime || waveEndTime>0) return;
  waveEndTime = new Date().getTime() + 600000; localStorage.setItem('smoke_wave_end', waveEndTime); checkWave();
}
function checkWave() {
  const o = document.getElementById('waveOverlay');
  if(waveEndTime > 0) {
    o.classList.remove('hidden');
    if(waveTimer) clearInterval(waveTimer);
    waveTimer = setInterval(() => {
      let rem = Math.ceil((waveEndTime - new Date().getTime())/1000);
      if(rem<=0) { clearInterval(waveTimer); waveEndTime=0; localStorage.removeItem('smoke_wave_end'); o.classList.add('hidden'); shields++; localStorage.setItem('smoke_shields', shields); updateUI(); fireConfetti("Wave Survived!"); }
      else { document.getElementById('waveCountdown').innerText=`${Math.floor(rem/60).toString().padStart(2,'0')}:${(rem%60).toString().padStart(2,'0')}`; document.getElementById('waveProgressBar').style.width=`${(rem/600)*100}%`; }
    }, 1000);
  }
}

function switchTab(t) {
  ['tracker','insights','history','settings'].forEach(x => { document.getElementById(`page-${x}`).classList.add('hidden'); document.getElementById(`tab-${x}`).classList.remove('tab-active'); });
  document.getElementById(`page-${t}`).classList.remove('hidden'); document.getElementById(`tab-${t}`).classList.add('tab-active');
  if(t==='history') renderHistory();
  if(t==='insights') { setTimeout(() => renderAllCharts(), 100); }
}

function applyTheme(t) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if(t!=='default') document.body.classList.add(`theme-${t}`);
  if(document.getElementById('themeSelect')) document.getElementById('themeSelect').value = t;
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#9CA3AF';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value; settings.haptics = document.getElementById('hapticToggle').checked;
  settings.dailyLimit = parseInt(document.getElementById('dailyLimitInput').value)||15; settings.lockSecs = parseInt(document.getElementById('lockDurationSelect').value)||0;
  settings.packPrice = parseInt(document.getElementById('packPriceInput').value)||20;
  localStorage.setItem('smoke_settings', JSON.stringify(settings)); applyTheme(settings.theme); updateUI();
}

function updateUI() {
  if(document.getElementById('themeSelect')) {
    document.getElementById('themeSelect').value = settings.theme; document.getElementById('dailyLimitInput').value = settings.dailyLimit;
    document.getElementById('packPriceInput').value = settings.packPrice; document.getElementById('lockDurationSelect').value = settings.lockSecs;
  }
  document.getElementById('shieldCount').innerText = shields;
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  document.getElementById('todayCount').innerText = `${today.length} / ${settings.dailyLimit}`;
  document.getElementById('todaySpend').innerText = `AED ${(today.length * (settings.packPrice/settings.packSize)).toFixed(1)}`;
  if(logs.length>1) document.getElementById('prevGap').innerText = formatGap(logs[logs.length-1].gap);
  if(today.length>0) document.getElementById('bestGap').innerText = formatGap(Math.max(...today.map(l=>l.gap)));
  renderHistory('homeRecentLogs', 4);
}

function formatGap(m) { return m<60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60>0?m%60+'m':''}`; }
function fireConfetti(msg) { document.getElementById('milestoneMsg').innerText=msg; document.getElementById('milestoneToast').classList.remove('hidden'); confetti({particleCount:100, spread:70, origin:{y:0.6}}); setTimeout(()=>document.getElementById('milestoneToast').classList.add('hidden'), 4000); }
function resetData(type) { if(confirm("Wipe Data?")) { localStorage.clear(); location.reload(); } }

function openTriggerModal() { document.getElementById('modalTriggerGrid').innerHTML=triggers.map(t=>`<button onclick="assignTag('${t}')" class="py-3 px-2 glass-card rounded-xl text-left truncate">${t}</button>`).join(''); document.getElementById('triggerModal').classList.remove('hidden'); }
function assignTag(tag) { if(logs.length>0) { logs[logs.length-1].trigger=tag; localStorage.setItem('smoke_logs', JSON.stringify(logs)); renderHistory('homeRecentLogs',4); } closeTriggerModal(); }
function closeTriggerModal() { document.getElementById('triggerModal').classList.add('hidden'); }

function renderHistory(tId='fullHistoryList', limit=null) {
  const c = document.getElementById(tId); if(!c) return;
  if(logs.length===0) { c.innerHTML="<p class='text-center opacity-50 py-4'>No logs yet.</p>"; return; }
  let items = logs.slice().reverse(); if(limit) items = items.slice(0,limit);
  c.innerHTML = items.map(l => `<div class="glass-card p-3 rounded-xl flex justify-between border-l-2 border-gray-500 mb-2"><div><div class="font-bold">${new Date(l.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div><div class="text-[10px] opacity-70">${l.trigger||'No Tag'}</div></div><div class="font-bold dynamic-text">${formatGap(l.gap)}</div></div>`).join('');
}

function renderAllCharts() {
  const hasData = logs.length >= 3;
  document.querySelectorAll('.empty-state').forEach(el => hasData ? el.classList.add('hidden') : el.classList.remove('hidden'));
  if(!hasData) return;

  const today = new Date();
  const perStick = settings.packPrice / settings.packSize;
  const tooltips = { backgroundColor: 'rgba(22,26,33,0.9)', titleColor: '#fff', padding: 10, cornerRadius: 8 };

  function buildChart(id, config) {
    if(myChartInstances[id]) myChartInstances[id].destroy();
    myChartInstances[id] = new Chart(document.getElementById(id).getContext('2d'), config);
  }

  let gL=[], gD=[]; logs.slice(-15).forEach((l,i)=>{gL.push(`#${i+1}`); gD.push(l.gap);});
  let ctx1 = document.getElementById('chart1').getContext('2d');
  let grad1 = ctx1.createLinearGradient(0,0,0,150); grad1.addColorStop(0,'rgba(16,185,129,0.5)'); grad1.addColorStop(1,'rgba(16,185,129,0)');
  buildChart('chart1', { type: 'line', data: { labels: gL, datasets: [{ data: gD, borderColor: '#10B981', backgroundColor: grad1, fill: true, tension: 0.4 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:tooltips}, scales:{x:{display:false},y:{grid:{color:'rgba(255,255,255,0.05)'}}} } });

  let sL=[], sD=[];
  for(let i=6;i>=0;i--){ let d=new Date(today.getTime()-i*86400000); sL.push(d.toLocaleDateString([],{weekday:'short'})); sD.push(logs.filter(l=>new Date(l.timestamp).toDateString()===d.toDateString()).length*perStick); }
  buildChart('chart2', { type: 'bar', data: { labels: sL, datasets: [{ data: sD, backgroundColor: '#EF4444', borderRadius: 4 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:tooltips}, scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(255,255,255,0.05)'}}} } });

  let zm=0, za=0, ze=0, zn=0;
  logs.filter(l=>new Date(l.timestamp).toDateString()===today.toDateString()).forEach(l=>{ let h=new Date(l.timestamp).getHours(); if(h>=6&&h<12)zm++; else if(h>=12&&h<18)za++; else if(h>=18&&h<22)ze++; else zn++; });
  buildChart('chart3', { type: 'radar', data: { labels: ['Morning','Afternoon','Evening','Night'], datasets: [{ data:[zm,za,ze,zn], backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366F1' }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{r:{grid:{color:'rgba(255,255,255,0.1)'}, angleLines:{color:'rgba(255,255,255,0.1)'}, ticks:{display:false}}} } });

  let cd=0, cn=0; logs.forEach(l=>{ let h=new Date(l.timestamp).getHours(); if(h>=6&&h<18)cd++; else cn++; });
  buildChart('chart4', { type: 'doughnut', data: { labels: ['Day','Night'], datasets: [{ data:[cd,cn], backgroundColor: ['#F59E0B','#3B82F6'], borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{legend:{position:'right'},tooltip:tooltips} } });

  let hD = new Array(24).fill(0); logs.forEach(l=>hD[new Date(l.timestamp).getHours()]++);
  buildChart('chart5', { type: 'bar', data: { labels: Array.from({length:24},(_,i)=>i), datasets: [{ data:hD, backgroundColor: '#F97316' }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{display:false}} } });

  let dwD = [0,0,0,0,0,0,0]; logs.forEach(l=>dwD[new Date(l.timestamp).getDay()]++);
  buildChart('chart6', { type: 'bar', data: { labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], datasets: [{ data:dwD, backgroundColor: '#3B82F6', borderRadius: 4 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{display:false}} } });

  let tgC={}; logs.forEach(l=>{ let t=l.trigger||'Untagged'; tgC[t]=(tgC[t]||0)+1; });
  buildChart('chart7', { type: 'polarArea', data: { labels: Object.keys(tgC), datasets: [{ data: Object.values(tgC), backgroundColor: ['#8B5CF6','#EC4899','#10B981','#F59E0B','#3B82F6','#EF4444'], borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right'}} } });

  let gd1=0, gd2=0, gd3=0, gd4=0;
  logs.forEach(l=>{ if(l.gap<60)gd1++; else if(l.gap<120)gd2++; else if(l.gap<240)gd3++; else gd4++; });
  buildChart('chart8', { type: 'bar', data: { labels: ['<1h','1-2h','2-4h','>4h'], datasets: [{ data:[gd1,gd2,gd3,gd4], backgroundColor: '#14B8A6', borderRadius:4 }] }, options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{display:false}}} } });

  let scL=[], scD=[];
  for(let i=6;i>=0;i--){ let d=new Date(today.getTime()-i*86400000); scL.push(d.toLocaleDateString([],{weekday:'short'})); scD.push(logs.filter(l=>new Date(l.timestamp).toDateString()===d.toDateString()).length); }
  buildChart('chart9', { type: 'line', data: { labels: scL, datasets: [{ data: scD, borderColor: '#EC4899', backgroundColor: 'rgba(236,72,153,0.1)', fill:true, tension:0.3 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{color:'rgba(255,255,255,0.05)}} } });

  const gpsLogs = logs.filter(l => l.lat && l.lng); 
  if(mapInstance) { mapInstance.remove(); mapInstance = null; }
  let defLat = gpsLogs.length>0 ? gpsLogs[gpsLogs.length-1].lat : 25.2048; 
  let defLng = gpsLogs.length>0 ? gpsLogs[gpsLogs.length-1].lng : 55.2708;
  mapInstance = L.map('mapContainer', { zoomControl: false }).setView([defLat, defLng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18}).addTo(mapInstance);
  gpsLogs.forEach(l => L.circleMarker([l.lat, l.lng], {radius:6, fillColor:"#3B82F6", color:"#fff", weight:2, fillOpacity:0.8}).addTo(mapInstance).bindPopup(`<b>${l.trigger||'Logged'}</b>`));
}