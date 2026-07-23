let logs = JSON.parse(localStorage.getItem('smoke_logs')) || [];
// BUG FIX: merge saved settings on top of defaults instead of replacing them wholesale.
// Old behaviour meant any user whose saved data pre-dated a new field (e.g. "currency")
// ended up with `settings.currency === undefined`, which printed "undefined 12.5" on the UI.
const DEFAULT_SETTINGS = { theme: 'default', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED' };
let settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('smoke_settings')) || {});
// Guard against a 0/blank pack size ever being saved -> avoids Infinity/NaN spend calculations.
if (!settings.packSize || settings.packSize <= 0) settings.packSize = 20;
let triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || ['💼 Work Stress', '🍽️ After Meal', '☕ Chai / Coffee', '🚗 Driving', '📱 Boredom', '👥 Social'];
let shields = parseInt(localStorage.getItem('smoke_shields')) || 0;
let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let appPin = localStorage.getItem('smoke_pin');
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;

Chart.defaults.color = '#64748B';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';

const crosshairPlugin = {
  id: 'crosshair',
  afterDraw: chart => {
    if (chart.tooltip?._active?.length && (chart.config.type === 'line' || chart.config.type === 'bar')) {
      const activePoint = chart.tooltip._active[0];
      const ctx = chart.ctx;
      const x = activePoint.element.x;
      const topY = chart.scales.y.top;
      const bottomY = chart.scales.y.bottom;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }
};

const centerTextPlugin = {
  id: 'centerText',
  beforeDraw: chart => {
    if (chart.config.type === 'doughnut') {
      const ctx = chart.ctx;
      const width = chart.width;
      const height = chart.height;
      ctx.restore();
      const total = chart.data.datasets[0].data.reduce((a,b)=>a+b, 0);
      const text = total > 0 ? total + " Logs" : "No Data";
      ctx.font = "bold 16px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#F3F4F6";
      const textX = Math.round((width - ctx.measureText(text).width) / 2);
      const textY = height / 2;
      ctx.fillText(text, textX, textY);
      ctx.save();
    }
  }
};

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
  
  if(navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      saveLog(p.coords.latitude, p.coords.longitude);
    }, () => {
      saveLog(null, null);
    }, {timeout: 5000, maximumAge: 0, enableHighAccuracy: true});
  } else {
    saveLog(null, null);
  }
}

function saveLog(lat, lng) {
  const now = new Date().getTime();
  // BUG FIX: the very first cigarette ever logged has no previous entry to measure a gap
  // against. It used to be stored as gap: 0, which then quietly counted as a real
  // "0-minute gap" in every average / best-gap / chart calculation below. Storing it as
  // null keeps it out of those calculations while still being safe to display.
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : null;
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
  if (settings.packSize <= 0) settings.packSize = 20;
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
  const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined);
  document.getElementById('bestGapCard').innerText = todayGaps.length > 0 ? formatGap(Math.max(...todayGaps)) : '--';
  renderHistory('homeRecentLogs', 3);
}

