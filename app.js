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
let cachedCoords = JSON.parse(localStorage.getItem('smoke_last_coords')) || null;

window.onload = () => {
  applyTheme(settings.theme);
  document.getElementById('dailyLimitInput').value = settings.dailyLimit;
  document.getElementById('packPriceInput').value = settings.packPrice;
  document.getElementById('packSizeInput').value = settings.packSize;
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('currencySelect').value = settings.currency || 'AED';
  
  loadChartOrder();
  initDragAndDrop();

  if(appPin) {
    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('pinStatusBtn').innerText = "Remove PIN";
  } else {
    bootCore();
  }
};

function bootCore() {
  updateUI(); checkLock(); checkWave();
  if(navigator.geolocation && !cachedCoords) {
    navigator.geolocation.getCurrentPosition(p => {
      cachedCoords = { lat: p.coords.latitude, lng: p.coords.longitude };
      localStorage.setItem('smoke_last_coords', JSON.stringify(cachedCoords));
    }, () => {}, {timeout:5000});
  }
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
  
  if(cachedCoords) {
    saveLog(cachedCoords.lat, cachedCoords.lng);
  } else if(navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      cachedCoords = { lat: p.coords.latitude, lng: p.coords.longitude };
      localStorage.setItem('smoke_last_coords', JSON.stringify(cachedCoords));
      saveLog(cachedCoords.lat, cachedCoords.lng);
    }, () => saveLog(null, null), {timeout:3000});
  } else {
    saveLog(null, null);
  }
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
  if(t==='insights') { requestAnimationFrame(() => renderAllCharts()); }
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

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // Disabling heavy animations for buttery smooth 120Hz feel
    plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } }
  };

  if(myChartInstances[1]) myChartInstances[1].destroy();
  myChartInstances[1] = new Chart(document.getElementById('chart1').getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Gap (m)', data: gaps, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.3, fill: true }] },
    options: commonOptions
  });

  if(myChartInstances[2]) myChartInstances[2].destroy();
  let dayMap = {};
  activeLogs.forEach(l => {
    let d = new Date(l.timestamp).toLocaleDateString();
    dayMap[d] = (dayMap[d] || 0) + 1;
  });
  let dayLabels = Object.keys(dayMap);
  let dayCounts = Object.values(dayMap);
  if(dayLabels.length === 0) { dayLabels = ['Today']; dayCounts = [0]; }

  myChartInstances[2] = new Chart(document.getElementById('chart2').getContext('2d'), {
    type: 'bar',
    data: { 
      labels: dayLabels, 
      datasets: [
        { label: 'Count', data: dayCounts, backgroundColor: '#F59E0B', borderRadius: 6 },
        { label: 'Limit', data: dayLabels.map(() => settings.dailyLimit), type: 'line', borderColor: '#EF4444', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }
      ] 
    },
    options: commonOptions
  });

  if(myChartInstances[3]) myChartInstances[3].destroy();
  let cumulativeSpend = 0;
  let spendData = gaps.map(() => {
    cumulativeSpend += (settings.packPrice / settings.packSize);
    return cumulativeSpend.toFixed(1);
  });
  myChartInstances[3] = new Chart(document.getElementById('chart3').getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Spend', data: spendData, borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.2)', fill: true, tension: 0.4 }] },
    options: commonOptions
  });

  if(myChartInstances[4]) myChartInstances[4].destroy();
  let hours = Array(24).fill(0);
  activeLogs.forEach(l => hours[new Date(l.timestamp).getHours()]++);
  myChartInstances[4] = new Chart(document.getElementById('chart4').getContext('2d'), {
    type: 'line',
    data: { labels: Array.from({length:24}, (_,i)=>i+':00'), datasets: [{ data: hours, borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, tension: 0.4 }] },
    options: commonOptions
  });

  if(myChartInstances[5]) myChartInstances[5].destroy();
  myChartInstances[5] = new Chart(document.getElementById('chart5').getContext('2d'), {
    type: 'doughnut',
    data: { labels: triggers, datasets: [{ data: triggers.map(t => activeLogs.filter(l => l.trigger === t).length), backgroundColor: ['#F59E0B','#10B981','#6366F1','#EF4444','#3B82F6','#A855F7'] }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 }, color: '#9CA3AF' } } } }
  });

  renderHeatMap('mapContainer', activeLogs);
}

function renderHeatMap(containerId, activeLogs) {
  const mapEl = document.getElementById(containerId);
  if(!mapEl) return;
  if(containerId === 'mapContainer' && mapInstance) { mapInstance.remove(); mapInstance = null; }
  if(containerId === 'mapModalContainer' && modalMapInstance) { modalMapInstance.remove(); modalMapInstance = null; }

  let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng);
  let lat = lastWithLoc ? lastWithLoc.lat : (cachedCoords ? cachedCoords.lat : 25.2048);
  let lng = lastWithLoc ? lastWithLoc.lng : (cachedCoords ? cachedCoords.lng : 55.2708);

  try {
    let m = L.map(containerId, {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19}).addTo(m);
    
    // Fixed zoom-out scaling by adjusting radius and minOpacity so dots never fade away
    let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng, 1.0]);
    if(heatPoints.length > 0 && window.L.heatLayer) {
      L.heatLayer(heatPoints, {radius: 35, blur: 20, maxZoom: 18, minOpacity: 0.4}).addTo(m);
    } else {
      L.marker([lat, lng]).addTo(m);
    }

    if(containerId === 'mapContainer') mapInstance = m;
    if(containerId === 'mapModalContainer') modalMapInstance = m;
    setTimeout(() => { m.invalidateSize(); }, 250);
  } catch(e) {}
}

function openMapModal() {
  document.getElementById('mapModal').classList.remove('hidden');
  setTimeout(() => { renderHeatMap('mapModalContainer', getFilteredLogs()); }, 200);
}
function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  if(modalMapInstance) { modalMapInstance.remove(); modalMapInstance = null; }
}

// Drag and Drop Logic with Persistent LocalStorage Saving
function initDragAndDrop() {
  const container = document.getElementById('chartContainer');
  let draggedCard = null;

  container.addEventListener('dragstart', (e) => {
    draggedCard = e.target.closest('.draggable-card');
    if(draggedCard) draggedCard.classList.add('dragging');
  });

  container.addEventListener('dragend', (e) => {
    const card = e.target.closest('.draggable-card');
    if(card) card.classList.remove('dragging');
    saveChartOrder();
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(container, e.clientY);
    const draggable = document.querySelector('.dragging');
    if(draggable) {
      if(afterElement == null) {
        container.appendChild(draggable);
      } else {
        container.insertBefore(draggable, afterElement);
      }
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.draggable-card:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if(offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function saveChartOrder() {
  const container = document.getElementById('chartContainer');
  const cards = [...container.querySelectorAll('.draggable-card')];
  const order = cards.map(c => c.id);
  localStorage.setItem('smoke_chart_order', JSON.stringify(order));
}

function loadChartOrder() {
  const savedOrder = JSON.parse(localStorage.getItem('smoke_chart_order'));
  if(!savedOrder) return;
  const container = document.getElementById('chartContainer');
  savedOrder.forEach(id => {
    const card = document.getElementById(id);
    if(card) container.appendChild(card);
  });
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
