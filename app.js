let logs = JSON.parse(localStorage.getItem('smoke_logs')) || [];
const DEFAULT_SETTINGS = { theme: 'default', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED', timeFormat: '12h' };
let settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('smoke_settings')) || {});
if (!settings.packSize || settings.packSize <= 0) settings.packSize = 20;
if (!settings.timeFormat) settings.timeFormat = '12h';
let triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || ['💼 Work Stress', '🍽️ After Meal', '☕ Chai / Coffee', '🚗 Driving', '📱 Boredom', '👥 Social'];
let shields = parseInt(localStorage.getItem('smoke_shields')) || 0;
let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;

let storedPin = localStorage.getItem('smoke_pin');
let appPin = storedPin ? atob(storedPin) : null;
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;
let editingLogIdx = null;
let currentSelectedTags = [];

Chart.defaults.color = '#64748B';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';

const crosshairPlugin = { id: 'crosshair', afterDraw: chart => { if (chart.tooltip?._active?.length && (chart.config.type === 'line' || chart.config.type === 'bar')) { const activePoint = chart.tooltip._active[0]; const ctx = chart.ctx; const x = activePoint.element.x; ctx.save(); ctx.beginPath(); ctx.moveTo(x, chart.scales.y.top); ctx.lineTo(x, chart.scales.y.bottom); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.restore(); } } };

// FIX: Dynamic color for center text based on theme
const centerTextPlugin = { id: 'centerText', beforeDraw: chart => { if (chart.config.type === 'doughnut') { const ctx = chart.ctx; ctx.restore(); const total = chart.data.datasets[0].data.reduce((a,b)=>a+b, 0); const text = total > 0 ? total + " Logs" : "No Data"; ctx.font = "bold 16px sans-serif"; ctx.textBaseline = "middle"; ctx.fillStyle = document.body.classList.contains('theme-white') ? "#64748B" : "#F3F4F6"; ctx.fillText(text, Math.round((chart.width - ctx.measureText(text).width) / 2), chart.height / 2); ctx.save(); } } };

function formatAppTime(dateObj) {
  return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' });
}

window.onload = () => {
  applyTheme(settings.theme);
  document.getElementById('dailyLimitInput').value = settings.dailyLimit;
  document.getElementById('packPriceInput').value = settings.packPrice;
  document.getElementById('packSizeInput').value = settings.packSize;
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('timeFormatSelect').value = settings.timeFormat;
  document.getElementById('currencySelect').value = settings.currency || 'AED';
  document.getElementById('lockSecsInput').value = settings.lockSecs;
  document.getElementById('hapticsInput').checked = settings.haptics;
  updateCostPerCigDisplay();
  
  loadChartOrder(); initDragAndDrop(); renderTriggerSettingsList();
  if(window.lucide) window.lucide.createIcons();

  if(appPin) { document.getElementById('lockScreen').classList.remove('hidden'); document.getElementById('pinStatusBtn').innerText = "Remove PIN"; } 
  else { bootCore(); }
};

function bootCore() {
  updateUI(); checkLock(); checkWave();
  if(mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    if(logs.length === 0 || document.getElementById('page-tracker').classList.contains('hidden')) return;
    const diff = new Date().getTime() - logs[logs.length-1].timestamp;
    
    document.getElementById('stopwatch').innerText = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
    
    const prevLog = logs[logs.length-1];
    const prevGapMs = prevLog.gap ? prevLog.gap * 60000 : 0;
    const circle = document.getElementById('heroProgressCircle');
    const statusWrapper = document.getElementById('smartStatusWrapper');
    const statusText = document.getElementById('smartStatusText');
    const dashMax = 289.02;
    
    let newClass = '';
    let newHtml = '';
    
    if (prevGapMs > 0) {
      let percent = diff / prevGapMs;
      if (percent < 1) {
        circle.style.stroke = '#F59E0B'; circle.style.strokeDashoffset = dashMax - (dashMax * percent); circle.style.filter = 'none';
        let remMins = Math.ceil((prevGapMs - diff) / 60000);
        newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-amber-500/10 border-amber-500/20';
        newHtml = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-500"></i><span class="text-amber-500">${remMins} min${remMins>1?'s':''} left to beat previous gap</span>`;
      } else {
        circle.style.stroke = '#10B981'; circle.style.strokeDashoffset = 0; circle.style.filter = 'drop-shadow(0 0 8px rgba(16,185,129,0.5))';
        let extraMins = Math.floor((diff - prevGapMs) / 60000);
        newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]';
        newHtml = `<i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-500"></i><span class="text-emerald-500">Widened the gap by +${extraMins} min${extraMins!==1?'s':''}</span>`;
      }
    } else {
      circle.style.strokeDashoffset = 0; circle.style.stroke = 'var(--accent)'; circle.style.filter = 'none';
      newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-sky-500/10 border-sky-500/20';
      newHtml = `<i data-lucide="rocket" class="w-3.5 h-3.5 text-sky-500"></i><span class="text-sky-500">Setting your first baseline gap</span>`;
    }
    
    // FIX: Optimized blinking icon issue. DOM is updated only if text actually changed.
    if (statusText.dataset.rawHtml !== newHtml) {
      statusWrapper.className = newClass;
      statusText.innerHTML = newHtml;
      statusText.dataset.rawHtml = newHtml;
      if(window.lucide) window.lucide.createIcons();
    }
  }, 1000);
}

