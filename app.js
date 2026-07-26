// BULLETPROOF INIT
let logs = [];
try { 
  let raw = localStorage.getItem('smoke_logs');
  if(raw) logs = JSON.parse(raw);
  if(!Array.isArray(logs)) logs = [];
} catch(e) { logs = []; }

const DEFAULT_SETTINGS = { 
  theme: 'white', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED', timeFormat: '12h', motivation: '', autoReduce: false,
  notifWaveComplete: true, notifGapWidened: true, notifInactivity: true, notifPredictive: true
};
let settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('smoke_settings')) || {});
if (!settings.packSize || settings.packSize <= 0) settings.packSize = 20;
if (!settings.timeFormat) settings.timeFormat = '12h';

// Auto-Reduce Goal Logic
let lastReduceDate = localStorage.getItem('smoke_last_reduce_date');
if (settings.autoReduce) {
    let nowStr = new Date().toDateString();
    if (!lastReduceDate) {
        localStorage.setItem('smoke_last_reduce_date', nowStr);
    } else {
        let diffDays = Math.floor((new Date() - new Date(lastReduceDate)) / (1000 * 60 * 60 * 24));
        if (diffDays >= 7 && settings.dailyLimit > 1) {
            settings.dailyLimit -= 1;
            localStorage.setItem('smoke_settings', JSON.stringify(settings));
            localStorage.setItem('smoke_last_reduce_date', nowStr);
        }
    }
}

let triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || ['🏠 Home', '💼 Work', '🚗 Car / Commute', '🎉 Outside / Social', '😰 Stress', '🍽️ After Meal', '☕ Chai / Coffee', '📱 Boredom', '👥 Peer Pressure', '🍺 Alcohol', '😡 Anger', '🌙 Habit'];
const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1', '#F43F5E', '#84CC16', '#0EA5E9', '#D946EF', '#EAB308', '#1D4ED8', '#047857', '#B45309', '#BE123C', '#6D28D9'];

const INTENSITY_LABELS = {1: 'Mild', 2: 'Light', 3: 'Moderate', 4: 'Severe', 5: 'Extreme'};

let waves = [];
try { waves = JSON.parse(localStorage.getItem('smoke_waves')) || []; if(!Array.isArray(waves)) waves = []; } catch(e) { waves = []; }

let waveAttempts = [];
try { waveAttempts = JSON.parse(localStorage.getItem('smoke_wave_attempts')) || []; if(!Array.isArray(waveAttempts)) waveAttempts = []; } catch(e) { waveAttempts = []; }
function logWaveAttempt(outcome) {
  waveAttempts.push({ timestamp: Date.now(), outcome, mins: Math.round(waveDurationMs / 60000) });
  if(waveAttempts.length > 500) waveAttempts = waveAttempts.slice(-500);
  localStorage.setItem('smoke_wave_attempts', JSON.stringify(waveAttempts));
}

let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let waveDurationMs = parseInt(localStorage.getItem('smoke_wave_duration')) || 600000;
let lastPeakNudgeDate = localStorage.getItem('smoke_peak_nudge') || '';

// NOTIFICATION STATE TRACKERS
let gapWidenedNotified = false;
let inactivityNotified = false;

function hashPin(p) { let h = 0; for (let i = 0; i < p.length; i++) { h = ((h << 5) - h) + p.charCodeAt(i); h |= 0; } return h.toString(36); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let storedPinHash = localStorage.getItem('smoke_pin_hash');
let hasPin = !!storedPinHash;
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;
let editingLogIdx = null;
let currentSelectedTags = [];
let currentIntensity = 3;
let takeoverTimer = null;
let takeoverCountdown = 6;
let historyRenderLimit = 30;

let activeHeroStyle = parseInt(localStorage.getItem('smoke_hero_style')) || 0;

// HOLD BUTTON LOGIC
let holdTimerId = null;
let holdStartTime = 0;
let isHolding = false;

window.startHold = function(e) {
  if (e && e.cancelable) e.preventDefault();
  if (new Date().getTime() < lockEndTime || waveEndTime > 0) {
      if (waveEndTime > 0) showToast("Wave in progress. Can't log now!");
      else showToast("Wait for the cooldown 🔒");
      return;
  }
  if (settings.haptics && navigator.vibrate) navigator.vibrate(15);
  isHolding = true; holdStartTime = Date.now();
  const progressEl = document.getElementById('holdProgress');
  const textEl = document.getElementById('holdText');
  const iconEl = document.getElementById('holdIcon');
  const btnEl = document.getElementById('mainLogBtn');
  if(btnEl) btnEl.classList.add('is-holding');
  if(textEl) textEl.innerText = "Hold...";
  if(iconEl) { iconEl.classList.add('text-red-500'); iconEl.classList.remove('text-gray-400'); }
  
  function update() {
    if (!isHolding) return;
    const elapsed = Date.now() - holdStartTime;
    const pct = Math.min((elapsed / 800) * 100, 100);
    if(progressEl) progressEl.style.width = pct + '%';
    
    if (elapsed >= 800) {
      isHolding = false;
      if(btnEl) btnEl.classList.remove('is-holding');
      if(progressEl) progressEl.style.width = '100%';
      if(textEl) textEl.innerText = "Done";
      if (settings.haptics && navigator.vibrate) navigator.vibrate([30, 50, 30]);
      
      try { handleLogClick(); } catch(err) { console.error("Error logging", err); } 
      finally {
        setTimeout(() => { 
          if(progressEl) progressEl.style.width = '0%'; 
          if(textEl) textEl.innerText = "Hold to Smoke"; 
          if(iconEl) { iconEl.classList.add('text-gray-400'); iconEl.classList.remove('text-red-500'); }
        }, 500);
      }
    } else {
      holdTimerId = requestAnimationFrame(update);
    }
  }
  holdTimerId = requestAnimationFrame(update);
}

window.cancelHold = function(e) {
  if (e && e.cancelable) e.preventDefault();
  if (isHolding && Date.now() - holdStartTime < 800 && Date.now() - holdStartTime > 10) showToast("Press and hold to log ⏱️");
  isHolding = false;
  if (holdTimerId) cancelAnimationFrame(holdTimerId);
  if (new Date().getTime() < lockEndTime) return; 

  const progressEl = document.getElementById('holdProgress');
  const textEl = document.getElementById('holdText');
  const iconEl = document.getElementById('holdIcon');
  const btnEl = document.getElementById('mainLogBtn');
  if(btnEl) btnEl.classList.remove('is-holding');
  if(progressEl) progressEl.style.width = '0%';
  if(textEl) textEl.innerText = "Hold to Smoke";
  if(iconEl) { iconEl.classList.add('text-gray-400'); iconEl.classList.remove('text-red-500'); }
}

Chart.defaults.color = '#64748B';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
const crosshairPlugin = { id: 'crosshair', afterDraw: chart => { if (chart.tooltip?._active?.length && (chart.config.type === 'line' || chart.config.type === 'bar')) { const activePoint = chart.tooltip._active[0]; const ctx = chart.ctx; const x = activePoint.element.x; ctx.save(); ctx.beginPath(); ctx.moveTo(x, chart.scales.y.top); ctx.lineTo(x, chart.scales.y.bottom); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.restore(); } } };
const centerTextPlugin = { id: 'centerText', beforeDraw: chart => { if (chart.config.type === 'doughnut') { const ctx = chart.ctx; ctx.restore(); let text = ""; if (chart.canvas.id === 'chart4') { const smoked = chart.data.datasets[0].data[0] || 0; const resisted = chart.data.datasets[0].data[1] || 0; const total = smoked + resisted; text = total > 0 ? Math.round((resisted/total)*100) + "%" : "0%"; } else { const total = chart.data.datasets[0].data.reduce((a,b)=>a+b, 0); text = total > 0 ? total + " Logs" : "No Data"; } ctx.font = "bold " + (chart.canvas.id === 'chart4' ? '26px' : '16px') + " sans-serif"; const x = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2; const y = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = (isLightTheme()) ? "#64748B" : "#F3F4F6"; ctx.fillText(text, x, y); ctx.save(); } } };

function formatAppTime(dateObj) { return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' }); }

window.onload = () => {
  applyTheme(settings.theme);
  try {
    document.getElementById('dailyLimitInput').value = settings.dailyLimit;
    document.getElementById('packPriceInput').value = settings.packPrice;
    document.getElementById('packSizeInput').value = settings.packSize;
    document.getElementById('themeSelect').value = settings.theme;
    document.getElementById('timeFormatSelect').value = settings.timeFormat;
    document.getElementById('currencySelect').value = settings.currency || 'AED';
    document.getElementById('lockSecsInput').value = settings.lockSecs;
    document.getElementById('hapticsInput').checked = settings.haptics;
    document.getElementById('motivationInput').value = settings.motivation || '';
    document.getElementById('autoReduceInput').checked = settings.autoReduce || false;

    // Load Notification Toggle States
    const notifKeys = ['notifWaveComplete', 'notifGapWidened', 'notifInactivity', 'notifPredictive'];
    notifKeys.forEach(k => {
      const el = document.getElementById(k + 'Input');
      if(el) el.checked = settings[k] !== false;
    });
  } catch(e) {}
  updateCostPerCigDisplay();
  
  loadChartOrder(); initDragAndDrop(); renderTriggerSettingsList();
  setupCarouselSwipe(); setHeroStyle(activeHeroStyle);
  
  const filterSelect = document.getElementById('historyTagFilter');
  if(filterSelect) {
      filterSelect.innerHTML = `<option value="all">All Tags</option>` + triggers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  if(window.lucide) window.lucide.createIcons();
  setTimeout(() => { const skel = document.getElementById('appSkeleton'); if(skel) { skel.style.opacity = '0'; setTimeout(()=>skel.remove(), 500); } }, 100);
  if(hasPin) { document.getElementById('lockScreen').classList.remove('hidden'); document.getElementById('pinStatusBtn').innerText = "Remove PIN"; } else { bootCore(); }
};

function sendSystemNotification(title, body, key) {
  if (settings[key] !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icons/pause_icon_192.png' }); } catch(e) {}
  }
}

function requestNotifPermission() {
  if (typeof Notification === 'undefined') { showToast("Notifications not supported in browser"); return; }
  Notification.requestPermission().then(perm => {
    if(perm === 'granted') { showToast("Smart Reminders Enabled! 🔔"); }
    else { showToast("Notification Permission Denied"); }
  });
}

function toggleNotifSetting(key) {
  const el = document.getElementById(key + 'Input');
  if(!el) return;
  settings[key] = el.checked;
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  if(el.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    requestNotifPermission();
  }
}

function bootCore() {
  try { updateUI(); } catch(e) { console.error("updateUI error on boot", e); }
  checkLock(); checkWave();
  
  if(mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    try {
      checkPeakNudge();
      if(!logs || logs.length === 0 || document.hidden) return;
      const diff = new Date().getTime() - logs[logs.length-1].timestamp;
      
      const stopwatchEl = document.getElementById('stopwatch');
      if(stopwatchEl) stopwatchEl.innerText = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
      
      const prevLog = logs[logs.length-1];
      const prevGapMs = prevLog.gap ? prevLog.gap * 60000 : 0;
      const circle = document.getElementById('heroProgressCircle');
      const milestoneCircle = document.getElementById('heroMilestoneCircle');
      const statusWrapper = document.getElementById('smartStatusWrapper');
      const statusText = document.getElementById('smartStatusText');
      const liveDot = document.getElementById('headerLiveDot');
      const dashMax = 289.02;
      const milestoneDashMax = 251.32;
      
      let newClass = '', newHtml = '', dotColor = '#9CA3AF';
      
      const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
      const avgGapMs = allGaps.length ? (allGaps.reduce((a,b)=>a+b, 0) / allGaps.length) * 60000 : 3600000;
      
      if (activeHeroStyle === 1 && milestoneCircle) {
        milestoneCircle.classList.remove('hidden');
        let ratio = diff / avgGapMs;
        let p1 = Math.min(ratio, 1.0);
        if(circle) { circle.style.stroke = p1 >= 1.0 ? '#10B981' : 'var(--accent)'; circle.style.strokeDashoffset = dashMax - (dashMax * p1); }
        if (ratio > 1.0) {
          let p2 = Math.min(ratio - 1.0, 1.0);
          milestoneCircle.style.strokeDashoffset = milestoneDashMax - (milestoneDashMax * p2);
          document.getElementById('heroSubLabel').classList.remove('hidden');
          document.getElementById('heroSubLabel').innerText = `BEATING AVG BY +${formatGap(Math.floor((diff - avgGapMs)/60000))}`;
        } else {
          milestoneCircle.style.strokeDashoffset = milestoneDashMax;
          document.getElementById('heroSubLabel').classList.add('hidden');
        }
      } else if (milestoneCircle) {
        milestoneCircle.classList.add('hidden');
        document.getElementById('heroSubLabel').classList.add('hidden');
      }

      if (prevGapMs > 0) {
        let percent = diff / prevGapMs;
        if (percent < 1) {
          if(activeHeroStyle === 0 && circle) { circle.style.stroke = '#F59E0B'; circle.style.strokeDashoffset = dashMax - (dashMax * percent); circle.style.filter = 'none'; }
          let remMins = Math.ceil((prevGapMs - diff) / 60000);
          newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-amber-500/10 border-amber-500/20';
          newHtml = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-500"></i><span class="text-amber-500">${remMins} min${remMins>1?'s':''} left to beat previous gap</span>`;
          dotColor = '#F59E0B';
        } else {
          if(activeHeroStyle === 0 && circle) { circle.style.stroke = '#10B981'; circle.style.strokeDashoffset = 0; circle.style.filter = 'drop-shadow(0 0 8px rgba(16,185,129,0.5))'; }
          let extraMins = Math.floor((diff - prevGapMs) / 60000);
          newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]';
          newHtml = `<i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-500"></i><span class="text-emerald-500">Widened the gap by +${extraMins} min${extraMins!==1?'s':''}</span>`;
          dotColor = '#10B981';

          // PROPER ENGLISH NOTIFICATION #2: GAP WIDENED MILESTONE
          if(!gapWidenedNotified) {
            gapWidenedNotified = true;
            sendSystemNotification("🎉 Gap Widened!", `Great progress! You just beat your previous gap (${formatGap(Math.round(prevGapMs/60000))}). You're setting a personal best.`, 'notifGapWidened');
          }
        }
      } else {
        if(activeHeroStyle === 0 && circle) { circle.style.strokeDashoffset = dashMax; circle.style.stroke = 'var(--card-border)'; circle.style.filter = 'none'; }
        newClass = 'px-5 py-2.5 rounded-full border transition-all duration-500 bg-sky-500/10 border-sky-500/20';
        newHtml = `<i data-lucide="rocket" class="w-3.5 h-3.5 text-sky-500"></i><span class="text-sky-500">Setting your first baseline gap</span>`;
        dotColor = '#0EA5E9';
      }

      // PROPER ENGLISH NOTIFICATION #3: FORGOTTEN LOG / 1.5x INACTIVITY REMINDER
      if (avgGapMs > 0 && diff >= avgGapMs * 1.5 && waveEndTime <= 0 && !inactivityNotified) {
        inactivityNotified = true;
        sendSystemNotification("🚬 Did you forget to log?", "It's been longer than your average gap. Log your stick or keep widening the gap!", 'notifInactivity');
      }

      if(liveDot) { liveDot.style.backgroundColor = dotColor; liveDot.style.boxShadow = `0 0 8px ${dotColor}`; }
      if (statusText && statusText.dataset.rawHtml !== newHtml) { statusWrapper.className = newClass; statusText.innerHTML = newHtml; statusText.dataset.rawHtml = newHtml; if(window.lucide) window.lucide.createIcons(); }
    } catch(err) {}
  }, 1000);
}

// PROPER ENGLISH NOTIFICATION #4: PREDICTIVE PEAK CRAVING ALERT
function checkPeakNudge() {
  if(!logs || logs.length < 5) return;
  const now = new Date(); const dStr = now.toDateString();
  if(lastPeakNudgeDate !== dStr) {
    let hours = {}; logs.forEach(l => { 
      if(!l.timestamp) return;
      let h = new Date(l.timestamp).getHours(); 
      if(!isNaN(h)) hours[h] = (hours[h]||0)+1; 
    });
    if(Object.keys(hours).length > 0) {
      let peakHr = parseInt(Object.keys(hours).reduce((a,b) => hours[a] > hours[b] ? a : b));
      if (now.getHours() === peakHr || (now.getHours() === peakHr - 1 && now.getMinutes() >= 45)) {
        showToast("Your peak craving time is approaching. Ready to Ride It Out?");
        sendSystemNotification("☕ Peak Craving Approaching", "Your usual peak craving time is near. Stay mindful and prepare to Ride It Out!", 'notifPredictive');
        lastPeakNudgeDate = dStr; localStorage.setItem('smoke_peak_nudge', dStr);
        if (window.posthog) posthog.capture('peak_craving_nudge_shown', { hour: peakHr });
      }
    }
  }
}

function setHeroStyle(idx) {
  activeHeroStyle = idx;
  localStorage.setItem('smoke_hero_style', activeHeroStyle);
  const dot0 = document.getElementById('carouselDot0'), dot1 = document.getElementById('carouselDot1');
  const label = document.getElementById('heroLabelText');
  if(dot0 && dot1) {
    dot0.className = `w-2 h-2 rounded-full transition-all ${idx === 0 ? 'bg-amber-500 w-4' : 'bg-gray-500/40'}`;
    dot1.className = `w-2 h-2 rounded-full transition-all ${idx === 1 ? 'bg-amber-500 w-4' : 'bg-gray-500/40'}`;
  }
  if(label) label.innerHTML = idx === 0 ? `<i data-lucide="info" class="w-3 h-3"></i> Current Gap` : `<i data-lucide="target" class="w-3 h-3 text-emerald-500"></i> Milestone Ring`;
  if(window.lucide) window.lucide.createIcons();
}

let touchStartX = 0;
function setupCarouselSwipe() {
  const el = document.getElementById('heroCarousel');
  if(!el) return;
  el.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
  el.addEventListener('touchend', e => {
    let diffX = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diffX) > 40) {
      if (diffX < 0) setHeroStyle(1);
      else setHeroStyle(0);
    }
  }, {passive: true});
}

