let logs = JSON.parse(localStorage.getItem('smoke_logs')) || [];
let settings = JSON.parse(localStorage.getItem('smoke_settings')) || { theme: 'default', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED' };
let triggers = ['💼 Work Stress', '🍽️ After Meal', '☕ Chai / Coffee', '🚗 Driving', '📱 Boredom', '👥 Social'];
let shields = parseInt(localStorage.getItem('smoke_shields')) || 0;
let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let appPin = localStorage.getItem('smoke_pin');
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;

window.onload = () => {
  applyTheme(settings.theme);
  document.getElementById('dailyLimitInput').value = settings.dailyLimit;
  document.getElementById('packPriceInput').value = settings.packPrice;
  document.getElementById('packSizeInput').value = settings.packSize;
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('currencySelect').value = settings.currency || 'AED';
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
  if(t==='insights') { setTimeout(() => renderAllCharts(), 150); }
}

function applyTheme(t) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if(t!=='default') document.body.classList.add(`theme-${t}`);
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value;
  settings.currency = document.getElementById('currencySelect').value;
  settings.dailyLimit = parseInt(document.getElementById('dailyLimitInput').value) || 15;
  settings.packPrice = parseFloat(document.getElementById('packPriceInput').value) || 20;
  settings.packSize = parseInt(document.getElementById('packSizeInput').value) || 20;
  localStorage.setItem('smoke_settings', JSON.stringify(settings)); 
  applyTheme(settings.theme); 
  updateUI();
}

function updateUI() {
  document.getElementById('shieldCount').innerText = shields;
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  document.getElementById('todayCount').innerText = `${today.length} / ${settings.dailyLimit}`;
  document.getElementById('todaySpend').innerText = `${settings.currency} ${(today.length * (settings.packPrice/settings.packSize)).toFixed(1)}`;
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

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter').value;
  const now = new Date().getTime();
  if(filter === 'today') {
    return logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  } else if(filter === '7days') {
    return logs.filter(l => (now - l.timestamp) <= 7 * 86400000);
  } else if(filter === '1month') {
    return logs.filter(l => (now - l.timestamp) <= 30 * 86400000);
  }
  return logs;
}

function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  const labels = activeLogs.length > 0 ? activeLogs.map(l => new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}) + ' ' + new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})) : ['No Data'];
  const gaps = activeLogs.length > 0 ? activeLogs.map(l => l.gap) : [0];

  // 1. Line Trend
  if(myChartInstances[1]) myChartInstances[1].destroy();
  myChartInstances[1] = new Chart(document.getElementById('chart1').getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Gap (m)', data: gaps, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.3, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 2. Bar Spend
  if(myChartInstances[2]) myChartInstances[2].destroy();
  myChartInstances[2] = new Chart(document.getElementById('chart2').getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Spend', data: gaps.map(g => (settings.packPrice/settings.packSize).toFixed(1)), backgroundColor: '#EF4444' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 3. Radar Craving
  if(myChartInstances[3]) myChartInstances[3].destroy();
  myChartInstances[3] = new Chart(document.getElementById('chart3').getContext('2d'), {
    type: 'radar',
    data: { labels: triggers, datasets: [{ label: 'Triggers', data: triggers.map(t => activeLogs.filter(l => l.trigger === t).length), borderColor: '#6366F1', backgroundColor: 'rgba(99, 102, 241, 0.2)' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 4. Day vs Night Bar
  if(myChartInstances[4]) myChartInstances[4].destroy();
  const dayCount = activeLogs.filter(l => { let h = new Date(l.timestamp).getHours(); return h >= 6 && h < 18; }).length;
  const nightCount = activeLogs.length - dayCount;
  myChartInstances[4] = new Chart(document.getElementById('chart4').getContext('2d'), {
    type: 'bar',
    data: { labels: ['Day (6AM-6PM)', 'Night (6PM-6AM)'], datasets: [{ data: [dayCount, nightCount], backgroundColor: ['#F59E0B', '#3B82F6'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 5. 24-Hour Matrix
  if(myChartInstances[5]) myChartInstances[5].destroy();
  let hours = Array(24).fill(0);
  activeLogs.forEach(l => hours[new Date(l.timestamp).getHours()]++);
  myChartInstances[5] = new Chart(document.getElementById('chart5').getContext('2d'), {
    type: 'line',
    data: { labels: Array.from({length:24}, (_,i)=>i+':00'), datasets: [{ data: hours, borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, tension: 0.4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 6. Day of Week Pattern
  if(myChartInstances[6]) myChartInstances[6].destroy();
  let days = [0,0,0,0,0,0,0];
  activeLogs.forEach(l => days[new Date(l.timestamp).getDay()]++);
  myChartInstances[6] = new Chart(document.getElementById('chart6').getContext('2d'), {
    type: 'bar',
    data: { labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], datasets: [{ data: days, backgroundColor: '#3B82F6' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 7. Trigger Breakdown Doughnut
  if(myChartInstances[7]) myChartInstances[7].destroy();
  myChartInstances[7] = new Chart(document.getElementById('chart7').getContext('2d'), {
    type: 'doughnut',
    data: { labels: triggers, datasets: [{ data: triggers.map(t => activeLogs.filter(l => l.trigger === t).length), backgroundColor: ['#F59E0B','#10B981','#6366F1','#EF4444','#3B82F6','#A855F7'] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // 8. Gap Distribution Line
  if(myChartInstances[8]) myChartInstances[8].destroy();
  myChartInstances[8] = new Chart(document.getElementById('chart8').getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: [{ data: gaps, borderColor: '#14B8A6', backgroundColor: 'rgba(20, 184, 166, 0.1)', fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // 9. Stick Count Volume
  if(myChartInstances[9]) myChartInstances[9].destroy();
  myChartInstances[9] = new Chart(document.getElementById('chart9').getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: activeLogs.map(() => 1), backgroundColor: '#EC4899' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // Spatial Map Render
  renderMap('mapContainer', activeLogs);
}

function renderMap(containerId, activeLogs) {
  const mapEl = document.getElementById(containerId);
  if(!mapEl) return;
  if(containerId === 'mapContainer' && mapInstance) { mapInstance.remove(); mapInstance = null; }
  if(containerId === 'mapModalContainer' && modalMapInstance) { modalMapInstance.remove(); modalMapInstance = null; }

  let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng);
  let lat = lastWithLoc ? lastWithLoc.lat : 25.2048;
  let lng = lastWithLoc ? lastWithLoc.lng : 55.2708;

  try {
    let m = L.map(containerId, {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{z}.png', {maxZoom: 19}).addTo(m);
    if(lastWithLoc) {
      activeLogs.forEach(l => {
        if(l.lat && l.lng) L.marker([l.lat, l.lng]).addTo(m);
      });
    }
    if(containerId === 'mapContainer') mapInstance = m;
    if(containerId === 'mapModalContainer') modalMapInstance = m;
  } catch(e) {}
}

function openMapModal() {
  document.getElementById('mapModal').classList.remove('hidden');
  setTimeout(() => { renderMap('mapModalContainer', getFilteredLogs()); }, 200);
}
function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  if(modalMapInstance) { modalMapInstance.remove(); modalMapInstance = null; }
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
window.renderAllCharts = renderAllCharts;
window.openMapModal = openMapModal;
window.closeMapModal = closeMapModal;