function enterPin(n) {
  if(enteredPin.length < 4) { 
    enteredPin += n; 
    document.querySelectorAll('.pin-dot').forEach((el, i) => {
      el.classList.toggle('bg-gray-400', i < enteredPin.length);
      el.classList.toggle('bg-gray-500', i >= enteredPin.length);
    }); 
  }
  if(enteredPin.length === 4) {
    setTimeout(() => {
      if(enteredPin === appPin) { document.getElementById('lockScreen').classList.add('hidden'); bootCore(); } 
      else { alert("Wrong PIN"); clearPin(); }
    }, 200);
  }
}
function clearPin() { enteredPin = ""; document.querySelectorAll('.pin-dot').forEach(el => { el.classList.remove('bg-gray-400'); el.classList.add('bg-gray-500'); }); }
function setupPin() {
  if(appPin) { 
    if(confirm("Remove PIN?")) { localStorage.removeItem('smoke_pin'); appPin=null; location.reload(); } 
  } else { 
    let p = prompt("New 4-digit PIN (e.g., 1234):"); 
    if(p && /^\d{4}$/.test(p)) { localStorage.setItem('smoke_pin', btoa(p)); appPin=p; alert("PIN Saved!"); location.reload(); }
    else if(p) { alert("Invalid format. Must be exactly 4 digits."); }
  }
}

function handleLogClick() {
  if(new Date().getTime() < lockEndTime) return;
  if(settings.haptics && navigator.vibrate) navigator.vibrate(50);
  if(waveEndTime>0) { localStorage.removeItem('smoke_wave_end'); waveEndTime=0; clearInterval(waveTimer); document.getElementById('waveOverlay').classList.add('hidden'); }
  
  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : null;
  
  logs.push({timestamp: now, gap: gap, tags: [], trigger: '', lat: null, lng: null});
  const newLogIdx = logs.length - 1;
  localStorage.setItem('smoke_logs', JSON.stringify(logs));
  lockEndTime = now + (settings.lockSecs * 1000);
  localStorage.setItem('smoke_lock_end', lockEndTime);
  updateUI(); checkLock(); openTriggerModal(newLogIdx);

  if(navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      if(logs[newLogIdx]) {
        logs[newLogIdx].lat = p.coords.latitude;
        logs[newLogIdx].lng = p.coords.longitude;
        localStorage.setItem('smoke_logs', JSON.stringify(logs));
        if(!document.getElementById('page-insights').classList.contains('hidden')) renderHeatMap('mapContainer', getFilteredLogs());
      }
    }, () => {}, {timeout: 10000, maximumAge: 60000});
  }
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
  ['tracker','insights','history','settings'].forEach(x => { document.getElementById(`page-${x}`)?.classList.add('hidden'); document.getElementById(`tab-${x}`)?.classList.remove('nav-active'); });
  document.getElementById(`page-${t}`)?.classList.remove('hidden'); document.getElementById(`tab-${t}`)?.classList.add('nav-active');
  if(t==='history') renderHistory();
  if(t==='insights') requestAnimationFrame(() => renderAllCharts());
  if(window.lucide) window.lucide.createIcons();
}

function applyTheme(t) { document.body.className = document.body.className.replace(/theme-\w+/g, '').trim(); if(t!=='default') document.body.classList.add(`theme-${t}`); }

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value;
  settings.timeFormat = document.getElementById('timeFormatSelect').value;
  settings.currency = document.getElementById('currencySelect').value;
  settings.dailyLimit = parseInt(document.getElementById('dailyLimitInput').value) || 15;
  settings.packPrice = parseFloat(document.getElementById('packPriceInput').value) || 20;
  settings.packSize = parseInt(document.getElementById('packSizeInput').value) || 20;
  settings.lockSecs = parseInt(document.getElementById('lockSecsInput').value) || 300;
  settings.haptics = document.getElementById('hapticsInput').checked;
  if (settings.packSize <= 0) settings.packSize = 20;
  localStorage.setItem('smoke_settings', JSON.stringify(settings)); 
  applyTheme(settings.theme); updateCostPerCigDisplay(); updateUI();
  if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  if(!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList');
}