function enterPin(n) {
  if(enteredPin.length < 4) { enteredPin += n; document.querySelectorAll('.pin-dot').forEach((el, i) => { el.classList.toggle('bg-gray-400', i < enteredPin.length); el.classList.toggle('bg-gray-500', i >= enteredPin.length); }); }
  if(enteredPin.length === 4) { setTimeout(() => { if(hashPin(enteredPin) === storedPinHash) { document.getElementById('lockScreen').classList.add('hidden'); bootCore(); } else { showToast("Wrong PIN"); shakePinDots(); clearPin(); } }, 200); }
}
function clearPin() { enteredPin = ""; document.querySelectorAll('.pin-dot').forEach(el => { el.classList.remove('bg-gray-400'); el.classList.add('bg-gray-500'); }); }
function shakePinDots() { const d = document.getElementById('pinDots'); if(!d) return; d.classList.add('shake-anim'); setTimeout(() => d.classList.remove('shake-anim'), 400); }
function setupPin() { if(hasPin) { showConfirm("Remove PIN?", "You won't need a PIN to open the app anymore.", () => { localStorage.removeItem('smoke_pin_hash'); hasPin=false; storedPinHash=null; location.reload(); }); } else { document.getElementById('pinSetupInput').value = ''; document.getElementById('pinSetupError').classList.add('hidden'); document.getElementById('pinSetupModal').classList.remove('hidden'); setTimeout(() => document.getElementById('pinSetupInput').focus(), 100); } }
function closePinSetupModal() { document.getElementById('pinSetupModal').classList.add('hidden'); }
function savePinSetup() { const p = document.getElementById('pinSetupInput').value; if(/^\d{4}$/.test(p)) { localStorage.setItem('smoke_pin_hash', hashPin(p)); hasPin = true; storedPinHash = hashPin(p); closePinSetupModal(); document.getElementById('pinStatusBtn').innerText = "Remove PIN"; showToast("PIN saved"); } else { document.getElementById('pinSetupError').classList.remove('hidden'); } }

function handleLogClick() {
  gapWidenedNotified = false;
  inactivityNotified = false;

  let waveWasActive = false;
  if(waveEndTime > 0) { 
    waveWasActive = true; localStorage.removeItem('smoke_wave_end'); waveEndTime = 0; clearInterval(waveTimer); 
    document.getElementById('waveOverlay').classList.add('hidden'); 
    logWaveAttempt('lost'); resetRideButton();
  }
  
  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : null;
  logs.push({timestamp: now, gap: gap, tags: [], lat: null, lng: null, intensity: 3});
  const newLogIdx = logs.length - 1;
  localStorage.setItem('smoke_logs', JSON.stringify(logs));
  lockEndTime = now + (settings.lockSecs * 1000);
  localStorage.setItem('smoke_lock_end', lockEndTime);
  
  if (window.posthog) {
    posthog.capture('cigarette_logged', {
      gap_minutes: gap,
      during_wave: waveWasActive,
      total_logs_today: logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString()).length
    });
  }

  try { updateUI(); } catch(e) {}
  checkLock(); startSmokeTakeover(newLogIdx, gap, waveWasActive);

  if(navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      if(logs[newLogIdx]) { logs[newLogIdx].lat = p.coords.latitude; logs[newLogIdx].lng = p.coords.longitude; localStorage.setItem('smoke_logs', JSON.stringify(logs)); if(!document.getElementById('page-insights').classList.contains('hidden')) renderHeatMap('mapContainer', getFilteredLogs()); }
    }, () => {}, {timeout: 10000, maximumAge: 60000});
  }
}

