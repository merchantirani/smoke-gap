let logs = JSON.parse(localStorage.getItem('smoke_logs')) || [];
let settings = JSON.parse(localStorage.getItem('smoke_settings')) || { theme: 'default', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED' };
let triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || ['💼 Work Stress', '🍽️ After Meal', '☕ Chai / Coffee', '🚗 Driving', '📱 Boredom', '👥 Social'];
let shields = parseInt(localStorage.getItem('smoke_shields')) || 0;
let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let appPin = localStorage.getItem('smoke_pin');
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;
let cachedCoords = JSON.parse(localStorage.getItem('smoke_last_coords')) || null;

Chart.defaults.color = '#64748B';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';

window.onload = () => {
  applyTheme(settings.theme);
  document.getElementById('dailyLimitInput').value = settings.dailyLimit;
  document.getElementById('packPriceInput').value = settings.packPrice;
  document.getElementById('packSizeInput').value = settings.packSize;
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('currencySelect').value = settings.currency || 'AED';
  
  loadChartOrder();
  initDragAndDrop();
  renderTriggerSettingsList();
  if(window.lucide) window.lucide.createIcons();

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
  if(enteredPin.length < 4) { enteredPin += n; document.querySelectorAll('.pin-dot').forEach((el, i) => el.classList.toggle('bg-gray-400', i < enteredPin.length)); }
  if(enteredPin.length === 4) {
    setTimeout(() => {
      if(enteredPin === appPin) { document.getElementById('lockScreen').classList.add('hidden'); bootCore(); } 
      else { alert("Wrong PIN"); clearPin(); }
    }, 200);
  }
}
function clearPin() { enteredPin = ""; document.querySelectorAll('.pin-dot').forEach(el => el.classList.remove('bg-gray-400')); }
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
    btn.disabled=true; btn.style.opacity = '0.5';
    if(cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      let rem = Math.ceil((lockEndTime - new Date().getTime())/1000);
      if(rem<=0) { clearInterval(cooldownTimer); btn.disabled=false; btn.style.opacity = '1'; btn.innerText='START SMOKING'; }
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
  if(settings.haptics && navigator.vibrate) navigator.vibrate(20);
  ['tracker','insights','history','settings'].forEach(x => { 
    let p = document.getElementById(`page-${x}`);
    let tab = document.getElementById(`tab-${x}`);
    if(p) p.classList.add('hidden'); 
    if(tab) tab.classList.remove('nav-active'); 
  });
  let cp = document.getElementById(`page-${t}`);
  let ct = document.getElementById(`tab-${t}`);
  if(cp) cp.classList.remove('hidden'); 
  if(ct) ct.classList.add('nav-active');
  if(t==='history') renderHistory();
  if(t==='insights') { requestAnimationFrame(() => renderAllCharts()); }
  if(window.lucide) window.lucide.createIcons();
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
  if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
}

function updateUI() {
  document.getElementById('shieldCount').innerText = shields;
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  
  document.getElementById('todayCount').innerText = `${today.length} / ${settings.dailyLimit}`;
  let spendRaw = (today.length * (settings.packPrice/settings.packSize)).toFixed(1);
  document.getElementById('todaySpend').innerText = `${settings.currency} ${spendRaw}`;
  document.getElementById('prevGapCard').innerText = logs.length > 1 ? formatGap(logs[logs.length-1].gap) : '--';
  document.getElementById('bestGapCard').innerText = today.length > 0 ? formatGap(Math.max(...today.map(l=>l.gap))) : '--';
  
  renderHistory('homeRecentLogs', 3);
}

function formatGap(m) { return m<60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60>0?m%60+'m':''}`; }

function resetData(type) { 
  if(type === '24h') {
    if(confirm("Delete logs from the last 24 hours?")) {
      const now = new Date().getTime();
      logs = logs.filter(l => (now - l.timestamp) > 86400000);
      localStorage.setItem('smoke_logs', JSON.stringify(logs));
      location.reload();
    }
  } else {
    if(confirm("Wipe ALL data? This action cannot be undone.")) { 
      localStorage.clear(); 
      location.reload(); 
    } 
  }
}

function exportLogsCSV() {
  if(logs.length === 0) { alert("No logs to export!"); return; }
  let csvContent = "data:text/csv;charset=utf-8,Timestamp,Date,Time,Gap_Minutes,Trigger,Latitude,Longitude\n";
  logs.forEach(l => {
    let d = new Date(l.timestamp);
    csvContent += `${l.timestamp},"${d.toLocaleDateString()}","${d.toLocaleTimeString()}",${l.gap},"${l.trigger||''}",${l.lat||''},${l.lng||''}\n`;
  });
  let encodedUri = encodeURI(csvContent);
  let link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `SmokeGap_Logs_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function addCustomTrigger() {
  let val = document.getElementById('newTriggerInput').value.trim();
  if(val && !triggers.includes(val)) {
    triggers.push(val);
    localStorage.setItem('smoke_triggers', JSON.stringify(triggers));
    document.getElementById('newTriggerInput').value = '';
    renderTriggerSettingsList();
  }
}

function removeCustomTrigger(idx) {
  triggers.splice(idx, 1);
  localStorage.setItem('smoke_triggers', JSON.stringify(triggers));
  renderTriggerSettingsList();
}

function renderTriggerSettingsList() {
  const c = document.getElementById('triggerListSettings');
  if(!c) return;
  c.innerHTML = triggers.map((t, idx) => `
    <span class="bg-gray-500/10 text-xs px-3 py-1.5 rounded-xl border border-gray-500/20 flex items-center gap-1.5 font-medium" style="color: var(--text-main);">
      ${t} <button onclick="window.removeCustomTrigger(${idx})" class="text-red-500 font-bold hover:opacity-80">✕</button>
    </span>
  `).join('');
}

function openTriggerModal() { document.getElementById('modalTriggerGrid').innerHTML=triggers.map(t=>`<button onclick="window.assignTag('${t}')" class="py-4 px-2 bg-gray-500/10 rounded-xl text-center active:scale-95 transition-transform" style="color: var(--text-main);">${t}</button>`).join(''); document.getElementById('triggerModal').classList.remove('hidden'); }
function assignTag(tag) { if(logs.length>0) { logs[logs.length-1].trigger=tag; localStorage.setItem('smoke_logs', JSON.stringify(logs)); renderHistory('homeRecentLogs',3); } closeTriggerModal(); }
function closeTriggerModal() { document.getElementById('triggerModal').classList.add('hidden'); }

function renderHistory(tId='fullHistoryList', limit=null) {
  const c = document.getElementById(tId); if(!c) return;
  if(logs.length===0) { c.innerHTML="<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='inbox' class='w-6 h-6 opacity-50'></i> No logs recorded yet.</p>"; if(window.lucide) window.lucide.createIcons(); return; }
  let items = logs.slice().reverse(); if(limit) items = items.slice(0,limit);
  c.innerHTML = items.map(l => `
    <div class="premium-card p-4 flex justify-between items-center relative overflow-hidden">
      <div class="absolute left-0 top-0 bottom-0 w-1" style="background: var(--accent);"></div>
      <div>
        <div class="font-bold tracking-wide" style="color: var(--text-main);">${new Date(l.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="text-[10px] font-bold uppercase mt-0.5 flex items-center gap-1" style="color: var(--text-muted);"><i data-lucide="tag" class="w-3 h-3"></i> ${l.trigger||'Uncategorized'}</div>
      </div>
      <div class="font-bold text-base" style="color: var(--accent);">${formatGap(l.gap)}</div>
    </div>
  `).join('');
  if(window.lucide) window.lucide.createIcons();
}

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter').value;
  const now = new Date();
  
  if(filter === 'today') {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return logs.filter(l => l.timestamp >= startOfToday);
  } else if(filter === '7days') {
    const sevenDaysAgo = new Date(now.getTime() - (7 * 86400000)).getTime();
    return logs.filter(l => l.timestamp >= sevenDaysAgo);
  } else if(filter === '1month') {
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 86400000)).getTime();
    return logs.filter(l => l.timestamp >= thirtyDaysAgo);
  }
  return logs;
}