function updateCostPerCigDisplay() { const el = document.getElementById('costPerCigDisplay'); if (el) el.innerText = `${settings.currency} ${(settings.packPrice / settings.packSize).toFixed(2)}`; }

function updateUI() {
  document.getElementById('shieldCount').innerText = shields;
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  document.getElementById('todayCount').innerText = `${today.length} / ${settings.dailyLimit}`;
  document.getElementById('todaySpend').innerText = `${settings.currency} ${(today.length * (settings.packPrice/settings.packSize)).toFixed(1)}`;
  document.getElementById('prevGapCard').innerText = logs.length > 1 ? formatGap(logs[logs.length-1].gap) : '--';
  const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined);
  document.getElementById('bestGapCard').innerText = todayGaps.length > 0 ? formatGap(Math.max(...todayGaps)) : '--';
  renderHistory('homeRecentLogs', 3);
}

function formatGap(m) { if (m === null || m === undefined || isNaN(m)) return '—'; if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h ${m % 60 > 0 ? (m % 60) + 'm' : ''}`.trim(); }

function showStatDetail(type) {
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  const pricePerStick = settings.packPrice / settings.packSize;
  const icon = document.getElementById('statDetailIcon'), title = document.getElementById('statDetailTitle'), value = document.getElementById('statDetailValue'), desc = document.getElementById('statDetailDesc'), extra = document.getElementById('statDetailExtra');
  const row = (label, val) => `<div class="flex justify-between border-t pt-2" style="border-color: var(--text-muted); border-opacity: 0.1;"><span style="color: var(--text-muted);">${label}</span><span class="font-bold" style="color: var(--text-main);">${val}</span></div>`;
  let iconClass = 'bg-gray-500/10 text-gray-400', iconName = 'info';

  if (type === 'spend') {
    iconClass = 'bg-red-500/10 text-red-500'; iconName = 'wallet'; title.innerText = "Today's Spend"; value.innerText = `${settings.currency} ${(today.length * pricePerStick).toFixed(1)}`; desc.innerText = `Based on ${today.length} cigarette${today.length===1?'':'s'} logged today at ${settings.currency} ${pricePerStick.toFixed(2)} per stick.`;
    const monthLogs = logs.filter(l => (new Date().getTime() - l.timestamp) < 30*86400000);
    extra.innerHTML = row('Cost per cigarette', `${settings.currency} ${pricePerStick.toFixed(2)}`) + row('Last 30 days', `${settings.currency} ${(monthLogs.length * pricePerStick).toFixed(1)}`);
  } else if (type === 'count') {
    const over = today.length > settings.dailyLimit; iconClass = over ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'; iconName = 'activity'; title.innerText = "Today's Sticks"; value.innerText = `${today.length} / ${settings.dailyLimit}`; desc.innerText = over ? `You're ${today.length - settings.dailyLimit} over your daily goal.` : `You're ${settings.dailyLimit - today.length} away from your goal.`; extra.innerHTML = row('Your daily goal', `${settings.dailyLimit} cigarettes`);
  } else if (type === 'prevGap') {
    iconClass = 'bg-sky-500/10 text-sky-500'; iconName = 'history'; title.innerText = "Previous Gap"; const g = logs.length > 1 ? logs[logs.length-1].gap : null; value.innerText = formatGap(g); desc.innerText = `Time between your last two logs.`;
    const gappedAll = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
    extra.innerHTML = gappedAll.length ? row('Your all-time average gap', formatGap(Math.round(gappedAll.reduce((a,b)=>a+b,0)/gappedAll.length))) : '';
  } else if (type === 'bestGap') {
    iconClass = 'bg-emerald-500/10 text-emerald-500'; iconName = 'trophy'; title.innerText = "Best Gap Today"; const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined); const best = todayGaps.length ? Math.max(...todayGaps) : null; value.innerText = formatGap(best); desc.innerText = `The longest you've gone between cigarettes today.`;
    const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
    extra.innerHTML = allGaps.length ? row('Your all-time best gap', formatGap(Math.max(...allGaps))) : '';
  }
  icon.className = `w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClass}`; icon.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i>`;
  document.getElementById('statDetailModal').classList.remove('hidden'); if(window.lucide) window.lucide.createIcons();
}
function closeStatDetail() { document.getElementById('statDetailModal').classList.add('hidden'); }

function showShieldDashboard() {
  document.getElementById('modalShieldCount').innerText = shields; document.getElementById('modalShieldMins').innerText = (shields * 10) + " Mins Resisted";
  ['badge1', 'badge10', 'badge50'].forEach(id => document.getElementById(id).className = "flex flex-col items-center p-3 rounded-2xl bg-gray-500/10 opacity-30 grayscale transition-all duration-500 border border-gray-500/20");
  if(shields >= 1) { document.getElementById('badge1').classList.remove('opacity-30', 'grayscale'); document.getElementById('badge1').classList.add('shadow-[0_0_15px_rgba(245,158,11,0.15)]'); }
  if(shields >= 10) { document.getElementById('badge10').classList.remove('opacity-30', 'grayscale'); document.getElementById('badge10').classList.add('shadow-[0_0_15px_rgba(245,158,11,0.15)]'); document.getElementById('badge10').querySelector('i').classList.replace('text-gray-300', 'text-sky-400'); }
  if(shields >= 50) { document.getElementById('badge50').classList.remove('opacity-30', 'grayscale'); document.getElementById('badge50').classList.add('shadow-[0_0_15px_rgba(245,158,11,0.15)]'); }
  document.getElementById('shieldDashboardModal').classList.remove('hidden'); if(window.lucide) window.lucide.createIcons();
}
function closeShieldDashboard() { document.getElementById('shieldDashboardModal').classList.add('hidden'); }

function resetData(type) { 
  if(type === '24h') { if(confirm("Delete logs from the last 24 hours?")) { const now = new Date().getTime(); logs = logs.filter(l => (now - l.timestamp) > 86400000); localStorage.setItem('smoke_logs', JSON.stringify(logs)); location.reload(); } } 
  else { if(confirm("Wipe ALL data? This action cannot be undone.")) { localStorage.clear(); location.reload(); } }
}

function exportLogsCSV() {
  if(logs.length === 0) { alert("No logs to export!"); return; }
  let csvContent = "Timestamp,Date,Time,Gap_Minutes,Tags,Latitude,Longitude\n";
  logs.forEach(l => {
    let d = new Date(l.timestamp);
    let tagsStr = l.tags && l.tags.length ? l.tags.join(' | ') : (l.trigger || '');
    csvContent += `${l.timestamp},"${d.toLocaleDateString()}","${formatAppTime(d)}",${l.gap ?? ''},"${tagsStr}",${l.lat||''},${l.lng||''}\n`;
  });
  let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  let url = URL.createObjectURL(blob);
  let link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `SmokeGap_Logs_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function addCustomTrigger() {
  let val = document.getElementById('newTriggerInput').value.trim();
  if(val && !triggers.includes(val)) { triggers.push(val); localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); document.getElementById('newTriggerInput').value = ''; renderTriggerSettingsList(); }
}
function removeCustomTrigger(idx) { triggers.splice(idx, 1); localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); renderTriggerSettingsList(); }
function renderTriggerSettingsList() {
  const c = document.getElementById('triggerListSettings'); if(!c) return;
  c.innerHTML = triggers.map((t, idx) => `<span class="bg-gray-500/10 text-xs px-3 py-1.5 rounded-xl border border-gray-500/20 flex items-center gap-1.5 font-medium" style="color: var(--text-main);">${t} <button onclick="window.removeCustomTrigger(${idx})" class="text-red-500 font-bold hover:opacity-80">✕</button></span>`).join('');
}