function setTakeoverIntensity(val) {
  if(settings.haptics && navigator.vibrate) navigator.vibrate(10); currentIntensity = val;
  for(let i=1; i<=5; i++) {
    const b = document.getElementById('toInt'+i); if(!b) continue;
    b.className = "w-9 h-9 rounded-full border text-xs font-bold transition-all";
    if(i===val) { b.style.background = "var(--accent)"; b.style.color = "#fff"; b.style.boxShadow = "0 4px 12px var(--accent-glow)"; b.style.transform = "scale(1.1)"; b.style.borderColor = "transparent"; }
    else { b.style.background = "transparent"; b.style.borderColor = "var(--card-border)"; b.style.color = "var(--text-main)"; b.style.boxShadow = "none"; b.style.transform = "scale(1)"; }
  }
  document.getElementById('takeoverIntensityLabel').innerText = INTENSITY_LABELS[val];
}

function startSmokeTakeover(logIdx, gap, waveWasActive) {
  editingLogIdx = logIdx; currentSelectedTags = []; setTakeoverIntensity(3); takeoverCountdown = 6;
  const overlay = document.getElementById('smokeTakeover'); const numberEl = document.getElementById('takeoverNumber'); const ringEl = document.getElementById('takeoverRing'); const factEl = document.getElementById('takeoverFact');
  let factText = "";
  if(waveWasActive) factText = "It's okay to slip. What triggered this strong urge?";
  else if (gap === null || gap === undefined) factText = "Setting your first baseline.";
  else if (gap < 60) factText = `It's been ${gap}m since your last one.`;
  else factText = `It's been ${Math.floor(gap/60)}h ${gap%60}m since your last one.`;
  if(factEl) factEl.innerText = factText;
  renderTakeoverTags();

  const updateTick = () => {
    if(numberEl) numberEl.innerText = takeoverCountdown;
    const offset = 339.29 - (339.29 * (takeoverCountdown / 6));
    if(ringEl) ringEl.style.strokeDashoffset = offset;
    if (takeoverCountdown === 3 && factEl) factEl.style.opacity = 1;
  };
  updateTick();

  overlay.classList.remove('hidden'); requestAnimationFrame(() => { overlay.classList.remove('opacity-0'); overlay.classList.add('opacity-100'); });
  if (takeoverTimer) clearInterval(takeoverTimer);
  takeoverTimer = setInterval(() => {
    takeoverCountdown--;
    if (takeoverCountdown <= 0) { clearInterval(takeoverTimer); closeSmokeTakeover(); } else updateTick();
  }, 1000);
}

function renderTakeoverTags() {
  const grid = document.getElementById('takeoverTagsGrid'); if(!grid) return;
  grid.innerHTML = triggers.map(t => {
    const isActive = currentSelectedTags.includes(t);
    const activeClasses = isActive ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-white/5 border-white/10';
    const textStyle = isActive ? 'style="color: var(--accent);"' : 'style="color: var(--text-main);"';
    return `<button onclick="window.toggleTakeoverTag('${esc(t)}')" class="px-4 py-2.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all active:scale-95 ${activeClasses}" ${textStyle}>${esc(t)}</button>`;
  }).join('');
}

function toggleTakeoverTag(t) { if(settings.haptics && navigator.vibrate) navigator.vibrate(10); if(currentSelectedTags.includes(t)) currentSelectedTags = currentSelectedTags.filter(tag => tag !== t); else currentSelectedTags.push(t); renderTakeoverTags(); }
function cancelSmokeTakeover(e) {
  if(e) e.stopPropagation(); if(takeoverTimer) clearInterval(takeoverTimer);
  const overlay = document.getElementById('smokeTakeover'); overlay.classList.remove('opacity-100'); overlay.classList.add('opacity-0');
  if (editingLogIdx === logs.length - 1) {
    logs.pop(); localStorage.setItem('smoke_logs', JSON.stringify(logs));
    lockEndTime = 0; localStorage.setItem('smoke_lock_end', lockEndTime);
    try { updateUI(); } catch(err){} checkLock();
  }
  if (window.posthog) posthog.capture('takeover_cancelled');
  setTimeout(() => { overlay.classList.add('hidden'); }, 500);
}

function closeSmokeTakeover() {
  if(takeoverTimer) clearInterval(takeoverTimer);
  const overlay = document.getElementById('smokeTakeover'); overlay.classList.remove('opacity-100'); overlay.classList.add('opacity-0');
  if(editingLogIdx !== null && logs[editingLogIdx]) {
    logs[editingLogIdx].tags = [...currentSelectedTags]; logs[editingLogIdx].intensity = currentIntensity;
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    if (window.posthog) {
      posthog.capture('takeover_saved', { tags: currentSelectedTags, intensity: currentIntensity });
    }
    try { updateUI(); } catch(err){} 
    if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  }
  setTimeout(() => { overlay.classList.add('hidden'); showUndoToast(editingLogIdx); }, 500);
}

function showUndoToast(logIdx) {
  const c = document.getElementById('toastContainer'); if(!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-3 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300 flex items-center gap-3 border border-gray-500/20';
  t.style.background = 'var(--card-bg)';
  t.innerHTML = `<span class="flex items-center gap-1.5" style="color: var(--text-main);"><i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-500"></i> Logged</span><div class="w-px h-3 bg-gray-500/30"></div><button onclick="window.undoLog(${logIdx}, this.parentElement)" class="text-sky-500 active:scale-95 transition-transform uppercase tracking-wider">Undo</button>`;
  c.prepend(t); if(window.lucide) window.lucide.createIcons();
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  const autoHide = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 300); }, 5000); t.dataset.timerId = autoHide;
}

window.undoLog = function(idx, element) {
  if(element) { clearTimeout(element.dataset.timerId); element.style.opacity = '0'; setTimeout(() => element.remove(), 300); }
  if (logs[idx]) {
    logs.splice(idx, 1);
    for (let i = 1; i < logs.length; i++) { logs[i].gap = Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000); }
    if (logs.length > 0) logs[0].gap = null;
    localStorage.setItem('smoke_logs', JSON.stringify(logs)); lockEndTime = 0; localStorage.setItem('smoke_lock_end', lockEndTime);
    if (window.posthog) posthog.capture('log_undone');
    try { updateUI(); } catch(err){} checkLock();
    if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  }
}

function checkLock() {
  const btn = document.getElementById('mainLogBtn'); if(!btn) return;
  if(new Date().getTime() < lockEndTime) {
    btn.disabled=true; btn.style.opacity = '0.5';
    if(cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      let rem = Math.ceil((lockEndTime - new Date().getTime())/1000); const textEl = document.getElementById('holdText');
      if(rem<=0) { clearInterval(cooldownTimer); btn.disabled=false; btn.style.opacity = '1'; if(textEl) textEl.innerText='Hold to Smoke'; }
      else if(textEl) textEl.innerText=`COOLDOWN (${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')})`;
    }, 1000);
  }
}

function openWaveModal() { if(waveEndTime > 0) { showToast("A wave is already in progress 🌊"); return; } document.getElementById('waveModal').classList.remove('hidden'); }
function closeWaveModal() { document.getElementById('waveModal').classList.add('hidden'); }
function startWave(mins) { 
  closeWaveModal(); waveDurationMs = mins * 60000; localStorage.setItem('smoke_wave_duration', waveDurationMs); 
  waveEndTime = new Date().getTime() + waveDurationMs; localStorage.setItem('smoke_wave_end', waveEndTime); 
  if (window.posthog) posthog.capture('ride_wave_started', { duration_mins: mins });
  checkWave(); 
}

function celebrateBadgeIfUnlocked() {
  const milestones = { 1: 'First Win Unlocked! 🥇', 10: 'Iron Will Unlocked! 🏅', 50: 'Unshakable Unlocked! 🏆' };
  if(!milestones[waves.length]) return;
  showToast(milestones[waves.length]);
  spawnConfetti();
}

function spawnConfetti() {
  if(window.confetti) confetti({particleCount: 100, spread: 70, origin: {y: 0.6}});
}

function cancelActiveWave() {
  if(waveEndTime <= 0) return;
  if(waveTimer) clearInterval(waveTimer);
  waveEndTime = 0; localStorage.removeItem('smoke_wave_end');
  const o = document.getElementById('waveOverlay'); if(o) o.classList.add('hidden');
  logWaveAttempt('cancelled');
  resetRideButton();
  if (window.posthog) posthog.capture('ride_wave_cancelled');
  showToast("Wave cancelled");
}

function resetRideButton() {
  const fillEl = document.getElementById('rideProgressFill'), textEl = document.getElementById('rideText'), iconEl = document.getElementById('rideIcon');
  if(fillEl) fillEl.style.width = '0%';
  if(textEl) textEl.innerText = 'Ride It Out';
  if(iconEl) iconEl.classList.remove('hidden');
}

const WAVE_RING_CIRCUMFERENCE = 213.63;
function waveTick() {
  const o = document.getElementById('waveOverlay'); if(!o) return;
  let rem = Math.ceil((waveEndTime - new Date().getTime())/1000); let totalSecs = waveDurationMs / 1000;
  if(rem<=0) {
    clearInterval(waveTimer); waveEndTime=0; localStorage.removeItem('smoke_wave_end'); o.classList.add('hidden');
    resetRideButton();
    waves.push(Date.now()); localStorage.setItem('smoke_waves', JSON.stringify(waves)); logWaveAttempt('won'); showToast("🛡️ Craving Defeated! +1 Shield");
    
    // PROPER ENGLISH NOTIFICATION #1: WAVE COMPLETE
    sendSystemNotification("🛡️ Craving Defeated!", "Awesome job! You successfully rode out the craving wave. +1 Shield unlocked.", 'notifWaveComplete');
    
    celebrateBadgeIfUnlocked();
    if (window.posthog) posthog.capture('ride_wave_completed', { duration_mins: waveDurationMs / 60000 });
    try { updateUI(); } catch(e){}
  } else {
    const mm = Math.floor(rem/60).toString().padStart(2,'0'), ss = (rem%60).toString().padStart(2,'0');
    document.getElementById('waveCountdown').innerText = `${mm}:${ss}`;
    const elapsedFrac = Math.min(1, Math.max(0, (totalSecs - rem) / totalSecs));
    const ring = document.getElementById('waveRing'); if(ring) ring.style.strokeDashoffset = (WAVE_RING_CIRCUMFERENCE * elapsedFrac).toFixed(2);
    const fillEl = document.getElementById('rideProgressFill'), textEl = document.getElementById('rideText'), iconEl = document.getElementById('rideIcon');
    if(fillEl) fillEl.style.width = `${elapsedFrac*100}%`;
    if(textEl) textEl.innerText = `${mm}:${ss}`;
    if(iconEl) iconEl.classList.add('hidden');
    const pct = elapsedFrac; let txt = "Breathe in... Hold... Exhale...";
    if(pct < 0.2) txt = "Notice the urge without acting on it. Where do you feel it?";
    else if(pct < 0.5) txt = "Cravings are like ocean waves. They rise, peak, and crash.";
    else if(pct < 0.8) txt = "The urge is peaking now. Just ride it out, it will pass.";
    else txt = "You're doing great. The craving is fading away.";
    const txtEl = document.getElementById('waveMotivationalText');
    if(txtEl && txtEl.innerText !== txt) { txtEl.style.opacity='0'; setTimeout(()=>{ txtEl.innerText=txt; txtEl.style.opacity='1'; }, 300); }
  }
}
function checkWave() {
  const o = document.getElementById('waveOverlay'); if(!o) return;
  if(waveEndTime > 0) {
    o.classList.remove('hidden');
    if(waveTimer) clearInterval(waveTimer);
    waveTick();
    waveTimer = setInterval(waveTick, 1000);
  }
}