// PRO ADVANCED CHARTS ENGINE
function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  
  // 1. Dynamic Top Summary Cards
  let totalSpend = (activeLogs.length * (settings.packPrice/settings.packSize)).toFixed(1);
  document.getElementById('insightAvgGap').innerText = activeLogs.length > 0 ? formatGap(Math.round(activeLogs.reduce((a, b) => a + b.gap, 0) / activeLogs.length)) : '--';
  document.getElementById('insightShields').innerText = `${shields} Defeats`;

  if(activeLogs.length > 0) {
    let hours = {}; activeLogs.forEach(l => { let h = new Date(l.timestamp).getHours(); hours[h] = (hours[h]||0)+1; });
    let peak = Object.keys(hours).reduce((a,b) => hours[a] > hours[b] ? a : b);
    document.getElementById('insightPeakHour').innerText = `${peak}:00`;
  } else document.getElementById('insightPeakHour').innerText = '--';

  if(activeLogs.length > 0) {
    let trigs = {}; activeLogs.forEach(l => { let t = l.trigger||'Uncategorized'; trigs[t] = (trigs[t]||0)+1; });
    let topT = Object.keys(trigs).reduce((a,b) => trigs[a] > trigs[b] ? a : b);
    document.getElementById('insightTopTrigger').innerText = topT.length > 15 ? topT.substring(0,12)+'..' : topT;
  } else document.getElementById('insightTopTrigger').innerText = '--';

  document.getElementById('insightPackEq').innerText = activeLogs.length > 0 ? `${(activeLogs.length / settings.packSize).toFixed(1)} Packs` : '--';

  if(activeLogs.length > 0) {
    let filter = document.getElementById('insightsDateFilter').value;
    let days = filter === 'today' ? 1 : filter === '7days' ? 7 : filter === '1month' ? 30 : Math.max(1, Math.ceil((new Date() - new Date(logs[0].timestamp))/86400000));
    let yearly = ((totalSpend / days) * 365).toFixed(0);
    document.getElementById('insightProjected').innerText = `${settings.currency} ${yearly}`;
  } else document.getElementById('insightProjected').innerText = '--';

  // 2. Advanced Pro Canvas Charts Configuration
  const labels = activeLogs.length > 0 ? activeLogs.map(l => new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})) : ['No Data'];
  const gaps = activeLogs.length > 0 ? activeLogs.map(l => l.gap) : [0];
  const chartTextColor = settings.theme === 'white' ? '#64748B' : '#9CA3AF';

  // Base options for 100% Left Flush Layout (No margins/padding glitches)
  const proOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { left: -5, right: 5, top: 10, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#FFFFFF',
        bodyColor: '#10B981',
        padding: 12,
        cornerRadius: 12,
        displayColors: false
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, maxTicksLimit: 4 }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(156, 163, 175, 0.05)', drawBorder: false },
        ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, padding: 6 }
      }
    }
  };

  // Helper function to create Apple-like Glow Gradients
  const createGradient = (ctx, colorHex) => {
    let gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, colorHex);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    return gradient;
  };

  // 1. Gap Trend Line Chart
  if(myChartInstances[1]) myChartInstances[1].destroy();
  const ctx1 = document.getElementById('chart1').getContext('2d');
  myChartInstances[1] = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Gap (mins)',
        data: gaps,
        borderColor: '#10B981',
        backgroundColor: createGradient(ctx1, 'rgba(16, 185, 129, 0.25)'),
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHitRadius: 15
      }]
    },
    options: proOptions
  });

  // 2. Daily Volume Bar Chart
  if(myChartInstances[2]) myChartInstances[2].destroy();
  let dayMap = {}; activeLogs.forEach(l => { let d = new Date(l.timestamp).toLocaleDateString([],{weekday:'short'}); dayMap[d] = (dayMap[d] || 0) + 1; });
  let dayLabels = Object.keys(dayMap); let dayCounts = Object.values(dayMap);
  if(dayLabels.length === 0) { dayLabels = ['Today']; dayCounts = [0]; }

  const ctx2 = document.getElementById('chart2').getContext('2d');
  myChartInstances[2] = new Chart(ctx2, {
    type: 'bar',
    data: { 
      labels: dayLabels, 
      datasets: [
        { label: 'Count', data: dayCounts, backgroundColor: settings.theme === 'white' ? '#2563EB' : '#F59E0B', borderRadius: 6, barThickness: 18 },
        { label: 'Limit', data: dayLabels.map(() => settings.dailyLimit), type: 'line', borderColor: '#EF4444', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }
      ] 
    },
    options: proOptions
  });

  // 3. Financial Drain Line Chart
  if(myChartInstances[3]) myChartInstances[3].destroy();
  let cumulativeSpend = 0; let spendData = gaps.map(() => { cumulativeSpend += (settings.packPrice / settings.packSize); return cumulativeSpend.toFixed(1); });
  const ctx3 = document.getElementById('chart3').getContext('2d');
  myChartInstances[3] = new Chart(ctx3, {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Spend', data: spendData, borderColor: '#EF4444', backgroundColor: createGradient(ctx3, 'rgba(239, 68, 68, 0.2)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0 }] },
    options: proOptions
  });

  // 4. Danger Matrix Hours Chart
  if(myChartInstances[4]) myChartInstances[4].destroy();
  let hours = Array(24).fill(0); activeLogs.forEach(l => hours[new Date(l.timestamp).getHours()]++);
  const ctx4 = document.getElementById('chart4').getContext('2d');
  myChartInstances[4] = new Chart(ctx4, {
    type: 'line',
    data: { labels: Array.from({length:24}, (_,i)=>i+':00'), datasets: [{ data: hours, borderColor: '#F97316', backgroundColor: createGradient(ctx4, 'rgba(249, 115, 22, 0.2)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0 }] },
    options: proOptions
  });

  // 5. Trigger Doughnut Chart
  if(myChartInstances[5]) myChartInstances[5].destroy();
  myChartInstances[5] = new Chart(document.getElementById('chart5').getContext('2d'), {
    type: 'doughnut',
    data: { labels: triggers, datasets: [{ data: triggers.map(t => activeLogs.filter(l => l.trigger === t).length), backgroundColor: ['#F59E0B','#10B981','#6366F1','#EF4444','#2563EB','#A855F7'], borderWidth: 0, cutout: '72%' }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: chartTextColor } } } }
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
    let tileUrl = settings.theme === 'white' ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    L.tileLayer(tileUrl, {maxZoom: 19}).addTo(m);
    
    let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng, 1.0]);
    if(heatPoints.length > 0 && window.L.heatLayer) {
      L.heatLayer(heatPoints, {radius: 28, blur: 18, maxZoom: 17, minOpacity: 0.4}).addTo(m);
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

function initDragAndDrop() {
  const container = document.getElementById('chartContainer');
  if(!container || !window.Sortable) return;
  new Sortable(container, { handle: '.drag-handle', animation: 200, ghostClass: 'sortable-ghost', onEnd: function () { saveChartOrder(); } });
}

function saveChartOrder() {
  const container = document.getElementById('chartContainer');
  const cards = [...container.children];
  const order = cards.map(c => c.id);
  localStorage.setItem('smoke_chart_order', JSON.stringify(order));
}

function loadChartOrder() {
  const savedOrder = JSON.parse(localStorage.getItem('smoke_chart_order'));
  if(!savedOrder) return;
  const container = document.getElementById('chartContainer');
  savedOrder.forEach(id => { const card = document.getElementById(id); if(card) container.appendChild(card); });
}

window.enterPin = enterPin; window.clearPin = clearPin; window.setupPin = setupPin;
window.handleLogClick = handleLogClick; window.toggleWaveMode = toggleWaveMode; window.switchTab = switchTab;
window.updateSettings = updateSettings; window.resetData = resetData; window.assignTag = assignTag;
window.closeTriggerModal = closeTriggerModal; window.renderAllCharts = renderAllCharts;
window.openMapModal = openMapModal; window.closeMapModal = closeMapModal;
window.exportLogsCSV = exportLogsCSV; window.addCustomTrigger = addCustomTrigger; window.removeCustomTrigger = removeCustomTrigger;