function openTriggerModal(logIdx = null) {
  editingLogIdx = logIdx !== null ? logIdx : logs.length - 1;
  const log = logs[editingLogIdx];
  currentSelectedTags = log.tags && log.tags.length ? [...log.tags] : (log.trigger ? [log.trigger] : []);
  renderModalTriggerGrid();
  document.getElementById('triggerModal').classList.remove('hidden');
}

function renderModalTriggerGrid() {
  const grid = document.getElementById('modalTriggerGrid');
  grid.innerHTML = triggers.map((t, idx) => {
    const isSelected = currentSelectedTags.includes(t);
    const bgClass = isSelected ? 'text-white border border-sky-400' : 'bg-gray-500/10';
    const inlineStyle = isSelected ? `style="background: var(--accent); box-shadow: 0 4px 15px var(--accent-glow);"` : `style="color: var(--text-main);"`;
    return `<button onclick="window.toggleTag(${idx})" class="py-4 px-2 rounded-xl text-center active:scale-95 transition-all ${bgClass}" ${inlineStyle}>${t}</button>`;
  }).join('');
}

function toggleTag(idx) {
  const t = triggers[idx];
  if(currentSelectedTags.includes(t)) currentSelectedTags = currentSelectedTags.filter(tag => tag !== t);
  else currentSelectedTags.push(t);
  renderModalTriggerGrid();
}