function switchTab(t) {
  if(settings.haptics && navigator.vibrate) navigator.vibrate(20);
  ['tracker','insights','history','settings'].forEach(x => { document.getElementById(`page-${x}`)?.classList.add('hidden'); document.getElementById(`tab-${x}`)?.classList.remove('nav-active'); });
  document.getElementById(`page-${t}`)?.classList.remove('hidden'); document.getElementById(`tab-${t}`)?.classList.add('nav-active');
  if (window.posthog) posthog.capture('tab_switched', { tab_name: t });
  if(t==='history') renderHistory(); if(t==='insights') requestAnimationFrame(() => renderAllCharts());
  if(window.lucide) window.lucide.createIcons();
}

function showToast(msg) {
  const c = document.getElementById('toastContainer'); if(!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-2.5 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300';
  t.style.color = 'var(--text-main)'; t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; t.innerText = msg;
  c.prepend(t); requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 300); }, 2500);
}

let pendingConfirmCallback = null;
function showConfirm(title, message, onConfirm) {
  document.getElementById('confirmTitle').innerText = title; document.getElementById('confirmMessage').innerText = message;
  pendingConfirmCallback = onConfirm; document.getElementById('confirmModal').classList.remove('hidden');
  if(window.lucide) window.lucide.createIcons();
}
function closeConfirmModal() { document.getElementById('confirmModal').classList.add('hidden'); pendingConfirmCallback = null; }
function confirmYes() { const cb = pendingConfirmCallback; closeConfirmModal(); if(cb) cb(); }

const THEME_META_COLORS = { white: '#F8FAFC', carbon: '#000000', aurora: '#0B0B14', oled: '#000000', paper: '#FAF6F0', calm: '#F5F5F0', default: '#090A0F' };
const LIGHT_THEMES = ['white', 'paper', 'calm'];
function isLightTheme() { return LIGHT_THEMES.includes(settings.theme) || document.documentElement.classList.contains('theme-white') || document.documentElement.classList.contains('theme-paper') || document.documentElement.classList.contains('theme-calm'); }

function applyTheme(t) { 
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim(); document.documentElement.className = document.documentElement.className.replace(/theme-\w+/g, '').trim(); 
  if(t !== 'default') { document.body.classList.add(`theme-${t}`); document.documentElement.classList.add(`theme-${t}`); }
  const metaTheme = document.getElementById('theme-color-meta');
  if(metaTheme) metaTheme.setAttribute('content', THEME_META_COLORS[t] || THEME_META_COLORS.white);
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value; settings.timeFormat = document.getElementById('timeFormatSelect').value; settings.currency = document.getElementById('currencySelect').value;
  settings.dailyLimit = parseInt(document.getElementById('dailyLimitInput').value) || 15; settings.packPrice = parseFloat(document.getElementById('packPriceInput').value) || 20; settings.packSize = parseInt(document.getElementById('packSizeInput').value) || 20;
  settings.lockSecs = parseInt(document.getElementById('lockSecsInput').value) || 300; settings.haptics = document.getElementById('hapticsInput').checked;
  settings.motivation = document.getElementById('motivationInput').value; settings.autoReduce = document.getElementById('autoReduceInput').checked;
  if (settings.packSize <= 0) settings.packSize = 20;
  localStorage.setItem('smoke_settings', JSON.stringify(settings)); 
  if (window.posthog) posthog.capture('settings_updated', { theme: settings.theme, dailyLimit: settings.dailyLimit, autoReduce: settings.autoReduce });
  applyTheme(settings.theme); updateCostPerCigDisplay(); 
  try { updateUI(); } catch(err){}
  if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  if(!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList');
}

function updateCostPerCigDisplay() { const el = document.getElementById('costPerCigDisplay'); if (el) el.innerText = `${settings.currency} ${(settings.packPrice / settings.packSize).toFixed(2)}`; }

function updateUI() {
  document.getElementById('shieldCount').innerText = waves.length;
  const emptyBanner = document.getElementById('emptyStateBanner'); if(emptyBanner) emptyBanner.classList.toggle('hidden', logs.length > 0);
  const motEl = document.getElementById('motivationTag'); const motText = document.getElementById('motivationText');
  if(motEl && motText) { if (settings.motivation && settings.motivation.trim() !== "") { motText.innerText = settings.motivation; motEl.classList.remove('hidden'); } else { motEl.classList.add('hidden'); } }

  let streak = 0; let slipDays = 0; let logsByDate = {};
  logs.forEach(l => { if(l && l.timestamp) { let dStr = new Date(l.timestamp).toDateString(); logsByDate[dStr] = (logsByDate[dStr] || 0) + 1; } });
  let todayStr = new Date().toDateString(); if (!logsByDate[todayStr]) logsByDate[todayStr] = 0;
  let uniqueDates = Object.keys(logsByDate).sort((a,b) => new Date(b) - new Date(a));
  for (let dStr of uniqueDates) { if (logsByDate[dStr] <= settings.dailyLimit) { streak++; } else { if (slipDays < 2) { slipDays++; streak++; } else break; } }
  document.getElementById('homeStreak').innerText = `🔥 ${streak} Day Streak`;

  const today = logs.filter(l => l.timestamp && new Date(l.timestamp).toDateString() === todayStr);
  const overLimit = today.length >= settings.dailyLimit;
  const todayCountTextEl = document.getElementById('todayCountText'); if(todayCountTextEl) todayCountTextEl.innerText = `${today.length} / ${settings.dailyLimit}`;
  
  const stickIconEl = document.getElementById('todaySticksIcon'); const stickTextEl = document.getElementById('todayCount'); const limitMsg = document.getElementById('limitWarningMsg');
  if(stickIconEl && stickTextEl) {
    if(overLimit) { stickIconEl.className = 'w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500'; stickTextEl.style.color = '#F59E0B'; if(limitMsg) limitMsg.classList.remove('hidden'); } 
    else { stickIconEl.className = 'w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500'; stickTextEl.style.color = 'var(--text-main)'; if(limitMsg) limitMsg.classList.add('hidden'); }
  }

  const todayWaves = waves.filter(w => new Date(w).toDateString() === todayStr);
  const trEl = document.getElementById('todayResisted'); if(trEl) trEl.innerText = todayWaves.length.toString();
  document.getElementById('homeTodayBeaten').innerText = `${todayWaves.length} Defeated`;

  document.getElementById('todaySpend').innerText = `${settings.currency} ${(today.length * (settings.packPrice/settings.packSize)).toFixed(1)}`;
  
  const prevGapCard = document.getElementById('prevGapCard'); if(prevGapCard) { prevGapCard.innerText = logs.length > 1 ? formatGap(logs[logs.length-1].gap) : '--'; }
  const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const bestGapCard = document.getElementById('bestGapCard'); if(bestGapCard) { bestGapCard.innerText = todayGaps.length > 0 ? formatGap(Math.max(...todayGaps)) : '--'; }
  
  const dataSumm = document.getElementById('dataSummaryText');
  if(dataSumm) {
      if(logs.length > 0) { const firstDate = new Date(logs[0].timestamp).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}); dataSumm.innerText = `${logs.length} logs • Since ${firstDate}`; }
      else { dataSumm.innerText = `0 logs • No data yet`; }
  }

  computeMomentumScore(today, todayWaves);
  checkBackupReminder();
  renderHistory('homeRecentLogs', 3);
}

function computeMomentumScore(today, todayWaves) {
  const momHeaderEl = document.getElementById('momentumScoreHeader');
  if(logs.length === 0 && todayWaves.length === 0) {
    if(momHeaderEl) momHeaderEl.innerText = '0';
    return;
  }

  const limitComponent = Math.max(0, 100 - (today.length / Math.max(1, settings.dailyLimit)) * 100);
  const waveComponent = Math.min(100, todayWaves.length * 25);
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGapMin = allGaps.length ? allGaps.reduce((a,b)=>a+b,0) / allGaps.length : 0;
  const currentGapMin = logs.length > 0 ? (new Date().getTime() - logs[logs.length-1].timestamp) / 60000 : 0;
  const gapComponent = avgGapMin > 0 ? Math.min(100, (currentGapMin / avgGapMin) * 100) : 50;

  const score = Math.round(limitComponent*0.4 + waveComponent*0.3 + gapComponent*0.3);
  if(momHeaderEl) momHeaderEl.innerText = score.toString();
}