function formatGap(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

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
    csvContent += `${l.timestamp},"${d.toLocaleDateString()}","${d.toLocaleTimeString()}",${l.gap ?? ''},"${l.trigger||''}",${l.lat||''},${l.lng||''}\n`;
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

function setBadge(id, text, colorClass) {
  const b = document.getElementById(id);
  if(b) {
    if(text) {
      b.innerText = text;
      b.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${colorClass}`;
      b.classList.remove('hidden');
    } else {
      b.classList.add('hidden');
    }
  }
}

// 🔥 EXPERT FIX: STRICT FILTER-BASED YEARLY PROJECTION MATH 🔥
function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  const filter = document.getElementById('insightsDateFilter').value;
  
  let totalSpend = (activeLogs.length * (settings.packPrice/settings.packSize)).toFixed(1);
  const gappedLogs = activeLogs.filter(l => l.gap !== null && l.gap !== undefined);
  let avgGapVal = gappedLogs.length > 0 ? Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length) : 0;
  
  document.getElementById('insightAvgGap').innerText = gappedLogs.length > 0 ? formatGap(avgGapVal) : '--';
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

  // NEW: directly surfaces which specific day was the heaviest, instead of making
  // the user eyeball the Daily Volume bars to figure it out themselves.
  const heaviestDayEl = document.getElementById('insightHeaviestDay');
  if (heaviestDayEl) {
    if (activeLogs.length > 0) {
      let perDay = {};
      activeLogs.forEach(l => { const k = new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}); perDay[k] = (perDay[k]||0)+1; });
      let topDay = Object.keys(perDay).reduce((a,b) => perDay[a] > perDay[b] ? a : b);
      heaviestDayEl.innerText = `${topDay} (${perDay[topDay]})`;
    } else {
      heaviestDayEl.innerText = '--';
    }
  }

  // FIX: use the ACTUAL number of days the data covers (capped to the window),
  // not a fixed 7 or 30 — a new user with only 4 days of history selecting
  // "1 Month" was having their real 4-day total silently divided by 30, which
  // crushed the projection (this was the AED 140 vs AED 30 mismatch reported).
  if(activeLogs.length > 0) {
    const now = new Date().getTime();
    let yearlyMultiplier;
    if(filter === 'today') {
      yearlyMultiplier = 365; // Today's burn rate * 365 days
    } else if(filter === '7days' || filter === '1month') {
      const windowDays = filter === '7days' ? 7 : 30;
      const oldestInRange = Math.min(...activeLogs.map(l => l.timestamp));
      const daysActive = Math.min(windowDays, Math.max(1, Math.ceil((now - oldestInRange) / 86400000)));
      yearlyMultiplier = 365 / daysActive;
    } else {
      let oldestLogTime = Math.min(...logs.map(l => l.timestamp));
      let totalDaysActive = Math.max(1, Math.ceil((now - oldestLogTime) / 86400000));
      yearlyMultiplier = 365 / totalDaysActive;
    }
    let yearly = (totalSpend * yearlyMultiplier).toFixed(0);
    document.getElementById('insightProjected').innerText = `${settings.currency} ${yearly}`;
  } else {
    document.getElementById('insightProjected').innerText = '--';
  }

  setBadge('badge-chart1', gappedLogs.length > 0 ? `Avg ${formatGap(avgGapVal)}` : '', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20');
  setBadge('badge-chart2', activeLogs.length > 0 ? `${activeLogs.length} Total` : '', 'bg-amber-500/10 text-amber-500 border-amber-500/20');
  setBadge('badge-chart3', activeLogs.length > 0 ? `${settings.currency} ${totalSpend}` : '', 'bg-red-500/10 text-red-500 border-red-500/20');

  const labels = activeLogs.length > 0 ? activeLogs.map(l => new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})) : ['No Data'];
  const gaps = activeLogs.length > 0 ? activeLogs.map(l => l.gap) : [0];
  const chartTextColor = settings.theme === 'white' ? '#64748B' : '#9CA3AF';

  const proOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { left: -5, right: 5, top: 10, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)', titleColor: '#FFFFFF', bodyColor: '#10B981', padding: 12, cornerRadius: 12, displayColors: false }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, maxTicksLimit: 4 } },
      y: { beginAtZero: true, grid: { color: 'rgba(156, 163, 175, 0.05)', drawBorder: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, padding: 6 } }
    }
  };

  const createGradient = (ctx, colorHex) => {
    let gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, colorHex);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    return gradient;
  };

  // PERF FIX: reuse existing Chart.js instances instead of destroying and
  // rebuilding all 6 charts from scratch on every filter change, settings
  // tweak, or tab switch. Only rebuilds when the chart type actually changes.
  function upsertChart(key, ctx, config) {
    const existing = myChartInstances[key];
    if (existing && existing.config.type === config.type) {
      existing.data = config.data;
      if (config.options) existing.options = config.options;
      existing.update();
    } else {
      if (existing) existing.destroy();
      myChartInstances[key] = new Chart(ctx, config);
    }
  }

  const ctx1 = document.getElementById('chart1').getContext('2d');
  upsertChart(1, ctx1, {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Gap (mins)', data: gaps, borderColor: '#10B981', backgroundColor: createGradient(ctx1, 'rgba(16, 185, 129, 0.25)'), borderWidth: 3, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 15 }] },
    options: proOptions,
    plugins: [crosshairPlugin]
  });

  // BUG FIX: group by actual calendar date, not just weekday name. Grouping by weekday
  // name alone (e.g. "Mon") silently merged every Monday together once data spanned
  // more than a week, badly inflating the 1-Month/All-Time bars.
  let dayMap = {};
  activeLogs.forEach(l => {
    const dt = new Date(l.timestamp);
    let d = filter === '7days' ? dt.toLocaleDateString([], {weekday:'short'}) : dt.toLocaleDateString([], {month:'short', day:'numeric'});
    dayMap[d] = (dayMap[d] || 0) + 1;
  });
  let dayLabels = Object.keys(dayMap); let dayCounts = Object.values(dayMap);
  if(dayLabels.length === 0) { dayLabels = ['Today']; dayCounts = [0]; }

  const ctx2 = document.getElementById('chart2').getContext('2d');
  upsertChart(2, ctx2, {
    type: 'bar',
    data: { 
      labels: dayLabels, 
      datasets: [
        { label: 'Count', data: dayCounts, backgroundColor: settings.theme === 'white' ? '#2563EB' : '#F59E0B', borderRadius: Number.MAX_VALUE, borderSkipped: false, barThickness: 16 },
        { label: 'Limit', data: dayLabels.map(() => settings.dailyLimit), type: 'line', borderColor: '#EF4444', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }
      ] 
    },
    options: proOptions,
    plugins: [crosshairPlugin]
  });

  let cumulativeSpend = 0; let spendData = gaps.map(() => { cumulativeSpend += (settings.packPrice / settings.packSize); return cumulativeSpend.toFixed(1); });
  const ctx3 = document.getElementById('chart3').getContext('2d');
  upsertChart(3, ctx3, {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Spend', data: spendData, borderColor: '#EF4444', backgroundColor: createGradient(ctx3, 'rgba(239, 68, 68, 0.2)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHitRadius: 15 }] },
    options: proOptions,
    plugins: [crosshairPlugin]
  });

  let hours = Array(24).fill(0); activeLogs.forEach(l => hours[new Date(l.timestamp).getHours()]++);
  const ctx4 = document.getElementById('chart4').getContext('2d');
  upsertChart(4, ctx4, {
    type: 'line',
    data: { labels: Array.from({length:24}, (_,i)=>i+':00'), datasets: [{ data: hours, borderColor: '#F97316', backgroundColor: createGradient(ctx4, 'rgba(249, 115, 22, 0.2)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHitRadius: 15 }] },
    options: proOptions,
    plugins: [crosshairPlugin]
  });

  const ctx5 = document.getElementById('chart5').getContext('2d');
  upsertChart(5, ctx5, {
    type: 'doughnut',
    data: { labels: triggers, datasets: [{ data: triggers.map(t => activeLogs.filter(l => l.trigger === t).length), backgroundColor: ['#F59E0B','#10B981','#6366F1','#EF4444','#2563EB','#A855F7'], borderWidth: 0, cutout: '76%' }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: chartTextColor } } } },
    plugins: [centerTextPlugin]
  });

  // NEW: "Trigger Timing" — stacked bar of WHICH trigger fires during WHICH part of
  // the day. This is the concept the app is actually for: not pressuring anyone to
  // quit, just showing them their own pattern (e.g. "Work Stress mostly hits you at
  // 3-5pm", "Boredom is a Night thing for you") so they can see it clearly.
  const dayParts = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const partOf = (hr) => hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 21 ? 2 : 3;
  let triggerByPart = {}; triggers.forEach(t => triggerByPart[t] = [0, 0, 0, 0]);
  activeLogs.forEach(l => { if (l.trigger && triggerByPart[l.trigger]) triggerByPart[l.trigger][partOf(new Date(l.timestamp).getHours())]++; });
  const palette = ['#F59E0B', '#10B981', '#6366F1', '#EF4444', '#2563EB', '#A855F7'];
  const chart6El = document.getElementById('chart6');
  if (chart6El) {
    const ctx6 = chart6El.getContext('2d');
    upsertChart(6, ctx6, {
      type: 'bar',
      data: { labels: dayParts, datasets: triggers.map((t, i) => ({ label: t, data: triggerByPart[t], backgroundColor: palette[i % palette.length], borderRadius: 4, stack: 'triggers' })) },
      options: {
        ...proOptions,
        scales: {
          x: { ...proOptions.scales.x, stacked: true },
          y: { ...proOptions.scales.y, stacked: true, ticks: { ...proOptions.scales.y.ticks, precision: 0 } }
        },
        plugins: { ...proOptions.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { size: 9 }, color: chartTextColor } } }
      }
    });
  }

  renderHeatMap('mapContainer', activeLogs);
}

function renderHeatMap(containerId, activeLogs) {
  const mapEl = document.getElementById(containerId);
  if(!mapEl) return;

  let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng);
  let lat = lastWithLoc ? lastWithLoc.lat : 25.2048;
  let lng = lastWithLoc ? lastWithLoc.lng : 55.2708;
  let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng, 1.0]);

  const isModal = containerId === 'mapModalContainer';
  let m = isModal ? modalMapInstance : mapInstance;
  // Only tear down and recreate (which re-downloads map tiles) if there's no map yet
  // for this container, or the theme changed and the tile layer needs to switch.
  const needsRebuild = !m || m._smokegapTheme !== settings.theme;

  try {
    if (needsRebuild) {
      if (m) { try { m.remove(); } catch(e) {} }
      m = L.map(containerId, {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
      let tileUrl = settings.theme === 'white' ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      L.tileLayer(tileUrl, {maxZoom: 19}).addTo(m);
      m._smokegapTheme = settings.theme;
      if (isModal) modalMapInstance = m; else mapInstance = m;
      setTimeout(() => { m.invalidateSize(); }, 250);
    } else {
      m.setView([lat, lng], m.getZoom());
      setTimeout(() => { m.invalidateSize(); }, 50);
    }

    if (m._smokegapHeat) { m.removeLayer(m._smokegapHeat); m._smokegapHeat = null; }
    if (m._smokegapMarker) { m.removeLayer(m._smokegapMarker); m._smokegapMarker = null; }
    if(heatPoints.length > 0 && window.L.heatLayer) {
      m._smokegapHeat = L.heatLayer(heatPoints, {radius: 28, blur: 18, maxZoom: 17, minOpacity: 0.4}).addTo(m);
    } else {
      m._smokegapMarker = L.marker([lat, lng]).addTo(m);
    }
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
