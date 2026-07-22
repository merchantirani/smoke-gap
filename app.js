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
  document.getElementById('dailyLimitInput').value = settings.dailyLimit;
  document.getElementById('packPriceInput').value = settings.packPrice;
  document.getElementById('themeSelect').value = settings.theme;
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
  lockEndTime = now + (settings.lockSecs * 1000);
  localStorage.setItem('smoke_lock_end', lockEndTime);
  updateUI(); openTriggerModal(); checkLock();
}

function checkLock() {
  const btn = document.getElementById('mainLogBtn');
  if(!btn) return;
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
  if(!o) return;
  if(waveEndTime > 0) {
    o.classList.remove('hidden');
    if(waveTimer) clearInterval(waveTimer);
    waveTimer = setInterval(() => {
      let rem = Math.ceil((waveEndTime - new Date().getTime())/1000);
      if(rem<=0) { clearInterval(waveTimer); waveEndTime=0; localStorage.removeItem('smoke_wave_end'); o.classList.add('hidden'); shields++; localStorage.setItem('smoke_shields', shields); updateUI(); }
      else { document.getElementById('waveCountdown').innerText=`${Math.floor(rem/60).toString().padStart(2,'0')}:${(rem%60).toString().padStart(2,'0')}`; document.getElementById('waveProgressBar').style.width=`${(rem/600)*100}%`; }
    }, 1000);
  }
}

function switchTab(t) {
  ['tracker','insights','history','settings'].forEach(x => { 
    let p = document.getElementById(`page-${x}`);
    let tab = document.getElementById(`tab-${x}`);
    if(p) p.classList.add('hidden'); 
    if(tab) tab.classList.remove('tab-active'); 
  });
  let cp = document.getElementById(`page-${t}`);
  let ct = document.getElementById(`tab-${t}`);
  if(cp) cp.classList.remove('hidden'); 
  if(ct) ct.classList.add('tab-active');
  if(t==='history') renderHistory();
  if(t==='insights') { setTimeout(() => renderAllCharts(), 100); }
}

function applyTheme(t) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if(t!=='default') document.body.classList.add(`theme-${t}`);
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value;
  settings.dailyLimit = parseInt(document.getElementById('dailyLimitInput').value) || 15;
  settings.packPrice = parseFloat(document.getElementById('packPriceInput').value) || 20;
  localStorage.setItem('smoke_settings', JSON.stringify(settings)); 
  applyTheme(settings.theme); 
  updateUI();
}

function updateUI() {
  document.getElementById('shieldCount').innerText = shields;
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  document.getElementById('todayCount').innerText = `${today.length} / ${settings.dailyLimit}`;
  document.getElementById('todaySpend').innerText = `AED ${(today.length * (settings.packPrice/settings.packSize)).toFixed(1)}`;
  if(logs.length>1) document.getElementById('prevGap').innerText = formatGap(logs[logs.length-1].gap);
  if(today.length>0) document.getElementById('bestGap').innerText = formatGap(Math.max(...today.map(l=>l.gap)));
  renderHistory('homeRecentLogs', 4);
}

function formatGap(m) { return m<60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60>0?m%60+'m':''}`; }
function resetData(type) { if(confirm("Wipe Data?")) { localStorage.clear(); location.reload(); } }

function openTriggerModal() { document.getElementById('modalTriggerGrid').innerHTML=triggers.map(t=>`<button onclick="window.assignTag('${t}')" class="py-3 px-2 glass-card rounded-xl text-left truncate">${t}</button>`).join(''); document.getElementById('triggerModal').classList.remove('hidden'); }
function assignTag(tag) { if(logs.length>0) { logs[logs.length-1].trigger=tag; localStorage.setItem('smoke_logs', JSON.stringify(logs)); renderHistory('homeRecentLogs',4); } closeTriggerModal(); }
function closeTriggerModal() { document.getElementById('triggerModal').classList.add('hidden'); }

function renderHistory(tId='fullHistoryList', limit=null) {
  const c = document.getElementById(tId); if(!c) return;
  if(logs.length===0) { c.innerHTML="<p class='text-center opacity-50 py-4'>No logs yet.</p>"; return; }
  let items = logs.slice().reverse(); if(limit) items = items.slice(0,limit);
  c.innerHTML = items.map(l => `<div class="glass-card p-3 rounded-xl flex justify-between border-l-2 border-gray-500 mb-2"><div><div class="font-bold">${new Date(l.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div><div class="text-[10px] opacity-70">${l.trigger||'No Tag'}</div></div><div class="font-bold dynamic-text">${formatGap(l.gap)}</div></div>`).join('');
}

function renderAllCharts() {
  for (let i = 1; i <= 9; i++) {
    const canvas = document.getElementById(`chart${i}`);
    if(!canvas) continue;
    if(myChartInstances[i]) myChartInstances[i].destroy();
    
    let labels = logs.slice(-7).map(l => new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
    let data = logs.slice(-7).map(l => l.gap);
    if(data.length === 0) { data = [0]; labels = ['--']; }

    myChartInstances[i] = new Chart(canvas.getContext('2d'), {
      type: i === 3 ? 'radar' : (i === 4 || i === 6 ? 'bar' : 'line'),
      data: {
        labels: labels,
        datasets: [{
          label: 'Analytics',
          data: data,
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  // Spatial Map
  const mapEl = document.getElementById('mapContainer');
  if(mapEl) {
    if(mapInstance) { mapInstance.remove(); mapInstance = null; }
    mapEl.innerHTML = "";
    let lastWithLoc = logs.slice().reverse().find(l => l.lat && l.lng);
    let lat = lastWithLoc ? lastWithLoc.lat : 25.2048;
    let lng = lastWithLoc ? lastWithLoc.lng : 55.2708;
    try {
      mapInstance = L.map('mapContainer', {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{z}.png', {maxZoom: 19}).addTo(mapInstance);
      if(lastWithLoc) L.marker([lat, lng]).addTo(mapInstance);
    } catch(e) {}
  }
}

window.enterPin = enterPin;
window.clearPin = clearPin;
window.setupPin = setupPin;
window.handleLogClick = handleLogClick;
window.toggleWaveMode = toggleWaveMode;
window.switchTab = switchTab;
window.updateSettings = updateSettings;
window.resetData = resetData;
window.assignTag = assignTag;
window.closeTriggerModal = closeTriggerModal;