function formatGap(m) { if (m === null || m === undefined || isNaN(m)) return '—'; if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h ${m % 60 > 0 ? (m % 60) + 'm' : ''}`.trim(); }

function showStatDetail(type) {
  const today = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
  const pricePerStick = settings.packPrice / settings.packSize;
  const icon = document.getElementById('statDetailIcon'), title = document.getElementById('statDetailTitle'), value = document.getElementById('statDetailValue'), desc = document.getElementById('statDetailDesc'), extra = document.getElementById('statDetailExtra');
  const pBox = document.getElementById('statDetailProgressBox'), pLabel = document.getElementById('statProgressLabel'), pPct = document.getElementById('statProgressPct'), pBar = document.getElementById('statProgressBar');
  const row = (label, val) => `<div class="flex justify-between border-t pt-2.5" style="border-color: var(--card-border);"><span style="color: var(--text-muted);">${label}</span><span class="font-bold" style="color: var(--text-main);">${val}</span></div>`;
  
  pBox.classList.add('hidden');
  let iconClass = 'bg-gray-500/10 text-gray-400', iconName = 'info';

  if (type === 'spend') {
    iconClass = 'bg-red-500/10 text-red-500'; iconName = 'wallet'; title.innerText = "Today's Expense"; value.innerText = `${settings.currency} ${(today.length * pricePerStick).toFixed(1)}`; 
    desc.innerText = `You have spent ${settings.currency} ${(today.length * pricePerStick).toFixed(1)} today across ${today.length} stick${today.length===1?'':'s'}. Every cigarette delayed directly protects your monthly wallet.`;
    const monthLogs = logs.filter(l => (new Date().getTime() - l.timestamp) < 30*86400000); 
    extra.innerHTML = row('Cost Per Stick', `${settings.currency} ${pricePerStick.toFixed(2)}`) + row('30-Day Total Spend', `${settings.currency} ${(monthLogs.length * pricePerStick).toFixed(1)}`);
  } else if (type === 'count') {
    const over = today.length >= settings.dailyLimit; iconClass = over ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-500/10 text-amber-500'; iconName = 'activity'; 
    title.innerText = "Daily Volume Limit"; value.innerText = `${today.length} / ${settings.dailyLimit}`; 
    desc.innerText = over ? `Daily goal reached (${settings.dailyLimit} max). Focus on holding until tomorrow to keep momentum.` : `You have ${settings.dailyLimit - today.length} stick(s) remaining under your daily limit target.`; 
    pBox.classList.remove('hidden'); pLabel.innerText = "Daily Limit Used"; 
    let pct = Math.min(100, Math.round((today.length / settings.dailyLimit) * 100)); pPct.innerText = `${pct}%`; pBar.style.width = `${pct}%`; pBar.style.backgroundColor = over ? '#EF4444' : '#F59E0B';
    extra.innerHTML = row('Target Daily Cap', `${settings.dailyLimit} sticks`) + row('Auto-Reduce Active', settings.autoReduce ? 'Yes (-1 stick/week)' : 'Disabled');
  } else if (type === 'bestGap') {
    iconClass = 'bg-emerald-500/10 text-emerald-500'; iconName = 'trophy'; title.innerText = "Today's Best Gap"; const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined); const best = todayGaps.length ? Math.max(...todayGaps) : null; value.innerText = formatGap(best); 
    desc.innerText = best !== null ? `Your longest gap between cigarettes today was ${formatGap(best)}. The wider your gaps, the faster your baseline addiction drops.` : `No gap data recorded for today yet.`; 
    const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined); extra.innerHTML = allGaps.length ? row('All-Time Record Gap', formatGap(Math.max(...allGaps))) + row('All-Time Average Gap', formatGap(Math.round(allGaps.reduce((a,b)=>a+b,0)/allGaps.length))) : '';
  } else if (type === 'resisted') {
    iconClass = 'bg-sky-500/10 text-sky-500'; iconName = 'shield'; title.innerText = "Craving Defeats"; value.innerText = waves.length.toString(); 
    desc.innerText = `You have ridden out ${waves.length} urge wave(s) without giving in. Each defeated wave rewires your neural habit loops.`; 
    const todayWaves = waves.filter(w => new Date(w).toDateString() === new Date().toDateString()); extra.innerHTML = row('Defeated Today', `${todayWaves.length} wave(s)`) + row('Shield Badges Unlocked', waves.length >= 50 ? '3/3' : waves.length >= 10 ? '2/3' : waves.length >= 1 ? '1/3' : '0/3');
  } else if (type === 'currentGap') {
    const diff = logs.length > 0 ? (new Date().getTime() - logs[logs.length-1].timestamp) / 60000 : 0; const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined); const avgGap = allGaps.length ? Math.round(allGaps.reduce((a,b)=>a+b,0)/allGaps.length) : 0; iconClass = 'bg-sky-500/10 text-sky-500'; iconName = 'clock'; title.innerText = "Active Gap Stopwatch"; value.innerText = formatGap(Math.round(diff)); 
    if (avgGap > 0) { if (diff > avgGap) desc.innerText = `Outstanding! You are currently ${formatGap(Math.round(diff - avgGap))} past your all-time average gap!`; else desc.innerText = `Hold on! You are ${formatGap(Math.round(avgGap - diff))} away from reaching your average gap milestone.`; } else desc.innerText = "Setting your baseline timing gap. Every extra minute counts!";
    extra.innerHTML = avgGap ? row('All-Time Average Gap', formatGap(avgGap)) : '';
  } else if (type === 'momentum') {
    const todayLogs = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());
    const todayWaves = waves.filter(w => new Date(w).toDateString() === new Date().toDateString());
    const limitComponent = Math.max(0, 100 - (todayLogs.length / Math.max(1, settings.dailyLimit)) * 100);
    const waveComponent = Math.min(100, todayWaves.length * 25);
    const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
    const avgGapMin = allGaps.length ? allGaps.reduce((a,b)=>a+b,0) / allGaps.length : 0;
    const currentGapMin = logs.length > 0 ? (new Date().getTime() - logs[logs.length-1].timestamp) / 60000 : 0;
    const gapComponent = avgGapMin > 0 ? Math.min(100, (currentGapMin / avgGapMin) * 100) : 50;
    const score = Math.round(limitComponent*0.4 + waveComponent*0.3 + gapComponent*0.3);
    iconClass = 'bg-amber-500/10 text-amber-500'; iconName = 'zap'; title.innerText = "Today's Momentum Score"; value.innerText = (logs.length===0 && todayWaves.length===0) ? '0' : score.toString();
    desc.innerText = "Your Momentum Score blends how close you are to your daily limit, how many cravings you've resisted today, and how your current gap compares to your average — into one simple number.";
    pBox.classList.remove('hidden'); pLabel.innerText = "Score Breakdown"; pPct.innerText = `${score}/100`; pBar.style.width = `${Math.min(100,score)}%`; pBar.style.backgroundColor = score >= 60 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444';
    extra.innerHTML = row('Limit Adherence', `${Math.round(limitComponent)}/100`) + row('Cravings Resisted Today', `${todayWaves.length} (${Math.round(waveComponent)}/100)`) + row('Pace vs Average Gap', `${Math.round(gapComponent)}/100`);
  }
  
  icon.className = `w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`; icon.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5"></i>`;
  document.getElementById('statDetailModal').classList.remove('hidden'); if(window.lucide) window.lucide.createIcons();
}
function closeStatDetail() { document.getElementById('statDetailModal').classList.add('hidden'); }

function showShieldDashboard() {
  document.getElementById('modalShieldCount').innerText = waves.length;
  const now = new Date();
  const todayWaves = waves.filter(w => new Date(w).toDateString() === now.toDateString());
  const weekWaves = waves.filter(w => (now.getTime() - w) < 7 * 86400000);
  document.getElementById('modalShieldMins').innerText = `${todayWaves.length} today · ${weekWaves.length} this week`;

  const successRateEl = document.getElementById('modalSuccessRate');
  if(successRateEl) {
    if(waveAttempts.length >= 3) {
      const wonCount = waveAttempts.filter(a => a.outcome === 'won').length;
      const rate = Math.round((wonCount / waveAttempts.length) * 100);
      successRateEl.innerText = `${rate}% Success Rate (${wonCount}/${waveAttempts.length} attempts)`;
      successRateEl.classList.remove('hidden');
    } else { successRateEl.classList.add('hidden'); }
  }

  const milestones = [ {id: 'badge1', target: 1, label: '1 Shield'}, {id: 'badge10', target: 10, label: '10 Shields'}, {id: 'badge50', target: 50, label: '50 Shields'} ];
  milestones.forEach(m => {
    const card = document.getElementById(m.id); if(!card) return;
    const sub = document.getElementById(m.id + 'Sub'); const lock = card.querySelector('.badge-lock');
    card.className = "relative flex flex-col items-center p-3 rounded-2xl transition-all duration-500 border" + (waves.length < m.target ? " opacity-30 grayscale" : "");
    card.style.backgroundColor = "var(--input-bg)"; card.style.borderColor = "var(--card-border)";
    if(waves.length >= m.target) {
      card.classList.add('shadow-[0_0_15px_rgba(245,158,11,0.15)]');
      if(lock) lock.classList.add('hidden');
      if(sub) sub.innerText = m.label;
      if(m.id === 'badge10') { const i = card.querySelector('i[data-lucide="award"]'); if(i) i.classList.replace('text-gray-300', 'text-sky-400'); }
    } else {
      if(lock) lock.classList.remove('hidden');
      if(sub) sub.innerText = `${waves.length}/${m.target} to unlock`;
    }
  });

  document.getElementById('shieldDashboardModal').classList.remove('hidden'); if(window.lucide) window.lucide.createIcons();
}
function closeShieldDashboard() { document.getElementById('shieldDashboardModal').classList.add('hidden'); }

function exportJSON() {
  if(!logs || logs.length === 0) { showToast("No data to backup yet."); return; }
  const data = { logs, settings, triggers, waves, version: '1.5' };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `SmokeGap_Backup_${new Date().toISOString().slice(0,10)}.json`); document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  localStorage.setItem('smoke_last_backup', new Date().getTime().toString());
  const banner = document.getElementById('backupReminderBanner'); if(banner) banner.classList.add('hidden');
  showToast("Backup downloaded ✅");
}