function saveTags() {
  if(editingLogIdx !== null && logs[editingLogIdx]) {
    logs[editingLogIdx].tags = [...currentSelectedTags];
    logs[editingLogIdx].trigger = currentSelectedTags.length > 0 ? currentSelectedTags[0] : '';
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    renderHistory('homeRecentLogs', 3);
    if(!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList');
    if(!document.getElementById('page-insights').classList.contains('hidden')) requestAnimationFrame(() => renderAllCharts());
  }
  document.getElementById('triggerModal').classList.add('hidden');
}

function closeTriggerModal() {
  document.getElementById('triggerModal').classList.add('hidden');
}

function renderHistory(tId='fullHistoryList', limit=null) {
  const c = document.getElementById(tId); if(!c) return;
  if(logs.length===0) { c.innerHTML="<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='inbox' class='w-6 h-6 opacity-50'></i> No logs recorded yet.</p>"; if(window.lucide) window.lucide.createIcons(); return; }
  let items = logs.slice().reverse(); if(limit) items = items.slice(0,limit);
  
  c.innerHTML = items.map((l, j) => {
    const origIdx = logs.length - 1 - j;
    const prev = origIdx > 0 ? logs[origIdx - 1] : null;
    let trendClass = 'bg-gray-500/10 text-gray-400', trendIcon = 'minus', valueColor = 'var(--accent)';
    if (l.gap !== null && l.gap !== undefined && prev && prev.gap !== null && prev.gap !== undefined) {
      if (l.gap > prev.gap) { trendClass = 'bg-emerald-500/10 text-emerald-500'; trendIcon = 'trending-up'; valueColor = '#10B981'; }
      else if (l.gap < prev.gap) { trendClass = 'bg-red-500/10 text-red-500'; trendIcon = 'trending-down'; valueColor = '#EF4444'; }
    }
    const tagsDisplay = l.tags && l.tags.length ? l.tags.join(', ') : (l.trigger || 'Uncategorized');
    return `
    <div onclick="window.openTriggerModal(${origIdx})" class="premium-card p-4 flex justify-between items-center relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform hover:bg-gray-500/5">
      <div class="flex items-start gap-3 flex-1 min-w-0 pr-3">
        <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${trendClass}"><i data-lucide="${trendIcon}" class="w-3.5 h-3.5"></i></div>
        <div class="flex-1 min-w-0">
          <div class="font-bold tracking-wide" style="color: var(--text-main);">${formatAppTime(new Date(l.timestamp))}</div>
          <div class="text-[10px] font-bold uppercase mt-0.5 flex items-start gap-1" style="color: var(--text-muted);">
            <i data-lucide="tag" class="w-3 h-3 shrink-0 mt-0.5"></i>
            <span class="leading-relaxed whitespace-normal break-words">${tagsDisplay}</span>
          </div>
        </div>
      </div>
      <div class="font-bold text-base shrink-0" style="color: ${valueColor};">${formatGap(l.gap)}</div>
    </div>
  `;
  }).join('');
  if(window.lucide) window.lucide.createIcons();
}

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter').value, now = new Date();
  if(filter === 'today') return logs.filter(l => l.timestamp >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
  if(filter === '7days') return logs.filter(l => l.timestamp >= new Date(now.getTime() - (7 * 86400000)).getTime());
  if(filter === '1month') return logs.filter(l => l.timestamp >= new Date(now.getTime() - (30 * 86400000)).getTime());
  return logs;
}
function setBadge(id, text, colorClass) { const b = document.getElementById(id); if(b) { if(text) { b.innerText = text; b.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${colorClass}`; b.classList.remove('hidden'); } else b.classList.add('hidden'); } }

function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  const filter = document.getElementById('insightsDateFilter').value;
  const filterEl = document.getElementById('selectedFilterLabel');
  if(filterEl) filterEl.innerText = { today: 'Today', '7days': 'Last 7 Days', '1month': '1 Month', all: 'All Time' }[filter] || 'Selected Period';

  let totalSpend = (activeLogs.length * (settings.packPrice/settings.packSize)).toFixed(1);
  document.getElementById('insightPeriodSpend').innerText = `${settings.currency} ${totalSpend}`;
  document.getElementById('insightPeriodCount').innerText = `${activeLogs.length} Sticks`;

  const gappedLogs = activeLogs.filter(l => l.gap !== null && l.gap !== undefined);
  document.getElementById('insightAvgGap').innerText = gappedLogs.length > 0 ? formatGap(Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length)) : '--';
  document.getElementById('insightShields').innerText = `${shields} Defeats`;

  if(activeLogs.length > 0) {
    let hours = {}; activeLogs.forEach(l => { let h = new Date(l.timestamp).getHours(); hours[h] = (hours[h]||0)+1; });
    let peakHrInt = parseInt(Object.keys(hours).reduce((a,b) => hours[a] > hours[b] ? a : b));
    let peakDate = new Date(); peakDate.setHours(peakHrInt, 0, 0, 0);
    document.getElementById('insightPeakHour').innerText = formatAppTime(peakDate);
  } else document.getElementById('insightPeakHour').innerText = '--';

  if(activeLogs.length > 0) {
    let trigs = {}; 
    activeLogs.forEach(l => { 
      let tg = l.tags && l.tags.length ? l.tags : (l.trigger ? [l.trigger] : ['Uncategorized']);
      tg.forEach(t => trigs[t] = (trigs[t]||0)+1);
    });
    let topT = Object.keys(trigs).length > 0 ? Object.keys(trigs).reduce((a,b) => trigs[a] > trigs[b] ? a : b) : '--';
    document.getElementById('insightTopTrigger').innerText = topT.length > 15 ? topT.substring(0,12)+'..' : topT;
  } else document.getElementById('insightTopTrigger').innerText = '--';

  document.getElementById('insightPackEq').innerText = activeLogs.length > 0 ? `${(activeLogs.length / settings.packSize).toFixed(1)} Packs` : '--';

  const heaviestDayEl = document.getElementById('insightHeaviestDay');
  if (heaviestDayEl) {
    if (activeLogs.length > 0) {
      let perDay = {}; activeLogs.forEach(l => { const k = new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}); perDay[k] = (perDay[k]||0)+1; });
      let topDay = Object.keys(perDay).reduce((a,b) => perDay[a] > perDay[b] ? a : b);
      heaviestDayEl.innerText = `${topDay} (${perDay[topDay]})`;
    } else heaviestDayEl.innerText = '--';
  }

  setBadge('badge-chart1', gappedLogs.length > 0 ? `Avg ${formatGap(Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length))}` : '', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20');
  setBadge('badge-chart2', activeLogs.length > 0 ? `${activeLogs.length} Total` : '', 'bg-amber-500/10 text-amber-500 border-amber-500/20');
  setBadge('badge-chart3', activeLogs.length > 0 ? `${settings.currency} ${totalSpend}` : '', 'bg-red-500/10 text-red-500 border-red-500/20');

  // FIX: X-Axis Multi-line Labels (Array format prevents clipping)
  const labels = activeLogs.length > 0 ? activeLogs.map(l => {
    let d = new Date(l.timestamp);
    let tStr = formatAppTime(d);
    if (filter === 'today') return tStr;
    if (filter === '7days') return [d.toLocaleDateString([], {weekday:'short'}), tStr];
    return [d.toLocaleDateString([], {month:'short', day:'numeric'}), tStr];
  }) : ['No Data'];
  
  const gaps = activeLogs.length > 0 ? activeLogs.map(l => l.gap) : [0];
  const chartTextColor = settings.theme === 'white' ? '#64748B' : '#9CA3AF';

  // FIX: Base options -> Removed negative padding to prevent edge clipping
  const proOptions = { responsive: true, maintainAspectRatio: false, animation: { duration: 600, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, layout: { padding: { left: 0, right: 0, top: 10, bottom: 0 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)', titleColor: '#FFFFFF', bodyColor: '#10B981', padding: 12, cornerRadius: 12, displayColors: false } }, scales: { x: { grid: { display: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, maxTicksLimit: 4 } }, y: { beginAtZero: true, grid: { color: 'rgba(156, 163, 175, 0.05)', drawBorder: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, padding: 6 } } } };
  const createGradient = (ctx, colorHex) => { let g = ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, colorHex); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  function upsertChart(key, ctx, config) { const existing = myChartInstances[key]; if (existing && existing.config.type === config.type) { existing.data = config.data; if (config.options) existing.options = config.options; existing.update(); } else { if (existing) existing.destroy(); myChartInstances[key] = new Chart(ctx, config); } }

  const ctx1 = document.getElementById('chart1').getContext('2d');
  // FIX: Added offset to X-axis to center the line
  upsertChart(1, ctx1, { type: 'line', data: { labels: labels, datasets: [{ label: 'Gap (mins)', data: gaps, borderColor: '#10B981', backgroundColor: createGradient(ctx1, 'rgba(16, 185, 129, 0.25)'), borderWidth: 3, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 15 }] }, options: { ...proOptions, scales: { ...proOptions.scales, x: { ...proOptions.scales.x, offset: true } } }, plugins: [crosshairPlugin] });

  let dayMap = {}; activeLogs.forEach(l => { let d = document.getElementById('insightsDateFilter').value === '7days' ? new Date(l.timestamp).toLocaleDateString([], {weekday:'short'}) : new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}); dayMap[d] = (dayMap[d] || 0) + 1; });
  let dayLabels = Object.keys(dayMap), dayCounts = Object.values(dayMap); if(dayLabels.length === 0) { dayLabels = ['Today']; dayCounts = [0]; }
  const ctx2 = document.getElementById('chart2').getContext('2d');
  
  // FIX: Offset true & maxBarThickness to prevent left clipping
  upsertChart(2, ctx2, { type: 'bar', data: { labels: dayLabels, datasets: [{ label: 'Count', data: dayCounts, backgroundColor: settings.theme === 'white' ? '#2563EB' : '#F59E0B', borderRadius: Number.MAX_VALUE, borderSkipped: false, maxBarThickness: 16 }, { label: 'Limit', data: dayLabels.map(() => settings.dailyLimit), type: 'line', borderColor: '#EF4444', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }] }, options: { ...proOptions, scales: { x: { ...proOptions.scales.x, offset: true }, y: { ...proOptions.scales.y } } }, plugins: [crosshairPlugin] });

  let cumulativeSpend = 0; let spendData = gaps.map(() => { cumulativeSpend += (settings.packPrice / settings.packSize); return cumulativeSpend.toFixed(1); });
  const ctx3 = document.getElementById('chart3').getContext('2d');
  upsertChart(3, ctx3, { type: 'line', data: { labels: labels, datasets: [{ label: 'Spend', data: spendData, borderColor: '#EF4444', backgroundColor: createGradient(ctx3, 'rgba(239, 68, 68, 0.2)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHitRadius: 15 }] }, options: { ...proOptions, scales: { ...proOptions.scales, x: { ...proOptions.scales.x, offset: true } } }, plugins: [crosshairPlugin] });

  const ctx5 = document.getElementById('chart5').getContext('2d');
  const triggerCounts = triggers.map(t => activeLogs.filter(l => (l.tags && l.tags.includes(t)) || l.trigger === t).length);
  const topTriggerIdx = triggerCounts.length ? triggerCounts.indexOf(Math.max(...triggerCounts)) : -1;
  setBadge('badge-chart5', (topTriggerIdx >= 0 && triggerCounts[topTriggerIdx] > 0) ? `Top: ${triggers[topTriggerIdx]}` : '', 'bg-purple-500/10 text-purple-500 border-purple-500/20');
  upsertChart(5, ctx5, { type: 'doughnut', data: { labels: triggers, datasets: [{ data: triggerCounts, backgroundColor: ['#F59E0B','#10B981','#6366F1','#EF4444','#2563EB','#A855F7'], borderWidth: 0, cutout: '76%' }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: chartTextColor } } } }, plugins: [centerTextPlugin] });

  const dayParts = ['Morning', 'Afternoon', 'Evening', 'Night']; const partOf = (hr) => hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 21 ? 2 : 3;
  let triggerByPart = {}; triggers.forEach(t => triggerByPart[t] = [0, 0, 0, 0]);
  activeLogs.forEach(l => { 
    let tArr = l.tags && l.tags.length ? l.tags : (l.trigger ? [l.trigger] : []);
    tArr.forEach(tg => { if (triggerByPart[tg]) triggerByPart[tg][partOf(new Date(l.timestamp).getHours())]++; }); 
  });
  const palette = ['#F59E0B', '#10B981', '#6366F1', '#EF4444', '#2563EB', '#A855F7'];
  const partTotals = dayParts.map((_, i) => triggers.reduce((sum, t) => sum + triggerByPart[t][i], 0));
  const peakPartIdx = partTotals.some(v => v > 0) ? partTotals.indexOf(Math.max(...partTotals)) : -1;
  setBadge('badge-chart6', peakPartIdx >= 0 ? `Peak: ${dayParts[peakPartIdx]}` : '', 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20');
  const chart6El = document.getElementById('chart6');
  
  // FIX: Trigger Timing chart layout. maxBarThickness controls the extreme width, borderRadius: 0 fixes the stacked gap issue, and offset: true adds padding so left/right bars don't cut.
  if (chart6El) {
    upsertChart(6, chart6El.getContext('2d'), { type: 'bar', data: { labels: dayParts, datasets: triggers.map((t, i) => ({ label: t, data: triggerByPart[t], backgroundColor: palette[i % palette.length], borderRadius: 0, maxBarThickness: 32, stack: 'triggers' })) }, options: { ...proOptions, scales: { x: { ...proOptions.scales.x, stacked: true, offset: true }, y: { ...proOptions.scales.y, stacked: true, ticks: { ...proOptions.scales.y.ticks, precision: 0 } } }, plugins: { ...proOptions.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { size: 9 }, color: chartTextColor } } } } });
  }

  renderHeatMap('mapContainer', activeLogs);
}

function renderHeatMap(containerId, activeLogs) {
  const mapEl = document.getElementById(containerId); if(!mapEl) return;
  let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng), lat = lastWithLoc ? lastWithLoc.lat : 25.2048, lng = lastWithLoc ? lastWithLoc.lng : 55.2708;
  let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng, 1.0]);
  const isModal = containerId === 'mapModalContainer'; let m = isModal ? modalMapInstance : mapInstance;
  try {
    if (!m || m._smokegapTheme !== settings.theme) {
      if (m) { try { m.remove(); } catch(e) {} }
      m = L.map(containerId, {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
      L.tileLayer(settings.theme === 'white' ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom: 19}).addTo(m);
      m._smokegapTheme = settings.theme; if (isModal) modalMapInstance = m; else mapInstance = m;
      setTimeout(() => { m.invalidateSize(); }, 250);
    } else { m.setView([lat, lng], m.getZoom()); setTimeout(() => { m.invalidateSize(); }, 50); }
    if (m._smokegapHeat) { m.removeLayer(m._smokegapHeat); m._smokegapHeat = null; }
    if (m._smokegapMarker) { m.removeLayer(m._smokegapMarker); m._smokegapMarker = null; }
    if(heatPoints.length > 0 && window.L.heatLayer) m._smokegapHeat = L.heatLayer(heatPoints, {radius: 28, blur: 18, maxZoom: 17, minOpacity: 0.4}).addTo(m);
    else m._smokegapMarker = L.marker([lat, lng]).addTo(m);
  } catch(e) {}
}

function openMapModal() { document.getElementById('mapModal').classList.remove('hidden'); setTimeout(() => { renderHeatMap('mapModalContainer', getFilteredLogs()); }, 200); }
function closeMapModal() { document.getElementById('mapModal').classList.add('hidden'); if(modalMapInstance) { modalMapInstance.remove(); modalMapInstance = null; } }
function initDragAndDrop() { const container = document.getElementById('chartContainer'); if(!container || !window.Sortable) return; new Sortable(container, { handle: '.drag-handle', animation: 200, ghostClass: 'sortable-ghost', onEnd: function () { localStorage.setItem('smoke_chart_order', JSON.stringify([...container.children].map(c => c.id))); } }); }
function loadChartOrder() { const savedOrder = JSON.parse(localStorage.getItem('smoke_chart_order')); if(!savedOrder) return; const container = document.getElementById('chartContainer'); savedOrder.forEach(id => { const card = document.getElementById(id); if(card) container.appendChild(card); }); }

window.enterPin = enterPin; window.clearPin = clearPin; window.setupPin = setupPin;
window.handleLogClick = handleLogClick; window.toggleWaveMode = toggleWaveMode; window.switchTab = switchTab; window.updateSettings = updateSettings; window.resetData = resetData; 
window.openTriggerModal = openTriggerModal; window.closeTriggerModal = closeTriggerModal; window.toggleTag = toggleTag; window.saveTags = saveTags;
window.renderAllCharts = renderAllCharts; window.openMapModal = openMapModal; window.closeMapModal = closeMapModal;
window.showStatDetail = showStatDetail; window.closeStatDetail = closeStatDetail; window.showShieldDashboard = showShieldDashboard; window.closeShieldDashboard = closeShieldDashboard;
window.exportLogsCSV = exportLogsCSV; window.addCustomTrigger = addCustomTrigger; window.removeCustomTrigger = removeCustomTrigger;