function importJSON(event) {
  const file = event.target.files && event.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if(!data || !Array.isArray(data.logs)) { showToast("Invalid backup file"); return; }
      showConfirm("Restore this backup?", `This will replace your current data with ${data.logs.length} logs from the backup file. This cannot be undone.`, () => {
        localStorage.setItem('smoke_logs', JSON.stringify(data.logs));
        if(Array.isArray(data.waves)) localStorage.setItem('smoke_waves', JSON.stringify(data.waves));
        if(Array.isArray(data.triggers)) localStorage.setItem('smoke_triggers', JSON.stringify(data.triggers));
        if(data.settings) localStorage.setItem('smoke_settings', JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, data.settings)));
        localStorage.setItem('smoke_last_backup', new Date().getTime().toString());
        location.reload();
      });
    } catch(err) { showToast("Could not read that file"); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function checkBackupReminder() {
  const banner = document.getElementById('backupReminderBanner'); if(!banner) return;
  if(!logs || logs.length < 10) { banner.classList.add('hidden'); return; }
  const lastBackup = parseInt(localStorage.getItem('smoke_last_backup'));
  const daysSince = lastBackup ? Math.floor((new Date().getTime() - lastBackup) / 86400000) : Infinity;
  if(daysSince >= 7) {
    document.getElementById('backupReminderText').innerText = lastBackup ? `Last backup: ${daysSince} days ago` : "You haven't backed up your data yet";
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}

function resetData(type) { 
  if(type === '24h') { showConfirm("Delete last 24h logs?", "This will permanently remove cigarette logs from the last 24 hours. Your Shield achievements are never affected.", () => { const now = new Date().getTime(); logs = logs.filter(l => (now - l.timestamp) > 86400000); localStorage.setItem('smoke_logs', JSON.stringify(logs)); location.reload(); }); } 
  else { showConfirm("Wipe ALL data?", "This cannot be undone. All logs, settings, and tags will be erased.", () => { localStorage.clear(); location.reload(); }); }
}

function exportLogsCSV() {
  if(!logs || logs.length === 0) { showToast("No logs to export yet"); return; }
  let csvContent = "Timestamp,Date,Time,Gap_Minutes,Tags,Intensity,Latitude,Longitude\n";
  logs.forEach(l => {
    let d = new Date(l.timestamp); let tagsArr = [];
    if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags; else if (l.trigger) tagsArr = [l.trigger]; else tagsArr = ['Uncategorized'];
    let tagsStr = tagsArr.join(' | ');
    csvContent += `${l.timestamp},"${d.toLocaleDateString()}","${formatAppTime(d)}",${l.gap ?? ''},"${tagsStr}",${l.intensity||3},${l.lat||''},${l.lng||''}\n`;
  });
  let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); let url = URL.createObjectURL(blob); let link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `SmokeGap_Logs_${new Date().toISOString().slice(0,10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
}

function addCustomTrigger() { let val = document.getElementById('newTriggerInput').value.trim(); if(val && !triggers.includes(val)) { triggers.push(val); localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); document.getElementById('newTriggerInput').value = ''; renderTriggerSettingsList(); 
  const filterSelect = document.getElementById('historyTagFilter'); if(filterSelect) filterSelect.innerHTML += `<option value="${esc(val)}">${esc(val)}</option>`;
} }
function removeCustomTrigger(idx) { triggers.splice(idx, 1); localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); renderTriggerSettingsList(); }
function renderTriggerSettingsList() { const c = document.getElementById('triggerListSettings'); if(!c) return; c.innerHTML = triggers.map((t, idx) => `<span class="text-xs px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-medium" style="background-color: var(--input-bg); color: var(--text-main); border-color: var(--card-border);">${esc(t)} <button onclick="window.removeCustomTrigger(${idx})" class="text-red-500 font-bold hover:opacity-80">✕</button></span>`).join(''); }

window.setEditIntensity = function(val) {
  if(settings.haptics && navigator.vibrate) navigator.vibrate(10); currentIntensity = val;
  for(let i=1; i<=5; i++) {
    const b = document.getElementById('editInt'+i); if(!b) continue;
    b.className = "w-10 h-10 rounded-full border text-xs font-bold transition-all";
    if(i===val) { b.style.background = "var(--accent)"; b.style.color = "#fff"; b.style.boxShadow = "0 4px 12px var(--accent-glow)"; b.style.transform = "scale(1.1)"; b.style.borderColor = "transparent"; }
    else { b.style.background = "transparent"; b.style.borderColor = "var(--card-border)"; b.style.color = "var(--text-main)"; b.style.boxShadow = "none"; b.style.transform = "scale(1)"; }
  }
  const lbl = document.getElementById('editIntensityLabel'); if(lbl) lbl.innerText = INTENSITY_LABELS[val];
}

function openTriggerModal(logIdx = null) {
  editingLogIdx = logIdx !== null ? logIdx : logs.length - 1;
  const log = logs[editingLogIdx]; 
  if (Array.isArray(log.tags) && log.tags.length > 0) currentSelectedTags = [...log.tags]; else if (log.trigger) currentSelectedTags = [log.trigger]; else currentSelectedTags = [];
  
  window.setEditIntensity(log.intensity || 3);
  const d = new Date(log.timestamp); document.getElementById('editLogDate').value = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`; document.getElementById('editLogTime').value = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  renderModalTriggerGrid(); document.getElementById('triggerModal').classList.remove('hidden'); if(window.lucide) window.lucide.createIcons();
}

function renderModalTriggerGrid() {
  const grid = document.getElementById('modalTriggerGrid');
  grid.innerHTML = triggers.map((t, idx) => {
    const isSelected = currentSelectedTags.includes(t);
    const bgClass = isSelected ? 'text-white border-sky-400' : 'border-transparent';
    const inlineStyle = isSelected ? `style="background: var(--accent); box-shadow: 0 4px 15px var(--accent-glow);"` : `style="background: var(--input-bg); color: var(--text-main); border-color: var(--card-border);"`;
    return `<button onclick="window.toggleTag(${idx})" class="px-4 py-2.5 rounded-full text-xs font-semibold active:scale-95 transition-all border ${bgClass}" ${inlineStyle}>${esc(t)}</button>`;
  }).join('');
}

function toggleTag(idx) { const t = triggers[idx]; if(currentSelectedTags.includes(t)) currentSelectedTags = currentSelectedTags.filter(tag => tag !== t); else currentSelectedTags.push(t); renderModalTriggerGrid(); }

function saveTags() {
  if(editingLogIdx !== null && logs[editingLogIdx]) {
    const dateVal = document.getElementById('editLogDate').value; const timeVal = document.getElementById('editLogTime').value;
    if(dateVal && timeVal) { const dt = new Date(`${dateVal}T${timeVal}`); if(!isNaN(dt.getTime())) logs[editingLogIdx].timestamp = dt.getTime(); }
    logs[editingLogIdx].tags = [...currentSelectedTags]; logs[editingLogIdx].intensity = currentIntensity;
    logs.sort((a,b) => a.timestamp - b.timestamp);
    for (let i = 0; i < logs.length; i++) { logs[i].gap = i > 0 ? Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000) : null; }
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    try { updateUI(); } catch(err){}
    if(!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList'); if(!document.getElementById('page-insights').classList.contains('hidden')) requestAnimationFrame(() => renderAllCharts());
  }
  document.getElementById('triggerModal').classList.add('hidden');
}

window.deleteCurrentLog = function() {
    showConfirm("Delete this log?", "This action cannot be undone.", () => {
        if(editingLogIdx !== null && logs[editingLogIdx]) {
            window.undoLog(editingLogIdx, null);
            closeTriggerModal();
            showToast("Log deleted permanently.");
        }
    });
}

function closeTriggerModal() { document.getElementById('triggerModal').classList.add('hidden'); }

window.loadMoreHistory = function() {
    historyRenderLimit += 30;
    renderHistory('fullHistoryList');
}

function renderHistory(tId='fullHistoryList') {
  try {
    const c = document.getElementById(tId); if(!c) return;
    if(!logs || logs.length===0) { c.innerHTML="<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='inbox' class='w-6 h-6 opacity-50'></i> No logs recorded yet.</p>"; if(window.lucide) window.lucide.createIcons(); return; }
    
    let filteredLogs = logs.map((l, i) => ({ ...l, origIdx: i })).reverse();
    
    const filterSelect = document.getElementById('historyTagFilter');
    if (filterSelect && tId === 'fullHistoryList' && filterSelect.value !== 'all') {
        filteredLogs = filteredLogs.filter(l => {
            let tagsArr = [];
            if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
            else if (l.trigger) tagsArr = [l.trigger];
            return tagsArr.includes(filterSelect.value);
        });
        if(filteredLogs.length===0) { c.innerHTML="<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='filter' class='w-6 h-6 opacity-50'></i> No logs match this tag.</p>"; document.getElementById('historyLoadMore').classList.add('hidden'); if(window.lucide) window.lucide.createIcons(); return; }
    }

    let mappedLogs = tId === 'homeRecentLogs' ? filteredLogs.slice(0, 3) : filteredLogs.slice(0, historyRenderLimit);
    
    const btnBox = document.getElementById('historyLoadMore');
    if (btnBox && tId === 'fullHistoryList') {
        if (filteredLogs.length > historyRenderLimit) btnBox.classList.remove('hidden');
        else btnBox.classList.add('hidden');
    }

    if (tId === 'homeRecentLogs') { c.innerHTML = mappedLogs.map(l => renderHistoryItem(l)).join(''); } 
    else {
      let groups = {};
      mappedLogs.forEach(l => { const k = new Date(l.timestamp).toDateString(); if(!groups[k]) groups[k] = []; groups[k].push(l); });
      const todayStr = new Date().toDateString(); let yest = new Date(); yest.setDate(yest.getDate() - 1); const yestStr = yest.toDateString();
      let html = '';
      for (let k in groups) {
        let headerLabel = k;
        if (k === todayStr) headerLabel = 'TODAY'; else if (k === yestStr) headerLabel = 'YESTERDAY';
        else { const d = new Date(k); headerLabel = `${d.toLocaleDateString('en-US', {weekday:'short'}).toUpperCase()}, ${d.toLocaleDateString('en-US', {month:'short', day:'numeric'}).toUpperCase()}`; }
        html += `<div class="pt-4 pb-1"><h4 class="text-[10px] font-bold uppercase tracking-widest text-gray-500">${headerLabel}</h4></div>`;
        html += `<div class="space-y-3">` + groups[k].map(l => renderHistoryItem(l)).join('') + `</div>`;
      }
      c.innerHTML = html;
    }
    if(window.lucide) window.lucide.createIcons();
  } catch (err) { console.error("renderHistory Error", err); }
}

function renderHistoryItem(l) {
  const prev = l.origIdx > 0 ? logs[l.origIdx - 1] : null;
  let trendClass = 'bg-gray-500/10 text-gray-400', trendIcon = 'minus', valueColor = 'var(--accent)';
  if (l.gap !== null && l.gap !== undefined && prev && prev.gap !== null && prev.gap !== undefined) {
    if (l.gap > prev.gap) { trendClass = 'bg-emerald-500/10 text-emerald-500'; trendIcon = 'trending-up'; valueColor = '#10B981'; }
    else if (l.gap < prev.gap) { trendClass = 'bg-red-500/10 text-red-500'; trendIcon = 'trending-down'; valueColor = '#EF4444'; }
  }
  
  let tagsArr = [];
  if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
  else if (l.trigger) tagsArr = [l.trigger];
  else tagsArr = ['Uncategorized'];
  
  const visibleTags = tagsArr.slice(0, 2).map(esc).join(', ');
  const extraCount = tagsArr.length - 2; 
  const tagsDisplay = extraCount > 0 ? `${visibleTags} <span class="opacity-60">+${extraCount} more</span>` : visibleTags;
  
  let intensityDots = ''; let intVal = l.intensity || 3;
  for(let i=1; i<=5; i++) { intensityDots += `<div class="w-1.5 h-1.5 rounded-full" style="background-color: ${i <= intVal ? 'var(--accent)' : 'rgba(156,163,175,0.2)'};"></div>`; }

  const timeStr = l.timestamp ? formatAppTime(new Date(l.timestamp)) : '--:--';

  return `
  <div onclick="window.openTriggerModal(${l.origIdx})" class="premium-card p-4 flex justify-between items-center relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform hover:bg-gray-500/5">
    <div class="flex items-start gap-3 flex-1 min-w-0 pr-3">
      <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${trendClass}"><i data-lucide="${trendIcon}" class="w-3.5 h-3.5"></i></div>
      <div class="flex-1 min-w-0">
        <div class="font-bold tracking-wide flex items-center gap-2" style="color: var(--text-main);">${timeStr}<div class="flex gap-0.5 ml-2">${intensityDots}</div></div>
        <div class="text-[10px] font-bold uppercase mt-0.5 flex items-start gap-1" style="color: var(--text-muted);"><i data-lucide="tag" class="w-3 h-3 shrink-0 mt-0.5"></i><span class="leading-relaxed whitespace-normal break-words">${tagsDisplay}</span></div>
      </div>
    </div>
    <div class="numeric-display font-bold text-base shrink-0" style="color: ${valueColor};">${formatGap(l.gap)}</div>
  </div>`;
}

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter').value, now = new Date();
  if(filter === 'today') return logs.filter(l => l.timestamp >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
  if(filter === '7days') return logs.filter(l => l.timestamp >= new Date(now.getTime() - (7 * 86400000)).getTime());
  if(filter === '1month') return logs.filter(l => l.timestamp >= new Date(now.getTime() - (30 * 86400000)).getTime());
  return logs;
}
function setBadge(id, text, colorClass) { const b = document.getElementById(id); if(b) { if(text) { b.innerText = text; b.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${colorClass}`; b.classList.remove('hidden'); } else b.classList.add('hidden'); } }

function renderHeatmapCalendar(logsArray) {
    try {
      const container = document.getElementById('calendarHeatmap');
      if(!container) return;
      
      let dailyCounts = {};
      const today = new Date();
      today.setHours(0,0,0,0);
      
      for (let i = 27; i >= 0; i--) {
          let d = new Date(today);
          d.setDate(today.getDate() - i);
          dailyCounts[d.toDateString()] = 0;
      }
      
      logsArray.forEach(l => {
          let dStr = new Date(l.timestamp).toDateString();
          if(dailyCounts[dStr] !== undefined) dailyCounts[dStr]++;
      });

      let maxVal = Math.max(...Object.values(dailyCounts));
      if (maxVal === 0) maxVal = 1;

      let html = '';
      let dayCount = 0;
      let currentCol = '';
      
      Object.keys(dailyCounts).forEach((dStr) => {
          const count = dailyCounts[dStr];
          let intensity = 0;
          if (count > 0) {
              let ratio = count / maxVal;
              intensity = Math.ceil(ratio * 4); 
              if(intensity === 0) intensity = 1;
          }
          
          currentCol += `<div class="heat-cell" style="background-color: var(--heat-${intensity});" title="${count} cigarettes on ${dStr}"></div>`;
          dayCount++;
          
          if (dayCount % 7 === 0) {
              html += `<div class="heat-col">${currentCol}</div>`;
              currentCol = '';
          }
      });
      
      if (currentCol !== '') html += `<div class="heat-col">${currentCol}</div>`;
      container.innerHTML = html;
    } catch(e) {}
}

function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  const filter = document.getElementById('insightsDateFilter').value;
  const filterEl = document.getElementById('selectedFilterLabel');
  if(filterEl) filterEl.innerText = { today: 'Today', '7days': 'Last 7 Days', '1month': '1 Month', all: 'All Time' }[filter] || 'Selected Period';

  let activeWaves = waves;
  const now = new Date();
  if(filter === 'today') activeWaves = waves.filter(w => w >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
  else if(filter === '7days') activeWaves = waves.filter(w => w >= new Date(now.getTime() - (7 * 86400000)).getTime());
  else if(filter === '1month') activeWaves = waves.filter(w => w >= new Date(now.getTime() - (30 * 86400000)).getTime());

  const totalEvents = activeLogs.length + activeWaves.length;
  const winRate = totalEvents > 0 ? Math.round((activeWaves.length / totalEvents) * 100) : 0;
  
  document.getElementById('insightWinRate').innerText = `${winRate}%`;

  let totalSpend = (activeLogs.length * (settings.packPrice/settings.packSize)).toFixed(1);
  document.getElementById('insightPeriodSpend').innerText = `${settings.currency} ${totalSpend}`;
  document.getElementById('insightPeriodCount').innerText = `${activeLogs.length} Sticks`;

  const gappedLogs = activeLogs.filter(l => l.gap !== null && l.gap !== undefined);
  document.getElementById('insightAvgGap').innerText = gappedLogs.length > 0 ? formatGap(Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length)) : '--';

  let smartText = "Keep tracking to generate insights.";
  
  if(activeLogs.length > 0) {
    let hours = {}; activeLogs.forEach(l => { let h = new Date(l.timestamp).getHours(); hours[h] = (hours[h]||0)+1; });
    let peakHrInt = parseInt(Object.keys(hours).reduce((a,b) => hours[a] > hours[b] ? a : b));
    let peakDate = new Date(); peakDate.setHours(peakHrInt, 0, 0, 0);
    document.getElementById('insightPeakHour').innerText = formatAppTime(peakDate);
    
    let trigs = {}; let trigIntensitySum = {}; let trigIntensityCount = {};
    activeLogs.forEach(l => { 
      let tagsArr = [];
      if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
      else if (l.trigger) tagsArr = [l.trigger];
      else tagsArr = ['Uncategorized'];
      tagsArr.forEach(t => { 
        trigs[t] = (trigs[t]||0)+1; 
        const inten = l.intensity || 3;
        trigIntensitySum[t] = (trigIntensitySum[t]||0) + inten;
        trigIntensityCount[t] = (trigIntensityCount[t]||0) + 1;
      });
    });
    let topT = Object.keys(trigs).length > 0 ? Object.keys(trigs).reduce((a,b) => trigs[a] > trigs[b] ? a : b) : '--';
    document.getElementById('insightTopTrigger').innerText = topT.length > 15 ? topT.substring(0,12)+'..' : topT;
    
    let perDay = {}; activeLogs.forEach(l => { const k = new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}); perDay[k] = (perDay[k]||0)+1; });
    let topDay = Object.keys(perDay).reduce((a,b) => perDay[a] > perDay[b] ? a : b);
    document.getElementById('insightHeaviestDay').innerText = `${topDay} (${perDay[topDay]})`;
    
    smartText = `You mostly struggle around <strong>${formatAppTime(peakDate)}</strong>, heavily triggered by <strong>${topT}</strong>.`;

    const intensityCandidates = Object.keys(trigIntensityCount).filter(t => trigIntensityCount[t] >= 2);
    if(intensityCandidates.length > 0) {
      const avgIntensityByTrigger = {}; intensityCandidates.forEach(t => avgIntensityByTrigger[t] = trigIntensitySum[t] / trigIntensityCount[t]);
      const hardestTrigger = intensityCandidates.reduce((a,b) => avgIntensityByTrigger[a] > avgIntensityByTrigger[b] ? a : b);
      if(avgIntensityByTrigger[hardestTrigger] >= 3.3 && hardestTrigger !== topT) {
        smartText += ` Note: <strong>${hardestTrigger}</strong> brings your most intense cravings.`;
      }
    }

  } else {
    document.getElementById('insightPeakHour').innerText = '--';
    document.getElementById('insightTopTrigger').innerText = '--';
    document.getElementById('insightHeaviestDay').innerText = '--';
  }
  
  document.getElementById('smartTextInsight').innerHTML = smartText;

  let pricePerStick = settings.packPrice / settings.packSize;
  let totalSavedLifetime = 0;
  let baselineGapMs = parseInt(localStorage.getItem('smoke_baseline_gap'));
  if (!baselineGapMs && logs.length > 1) { let limit = Math.min(logs.length, 10); baselineGapMs = (logs[limit - 1].timestamp - logs[0].timestamp) / (limit - 1); if (logs.length >= 10) localStorage.setItem('smoke_baseline_gap', baselineGapMs); }
  if (!baselineGapMs || isNaN(baselineGapMs) || baselineGapMs <= 0) { baselineGapMs = (24 * 60 * 60 * 1000) / settings.dailyLimit; }
  if (logs.length > 0) {
      let periodStartTime = logs[0].timestamp;
      let timeElapsed = new Date().getTime() - periodStartTime;
      let expectedCigs = 1 + (timeElapsed / baselineGapMs);
      let actualCigs = logs.length;
      totalSavedLifetime = Math.max(0, expectedCigs - actualCigs) * pricePerStick;
  }
  document.getElementById('insightTotalSaved').innerText = `${settings.currency} ${Math.round(totalSavedLifetime)}`;
  
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  document.getElementById('insightLongestGap').innerText = allGaps.length > 0 ? formatGap(Math.max(...allGaps)) : '--';

  setBadge('badge-chart1', gappedLogs.length > 0 ? `Avg ${formatGap(Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length))}` : '', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20');
  setBadge('badge-chart2', activeLogs.length > 0 ? `${activeLogs.length} Total` : '', 'bg-amber-500/10 text-amber-500 border-amber-500/20');

  const labels = activeLogs.length > 0 ? activeLogs.map(l => {
    let d = new Date(l.timestamp);
    if (filter === 'today') return formatAppTime(d);
    if (filter === '7days') return d.toLocaleDateString([], {weekday:'short'});
    return d.toLocaleDateString([], {month:'short', day:'numeric'});
  }) : ['No Data'];
  
  const gaps = activeLogs.length > 0 ? activeLogs.map(l => l.gap) : [0];
  const chartTextColor = (isLightTheme()) ? '#64748B' : '#9CA3AF';

  const proOptions = { responsive: true, maintainAspectRatio: false, animation: { duration: 600, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, layout: { padding: { left: 0, right: 0, top: 10, bottom: 0 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)', titleColor: '#FFFFFF', bodyColor: '#10B981', padding: 12, cornerRadius: 12, displayColors: false } }, scales: { x: { grid: { display: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, maxTicksLimit: 4 } }, y: { beginAtZero: true, grid: { color: 'rgba(156, 163, 175, 0.05)', drawBorder: false }, ticks: { color: chartTextColor, font: { size: 9, weight: '600' }, padding: 6 } } } };
  const createGradient = (ctx, colorHex) => { let g = ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, colorHex); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  function upsertChart(key, ctx, config) { const existing = myChartInstances[key]; if (existing && existing.config.type === config.type) { existing.data = config.data; if (config.options) existing.options = config.options; existing.update(); } else { if (existing) existing.destroy(); myChartInstances[key] = new Chart(ctx, config); } }

  const fullDateTimeTooltip = { callbacks: { title: (items) => { if(!items.length) return ''; const l = activeLogs[items[0].dataIndex]; if(!l) return ''; const d = new Date(l.timestamp); return `${d.toLocaleDateString([], {month:'short', day:'numeric'})} · ${formatAppTime(d)}`; } } };

  try {
    const ctx1 = document.getElementById('chart1').getContext('2d');
    upsertChart(1, ctx1, { type: 'line', data: { labels: labels, datasets: [{ label: 'Gap (mins)', data: gaps, borderColor: '#10B981', backgroundColor: createGradient(ctx1, 'rgba(16, 185, 129, 0.25)'), borderWidth: 3, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 15 }] }, options: { ...proOptions, plugins: { ...proOptions.plugins, tooltip: { ...proOptions.plugins.tooltip, ...fullDateTimeTooltip } }, scales: { ...proOptions.scales, x: { ...proOptions.scales.x, offset: true } } }, plugins: [crosshairPlugin] });
  } catch(e){}

  try {
    let dayMap = {}; activeLogs.forEach(l => { let d = document.getElementById('insightsDateFilter').value === '7days' ? new Date(l.timestamp).toLocaleDateString([], {weekday:'short'}) : new Date(l.timestamp).toLocaleDateString([], {month:'short', day:'numeric'}); dayMap[d] = (dayMap[d] || 0) + 1; });
    let dayLabels = Object.keys(dayMap), dayCounts = Object.values(dayMap); if(dayLabels.length === 0) { dayLabels = ['Today']; dayCounts = [0]; }
    const ctx2 = document.getElementById('chart2').getContext('2d');
    upsertChart(2, ctx2, { type: 'bar', data: { labels: dayLabels, datasets: [{ label: 'Count', data: dayCounts, backgroundColor: (isLightTheme()) ? '#2563EB' : '#F59E0B', borderRadius: Number.MAX_VALUE, borderSkipped: false, maxBarThickness: 16 }, { label: 'Limit', data: dayLabels.map(() => settings.dailyLimit), type: 'line', borderColor: '#EF4444', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }] }, options: { ...proOptions, scales: { x: { ...proOptions.scales.x, offset: true }, y: { ...proOptions.scales.y } } }, plugins: [crosshairPlugin] });
  } catch(e){}

  try {
    let cumulativeSpend = 0; let spendData = []; let savedData = [];
    if (activeLogs.length > 0) {
      let periodStartTime = activeLogs[0].timestamp;
      activeLogs.forEach((l, i) => {
        cumulativeSpend += pricePerStick; spendData.push(cumulativeSpend.toFixed(1));
        let timeElapsed = l.timestamp - periodStartTime; let expectedCigs = 1 + (timeElapsed / baselineGapMs); let actualCigs = i + 1;
        let savedAmount = Math.max(0, expectedCigs - actualCigs) * pricePerStick; savedData.push(savedAmount.toFixed(1));
      });
    }
    const ctx3 = document.getElementById('chart3').getContext('2d');
    upsertChart(3, ctx3, { type: 'line', data: { labels: labels, datasets: [{ label: 'Spent', data: spendData, borderColor: '#EF4444', backgroundColor: createGradient(ctx3, 'rgba(239, 68, 68, 0.15)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHitRadius: 15 }, { label: 'Saved', data: savedData, borderColor: '#10B981', backgroundColor: createGradient(ctx3, 'rgba(16, 185, 129, 0.15)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHitRadius: 15 }] }, options: { ...proOptions, plugins: { ...proOptions.plugins, tooltip: { ...proOptions.plugins.tooltip, ...fullDateTimeTooltip } }, scales: { ...proOptions.scales, x: { ...proOptions.scales.x, offset: true } } }, plugins: [crosshairPlugin] });
    let finalSaved = savedData.length > 0 ? savedData[savedData.length - 1] : '0.0';
    setBadge('badge-chart3', activeLogs.length > 0 ? `Saved ${settings.currency} ${finalSaved}` : '', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20');
  } catch(e){}

  try {
    const ctx4 = document.getElementById('chart4').getContext('2d');
    upsertChart(4, ctx4, { type: 'doughnut', data: { labels: ['Smoked', 'Resisted'], datasets: [{ data: [activeLogs.length, activeWaves.length], backgroundColor: ['#EF4444', '#0EA5E9'], borderWidth: 0, cutout: '76%' }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: chartTextColor } } } }, plugins: [centerTextPlugin] });
  } catch(e){}

  try {
    const ctx5 = document.getElementById('chart5').getContext('2d');
    const triggerCounts = triggers.map(t => activeLogs.filter(l => {
        let tagsArr = [];
        if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
        else if (l.trigger) tagsArr = [l.trigger];
        else tagsArr = ['Uncategorized'];
        return tagsArr.includes(t);
    }).length);
    const topTriggerIdx = triggerCounts.length ? triggerCounts.indexOf(Math.max(...triggerCounts)) : -1;
    setBadge('badge-chart5', (topTriggerIdx >= 0 && triggerCounts[topTriggerIdx] > 0) ? `Top: ${triggers[topTriggerIdx]}` : '', 'bg-purple-500/10 text-purple-500 border-purple-500/20');
    upsertChart(5, ctx5, { type: 'doughnut', data: { labels: triggers, datasets: [{ data: triggerCounts, backgroundColor: triggers.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]), borderWidth: 0, cutout: '76%' }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: chartTextColor } } } }, plugins: [centerTextPlugin] });
  } catch(e){}

  try {
    const dayParts = ['Morning', 'Afternoon', 'Evening', 'Night']; const partOf = (hr) => hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 21 ? 2 : 3;
    let triggerByPart = {}; triggers.forEach(t => triggerByPart[t] = [0, 0, 0, 0]);
    activeLogs.forEach(l => { 
      let tagsArr = [];
      if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags; else if (l.trigger) tagsArr = [l.trigger]; else tagsArr = ['Uncategorized'];
      tagsArr.forEach(tg => { if (triggerByPart[tg]) triggerByPart[tg][partOf(new Date(l.timestamp).getHours())]++; }); 
    }); 
    let wavesByPart = [0, 0, 0, 0]; activeWaves.forEach(w => wavesByPart[partOf(new Date(w).getHours())]++);

    let topTriggers = triggers.map(t => ({name: t, count: triggerByPart[t].reduce((a,b)=>a+b,0)}))
                              .sort((a,b) => b.count - a.count)
                              .slice(0, 4)
                              .map(x => x.name);
                              
    let otherByPart = [0, 0, 0, 0];
    triggers.forEach(t => {
        if(!topTriggers.includes(t)) {
            for(let i=0; i<4; i++) otherByPart[i] += triggerByPart[t][i];
        }
    });

    const partTotals = dayParts.map((_, i) => triggers.reduce((sum, t) => sum + triggerByPart[t][i], 0));
    const peakPartIdx = partTotals.some(v => v > 0) ? partTotals.indexOf(Math.max(...partTotals)) : -1;
    setBadge('badge-chart6', peakPartIdx >= 0 ? `Peak: ${dayParts[peakPartIdx]}` : '', 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20');
    
    const chart6El = document.getElementById('chart6');
    if (chart6El) {
      let datasets = topTriggers.map((t, i) => ({ label: t, data: triggerByPart[t], backgroundColor: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 0, maxBarThickness: 32, stack: 'triggers' }));
      if(otherByPart.some(v => v > 0)) datasets.push({ label: 'Other Triggers', data: otherByPart, backgroundColor: '#9CA3AF', borderRadius: 0, maxBarThickness: 32, stack: 'triggers' });
      datasets.push({ label: 'Resisted', data: wavesByPart, backgroundColor: '#0EA5E9', borderRadius: 0, maxBarThickness: 32, stack: 'resisted' });
      upsertChart(6, chart6El.getContext('2d'), { type: 'bar', data: { labels: dayParts, datasets: datasets }, options: { ...proOptions, scales: { x: { ...proOptions.scales.x, stacked: true, offset: true }, y: { ...proOptions.scales.y, stacked: true, ticks: { ...proOptions.scales.y.ticks, precision: 0 } } }, plugins: { ...proOptions.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { size: 9 }, color: chartTextColor } } } } });
    }
  } catch(e){}
  
  renderHeatmapCalendar(logs);
  renderHeatMap('mapContainer', activeLogs);
}

function renderHeatMap(containerId, activeLogs) {
  try {
    const mapEl = document.getElementById(containerId); if(!mapEl) return;
    let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng), lat = lastWithLoc ? lastWithLoc.lat : 25.2048, lng = lastWithLoc ? lastWithLoc.lng : 55.2708;
    let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng, 1.0]);
    const isModal = containerId === 'mapModalContainer'; 
    let m = isModal ? modalMapInstance : mapInstance;

    if (m) { 
      try { m.remove(); } catch(e) {} 
      if (isModal) modalMapInstance = null; else mapInstance = null; 
    }
    if (mapEl._leaflet_id) { mapEl._leaflet_id = null; mapEl.innerHTML = ""; }

    m = L.map(containerId, {zoomControl: false, attributionControl: false}).setView([lat, lng], 13);
    L.tileLayer((isLightTheme()) ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom: 19}).addTo(m);
    
    if (isModal) modalMapInstance = m; else mapInstance = m;
    
    if(heatPoints.length > 0 && window.L.heatLayer) m._smokegapHeat = L.heatLayer(heatPoints, {radius: 28, blur: 18, maxZoom: 17, minOpacity: 0.4}).addTo(m);
    else m._smokegapMarker = L.marker([lat, lng]).addTo(m);

    setTimeout(() => { try { m.invalidateSize(); } catch(e){} }, 250);
  } catch(e) {}
}

function openMapModal() { document.getElementById('mapModal').classList.remove('hidden'); setTimeout(() => { renderHeatMap('mapModalContainer', getFilteredLogs()); }, 200); }
function closeMapModal() { document.getElementById('mapModal').classList.add('hidden'); if(modalMapInstance) { try { modalMapInstance.remove(); } catch(e){} modalMapInstance = null; } }
function initDragAndDrop() { const container = document.getElementById('chartContainer'); if(!container || !window.Sortable) return; new Sortable(container, { handle: '.drag-handle', animation: 200, ghostClass: 'sortable-ghost', onEnd: function () { localStorage.setItem('smoke_chart_order', JSON.stringify([...container.children].map(c => c.id))); } }); }
function loadChartOrder() { const savedOrder = JSON.parse(localStorage.getItem('smoke_chart_order')); if(!savedOrder) return; const container = document.getElementById('chartContainer'); savedOrder.forEach(id => { const card = document.getElementById(id); if(card) container.appendChild(card); }); }

// EXPORT ALL TO WINDOW
window.enterPin = enterPin; window.clearPin = clearPin; window.setupPin = setupPin; window.renderHistory = renderHistory;
window.handleLogClick = handleLogClick; window.switchTab = switchTab; window.updateSettings = updateSettings; window.resetData = resetData; 
window.startSmokeTakeover = startSmokeTakeover; window.closeSmokeTakeover = closeSmokeTakeover; window.toggleTakeoverTag = toggleTakeoverTag; window.cancelSmokeTakeover = cancelSmokeTakeover;
window.openTriggerModal = openTriggerModal; window.closeTriggerModal = closeTriggerModal; window.toggleTag = toggleTag; window.saveTags = saveTags;
window.openWaveModal = openWaveModal; window.closeWaveModal = closeWaveModal; window.startWave = startWave; window.cancelActiveWave = cancelActiveWave;
window.renderAllCharts = renderAllCharts; window.openMapModal = openMapModal; window.closeMapModal = closeMapModal;
window.showStatDetail = showStatDetail; window.closeStatDetail = closeStatDetail; window.showShieldDashboard = showShieldDashboard; window.closeShieldDashboard = closeShieldDashboard;
window.exportLogsCSV = exportLogsCSV; window.addCustomTrigger = addCustomTrigger; window.removeCustomTrigger = removeCustomTrigger;
window.closeConfirmModal = closeConfirmModal; window.confirmYes = confirmYes; window.setTakeoverIntensity = setTakeoverIntensity; window.exportJSON = exportJSON; window.importJSON = importJSON;
window.closePinSetupModal = closePinSetupModal; window.savePinSetup = savePinSetup; window.setHeroStyle = setHeroStyle;
window.requestNotifPermission = requestNotifPermission; window.toggleNotifSetting = toggleNotifSetting;
