let logs = [];
try {
  let raw = localStorage.getItem('smoke_logs');
  if(raw) logs = JSON.parse(raw);
  if(!Array.isArray(logs)) logs = [];
} catch(e) { logs = []; }

// ==================== LOGS DERIVED CACHE ====================
// Single-pass cache for values used every 1s tick — avoids O(n) scans per tick
const logsCache = { todayStr: '', todayCount: 0, avgGapMs: 3600000 };
function recomputeLogsCache() {
  const nowStr = new Date().toDateString();
  let todayCount = 0, gapSum = 0, gapN = 0;
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    if (l.timestamp && new Date(l.timestamp).toDateString() === nowStr) todayCount++;
    if (l.gap !== null && l.gap !== undefined) { gapSum += l.gap; gapN++; }
  }
  logsCache.todayStr = nowStr;
  logsCache.todayCount = todayCount;
  logsCache.avgGapMs = gapN ? (gapSum / gapN) * 60000 : 3600000;
}
function ensureLogsCacheFresh() {
  const nowStr = new Date().toDateString();
  if (logsCache.todayStr !== nowStr) {
    // Day rolled over — recount today's count only
    let todayCount = 0;
    for (let i = 0; i < logs.length; i++) {
      if (logs[i].timestamp && new Date(logs[i].timestamp).toDateString() === nowStr) todayCount++;
    }
    logsCache.todayStr = nowStr;
    logsCache.todayCount = todayCount;
  }
}

const DEFAULT_SETTINGS = {
  theme: 'white', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED', timeFormat: '12h', motivation: '', autoReduce: false, quitDate: '',
  notifWaveComplete: true, notifGapWidened: true, notifInactivity: true, notifPredictive: true, notifEnableSos: false
};
let settings;
try { settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('smoke_settings')) || {}); } catch(e) { settings = Object.assign({}, DEFAULT_SETTINGS); }
if (!settings.packSize || settings.packSize <= 0) settings.packSize = 20;
if (!settings.timeFormat) settings.timeFormat = '12h';

// Performance monitoring
const perfMetrics = {
  appLoadStart: Date.now(),
  firstPaint: null,
  interactive: null
};

// Track First Contentful Paint
if ('PerformanceObserver' in window) {
  try {
    const paintObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      entries.forEach(entry => {
        if (entry.name === 'first-contentful-paint') {
          perfMetrics.firstPaint = entry.startTime;
          console.log(`⚡ First Paint: ${entry.startTime.toFixed(0)}ms`);
        }
      });
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  } catch (e) {}
}

// Track Time to Interactive
window.addEventListener('load', () => {
  perfMetrics.interactive = Date.now() - perfMetrics.appLoadStart;
  console.log(`⚡ Time to Interactive: ${perfMetrics.interactive}ms`);

  // Report to analytics if available
  if (window.posthog) {
    posthog.capture('performance_metrics', {
      first_paint_ms: perfMetrics.firstPaint,
      time_to_interactive_ms: perfMetrics.interactive,
      app_load_start: perfMetrics.appLoadStart
    });
  }
});

if ('serviceWorker' in navigator) {
  // Register service worker with retry logic
  registerServiceWorker();
}

async function registerServiceWorker(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      console.log("✅ Service Worker registered successfully");

      // Wait for service worker to be active
      if (reg.installing) {
        console.log("⏳ Service Worker installing...");
        await new Promise((resolve) => {
          reg.installing.addEventListener('statechange', (e) => {
            if (e.target.state === 'activated') {
              console.log("✅ Service Worker activated");
              resolve();
            }
          });
        });
      } else if (reg.active) {
        console.log("✅ Service Worker already active");
      }

      // Check if app is ready for offline use
      if (reg.active) {
        const mc = new MessageChannel();
        mc.port1.onmessage = (e) => {
          if (e.data && e.data.version) {
            console.log("✅ Offline cache ready - Version:", e.data.version);
            setTimeout(() => { showOfflineReadyToast(); }, 3000);
          }
        };
        reg.active.postMessage({ type: 'GET_CACHE_STATUS' }, [mc.port2]);
      }

      // Listen for updates
      reg.addEventListener('updatefound', () => {
        console.log("🔄 Service Worker update found");
      });

      return; // Success, exit retry loop
    } catch (err) {
      console.error(`❌ Service Worker registration attempt ${i + 1} failed:`, err);
      if (i < retries - 1) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  console.error("❌ Service Worker registration failed after all retries");
}

function showOfflineReadyToast() {
  // Only show if not shown before in this session
  if (sessionStorage.getItem('offline_ready_shown')) return;
  sessionStorage.setItem('offline_ready_shown', 'true');

  const toast = document.createElement('div');
  toast.className = 'fixed bottom-24 left-4 right-4 z-[10002] premium-card p-3 text-center text-xs font-semibold shadow-lg transition-all duration-500';
  toast.style.background = 'var(--card-bg)';
  toast.style.color = 'var(--text-main)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(20px)';
  toast.innerHTML = `
    <div class="flex items-center justify-center gap-2">
      <i data-lucide="wifi-off" class="w-4 h-4 text-emerald-500"></i>
      <span>App ready for offline use</span>
    </div>
  `;
  document.body.appendChild(toast);

  // Initialize lucide icon
  refreshIcons();

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// PWA Install Prompt
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  setTimeout(() => {
    if (deferredInstallPrompt && logs.length >= 3) {
      showInstallBanner();
    }
  }, 5000);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.add('hidden');
  showToast('pause installed! 🎉');
});

function showInstallBanner() {
  const existing = document.getElementById('installBanner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.className = 'fixed bottom-36 left-4 right-4 z-[10002] premium-card p-4 flex items-center gap-3 mx-auto max-w-md shadow-2xl';
  banner.style.background = 'var(--modal-bg)';
  banner.innerHTML = `
    <div class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style="background: var(--accent-glow);">
      <i data-lucide="download" class="w-5 h-5" style="color: var(--accent);"></i>
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-xs font-bold" style="color: var(--text-main);">Install pause</p>
      <p class="text-[10px]" style="color: var(--text-muted);">Add to your home screen for quick access</p>
    </div>
    <button onclick="window.installApp()" class="px-4 py-2 rounded-xl text-xs font-bold text-white shrink-0 active:scale-95 transition-transform" style="background: var(--accent);">Install</button>
    <button onclick="this.closest('#installBanner').remove()" class="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style="color: var(--text-muted);"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
  `;
  document.body.appendChild(banner);
  refreshIcons();
}

window.installApp = function() {
  if (!deferredInstallPrompt) { showToast('Already installed or not supported'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      showToast('Installing pause...');
    }
    deferredInstallPrompt = null;
    const banner = document.getElementById('installBanner');
    if (banner) banner.remove();
  });
}

let lastReduceDate = localStorage.getItem('smoke_last_reduce_date');
if (settings.autoReduce) {
    let nowStr = new Date().toDateString();
    if (!lastReduceDate) {
        localStorage.setItem('smoke_last_reduce_date', nowStr);
    } else {
        let diffDays = Math.floor((new Date() - new Date(lastReduceDate)) / (1000 * 60 * 60 * 24));
        let weeksMissed = Math.floor(diffDays / 7);
        if (weeksMissed > 0 && settings.dailyLimit > 2) {
            let decrement = Math.min(weeksMissed, settings.dailyLimit - 2);
            settings.dailyLimit -= decrement;
            localStorage.setItem('smoke_settings', JSON.stringify(settings));
            localStorage.setItem('smoke_last_reduce_date', nowStr);
        }
    }
}

const DEFAULT_TRIGGERS = ['🏠 Home', '💼 Work', '🚗 Car / Commute', '🎉 Outside / Social', '😰 Stress', '🍽️ After Meal', '☕ Chai / Coffee', '📱 Boredom', '👥 Peer Pressure', '🍺 Alcohol', '😡 Anger', '🌙 Habit'];
let triggers;
try { triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || DEFAULT_TRIGGERS; } catch(e) { triggers = DEFAULT_TRIGGERS; }
const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1', '#F43F5E', '#84CC16', '#0EA5E9', '#D946EF', '#EAB308', '#1D4ED8', '#047857', '#B45309', '#BE123C', '#6D28D9'];

const INTENSITY_LABELS = {1: 'Mild', 2: 'Light', 3: 'Moderate', 4: 'Severe', 5: 'Extreme'};
const MOODS = [
  {id: 'calm', icon: 'smile', label: 'Calm', color: '#10B981'},
  {id: 'happy', icon: 'sun', label: 'Happy', color: '#F59E0B'},
  {id: 'neutral', icon: 'meh', label: 'Neutral', color: '#6B7280'},
  {id: 'anxious', icon: 'zap', label: 'Anxious', color: '#F97316'},
  {id: 'stressed', icon: 'alert-triangle', label: 'Stressed', color: '#EF4444'},
  {id: 'frustrated', icon: 'flame', label: 'Frustrated', color: '#DC2626'},
  {id: 'sad', icon: 'cloud-rain', label: 'Sad', color: '#3B82F6'},
  {id: 'craving', icon: 'cigarette', label: 'Craving', color: '#8B5CF6'}
];
const LEGACY_MOOD_EMOJI = { '😌':'calm', '😊':'happy', '😐':'neutral', '😰':'anxious', '😣':'stressed', '😡':'frustrated', '😢':'sad', '🙏':'craving' };
function moodDefFor(val) {
  if (!val) return null;
  return MOODS.find(m => m.id === val) || MOODS.find(m => LEGACY_MOOD_EMOJI[val] === m.id) || null;
}
function moodChipHtml(m, idx, toggleName, showLabel) {
  const isActive = currentMood === m.id;
  const activeStyle = isActive
    ? `background:${m.color};border-color:${m.color};color:#fff;box-shadow:0 4px 16px ${m.color}66;`
    : `background:var(--input-bg);border-color:var(--card-border);color:var(--text-main);`;
  const shape = showLabel
    ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-semibold transition-all active:scale-95'
    : 'w-9 h-9 rounded-full inline-flex items-center justify-center border transition-all active:scale-90';
  const iconSize = showLabel ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return `<button onclick="window.${toggleName}(${idx})" class="${shape}" style="${activeStyle}" title="${m.label}"><i data-lucide="${m.icon}" class="${iconSize}"></i>${showLabel ? `<span>${m.label}</span>` : ''}</button>`;
}

const HEALTH_MILESTONES = [
  {mins: 20, emoji: '❤️', title: 'Heart Rate Normalizes', desc: 'Blood pressure begins to drop after your last cigarette.'},
  {mins: 120, emoji: '🫁', title: 'Oxygen Improves', desc: 'Oxygen levels in your blood return toward normal.'},
  {mins: 480, emoji: '💨', title: 'CO Level Drops', desc: 'Carbon monoxide is cleared from your bloodstream.'},
  {mins: 1440, emoji: '💪', title: 'Heart Attack Risk Drops', desc: 'Risk of heart attack begins to decrease.'},
  {mins: 2880, emoji: '👅', title: 'Senses Heighten', desc: 'Nerve endings regrow. Taste and smell improve.'},
  {mins: 4320, emoji: '🧘', title: 'Breathing Eases', desc: 'Bronchial tubes relax. Lung capacity improves.'},
  {mins: 10080, emoji: '🧠', title: 'Mood Stabilizes', desc: 'Nicotine receptors return to normal levels.'},
  {mins: 20160, emoji: '🏃', title: 'Circulation Boosts', desc: 'Blood circulation improves significantly.'},
  {mins: 43200, emoji: '🌟', title: 'Lung Function Grows', desc: 'Cilia regrow and lung function increases.'},
];
let waves = [];
try { waves = JSON.parse(localStorage.getItem('smoke_waves')) || []; if(!Array.isArray(waves)) waves = []; } catch(e) { waves = []; }

let progressPhotos = [];
try { progressPhotos = JSON.parse(localStorage.getItem('smoke_progress_photos')) || []; if(!Array.isArray(progressPhotos)) progressPhotos = []; } catch(e) { progressPhotos = []; }

let waveAttempts = [];
try { waveAttempts = JSON.parse(localStorage.getItem('smoke_wave_attempts')) || []; if(!Array.isArray(waveAttempts)) waveAttempts = []; } catch(e) { waveAttempts = []; }
function logWaveAttempt(outcome, customDurationMs) {
  const durMs = customDurationMs !== undefined ? customDurationMs : waveDurationMs;
  const mins = customDurationMs !== undefined ? +(durMs / 60000).toFixed(2) : Math.round(durMs / 60000);
  waveAttempts.push({ outcome, timestamp: Date.now(), durationMs: durMs, minutes: mins });
  if(waveAttempts.length > 500) waveAttempts = waveAttempts.slice(-500);
  localStorage.setItem('smoke_wave_attempts', JSON.stringify(waveAttempts));
}

let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let waveDurationMs = parseInt(localStorage.getItem('smoke_wave_duration')) || 600000;
let lastPeakNudgeDate = localStorage.getItem('smoke_peak_nudge') || '';

let gapWidenedNotified = localStorage.getItem('smoke_gap_widened_notified') === 'true';
let inactivityNotified = false;

let sosTimer = null;
let sosSecs = 15;

function hashPin(p) { let h = 0; for (let i = 0; i < p.length; i++) { h = ((h << 5) - h) + p.charCodeAt(i); h |= 0; } return h.toString(36); }
function esc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c])); }

let storedPinHash = localStorage.getItem('smoke_pin_hash');
let hasPin = !!storedPinHash;
let enteredPin = "";

let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;
let mainTimer = null, waveTimer = null, cooldownTimer = null;
let editingLogIdx = null;
let currentSelectedTags = [];
let currentIntensity = 3;
let currentMood = null;
let takeoverTimer = null;
let takeoverCountdown = 6;
let historyRenderLimit = 30;

// Debounced lucide icon initialization — batches rapid calls into one
let _lucideTimer = null;
function refreshIcons() {
  if (_lucideTimer) clearTimeout(_lucideTimer);
  _lucideTimer = setTimeout(() => {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }, 30);
}

let currentWatchStyle = parseInt(localStorage.getItem('smoke_watch_style')) || 1;
if (currentWatchStyle < 1 || currentWatchStyle > 3) currentWatchStyle = 1;
let touchStartXCoord = 0;

function touchStartX(e) {
  if(e.changedTouches && e.changedTouches.length > 0) {
    touchStartXCoord = e.changedTouches[0].clientX;
  }
}

function touchEndX(e) {
  if(e.changedTouches && e.changedTouches.length > 0) {
    let diff = e.changedTouches[0].clientX - touchStartXCoord;
    if(Math.abs(diff) > 40) {
      if(diff > 0) {
        currentWatchStyle = currentWatchStyle === 1 ? 3 : currentWatchStyle - 1;
      } else {
        currentWatchStyle = currentWatchStyle === 3 ? 1 : currentWatchStyle + 1;
      }
      window.switchWatchStyle(currentWatchStyle);
    }
  }
}

window.cycleNextWatch = function() {
  currentWatchStyle = currentWatchStyle >= 3 ? 1 : currentWatchStyle + 1;
  window.switchWatchStyle(currentWatchStyle);
}

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
  
  let lastTick = 0;
  function update() {
    if (!isHolding) return;
    const elapsed = Date.now() - holdStartTime;
    const pct = Math.min((elapsed / 800) * 100, 100);
    if(progressEl) progressEl.style.width = pct + '%';

    // tick haptics at 25%, 50%, 75%
    const tickPct = Math.floor(pct / 25) * 25;
    if (tickPct > lastTick && tickPct > 0 && tickPct < 100) {
      lastTick = tickPct;
      if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
    }

    if (elapsed >= 800) {
      isHolding = false;
      if(btnEl) btnEl.classList.remove('is-holding');
      if(progressEl) progressEl.style.width = '100%';
      if(textEl) textEl.innerText = "Done";
      if (settings.haptics && navigator.vibrate) navigator.vibrate([30, 50, 30]);
      
      try {
        if(settings.notifEnableSos) {
          triggerSosInterrupterFirst();
        } else {
          actuallyLogCigarette();
        }
      } catch(err) { console.error("Error logging", err); }
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

const APP_FONT_FAMILY = '"General Sans", -apple-system, BlinkMacSystemFont, sans-serif';
const NUMERIC_FONT_FAMILY = '"Space Grotesk", monospace';
if (typeof Chart !== 'undefined') {
  try { Chart.defaults.color = '#64748B'; } catch(e) {}
  try { Chart.defaults.font.family = APP_FONT_FAMILY; } catch(e) {}
}
const crosshairPlugin = { id: 'crosshair', afterDraw: chart => { if (chart.tooltip?._active?.length && (chart.config.type === 'line' || chart.config.type === 'bar')) { const activePoint = chart.tooltip._active[0]; const ctx = chart.ctx; const x = activePoint.element.x; ctx.save(); ctx.beginPath(); ctx.moveTo(x, chart.scales.y.top); ctx.lineTo(x, chart.scales.y.bottom); ctx.lineWidth = 1.5; ctx.strokeStyle = (isLightTheme()) ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.2)'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.restore(); } } };
const centerTextPlugin = { id: 'centerText', beforeDraw: chart => { if (chart.config.type !== 'doughnut') return; const ctx = chart.ctx; ctx.save(); const total = chart.data.datasets[0].data.reduce((a,b)=>a+b, 0); const text = total > 0 ? total + " Logs" : "Log first urge"; ctx.font = "700 14px " + APP_FONT_FAMILY; const x = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2; const y = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = (isLightTheme()) ? "#0F172A" : "#E5E7EB"; ctx.fillText(text, x, y); ctx.restore(); } };

function formatAppTime(dateObj) { return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' }); }

const hideSkeleton = () => {
  const skel = document.getElementById('appSkeleton');
  if(skel) {
    const pwa = window.matchMedia('(display-mode: standalone)').matches ||
                window.navigator.standalone === true ||
                document.referrer.includes('android-app://');
    if(pwa) {
      skel.remove();
    } else {
      skel.style.opacity = '0';
      setTimeout(() => skel.remove(), 300);
    }
  }
};

function bootApp() {
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

    const notifKeys = ['notifWaveComplete', 'notifGapWidened', 'notifInactivity', 'notifPredictive', 'notifEnableSos'];
    notifKeys.forEach(k => {
      const el = document.getElementById(k + 'Input');
      if(el) el.checked = settings[k] !== false;
    });
  } catch(e) {}
  updateCostPerCigDisplay();

  const qdInput = document.getElementById('quitDateInput');
  if(qdInput) {
    qdInput.value = settings.quitDate || '';
    qdInput.max = new Date().toISOString().split('T')[0];
  }

  try { loadChartOrder(); } catch(e) { console.warn("Chart order load failed", e); }
  try { initDragAndDrop(); } catch(e) { console.warn("Drag-and-drop init failed", e); } renderTriggerSettingsList();
  
  const filterSelect = document.getElementById('historyTagFilter');
  if(filterSelect) {
      filterSelect.innerHTML = `<option value="all">All Tags</option>` + triggers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  refreshIcons();

  // Detect if running as PWA (standalone mode)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                window.navigator.standalone === true ||
                document.referrer.includes('android-app://');

  // If PWA, hide skeleton immediately
  if(isPWA) {
    const skel = document.getElementById('appSkeleton');
    if(skel) skel.remove();
  }

  // Check onboarding
  const onboardingDone = localStorage.getItem('smoke_onboarding_done');
  if (!onboardingDone && logs.length === 0) {
    showOnboarding();
    hideSkeleton();
    return;
  }

  if(hasPin) {
    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('pinStatusBtn').innerText = "Remove PIN";
    hideSkeleton();
  } else {
    bootCore();
    hideSkeleton();
  }
}

// Onboarding state
let onboardingStep = 1;

function showOnboarding() {
  document.getElementById('onboardingOverlay').classList.remove('hidden');
  initOnboardingSetup();
  refreshIcons();
}

window.onboardingNext = function() {
  if (onboardingStep < 4) {
    document.getElementById('onboardSlide' + onboardingStep).classList.add('hidden');
    const prevDot = document.getElementById('onboardDot' + onboardingStep);
    prevDot.className = 'w-2.5 h-2.5 rounded-full transition-all';
    prevDot.style.backgroundColor = 'rgba(156,163,175,0.3)';
    prevDot.style.width = '10px';
    onboardingStep++;
    document.getElementById('onboardSlide' + onboardingStep).classList.remove('hidden');
    const curDot = document.getElementById('onboardDot' + onboardingStep);
    curDot.className = 'w-2.5 h-2.5 rounded-full transition-all';
    curDot.style.backgroundColor = 'var(--accent)';
    curDot.style.width = '20px';

    if (onboardingStep === 4) {
      document.getElementById('onboardNextBtn').innerText = 'Get Started';
    }
  } else {
    finishOnboarding();
  }
}

window.onboardingSkip = function() {
  finishOnboarding();
}

window.restartOnboarding = function() {
  localStorage.removeItem('smoke_onboarding_done');
  location.reload();
}

function finishOnboarding() {
  localStorage.setItem('smoke_onboarding_done', 'true');
  document.getElementById('onboardingOverlay').classList.add('hidden');
  if(hasPin) {
    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('pinStatusBtn').innerText = "Remove PIN";
    hideSkeleton();
  } else {
    bootCore();
    hideSkeleton();
  }
}

window.switchWatchStyle = function(styleNum) {
    if(settings.haptics && navigator.vibrate) navigator.vibrate(10);
    currentWatchStyle = styleNum;
    localStorage.setItem('smoke_watch_style', styleNum);
    
    for(let i=1; i<=3; i++) {
        const el = document.getElementById('watchStyle'+i);
        const dot = document.getElementById('watchDot'+i);
        if(el) el.classList.toggle('hidden', i !== styleNum);
        if(dot) {
            if(i === styleNum) {
                dot.className = "w-2.5 h-2.5 rounded-full transition-all duration-300 scale-125 shadow-[0_0_8px_var(--accent-glow)]";
                dot.style.backgroundColor = "var(--accent)";
            } else {
                dot.className = "w-2 h-2 rounded-full transition-all duration-300 bg-gray-500/30";
                dot.style.backgroundColor = "";
            }
        }
    }
}

function sendSystemNotification(title, body, key) {
  if (settings[key] !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, { body, icon: 'icons/pause_icon_192.png' });
        });
      } else {
        new Notification(title, { body, icon: 'icons/pause_icon_192.png' });
      }
    } catch(e) {}
  }
}

function requestNotifPermission(onGranted, onDenied) {
  if (typeof Notification === 'undefined') { showToast("Notifications not supported in browser"); return; }
  Notification.requestPermission().then(perm => {
    if(perm === 'granted') { showToast("Smart Reminders Enabled! 🔔"); if(onGranted) onGranted(); }
    else { showToast("Notification Permission Denied"); if(onDenied) onDenied(); }
  });
}

function toggleNotifSetting(key) {
  const el = document.getElementById(key + 'Input');
  if(!el) return;
  settings[key] = el.checked;
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  if(el.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    requestNotifPermission(null, () => {
      el.checked = false;
      settings[key] = false;
      localStorage.setItem('smoke_settings', JSON.stringify(settings));
    });
  }
}

function triggerSosInterrupterFirst() {
  const actions = [
    "Drink a full glass of cold water 💧",
    "Take 3 deep breaths (4s in, 4s hold, 6s out) 🫁",
    "Walk away from your current room for 1 minute 🚶"
  ];
  const choice = actions[Math.floor(Math.random() * actions.length)];
  document.getElementById('sosActionTitle').innerText = choice;

  sosSecs = 15;
  const numEl = document.getElementById('sosTimerNum');
  const proceedBtn = document.getElementById('sosProceedBtn');
  if(numEl) { numEl.innerText = sosSecs; numEl.style.transform = "scale(1)"; }
  if(proceedBtn) { 
    proceedBtn.className = "w-full py-3 rounded-xl font-bold text-xs border opacity-50 transition-all";
    proceedBtn.innerText = "Skip & Proceed to Log"; 
  }

  document.getElementById('sosInterrupterModal').classList.remove('hidden');
  refreshIcons();

  if(sosTimer) clearInterval(sosTimer);
  sosTimer = setInterval(() => {
    sosSecs--;
    if(numEl) {
      numEl.innerText = sosSecs;
      numEl.style.transform = "scale(1.3)";
      setTimeout(() => { if(numEl) numEl.style.transform = "scale(1)"; }, 150);
      if(sosSecs <= 3) numEl.className = "numeric-display text-4xl font-black text-red-500 transition-transform duration-150";
      else numEl.className = "numeric-display text-4xl font-black text-amber-500 transition-transform duration-150";
    }
    if(sosSecs <= 0) {
      clearInterval(sosTimer);
      if(proceedBtn) { 
        proceedBtn.className = "w-full py-3 rounded-xl font-bold text-xs text-white bg-amber-500 shadow-lg active:scale-95 transition-all";
        proceedBtn.innerText = "Ready to Proceed to Log →"; 
      }
    }
  }, 1000);
}

function closeSosInterrupter(cravingPassed) {
  if(sosTimer) clearInterval(sosTimer);
  document.getElementById('sosInterrupterModal').classList.add('hidden');

  if(cravingPassed) {
    // User defeated the craving - add shield
    waves.push(Date.now());
    localStorage.setItem('smoke_waves', JSON.stringify(waves));
    logWaveAttempt('won', 15000);
    showToast("🛡️ Craving Defeated! +1 Shield");
    if(window.confetti) confetti({particleCount: 80, spread: 60, origin: {y: 0.6}});
    try { updateUI(); } catch(e){}
  } else {
    // User skipped - proceed to log cigarette
    actuallyLogCigarette();
  }
}

function actuallyLogCigarette() {
  gapWidenedNotified = false;
  inactivityNotified = false;
  localStorage.setItem('smoke_gap_widened_notified', 'false');

  let waveWasActive = false;
  if(waveEndTime > 0) {
    waveWasActive = true; localStorage.removeItem('smoke_wave_end'); waveEndTime = 0; clearInterval(waveTimer);
    document.getElementById('waveOverlay').classList.add('hidden');
    logWaveAttempt('lost'); resetRideButton();
  }

  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : null;
  logs.push({timestamp: now, gap: gap, tags: [], lat: null, lng: null, intensity: 3, note: '', mood: null});
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
    const logTimestamp = now;
    navigator.geolocation.getCurrentPosition(p => {
      const entry = logs.find(l => l.timestamp === logTimestamp);
      if(entry) { entry.lat = p.coords.latitude; entry.lng = p.coords.longitude; localStorage.setItem('smoke_logs', JSON.stringify(logs)); if(!document.getElementById('page-insights').classList.contains('hidden')) renderHeatMap('mapContainer', getFilteredLogs()); }
    }, () => {}, {timeout: 10000, maximumAge: 60000});
  }
}

function moveNavIndicator(activeBtn) {
  const ind = document.getElementById('navIndicator');
  if (!ind || !activeBtn) return;
  ind.style.width = activeBtn.offsetWidth + 'px';
  ind.style.left = activeBtn.offsetLeft + 'px';
  ind.style.opacity = '1';
}

function initNavIndicator() {
  const ind = document.getElementById('navIndicator');
  const active = document.querySelector('.nav-btn.nav-active');
  if (!ind || !active) return;
  ind.style.transition = 'none';
  ind.style.width = active.offsetWidth + 'px';
  ind.style.left = active.offsetLeft + 'px';
  ind.style.opacity = '1';
  void ind.offsetWidth;
  ind.style.transition = '';
}

window.addEventListener('resize', () => {
  const active = document.querySelector('.nav-btn.nav-active');
  if (active) moveNavIndicator(active);
});

function bootCore() {
  window.switchWatchStyle(currentWatchStyle);
  initNavIndicator();

  // Restore last active tab
  const savedTab = localStorage.getItem('smoke_active_tab');
  if (savedTab && ['tracker','insights','history','settings'].includes(savedTab)) {
    window.switchTab(savedTab);
  }

  try { updateUI(); } catch(e) { console.error("updateUI error on boot", e); }
  checkLock(); checkWave();
  setTimeout(() => showDailyRecap(), 1000);
  // The interval below handles ongoing updates
  
  if(mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    try {
      if (document.hidden) return;
      ensureLogsCacheFresh(); // day rollover check — cheap string compare
      checkPeakNudge();
      updateLastSmokeDisplay();

      if(!logs || logs.length === 0) return;
      const diff = new Date().getTime() - logs[logs.length-1].timestamp;

      const prevLog = logs[logs.length-1];
      const prevGapMs = prevLog.gap ? prevLog.gap * 60000 : 0;
      const avgGapMs = logsCache.avgGapMs;

      if (prevGapMs > 0 && diff >= prevGapMs && !gapWidenedNotified) {
        gapWidenedNotified = true;
        localStorage.setItem('smoke_gap_widened_notified', 'true');
        sendSystemNotification("🎉 Gap Widened!", `Great progress! You just beat your previous gap (${formatGap(Math.round(prevGapMs/60000))}). You're setting a personal best.`, 'notifGapWidened');
	        if (window.confetti) {
	          confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
	          setTimeout(() => confetti({ particleCount: 40, spread: 40, origin: { y: 0.6 } }), 200);
	        }
      }
      if (avgGapMs > 0 && diff >= avgGapMs * 1.5 && waveEndTime <= 0 && !inactivityNotified) {
        inactivityNotified = true;
        sendSystemNotification("🚬 Did you forget to log?", "It's been longer than your average gap. Log your stick or keep widening the gap!", 'notifInactivity');
      }

      updateHeroDisplay(diff, prevGapMs, avgGapMs);

    } catch(err) { console.error('Main timer error:', err); }
  }, 1000);
}

function updateHeroDisplay(diff, prevGapMs, avgGapMs) {
  const timeStr = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
  
  for(let i=1; i<=3; i++) {
    const sw = document.getElementById('stopwatch'+i);
    if(sw) sw.innerText = timeStr;
  }

  let pct = 0, bonusPct = 0, isVictory = false, extraMins = 0, remMins = 0;
  if(avgGapMs > 0) {
    if (diff >= avgGapMs) {
      isVictory = true;
      extraMins = Math.floor((diff - avgGapMs) / 60000);
      bonusPct = Math.min(30, Math.round(((diff - avgGapMs) / avgGapMs) * 30));
      pct = 70 + bonusPct;
    } else {
      pct = Math.min(70, Math.round((diff / avgGapMs) * 70));
      remMins = Math.ceil((avgGapMs - diff) / 60000);
    }
  }

  const fill1 = document.getElementById('heroHorizonFill');
  const marker1 = document.getElementById('heroHorizonMarker');
  const badge1 = document.getElementById('heroRecordBadge3');
  const status1 = document.getElementById('heroHorizonStatus');
  const sub1 = document.getElementById('heroHorizonSub');

  if(fill1 && avgGapMs > 0) {
    if(marker1) { marker1.classList.remove('hidden'); }
    if(isVictory) {
      fill1.style.width = `${pct}%`; fill1.style.backgroundColor = '#10B981'; fill1.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.4)";
      if(badge1) badge1.classList.remove('hidden');
      if(status1) { status1.innerText = "Victory Zone"; status1.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"; }
      if(sub1) sub1.innerText = `Record Extended: +${formatGap(extraMins)}`;
    } else {
      fill1.style.width = `${pct}%`; fill1.style.backgroundColor = 'var(--accent)'; fill1.style.boxShadow = "none";
      if(badge1) badge1.classList.add('hidden');
      if(status1) { status1.innerText = "Pacing"; status1.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20"; }
      if(sub1) sub1.innerText = `Target Avg: ${formatGap(Math.round(avgGapMs/60000))} (${remMins}m left)`;
    }
  }

  const ringFill = document.getElementById('heroRingFill');
  const badge2 = document.getElementById('heroRecordBadge2');
  const status2 = document.getElementById('heroRingStatus');
  const sub2 = document.getElementById('heroRingSub');
  
  if(ringFill && avgGapMs > 0) {
      let ringPct = isVictory ? Math.min(100, 70 + bonusPct) : pct;
      const offset = 314.16 - (314.16 * (ringPct / 100));
      ringFill.style.strokeDashoffset = offset;

      if(isVictory) {
          ringFill.style.stroke = '#10B981'; ringFill.style.filter = "drop-shadow(0 0 8px rgba(16, 185, 129, 0.5))";
          if(badge2) badge2.classList.remove('hidden');
          if(status2) { status2.innerText = "Victory Zone"; status2.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"; }
          if(sub2) sub2.innerText = `Target Beaten: +${formatGap(extraMins)}`;
      } else {
          ringFill.style.stroke = 'var(--accent)'; ringFill.style.filter = "drop-shadow(0 0 8px var(--accent-glow))";
          if(badge2) badge2.classList.add('hidden');
          if(status2) { status2.innerText = "Pacing"; status2.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20"; }
          if(sub2) sub2.innerText = `Target: ${formatGap(Math.round(avgGapMs/60000))} (${remMins}m left)`;
      }
  }

  const fill3 = document.getElementById('heroClimbFill');
  const badge3 = document.getElementById('heroRecordBadge1');
  const status3 = document.getElementById('heroClimbStatus');
  const sub3 = document.getElementById('heroClimbSub');

  if(fill3 && avgGapMs > 0) {
      fill3.style.height = `${pct}%`;
      if(isVictory) {
          fill3.style.background = 'linear-gradient(180deg, #34D399, #10B981)'; fill3.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.5)";
          if(badge3) badge3.classList.remove('hidden');
          if(status3) { status3.innerText = "Victory Zone"; status3.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 w-max"; }
          if(sub3) sub3.innerText = `Record Extended: +${formatGap(extraMins)}`;
      } else {
          fill3.style.background = 'linear-gradient(180deg, #FBBF24, #10B981)'; fill3.style.boxShadow = "0 0 12px rgba(245,158,11,0.4) inset";
          if(badge3) badge3.classList.add('hidden');
          if(status3) { status3.innerText = "Pacing"; status3.className = "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 w-max"; }
          if(sub3) sub3.innerText = `Target: ${formatGap(Math.round(avgGapMs/60000))} (${remMins}m left)`;
      }
  }

  let dotColor = '#9CA3AF', newClass = '', newHtml = '';
  const liveDot = document.getElementById('headerLiveDot');

  if (prevGapMs > 0) {
    let percent = diff / prevGapMs;
    if (percent < 1) {
      let remMins = Math.ceil((prevGapMs - diff) / 60000);
      newClass = 'mt-3 px-5 py-2 rounded-full border transition-all duration-500 bg-amber-500/10 border-amber-500/20';
      newHtml = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-500"></i><span class="text-amber-500">${remMins} min${remMins>1?'s':''} left to beat previous gap</span>`;
      dotColor = '#10B981';
    } else {
      let extraMins = Math.floor((diff - prevGapMs) / 60000);
      newClass = 'mt-3 px-5 py-2 rounded-full border transition-all duration-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]';
      newHtml = `<i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-500"></i><span class="text-emerald-500">Widened the gap by +${extraMins} min${extraMins!==1?'s':''}</span>`;
      dotColor = '#10B981';
    }
  } else {
    newClass = 'mt-3 px-5 py-2 rounded-full border transition-all duration-500 bg-sky-500/10 border-sky-500/20';
    newHtml = `<i data-lucide="rocket" class="w-3.5 h-3.5 text-sky-500"></i><span class="text-sky-500">Setting your first baseline gap</span>`;
    dotColor = '#0EA5E9';
  }

  if(liveDot) { liveDot.style.backgroundColor = dotColor; liveDot.style.boxShadow = `0 0 8px ${dotColor}`; }
  const statusWrapper = document.getElementById('smartStatusWrapper');
  const statusText = document.getElementById('smartStatusText');
  if (statusText && statusText.dataset.rawHtml !== newHtml) { statusWrapper.className = newClass; statusText.innerHTML = newHtml; statusText.dataset.rawHtml = newHtml; refreshIcons(); }
}

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

function enterPin(n) {
  if(enteredPin.length < 4) { enteredPin += n; document.querySelectorAll('.pin-dot').forEach((el, i) => { el.classList.toggle('bg-gray-400', i < enteredPin.length); el.classList.toggle('bg-gray-500', i >= enteredPin.length); }); }
  if(enteredPin.length === 4) { const pinCheck = enteredPin; setTimeout(() => { if(hashPin(pinCheck) === storedPinHash) { document.getElementById('lockScreen').classList.add('hidden'); bootCore(); } else { showToast("Wrong PIN"); shakePinDots(); clearPin(); } }, 200); }
}
function clearPin() { enteredPin = ""; document.querySelectorAll('.pin-dot').forEach(el => { el.classList.remove('bg-gray-400'); el.classList.add('bg-gray-500'); }); }
function shakePinDots() { const d = document.getElementById('pinDots'); if(!d) return; d.classList.add('shake-anim'); setTimeout(() => d.classList.remove('shake-anim'), 400); }
function setupPin() { if(hasPin) { showConfirm("Remove PIN?", "You won't need a PIN to open the app anymore.", () => { localStorage.removeItem('smoke_pin_hash'); hasPin=false; storedPinHash=null; location.reload(); }); } else { const inp = document.getElementById('pinSetupInput'); inp.value = ''; document.getElementById('pinSetupError').classList.add('hidden'); document.getElementById('pinSetupModal').classList.remove('hidden'); setTimeout(() => { inp.focus({preventScroll: true}); if (inp.click) inp.click(); }, 300); } }
function closePinSetupModal() { document.getElementById('pinSetupModal').classList.add('hidden'); }
function savePinSetup() { const p = document.getElementById('pinSetupInput').value; if(/^\d{4}$/.test(p)) { localStorage.setItem('smoke_pin_hash', hashPin(p)); hasPin = true; storedPinHash = hashPin(p); closePinSetupModal(); document.getElementById('pinStatusBtn').innerText = "Remove PIN"; showToast("PIN saved"); } else { document.getElementById('pinSetupError').classList.remove('hidden'); } }

function applyIntensityStyling(val, prefix, sizeClass) {
  for(let i=1; i<=5; i++) {
    const b = document.getElementById(prefix+i); if(!b) continue;
    if(i===val) {
      b.className = `${sizeClass} rounded-full border text-xs font-bold transition-all scale-110`;
      b.style.background = "var(--accent)"; b.style.color = "#fff"; b.style.boxShadow = "0 4px 12px var(--accent-glow)"; b.style.borderColor = "transparent";
    } else {
      b.className = `${sizeClass} rounded-full border text-xs font-bold transition-all scale-100`;
      b.style.background = "transparent"; b.style.borderColor = "var(--card-border)"; b.style.color = "var(--text-main)"; b.style.boxShadow = "none";
    }
  }
}

function setTakeoverIntensity(val) {
  if(settings.haptics && navigator.vibrate) navigator.vibrate(10);
  currentIntensity = val;
  applyIntensityStyling(val, 'toInt', 'w-9 h-9');
  const lbl = document.getElementById('takeoverIntensityLabel');
  if(lbl) lbl.innerText = INTENSITY_LABELS[val];
}

function startSmokeTakeover(logIdx, gap, waveWasActive) {
  editingLogIdx = logIdx; currentSelectedTags = []; currentMood = null; setTakeoverIntensity(3); takeoverCountdown = 6;
  const overlay = document.getElementById('smokeTakeover'); const numberEl = document.getElementById('takeoverNumber'); const ringEl = document.getElementById('takeoverRing'); const factEl = document.getElementById('takeoverFact');
  let factText = "";
  if(waveWasActive) factText = "It's okay to slip. What triggered this strong urge?";
  else if (gap === null || gap === undefined) factText = "Setting your first baseline.";
  else if (gap < 60) factText = `It's been ${gap}m since your last one.`;
  else factText = `It's been ${Math.floor(gap/60)}h ${gap%60}m since your last one.`;
  if(factEl) factEl.innerText = factText;
  if(factEl) factEl.style.opacity = 0;
  renderTakeoverTags();
  renderTakeoverMoods();

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
    const safeId = 'tagBtn_' + t.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/_+$/, '').substring(0, 50) || 'trigger';
    return `<button id="${safeId}" onclick="window.toggleTakeoverTag('${esc(t)}')" class="px-4 py-2.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all active:scale-95 ${activeClasses}" ${textStyle}>${esc(t)}</button>`;
  }).join('');
}

function renderTakeoverMoods() {
  const grid = document.getElementById('takeoverMoodGrid'); if(!grid) return;
  grid.innerHTML = MOODS.map((m, idx) => moodChipHtml(m, idx, 'toggleTakeoverMood', false)).join('');
  refreshIcons();
}

window.toggleTakeoverMood = function(idx) {
  currentMood = currentMood === MOODS[idx].id ? null : MOODS[idx].id;
  renderTakeoverMoods();
}

function renderEditMood() {
  const grid = document.getElementById('editMoodGrid'); if(!grid) return;
  grid.innerHTML = MOODS.map((m, idx) => moodChipHtml(m, idx, 'toggleEditMood', true)).join('');
  refreshIcons();
}

window.toggleEditMood = function(idx) {
  currentMood = currentMood === MOODS[idx].id ? null : MOODS[idx].id;
  renderEditMood();
}

function toggleTakeoverTag(t) { 
  if(settings.haptics && navigator.vibrate) navigator.vibrate(10); 
  const isAdding = !currentSelectedTags.includes(t);
  if (isAdding) currentSelectedTags.push(t);
  else currentSelectedTags = currentSelectedTags.filter(tag => tag !== t);

  const safeId = 'tagBtn_' + t.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/_+$/, '').substring(0, 50) || 'trigger';
  const btn = document.getElementById(safeId);
  if (btn) {
    if (isAdding) {
      btn.className = "px-4 py-2.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all active:scale-95 bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]";
      btn.style.color = "var(--accent)";
    } else {
      btn.className = "px-4 py-2.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all active:scale-95 bg-white/5 border-white/10";
      btn.style.color = "var(--text-main)";
    }
  } else {
    renderTakeoverTags();
  }
}

function cancelSmokeTakeover(e) {
  if(e) e.stopPropagation(); if(takeoverTimer) clearInterval(takeoverTimer);
  const overlay = document.getElementById('smokeTakeover'); overlay.classList.remove('opacity-100'); overlay.classList.add('opacity-0');
  if (editingLogIdx >= 0 && editingLogIdx === logs.length - 1 && logs[editingLogIdx] && Array.isArray(logs[editingLogIdx].tags) && logs[editingLogIdx].tags.length === 0 && logs[editingLogIdx].lat === null) {
    logs.pop(); localStorage.setItem('smoke_logs', JSON.stringify(logs));
    lockEndTime = 0; localStorage.setItem('smoke_lock_end', lockEndTime);
    if(cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
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
    logs[editingLogIdx].mood = currentMood;
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
  t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
  c.appendChild(t); refreshIcons();
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  const autoHide = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 5000); t.dataset.timerId = autoHide;
}

window.undoLog = function(idx, element) {
  if(element) { clearTimeout(element.dataset.timerId); element.style.opacity = '0'; setTimeout(() => element.remove(), 300); }
  if (logs[idx]) {
    logs.splice(idx, 1);
    for (let i = 1; i < logs.length; i++) { logs[i].gap = Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000); }
    if (logs.length > 0) logs[0].gap = null;
    localStorage.setItem('smoke_logs', JSON.stringify(logs)); lockEndTime = 0; localStorage.setItem('smoke_lock_end', lockEndTime);
    if(cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
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
      let rem = Math.max(0, Math.ceil((lockEndTime - new Date().getTime())/1000)); const textEl = document.getElementById('holdText');
      if(rem<=0) { clearInterval(cooldownTimer); btn.disabled=false; btn.style.opacity = '1'; if(textEl) textEl.innerText='Hold to Smoke'; if(settings.haptics && navigator.vibrate) navigator.vibrate([30, 50, 30]); showToast("Ready to log 🔓"); }
      else if(textEl) textEl.innerText=`COOLDOWN (${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')})`;
    }, 1000);
  } else {
    if(cooldownTimer) clearInterval(cooldownTimer); cooldownTimer = null;
    btn.disabled = false; btn.style.opacity = '1';
    const textEl = document.getElementById('holdText'); if(textEl) textEl.innerText = 'Hold to Smoke';
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
  // Ride It Out button removed — merged into Breathe modal. No-op kept for call-site compatibility.
}

function waveTick() {
  const o = document.getElementById('waveOverlay'); if(!o) return;
  let rem = Math.ceil((waveEndTime - new Date().getTime())/1000); let totalSecs = waveDurationMs / 1000;
  if(rem<=0) {
    clearInterval(waveTimer); waveEndTime=0; localStorage.removeItem('smoke_wave_end'); o.classList.add('hidden');
    resetRideButton();
    waves.push(Date.now()); localStorage.setItem('smoke_waves', JSON.stringify(waves)); logWaveAttempt('won'); showToast("🛡️ Craving Defeated! +1 Shield");
    
    sendSystemNotification("🛡️ Craving Defeated!", "Awesome job! You successfully rode out the craving wave. +1 Shield unlocked.", 'notifWaveComplete');
    celebrateBadgeIfUnlocked();
    if (window.posthog) posthog.capture('ride_wave_completed', { duration_mins: waveDurationMs / 60000 });
    try { updateUI(); } catch(e){}
  } else {
    const mm = Math.floor(rem/60).toString().padStart(2,'0'), ss = (rem%60).toString().padStart(2,'0');
    document.getElementById('waveCountdown').innerText = `${mm}:${ss}`;
    const elapsedFrac = Math.min(1, Math.max(0, (totalSecs - rem) / totalSecs));

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
  try {
    if(settings.haptics && navigator.vibrate) navigator.vibrate(20);
    ['tracker','insights','history','settings'].forEach(x => { 
      const p = document.getElementById(`page-${x}`);
      const btn = document.getElementById(`tab-${x}`);
      if(p) p.classList.add('hidden'); 
      if(btn) btn.classList.remove('nav-active'); 
    });

    const activePage = document.getElementById(`page-${t}`);
    const activeBtn = document.getElementById(`tab-${t}`);
    if(activePage) activePage.classList.remove('hidden');
    if(activeBtn) activeBtn.classList.add('nav-active');
    moveNavIndicator(activeBtn);

    if (window.posthog) posthog.capture('tab_switched', { tab_name: t });
    localStorage.setItem('smoke_active_tab', t);
    if(t === 'history') renderHistory('fullHistoryList'); 
    if(t === 'insights') requestAnimationFrame(() => renderAllCharts());
    refreshIcons();
  } catch(err) { console.error("switchTab Error:", err); }
}

window.refreshAppCache = function() {
  showConfirm("Refresh App Cache?", "This will clear old cached files and reload the app. Your data (logs, settings) will NOT be lost.", () => {
    // Delete all service worker caches
    if ('caches' in window) {
      caches.keys().then(keys => {
        return Promise.all(keys.map(k => caches.delete(k)));
      }).then(() => {
        // Unregister service worker
        if (navigator.serviceWorker) {
          navigator.serviceWorker.getRegistrations().then(regs => {
            regs.forEach(r => r.unregister());
          });
        }
        // Reload to fetch fresh files
        window.location.reload();
      });
    } else {
      // Fallback: just reload
      window.location.reload();
    }
  }, 'info');
}

function showToast(msg) {
  const c = document.getElementById('toastContainer'); if(!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-2.5 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300';
  t.style.color = 'var(--text-main)'; t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; t.innerText = msg;
  c.appendChild(t); requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 2500);
}

let pendingConfirmCallback = null;
function showConfirm(title, message, onConfirm, type) {
  document.getElementById('confirmTitle').innerText = title; document.getElementById('confirmMessage').innerText = message;
  pendingConfirmCallback = onConfirm;
  const isDanger = type !== 'info';
  const btn = document.getElementById('confirmYesBtn');
  const iconWrap = document.getElementById('confirmIconWrap');
  const icon = document.getElementById('confirmIcon');
  if (btn) btn.style.backgroundColor = isDanger ? '#EF4444' : 'var(--accent)';
  if (iconWrap) iconWrap.style.backgroundColor = isDanger ? 'rgba(239,68,68,0.1)' : 'var(--accent-glow)';
  if (icon) { icon.className = 'w-7 h-7 ' + (isDanger ? 'text-red-500' : ''); icon.style.color = isDanger ? '' : 'var(--accent)'; icon.setAttribute('data-lucide', isDanger ? 'alert-triangle' : 'sparkles'); }
  document.getElementById('confirmModal').classList.remove('hidden');
  refreshIcons();
}
function closeConfirmModal() { document.getElementById('confirmModal').classList.add('hidden'); pendingConfirmCallback = null; }
function confirmYes() { const cb = pendingConfirmCallback; closeConfirmModal(); if(cb) cb(); }

const THEME_META_COLORS = { white: '#F8FAFC', default: '#090A0F', paper: '#FAF6F0', oled: '#000000', aurora: '#0B0B14', ocean: '#132F4C' };
const LIGHT_THEMES = ['white', 'paper'];
function isLightTheme() { return LIGHT_THEMES.includes(settings.theme) || document.documentElement.classList.contains('theme-white') || document.documentElement.classList.contains('theme-paper'); }

function applyTheme(t) { 
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim(); document.documentElement.className = document.documentElement.className.replace(/theme-\w+/g, '').trim(); 
  if(t !== 'default') { document.body.classList.add(`theme-${t}`); document.documentElement.classList.add(`theme-${t}`); }
  const metaTheme = document.getElementById('theme-color-meta');
  if(metaTheme) metaTheme.setAttribute('content', THEME_META_COLORS[t] || THEME_META_COLORS.white);
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value; settings.timeFormat = document.getElementById('timeFormatSelect').value; settings.currency = document.getElementById('currencySelect').value;
  settings.dailyLimit = Math.max(1, Math.min(100, parseInt(document.getElementById('dailyLimitInput').value) || 15));
  settings.packPrice = Math.max(0, Math.min(9999, parseFloat(document.getElementById('packPriceInput').value) || 0));
  settings.packSize = Math.max(1, Math.min(100, parseInt(document.getElementById('packSizeInput').value) || 20));
  settings.lockSecs = parseInt(document.getElementById('lockSecsInput').value) || 300; settings.haptics = document.getElementById('hapticsInput').checked;
  settings.motivation = document.getElementById('motivationInput').value.substring(0, 100);
  const prevAutoReduce = settings.autoReduce;
  settings.autoReduce = document.getElementById('autoReduceInput').checked;
  if (settings.autoReduce && !prevAutoReduce) {
    localStorage.setItem('smoke_last_reduce_date', new Date().toDateString());
  }
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  if (window.posthog) posthog.capture('settings_updated', { theme: settings.theme, dailyLimit: settings.dailyLimit, autoReduce: settings.autoReduce });
  applyTheme(settings.theme); updateCostPerCigDisplay();
  try { updateUI(); } catch(err){}
  if(!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  if(!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList');
}

function updateCostPerCigDisplay() { const el = document.getElementById('costPerCigDisplay'); if (el) el.innerText = `${settings.currency} ${(settings.packPrice / settings.packSize).toFixed(2)}`; }

window.updateQuitDate = function() {
  const el = document.getElementById('quitDateInput');
  if(!el) return;
  const today = new Date().toISOString().split('T')[0];
  el.max = today;
  if (el.value && el.value > today) el.value = today;
  settings.quitDate = el.value || '';
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  showToast(settings.quitDate ? `Quit date set for ${settings.quitDate}` : 'Quit date cleared');
}

window.resetSettings = function() {
  if (!confirm('Reset all settings to defaults? Your logs and progress will be kept.')) return;
  const keepLogs = { quitDate: settings.quitDate };
  settings = Object.assign({}, DEFAULT_SETTINGS, keepLogs);
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  localStorage.removeItem('smoke_last_reduce_date');
  location.reload();
}

function updateUI() {
  recomputeLogsCache(); // recompute once per mutation, not every tick
  document.getElementById('shieldCount').innerText = waves.length;
  const emptyBanner = document.getElementById('emptyStateBanner'); if(emptyBanner) emptyBanner.classList.toggle('hidden', logs.length > 0);
  const motEl = document.getElementById('motivationTag'); const motText = document.getElementById('motivationText');
  if(motEl && motText) { if (settings.motivation && settings.motivation.trim() !== "") { motText.innerText = settings.motivation; motEl.classList.remove('hidden'); } else { motEl.classList.add('hidden'); } }

  let streak = 0; let slipDays = 0; let logsByDate = {};
  logs.forEach(l => { if(l && l.timestamp) { let dStr = new Date(l.timestamp).toDateString(); logsByDate[dStr] = (logsByDate[dStr] || 0) + 1; } });
  let todayStr = new Date().toDateString(); if (!logsByDate[todayStr]) logsByDate[todayStr] = 0;
  // Fill zero-log days between earliest log and today so clean days count in streak
  const dateKeys = Object.keys(logsByDate);
  if (dateKeys.length > 1) {
    const sorted = dateKeys.map(d => new Date(d)).sort((a, b) => a - b);
    const earliest = sorted[0];
    const todayDate = new Date();
    for (let d = new Date(earliest); d <= todayDate; d = new Date(d.getTime() + 86400000)) {
      const ds = d.toDateString();
      if (!logsByDate[ds]) logsByDate[ds] = 0;
    }
  }
  let uniqueDates = Object.keys(logsByDate).sort((a,b) => new Date(b) - new Date(a));
  for (let dStr of uniqueDates) { if (logsByDate[dStr] <= settings.dailyLimit) { streak++; } else { if (slipDays < 2) { slipDays++; streak++; } else break; } }
  document.getElementById('homeStreak').innerText = `🔥 ${streak} Day Streak`;
  const hdStreak = document.getElementById('headerStreak'); if(hdStreak) hdStreak.innerText = `${streak}d`;

  const today = logs.filter(l => l.timestamp && new Date(l.timestamp).toDateString() === todayStr);
  const todayCountTextEl = document.getElementById('todayCountText'); if(todayCountTextEl) animateCounter(todayCountTextEl, today.length, 600, '', ` / ${settings.dailyLimit} Sticks`);
  
  const fillBar = document.getElementById('batteryFillBar');
  const pctText = document.getElementById('batteryPctText');
  const battIcon = document.getElementById('batteryIcon');
  const limitMsg = document.getElementById('limitWarningMsg');

  let remCap = Math.max(0, settings.dailyLimit - today.length);
  let battPct = Math.round((remCap / Math.max(1, settings.dailyLimit)) * 100);

	  const battLabel = document.getElementById("batteryLevelLabel");
  if(fillBar && pctText) {
    pctText.innerText = `${battPct}%`;
    fillBar.style.width = `${battPct}%`;
    if(battPct <= 20) {
      fillBar.className = "h-full rounded-full transition-all duration-500 bg-red-500";
      pctText.className = "numeric-display text-[10px] font-bold text-red-500";
      if(battIcon) battIcon.className = "w-3.5 h-3.5 text-red-500";
	      if(battLabel) { battLabel.innerText = "Low — Almost depleted"; battLabel.style.color = "#EF4444"; }
      if(limitMsg) limitMsg.classList.remove('hidden');
    } else if(battPct <= 50) {
      fillBar.className = "h-full rounded-full transition-all duration-500 bg-amber-500";
      pctText.className = "numeric-display text-[10px] font-bold text-amber-500";
      if(battIcon) battIcon.className = "w-3.5 h-3.5 text-amber-500";
      if(limitMsg) limitMsg.classList.add('hidden');
	      if(battLabel) { battLabel.innerText = "Moderate — Half remaining"; battLabel.style.color = "#F59E0B"; }
    } else {
      fillBar.className = "h-full rounded-full transition-all duration-500 bg-emerald-500";
      pctText.className = "numeric-display text-[10px] font-bold text-emerald-500";
      if(battIcon) battIcon.className = "w-3.5 h-3.5 text-emerald-500";
      if(limitMsg) limitMsg.classList.add('hidden');
	      if(battLabel) { battLabel.innerText = "High — Plenty of willpower"; battLabel.style.color = "#10B981"; }
    }
  }

  const todayWaves = waves.filter(w => new Date(w).toDateString() === todayStr);
  const trEl = document.getElementById('todayResisted'); if(trEl) trEl.innerText = todayWaves.length.toString();
  document.getElementById('homeTodayBeaten').innerText = `${todayWaves.length} Defeated`;

  const todaySpendVal = today.length * (settings.packPrice/settings.packSize);
  const spendEl = document.getElementById('todaySpend');
  if(spendEl) animateValue(spendEl, todaySpendVal, 600, settings.currency + ' ', '', 1);

  // vs yesterday comparison
  const yesterdayStr = new Date(Date.now() - 86400000).toDateString();
  const yCount = logs.filter(l => l.timestamp && new Date(l.timestamp).toDateString() === yesterdayStr).length;
  const vsEl = document.getElementById('vsYesterdaySpend');
  if(vsEl) {
    if(yCount === 0 && logs.length === 0) { vsEl.classList.add('hidden'); }
    else if(yCount > 0) {
      const diff = today.length - yCount;
      vsEl.classList.remove('hidden');
      if(diff > 0) { vsEl.innerText = `↑ ${diff} more than yesterday`; vsEl.style.color = '#EF4444'; }
      else if(diff < 0) { vsEl.innerText = `↓ ${Math.abs(diff)} fewer than yesterday`; vsEl.style.color = '#10B981'; }
      else { vsEl.innerText = `Same as yesterday`; vsEl.style.color = 'var(--text-muted)'; }
    } else { vsEl.classList.remove('hidden'); vsEl.innerText = `First day tracked 🎉`; vsEl.style.color = '#10B981'; }
  }

  const todayGaps = today.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const bestGapCard = document.getElementById('bestGapCard'); if(bestGapCard) { bestGapCard.innerText = todayGaps.length > 0 ? formatGap(Math.max(...todayGaps)) : '--'; }
  
  const dataSumm = document.getElementById('dataSummaryText');
  if(dataSumm) {
      if(logs.length > 0) { const firstDate = new Date(logs[0].timestamp).toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}); dataSumm.innerText = `${logs.length} logs • Since ${firstDate}`; }
      else { dataSumm.innerText = `0 logs • Log one to start tracking`; }
  }

  computeMomentumScore(today, todayWaves);
  checkBackupReminder();
  renderHistory('homeRecentLogs', 3);
  updateDynamicTagline();
  updateLastSmokeDisplay();
  renderHealthTimeline();
  renderProgressPhotos();
  try { renderMoneyVisualizer(); } catch(e) {}
  try { renderDailyChallenge(); } catch(e) {}
  try { renderPatternIntel(); } catch(e) {}
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

// Smart time formatting for the Widen The Gap chart — minutes → hours → days
function formatGapSmart(min) {
  if (min === null || min === undefined || isNaN(min) || min < 0) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = min / 1440;
  return `${d >= 10 ? Math.round(d) : d.toFixed(1)}d`;
}

function formatChartTime(min) {
  if (min === null || min === undefined || isNaN(min) || min < 0) return '';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) { const h = min / 60; return `${h >= 10 ? Math.round(h) : (Number.isInteger(h) ? h : h.toFixed(1))}h`; }
  const d = min / 1440;
  return `${d >= 10 ? Math.round(d) : (Number.isInteger(d) ? d : d.toFixed(1))}d`;
}

// Daily average gap: groups cigarette gaps by day, excludes sleep/quit outliers (> maxCapMin)
function computeDailyGaps(logsArr, maxCapMin) {
  const dayMap = new Map();
  for (let i = 0; i < logsArr.length; i++) {
    const l = logsArr[i];
    const g = l.gap;
    if (g === null || g === undefined || g > maxCapMin) continue;
    const d = new Date(l.timestamp);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!dayMap.has(key)) dayMap.set(key, { gaps: [] });
    dayMap.get(key).gaps.push(g);
  }
  const sorted = Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0]);
  return sorted.map(([key, { gaps }]) => ({ key, avg: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null }));
}

// Trailing rolling average (past-only) for a smooth premium trend line
function smoothDaily(arr, window) {
  const out = arr.slice();
  if (window <= 1) return out;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === null || arr[i] === undefined) continue;
    const start = Math.max(0, i - window + 1);
    let sum = 0, n = 0;
    for (let j = start; j <= i; j++) {
      if (arr[j] !== null && arr[j] !== undefined) { sum += arr[j]; n++; }
    }
    if (n) out[i] = Math.round(sum / n);
  }
  return out;
}

function updateDynamicTagline() {
  const tagline = document.getElementById('headerTagline');
  if (!tagline) return;

  const today = logs.filter(l => l.timestamp && new Date(l.timestamp).toDateString() === new Date().toDateString());
  const todayWaves = waves.filter(w => new Date(w).toDateString() === new Date().toDateString());

  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const lastGap = lastLog && lastLog.gap ? lastLog.gap : null; // gap in minutes
  const currentGap = lastLog ? Math.round((new Date().getTime() - lastLog.timestamp) / 60000) : 0;
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGap = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;

  let newText = '';
  let newColor = '';

  // "You're on fire" — jab short gap ho (jald jald pee raha hai)
  if (logs.length >= 2 && lastGap !== null && lastGap <= 30) {
    newText = "You're on fire.";
    newColor = '#EF4444';
  } else if (today.length >= Math.ceil(settings.dailyLimit * 0.8)) {
    newText = "You're on fire.";
    newColor = '#EF4444';
  } else if (today.length === 0 && logs.length > 0 && currentGap > avgGap) {
    newText = 'Building momentum.';
    newColor = '#10B981';
  } else if (todayWaves.length >= 2) {
    newText = 'Stronger every wave.';
    newColor = '#0EA5E9';
  } else {
    newText = 'Widen the gap.';
    newColor = '';
  }

  tagline.innerText = newText;
  tagline.style.color = newColor || '';
  tagline.style.textShadow = newColor ? `0 0 8px ${newColor}40` : 'none';
}

function updateLastSmokeDisplay() {
  const row = document.getElementById('lastSmokeRow');
  const text = document.getElementById('lastSmokeText');
  const count = document.getElementById('todayCountHeader');
  if (!row || !text || !count) return;

  if (!logs || logs.length === 0) {
    row.style.display = 'none';
    return;
  }

  row.style.display = 'flex';

  const last = logs[logs.length - 1];
  const diff = new Date().getTime() - last.timestamp;
  const mins = Math.floor(diff / 60000);

  let durationStr;
  if (mins < 1) {
    durationStr = 'Just now';
  } else if (mins < 60) {
    durationStr = `${mins}m ago`;
  } else {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    durationStr = remMins > 0 ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
  }

  text.innerText = `Last: ${durationStr}`;

  // Color code by gap length
  text.style.color = mins <= 30 ? '#EF4444' : mins <= 120 ? '#10B981' : '#10B981';
  text.style.textShadow = mins <= 30 ? '0 0 8px rgba(239,68,68,0.3)' : 'none';

  const todayCount = logsCache.todayCount;
  count.innerText = `Today: ${todayCount}`;

  // Auto-log nudge: if gap > 1.5x average, add reminder indicator
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGap = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;
  const nudgeEl = document.getElementById('autoLogNudge');
  if (avgGap > 0 && mins > avgGap * 1.5 && waveEndTime <= 0 && !inactivityNotified) {
    if (!nudgeEl) {
      const pill = document.createElement('span');
      pill.id = 'autoLogNudge';
      pill.className = 'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full animate-pulse';
      pill.style.cssText = 'background: rgba(249,115,22,0.15); color: #F97316; border: 1px solid rgba(249,115,22,0.3);';
      pill.innerText = '⏰ Log?';
      row.appendChild(pill);
    }
  } else if (nudgeEl) {
    nudgeEl.remove();
  }
}

function showDailyRecap() {
  const todayStr = new Date().toDateString();
  const lastOpen = localStorage.getItem('smoke_last_open');
  if (lastOpen !== todayStr) {
    localStorage.setItem('smoke_last_open', todayStr);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    const yesterdayCount = logs.filter(l => new Date(l.timestamp).toDateString() === yesterdayStr).length;
    if (yesterdayCount > 0) {
      setTimeout(() => {
        showToast(`📊 Yesterday: ${yesterdayCount} stick${yesterdayCount > 1 ? 's' : ''}`);
      }, 2500);
    }
  }
}

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
    const remCap = Math.max(0, settings.dailyLimit - today.length);
    const battPct = Math.round((remCap / Math.max(1, settings.dailyLimit)) * 100);
    iconClass = 'bg-emerald-500/10 text-emerald-500'; iconName = 'battery-charging'; 
    title.innerText = "Nicotine Willpower Battery"; value.innerText = `${battPct}% Remaining`; 
    desc.innerText = `Your daily limit is ${settings.dailyLimit} sticks. You have smoked ${today.length} stick(s) today. You have ${remCap} stick(s) left before depleting your willpower battery.`; 
    pBox.classList.remove('hidden'); pLabel.innerText = "Battery Capacity Remaining"; 
    pPct.innerText = `${battPct}%`; pBar.style.width = `${battPct}%`; pBar.style.background = battPct <= 20 ? 'linear-gradient(90deg, #EF4444, #F87171)' : 'linear-gradient(90deg, #10B981, #34D399)';
    extra.innerHTML = row('Daily Goal Cap', `${settings.dailyLimit} sticks`) + row('Sticks Smoked Today', `${today.length} sticks`) + row('Auto-Reduce Active', settings.autoReduce ? 'Yes (-1 stick/week)' : 'Disabled');
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
    pBox.classList.remove('hidden'); pLabel.innerText = "Score Breakdown"; pPct.innerText = `${score}/100`; pBar.style.width = `${Math.min(100,score)}%`; pBar.style.background = score >= 40 ? 'linear-gradient(90deg, #10B981, #34D399)' : 'linear-gradient(90deg, #EF4444, #F87171)';
    extra.innerHTML = row('Limit Adherence', `${Math.round(limitComponent)}/100`) + row('Cravings Resisted Today', `${todayWaves.length} (${Math.round(waveComponent)}/100)`) + row('Pace vs Average Gap', `${Math.round(gapComponent)}/100`);
  } else if (type === 'streak') {
    let sStreak = 0; let sSlip = 0; let sByDate = {};
    logs.forEach(l => { if(l && l.timestamp) { let d = new Date(l.timestamp).toDateString(); sByDate[d] = (sByDate[d] || 0) + 1; } });
    const sToday = new Date().toDateString(); if (!sByDate[sToday]) sByDate[sToday] = 0;
    const sDates = Object.keys(sByDate).sort((a,b) => new Date(b) - new Date(a));
    for (let d of sDates) { if (sByDate[d] <= settings.dailyLimit) { sStreak++; } else { if (sSlip < 2) { sSlip++; sStreak++; } else break; } }
    iconClass = 'bg-orange-500/10 text-orange-500'; iconName = 'flame'; title.innerText = "Current Streak"; value.innerText = `${sStreak} Day${sStreak===1?'':'s'}`;
    desc.innerText = sStreak > 0 ? `You've stayed within your ${settings.dailyLimit}-stick daily limit for ${sStreak} consecutive day${sStreak===1?'':'s'} (2 slip days tolerated). Don't break the chain!` : `Log a cigarette and stay within your daily limit to start your streak. Every day counts!`;
    const onTarget = sDates.filter(d => sByDate[d] <= settings.dailyLimit && d !== sToday).length;
    extra.innerHTML = row('Days On Target', `${onTarget}`) + row('Streak Tolerances', '2 slip days allowed') + row('Daily Limit', `${settings.dailyLimit} sticks`);
  }
  
  icon.className = `w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`; icon.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5"></i>`;
  document.getElementById('statDetailModal').classList.remove('hidden'); refreshIcons();
}
function closeStatDetail() { document.getElementById('statDetailModal').classList.add('hidden'); }

function showShieldDashboard() {
  const totalShields = waves.length;
  document.getElementById('modalShieldCount').innerText = totalShields;

  // Calculate streak (consecutive days with at least 1 shield)
  let streak = 0;
  const today = new Date();
  today.setHours(0,0,0,0);
  for(let i = 0; i < 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dayStr = checkDate.toDateString();
    const hasShield = waves.some(w => new Date(w).toDateString() === dayStr);
    if(hasShield) streak++;
    else if(i > 0) break; // Allow today to be empty
  }
  document.getElementById('modalShieldStreak').innerText = streak;

  // Total time resisted
  let totalMins = 0;
  waveAttempts.filter(a => a.outcome === 'won').forEach(a => totalMins += (a.minutes || 0));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  document.getElementById('modalShieldMins').innerText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // All 12 milestones with tier colors
  const milestones = [
    {id: 'badge1', target: 1, name: 'First Victory', tier: 1},
    {id: 'badge3', target: 3, name: 'On Fire', tier: 1},
    {id: 'badge5', target: 5, name: 'Momentum', tier: 1},
    {id: 'badge10', target: 10, name: 'Iron Will', tier: 2},
    {id: 'badge15', target: 15, name: 'Focused', tier: 2},
    {id: 'badge25', target: 25, name: 'Guardian', tier: 2},
    {id: 'badge50', target: 50, name: 'Unshakable', tier: 3},
    {id: 'badge75', target: 75, name: 'Champion', tier: 3},
    {id: 'badge100', target: 100, name: 'Master', tier: 3},
    {id: 'badge150', target: 150, name: 'Legendary', tier: 4},
    {id: 'badge200', target: 200, name: 'Invincible', tier: 4},
    {id: 'badge300', target: 300, name: 'Transcendent', tier: 4}
  ];

  let nextBadge = null;
  milestones.forEach(m => {
    const card = document.getElementById(m.id);
    if(!card) return;

    const lock = card.querySelector('.badge-lock');
    const isUnlocked = totalShields >= m.target;

    // Find next badge to unlock
    if(!isUnlocked && !nextBadge) nextBadge = m;

    // Apply unlock state
    if(isUnlocked) {
      card.classList.remove('opacity-40', 'grayscale');
      card.classList.add('shadow-lg');
      card.style.borderColor = 'var(--accent)';
      if(lock) lock.classList.add('hidden');
    } else {
      card.classList.add('opacity-40', 'grayscale');
      card.classList.remove('shadow-lg');
      card.style.borderColor = 'var(--card-border)';
      if(lock) lock.classList.remove('hidden');
    }
  });

  // Update progress ring
  if(nextBadge) {
    const progress = totalShields / nextBadge.target;
    const circumference = 276.46;
    const offset = circumference - (progress * circumference);
    const ring = document.getElementById('shieldProgressRing');
    if(ring) ring.style.strokeDashoffset = offset;
    document.getElementById('nextBadgeName').innerText = nextBadge.name;
    document.getElementById('progressToNext').innerText = `${totalShields}/${nextBadge.target}`;
  } else {
    // All badges unlocked!
    const ring = document.getElementById('shieldProgressRing');
    if(ring) ring.style.strokeDashoffset = '0';
    document.getElementById('nextBadgeName').innerText = 'All Badges!';
    document.getElementById('progressToNext').innerText = `${totalShields} 🎉`;
  }

  document.getElementById('shieldDashboardModal').classList.remove('hidden');
  refreshIcons();
}
function closeShieldDashboard() { document.getElementById('shieldDashboardModal').classList.add('hidden'); }

function exportJSON() {
  if(!logs || logs.length === 0) { showToast("No data to backup yet."); return; }
  const data = { logs, settings, triggers, waves, version: '1.7' };
  // Include all additional data
  try { data.waveAttempts = JSON.parse(localStorage.getItem('smoke_wave_attempts')) || []; } catch(e) {}
  try { data.progressPhotos = JSON.parse(localStorage.getItem('smoke_progress_photos')) || []; } catch(e) {}
  try { data.savingsGoal = JSON.parse(localStorage.getItem('smoke_savings_goal')) || {}; } catch(e) {}
  try { data.completedChallenges = JSON.parse(localStorage.getItem('smoke_completed_challenges')) || {}; } catch(e) {}
  const pinHash = localStorage.getItem('smoke_pin_hash'); if (pinHash) data.pinHash = pinHash;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `SmokeGap_Backup_${new Date().toISOString().slice(0,10)}.json`); document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  localStorage.setItem('smoke_last_backup', new Date().getTime().toString());
  const banner = document.getElementById('backupReminderBanner'); if(banner) banner.classList.add('hidden');
  showToast("Backup downloaded ✅");
}

function importJSON(event) {
  const file = event.target.files && event.target.files[0]; if(!file) return;
  showToast("Restoring data, please wait...");
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
        if(Array.isArray(data.waveAttempts)) localStorage.setItem('smoke_wave_attempts', JSON.stringify(data.waveAttempts));
        if(Array.isArray(data.progressPhotos)) localStorage.setItem('smoke_progress_photos', JSON.stringify(data.progressPhotos));
        if(data.savingsGoal && typeof data.savingsGoal === 'object') localStorage.setItem('smoke_savings_goal', JSON.stringify(data.savingsGoal));
        if(data.completedChallenges && typeof data.completedChallenges === 'object') localStorage.setItem('smoke_completed_challenges', JSON.stringify(data.completedChallenges));
        if(data.pinHash) localStorage.setItem('smoke_pin_hash', data.pinHash);
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
  if(type === '24h') { showConfirm("Delete last 24h logs?", "This will permanently remove cigarette logs from the last 24 hours. Your Shield achievements are never affected.", () => { const now = new Date().getTime(); logs = logs.filter(l => (now - l.timestamp) > 86400000); logs.sort((a, b) => a.timestamp - b.timestamp); for (let i = 0; i < logs.length; i++) { logs[i].gap = i > 0 ? Math.round((logs[i].timestamp - logs[i-1].timestamp) / 60000) : null; } localStorage.setItem('smoke_logs', JSON.stringify(logs)); location.reload(); }); }
  else { showConfirm("Wipe ALL data?", "This cannot be undone. All logs, settings, and tags will be erased.", () => { localStorage.clear(); location.reload(); }); }
}

function exportLogsCSV() {
  if(!logs || logs.length === 0) { showToast("No logs to export yet"); return; }
  let csvContent = "Timestamp,Date,Time,Gap_Minutes,Tags,Intensity,Latitude,Longitude\n";
  logs.forEach(l => {
    let d = new Date(l.timestamp); let tagsArr = [];
    if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags; else if (l.trigger) tagsArr = [l.trigger]; else tagsArr = ['Uncategorized'];
    let tagsStr = tagsArr.join(' | ').replace(/"/g, '""');
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
  applyIntensityStyling(val, 'editInt', 'w-10 h-10');
  const lbl = document.getElementById('editIntensityLabel'); if(lbl) lbl.innerText = INTENSITY_LABELS[val];
}

function openTriggerModal(logIdx = null) {
  try {
    editingLogIdx = logIdx !== null ? logIdx : logs.length - 1;
    const log = logs[editingLogIdx]; 
    if(!log) return;
    
    if (Array.isArray(log.tags) && log.tags.length > 0) currentSelectedTags = [...log.tags];
    else if (log.trigger) currentSelectedTags = [log.trigger];
    else currentSelectedTags = [];
    currentMood = (moodDefFor(log.mood) || {}).id || log.mood || null;
    
    window.setEditIntensity(log.intensity || 3);
    const d = new Date(log.timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');

    const dateInput = document.getElementById('editLogDate');
    const timeInput = document.getElementById('editLogTime');
    if(dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
    if(timeInput) timeInput.value = `${hh}:${min}`;

    const noteInput = document.getElementById('editLogNote');
    const noteCounter = document.getElementById('editLogNoteCounter');
    if (noteInput) { noteInput.value = log.note || ''; }
    if (noteCounter) noteCounter.innerText = `${(log.note || '').length}/200`;

    renderModalTriggerGrid();
    renderEditMood();
    const modal = document.getElementById('triggerModal');
    if(modal) modal.classList.remove('hidden');
    refreshIcons();
  } catch(e) { console.error("openTriggerModal Error:", e); }
}

function renderModalTriggerGrid() {
  const grid = document.getElementById('modalTriggerGrid'); if(!grid) return;
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
    logs[editingLogIdx].tags = [...currentSelectedTags]; logs[editingLogIdx].intensity = currentIntensity; logs[editingLogIdx].mood = currentMood;
    const noteEl = document.getElementById('editLogNote');
    if (noteEl) logs[editingLogIdx].note = noteEl.value.trim().substring(0, 200);
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

window.toggleHistoryClearBtn = function() {
    const searchVal = document.getElementById('historySearch')?.value.trim() || '';
    const fromVal = document.getElementById('historyDateFrom')?.value || '';
    const toVal = document.getElementById('historyDateTo')?.value || '';
    const tagVal = document.getElementById('historyTagFilter')?.value || 'all';
    const btn = document.getElementById('historyClearFilters');
    if (btn) {
        btn.classList.toggle('hidden', !(searchVal || fromVal || toVal || tagVal !== 'all'));
    }
    renderHistory('fullHistoryList');
}

window.clearHistoryFilters = function() {
    const search = document.getElementById('historySearch');
    const from = document.getElementById('historyDateFrom');
    const to = document.getElementById('historyDateTo');
    const tag = document.getElementById('historyTagFilter');
    const btn = document.getElementById('historyClearFilters');
    if (search) search.value = '';
    if (from) from.value = '';
    if (to) to.value = '';
    if (tag) tag.value = 'all';
    if (btn) btn.classList.add('hidden');
    renderHistory('fullHistoryList');
}

window.loadMoreHistory = function() {
    const scrollY = window.scrollY;
    historyRenderLimit += 30;
    renderHistory('fullHistoryList');
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function renderHistory(tId = 'fullHistoryList', homeLimit = 3) {
  try {
    const c = document.getElementById(tId); if(!c) return;
    if(!logs || logs.length===0) { c.innerHTML="<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='inbox' class='w-6 h-6 opacity-50'></i> No logs recorded yet.</p>"; refreshIcons(); return; }

    let filteredLogs = logs.map((l, i) => ({ ...l, origIdx: i })).reverse();

    // Search filter
    let searchVal = '';
    if (tId === 'fullHistoryList') {
        const searchInput = document.getElementById('historySearch');
        searchVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (searchVal) {
            filteredLogs = filteredLogs.filter(l => {
                let tagsArr = [];
                if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
                else if (l.trigger) tagsArr = [l.trigger];
                const tagsText = tagsArr.join(' ').toLowerCase();
                const dateText = l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }).toLowerCase() : '';
                const timeText = l.timestamp ? formatAppTime(new Date(l.timestamp)).toLowerCase() : '';
                const noteText = (l.note || '').toLowerCase();
                return tagsText.includes(searchVal) || dateText.includes(searchVal) || timeText.includes(searchVal) || noteText.includes(searchVal);
            });
        }

        // Date range filter
        const fromInput = document.getElementById('historyDateFrom');
        const toInput = document.getElementById('historyDateTo');
        const fromVal = fromInput ? fromInput.value : '';
        const toVal = toInput ? toInput.value : '';
        if (fromVal) {
            const fromDate = new Date(fromVal + 'T00:00:00').getTime();
            filteredLogs = filteredLogs.filter(l => l.timestamp >= fromDate);
        }
        if (toVal) {
            const toDate = new Date(toVal + 'T23:59:59').getTime();
            filteredLogs = filteredLogs.filter(l => l.timestamp <= toDate);
        }
    }

    const filterSelect = document.getElementById('historyTagFilter');
    if (filterSelect && tId === 'fullHistoryList' && filterSelect.value !== 'all') {
        filteredLogs = filteredLogs.filter(l => {
            let tagsArr = [];
            if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
            else if (l.trigger) tagsArr = [l.trigger];
            return tagsArr.includes(filterSelect.value);
        });
    }

    if(filteredLogs.length===0) {
        const isFiltered = searchVal || (document.getElementById('historyDateFrom') && document.getElementById('historyDateFrom').value) || (document.getElementById('historyDateTo') && document.getElementById('historyDateTo').value) || (document.getElementById('historyTagFilter') && document.getElementById('historyTagFilter').value !== 'all');
        if(isFiltered) {
          c.innerHTML = `<div class="premium-card p-6 text-center space-y-2"><div class="w-10 h-10 rounded-2xl mx-auto flex items-center justify-center" style="background: rgba(245,158,11,0.1);"><i data-lucide="filter" class="w-5 h-5" style="color: var(--accent);"></i></div><p class="text-xs font-bold" style="color: var(--text-main);">No Matches</p><p class="text-[11px]" style="color: var(--text-muted);">No logs match your filters. Try adjusting the date range or search.</p></div>`;
        } else {
          c.innerHTML = `<div class="premium-card p-6 text-center space-y-2"><div class="w-10 h-10 rounded-2xl mx-auto flex items-center justify-center" style="background: var(--accent-glow);"><i data-lucide="inbox" class="w-5 h-5" style="color: var(--accent);"></i></div><p class="text-xs font-bold" style="color: var(--text-main);">No Logs Yet</p><p class="text-[11px]" style="color: var(--text-muted);">Your first log hasn't happened yet. Every stick counted brings clarity.</p></div>`;
        }
        const btnBox = document.getElementById('historyLoadMore');
        if(btnBox) btnBox.classList.add('hidden');
        refreshIcons();
        return;
    }

    let mappedLogs = tId === 'homeRecentLogs' ? filteredLogs.slice(0, homeLimit) : filteredLogs.slice(0, historyRenderLimit);
    
    const btnBox = document.getElementById('historyLoadMore');
    if (btnBox && tId === 'fullHistoryList') {
        if (filteredLogs.length > historyRenderLimit) btnBox.classList.remove('hidden');
        else btnBox.classList.add('hidden');
    }

    if (tId === 'homeRecentLogs') {
      let prevGap = null;
      c.innerHTML = mappedLogs.map(l => { const item = renderHistoryItem(l, prevGap); prevGap = l.gap; return item; }).join('');
    }
    else {
      let groups = {};
      mappedLogs.forEach(l => { const k = new Date(l.timestamp).toDateString(); if(!groups[k]) groups[k] = []; groups[k].push(l); });
      const todayStr = new Date().toDateString(); let yest = new Date(); yest.setDate(yest.getDate() - 1); const yestStr = yest.toDateString();
      let html = '';
      let prevGap = null;
      for (let k in groups) {
        let headerLabel = k;
        if (k === todayStr) headerLabel = 'TODAY'; else if (k === yestStr) headerLabel = 'YESTERDAY';
        else { const d = new Date(k); headerLabel = `${d.toLocaleDateString('en-US', {weekday:'short'}).toUpperCase()}, ${d.toLocaleDateString('en-US', {month:'short', day:'numeric'}).toUpperCase()}`; }
        html += `<div class="pt-4 pb-1 flex items-center justify-between"><h4 class="text-[10px] font-bold uppercase tracking-widest text-gray-500">${headerLabel}</h4><span class="text-xs font-black px-2.5 py-1 rounded-full" style="background: var(--input-bg); color: var(--accent);">${groups[k].length} ${groups[k].length === 1 ? 'cig' : 'cigs'}</span></div>`;
        html += `<div class="space-y-3">` + groups[k].map(l => { const item = renderHistoryItem(l, prevGap); prevGap = l.gap; return item; }).join('') + `</div>`;
      }
      c.innerHTML = html;
    }
    refreshIcons();
  } catch (err) { console.error("renderHistory Error", err); }
}

function renderHistoryItem(l, prevGap) {
  let trendClass = 'bg-gray-500/10 text-gray-400', trendIcon = 'minus', valueColor = 'var(--accent)';
  if (l.gap !== null && l.gap !== undefined && prevGap !== null && prevGap !== undefined) {
    if (l.gap > prevGap) { trendClass = 'bg-emerald-500/10 text-emerald-500'; trendIcon = 'trending-up'; valueColor = '#10B981'; }
    else if (l.gap < prevGap) { trendClass = 'bg-red-500/10 text-red-500'; trendIcon = 'trending-down'; valueColor = '#EF4444'; }
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
  const moodDef = moodDefFor(l.mood);
  const moodHtml = moodDef
    ? `<span class="mr-1 inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0" title="Mood: ${moodDef.label}" style="background:${moodDef.color};color:#fff;"><i data-lucide="${moodDef.icon}" class="w-2.5 h-2.5"></i></span>`
    : (l.mood ? `<span class="mr-1">${l.mood}</span>` : '');
  const noteHtml = l.note ? `<div class="flex items-start gap-1 mt-1.5"><i data-lucide="edit-3" class="w-2.5 h-2.5 shrink-0 mt-0.5" style="color: var(--text-muted);"></i><span class="text-[10px] leading-relaxed italic" style="color: var(--text-muted);">${esc(l.note.substring(0, 200))}</span></div>` : '';

  return `
  <div onclick="window.openTriggerModal(${l.origIdx})" class="premium-card p-4 flex justify-between items-center relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform hover:bg-gray-500/5">
    <button onclick="event.stopPropagation();window.deleteLogFromHistory(${l.origIdx})" class="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all z-10 hover:bg-red-500/10" style="color: rgba(239,68,68,0.4);" title="Delete this log"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
    <div class="flex items-start gap-3 flex-1 min-w-0 pr-3">
      <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${trendClass}"><i data-lucide="${trendIcon}" class="w-3.5 h-3.5"></i></div>
      <div class="flex-1 min-w-0">
        <div class="font-bold tracking-wide flex items-center gap-2" style="color: var(--text-main);">${timeStr}${moodHtml}<div class="flex gap-0.5 ml-2">${intensityDots}</div></div>
        <div class="text-[10px] font-bold uppercase mt-0.5 flex items-start gap-1" style="color: var(--text-muted);"><i data-lucide="tag" class="w-3 h-3 shrink-0 mt-0.5"></i><span class="leading-relaxed whitespace-normal break-words">${tagsDisplay}</span></div>
        ${noteHtml}
      </div>
    </div>
    <div class="numeric-display font-bold text-base shrink-0" style="color: ${valueColor};">${formatGap(l.gap)}</div>
  </div>`;
}

function compressImage(file, maxW, maxH, quality, cb) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxW) { h *= maxW / w; w = maxW; }
      if (h > maxH) { w *= maxH / h; h = maxH; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

window.handlePhotoUpload = function(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (progressPhotos.length >= 5) { showToast('Maximum 5 photos allowed.'); e.target.value = ''; return; }
  compressImage(file, 800, 800, 0.7, function(dataUrl) {
    progressPhotos.push({id: Date.now(), dataUrl: dataUrl, timestamp: Date.now()});
    localStorage.setItem('smoke_progress_photos', JSON.stringify(progressPhotos));
    renderProgressPhotos();
    showToast('Progress photo added!');
  });
  e.target.value = '';
}

function renderProgressPhotos() {
  const section = document.getElementById('progressPhotosSection');
  const grid = document.getElementById('photoGrid');
  const countEl = document.getElementById('photoCount');
  if (!section || !grid) return;

  if (!progressPhotos || progressPhotos.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  if (countEl) countEl.innerText = `${progressPhotos.length}/5`;

  const sorted = [...progressPhotos].sort((a, b) => b.timestamp - a.timestamp);
  grid.innerHTML = sorted.map(p => {
    const d = new Date(p.timestamp);
    const dateStr = d.toLocaleDateString([], {month:'short', day:'numeric'});
    return `<div onclick="window.openPhotoViewer(${p.id})" class="relative rounded-xl overflow-hidden cursor-pointer active:scale-95 transition-all aspect-square" style="background: var(--input-bg); border: 1px solid var(--card-border);">
      <img src="${p.dataUrl}" loading="lazy" class="w-full h-full object-cover" alt="Progress ${dateStr}">
      <div class="absolute bottom-0 left-0 right-0 text-[8px] font-bold text-center py-1" style="background: rgba(0,0,0,0.5); color: #fff;">${dateStr}</div>
    </div>`;
  }).join('');
  refreshIcons();
}

window.openPhotoViewer = function(id) {
  const photo = progressPhotos.find(p => p.id === id);
  if (!photo) return;
  const img = document.getElementById('photoViewerImage');
  const dateEl = document.getElementById('photoViewerDate');
  const delBtn = document.getElementById('photoViewerDelete');
  if (img) img.src = photo.dataUrl;
  if (dateEl) dateEl.innerText = new Date(photo.timestamp).toLocaleDateString([], {weekday:'short', month:'short', day:'numeric', year:'numeric'});
  if (delBtn) delBtn.dataset.photoid = id;
  const modal = document.getElementById('photoViewerModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

window.closePhotoViewer = function() {
  const modal = document.getElementById('photoViewerModal');
  if (modal) modal.classList.add('hidden');
  const img = document.getElementById('photoViewerImage');
  if (img) img.src = '';
}

window.deleteViewedPhoto = function() {
  const delBtn = document.getElementById('photoViewerDelete');
  const id = parseInt(delBtn?.dataset?.photoid);
  if (!id) return;
  showConfirm("Delete this photo?", "This cannot be undone.", () => {
    progressPhotos = progressPhotos.filter(p => p.id !== id);
    localStorage.setItem('smoke_progress_photos', JSON.stringify(progressPhotos));
    closePhotoViewer();
    renderProgressPhotos();
    showToast('Photo deleted.');
  });
}

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter').value, now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if(filter === 'today') return logs.filter(l => l.timestamp >= todayStart);
  if(filter === '7days') return logs.filter(l => l.timestamp >= todayStart - (6 * 86400000));
  if(filter === '1month') return logs.filter(l => l.timestamp >= todayStart - (29 * 86400000));
  if(filter === 'custom') {
      const fromVal = document.getElementById('insightsDateFrom')?.value || '';
      const toVal = document.getElementById('insightsDateTo')?.value || '';
      let filtered = logs;
      if (fromVal) filtered = filtered.filter(l => l.timestamp >= new Date(fromVal + 'T00:00:00').getTime());
      if (toVal) filtered = filtered.filter(l => l.timestamp <= new Date(toVal + 'T23:59:59').getTime());
      return filtered;
  }
  return logs;
}

window.toggleInsightsCustomRange = function() {
    const sel = document.getElementById('insightsDateFilter');
    const range = document.getElementById('insightsCustomRange');
    if (sel && range) {
        range.classList.toggle('hidden', sel.value !== 'custom');
    }
    renderAllCharts();
}

window.clearInsightsCustomRange = function() {
    const from = document.getElementById('insightsDateFrom');
    const to = document.getElementById('insightsDateTo');
    const sel = document.getElementById('insightsDateFilter');
    if (from) from.value = '';
    if (to) to.value = '';
    if (sel) sel.value = 'all';
    const range = document.getElementById('insightsCustomRange');
    if (range) range.classList.add('hidden');
    renderAllCharts();
}

window.validateInsightsDates = function() {
    const from = document.getElementById('insightsDateFrom');
    const to = document.getElementById('insightsDateTo');
    if (!from || !to) return;
    const today = new Date().toISOString().split('T')[0];
    from.max = today;
    to.max = today;
    if (from.value && from.value > today) from.value = today;
    if (to.value && to.value > today) to.value = today;
    if (from.value && to.value && from.value > to.value) {
      from.value = to.value;
    }
    renderAllCharts();
}
function setBadge(id, text, colorClass) { const b = document.getElementById(id); if(b) { if(text) { b.innerText = text; b.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${colorClass}`; b.classList.remove('hidden'); } else b.classList.add('hidden'); } }

function renderHeatmapCalendar(logsArray) {
    try {
      const container = document.getElementById('calendarHeatmap');
      if(!container) return;

      const today = new Date();
      today.setHours(0,0,0,0);

      // Always show minimum 28 days, extend up to 56 based on actual data range
      let rangeDays = 27;
      if (logsArray.length > 0) {
        const oldest = new Date(logsArray[0].timestamp);
        oldest.setHours(0,0,0,0);
        const dataDays = Math.round((today - oldest) / 86400000) + 1;
        rangeDays = Math.max(27, Math.min(dataDays, 55));
      }
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - rangeDays);

      let dailyCounts = {};
      for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        dailyCounts[d.toDateString()] = 0;
      }

      logsArray.forEach(l => {
          let dStr = new Date(l.timestamp).toDateString();
          if(dailyCounts[dStr] !== undefined) dailyCounts[dStr]++;
      });

      let maxVal = Math.max(...Object.values(dailyCounts), 1);

      let html = '';
      const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dateKeys = Object.keys(dailyCounts);

      // Fixed labels Sun-Sat, height 16px matches heat-cell + same 3px gap = perfect pitch alignment
      const labelStyle = 'height:16px;display:flex;align-items:center;line-height:16px';
      html += `<div class="heat-col" style="gap: 3px;">` + allDays.map(d => `<span class="text-[7px] font-bold text-gray-500" style="${labelStyle}">${d}</span>`).join('') + `</div>`;

      let currentCol = '';
      let cellsInCol = 0;

      // Pad the first column with blanks so the range starts on its correct weekday row
      const firstDayOfWeek = new Date(dateKeys[0]).getDay(); // 0=Sun ... 6=Sat
      for (let i = 0; i < firstDayOfWeek; i++) {
        currentCol += `<div style="width:16px;height:16px;flex-shrink:0;"></div>`;
        cellsInCol++;
      }

      dateKeys.forEach((dStr, idx) => {
          const count = dailyCounts[dStr];
          let intensity = 0;
          if (count > 0) {
              let ratio = count / maxVal;
              intensity = Math.ceil(ratio * 4);
              if(intensity === 0) intensity = 1;
          }

          currentCol += `<div class="heat-cell" style="background-color: var(--heat-${intensity});" title="${count} cigarette${count !== 1 ? 's' : ''} on ${dStr}">${count > 0 ? count : ''}</div>`;
          cellsInCol++;

          const dayOfWeek = new Date(dStr).getDay();

          // Close column on Saturday or after the last date
          if (dayOfWeek === 6 || idx === dateKeys.length - 1) {
              // Pad remaining slots so every column has 7 rows
              while (cellsInCol < 7) {
                  currentCol += `<div style="width:16px;height:16px;flex-shrink:0;"></div>`;
                  cellsInCol++;
              }
              html += `<div class="heat-col">${currentCol}</div>`;
              currentCol = '';
              cellsInCol = 0;
          }
      });
      container.innerHTML = html;
    } catch(e) {}
}

function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  const filter = document.getElementById('insightsDateFilter').value;
  const filterEl = document.getElementById('selectedFilterLabel');
  if(filterEl) filterEl.innerText = { today: 'Today', '7days': 'Last 7 Days', '1month': '1 Month', all: 'All Time', custom: 'Custom Range' }[filter] || 'Selected Period';

  // Show/hide chart empty state
  const chartEmpty = document.getElementById('chartEmptyState');
  const chartCards = document.querySelectorAll('#chartContainer > .premium-card:not(#chartEmptyState)');
  if (chartEmpty) chartEmpty.classList.toggle('hidden', activeLogs.length > 0);
  chartCards.forEach(c => c.classList.toggle('hidden', activeLogs.length === 0));

  let activeWaves = waves;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if(filter === 'today') activeWaves = waves.filter(w => w >= todayStart);
  else if(filter === '7days') activeWaves = waves.filter(w => w >= todayStart - (6 * 86400000));
  else if(filter === '1month') activeWaves = waves.filter(w => w >= todayStart - (29 * 86400000));
  else if(filter === 'custom') {
    const fromEl = document.getElementById('insightsDateFrom');
    const toEl = document.getElementById('insightsDateTo');
    if(fromEl && toEl && fromEl.value && toEl.value) {
      const fromMs = new Date(fromEl.value + 'T00:00:00').getTime();
      const toMs = new Date(toEl.value + 'T23:59:59').getTime();
      activeWaves = waves.filter(w => w >= fromMs && w <= toMs);
    }
  }

  const totalEvents = activeLogs.length + activeWaves.length;
  const winRate = totalEvents > 0 ? Math.round((activeWaves.length / totalEvents) * 100) : 0;
  
  const winRateEl = document.getElementById('insightWinRate');
  if (winRateEl) animateCounter(winRateEl, winRate, 600, '', '%');

  let totalSpend = (activeLogs.length * (settings.packPrice/settings.packSize)).toFixed(1);
  document.getElementById('insightPeriodSpend').innerText = `${settings.currency} ${totalSpend}`;
  document.getElementById('insightPeriodCount').innerText = `${activeLogs.length} cigarette${activeLogs.length !== 1 ? 's' : ''} smoked`;

  const gappedLogs = activeLogs.filter(l => l.gap !== null && l.gap !== undefined);
  document.getElementById('insightAvgGap').innerText = gappedLogs.length > 0 ? formatGap(Math.round(gappedLogs.reduce((a, b) => a + b.gap, 0) / gappedLogs.length)) : '--';

  let smartText = activeLogs.length > 0 ? "Analyzing your patterns..." : "Log your first cigarette to unlock personalized insights about your habits.";
  
  if(activeLogs.length > 0) {
    let trigIntensitySum = {}; let trigIntensityCount = {};
    activeLogs.forEach(l => {
      let tagsArr = [];
      if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
      else if (l.trigger) tagsArr = [l.trigger];
      else tagsArr = ['Uncategorized'];
      tagsArr.forEach(t => {
        const inten = l.intensity || 3;
        trigIntensitySum[t] = (trigIntensitySum[t]||0) + inten;
        trigIntensityCount[t] = (trigIntensityCount[t]||0) + 1;
      });
    });

    if(activeLogs.length === 1) {
      smartText = `Your first log is recorded. Keep logging to see personalized insights.`;
    } else {
      smartText = '';
    }

    const intensityCandidates = Object.keys(trigIntensityCount).filter(t => trigIntensityCount[t] >= 2);
    if(intensityCandidates.length > 0) {
      const avgIntensityByTrigger = {}; intensityCandidates.forEach(t => avgIntensityByTrigger[t] = trigIntensitySum[t] / trigIntensityCount[t]);
      const hardestTrigger = intensityCandidates.reduce((a,b) => avgIntensityByTrigger[a] > avgIntensityByTrigger[b] ? a : b);
      if(avgIntensityByTrigger[hardestTrigger] >= 3.3) {
        smartText += `<strong>${esc(hardestTrigger)}</strong> brings your most intense cravings.`;
      }
    }

    if (!smartText) smartText = 'Keep logging to unlock deeper pattern insights.';
  } else {
    smartText = 'Log your first cigarette to unlock personalized insights about your habits.';
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
  const savedEl = document.getElementById('insightTotalSaved');
  if (savedEl) animateCounter(savedEl, Math.round(totalSavedLifetime), 800, settings.currency + ' ');
  
  const allGaps = activeLogs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  document.getElementById('insightLongestGap').innerText = allGaps.length > 0 ? formatGap(Math.max(...allGaps)) : '--';

  const dailyGaps = computeDailyGaps(activeLogs, 720).map(d => d.avg).filter(v => v !== null && v !== undefined);
  let badge1Txt = '', badge1Cls = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  if (dailyGaps.length >= 2) {
    const last = dailyGaps[dailyGaps.length - 1], prev = dailyGaps[dailyGaps.length - 2];
    const delta = last - prev;
    if (delta > 0) badge1Txt = `↑ ${formatGapSmart(delta)}`;
    else if (delta < 0) { badge1Txt = `↓ ${formatGapSmart(Math.abs(delta))}`; badge1Cls = 'bg-amber-500/10 text-amber-500 border-amber-500/20'; }
    else badge1Txt = `= ${formatGapSmart(last)}`;
  } else if (dailyGaps.length === 1) {
    badge1Txt = formatGapSmart(dailyGaps[0]);
  }
  setBadge('badge-chart1', badge1Txt, badge1Cls);
  // badge-chart2 removed (redundant with insightPeriodCount)

  const labels = activeLogs.length > 0 ? activeLogs.map(l => {
    let d = new Date(l.timestamp);
    if (filter === 'today') return formatAppTime(d);
    if (filter === '7days') return d.toLocaleDateString([], {weekday:'short'});
    return d.toLocaleDateString([], {month:'short', day:'numeric'});
  }) : ['Start logging to see your trend'];

  // Chart1 data: daily average gaps for multi-day, per-cigarette for today
  const isMultiDay = filter !== 'today';
  const dailySeries = isMultiDay ? computeDailyGaps(activeLogs, 720) : [];
  const chart1Labels = isMultiDay
    ? (dailySeries.length > 0 ? dailySeries.map(d => { const dt = new Date(d.key); return (filter === '7days') ? dt.toLocaleDateString([], {weekday:'short'}) : dt.toLocaleDateString([], {month:'short', day:'numeric'}); }) : ['Start logging'])
    : (activeLogs.length > 0 ? activeLogs.map(l => formatAppTime(new Date(l.timestamp))) : ['Start logging']);
  const chart1Data = isMultiDay
    ? (dailySeries.length > 0 ? smoothDaily(dailySeries.map(d => d.avg), 3) : [null])
    : (activeLogs.length > 0 ? activeLogs.map(l => (l.gap !== null && l.gap !== undefined) ? l.gap : null) : [null]);
  const chartTextColor = (isLightTheme()) ? '#64748B' : '#9CA3AF';
  const chartTooltipTheme = (isLightTheme())
    ? { backgroundColor: 'rgba(255, 255, 255, 0.96)', titleColor: '#0F172A', bodyColor: '#334155', titleFont: { family: APP_FONT_FAMILY, size: 11, weight: '700' }, bodyFont: { family: APP_FONT_FAMILY, size: 11, weight: '600' }, borderColor: 'rgba(203, 213, 225, 0.9)', borderWidth: 1, padding: 12, cornerRadius: 12, displayColors: false }
    : { backgroundColor: 'rgba(15, 23, 42, 0.96)', titleColor: '#FFFFFF', bodyColor: '#CBD5E1', titleFont: { family: APP_FONT_FAMILY, size: 11, weight: '700' }, bodyFont: { family: APP_FONT_FAMILY, size: 11, weight: '600' }, borderColor: 'rgba(255, 255, 255, 0.08)', borderWidth: 1, padding: 12, cornerRadius: 12, displayColors: false };

  const coloredTooltipLabel = { callbacks: { label: (ctx) => { let val; if (ctx.parsed && typeof ctx.parsed.y === 'number') val = ctx.parsed.y; else if (ctx.parsed && typeof ctx.parsed === 'number') val = ctx.parsed; else val = ctx.formattedValue; return ` ${ctx.dataset?.label || ''}: ${val}`; } } };

  const proOptions = getPremiumChartOptions(chartTextColor, chartTooltipTheme);
  const createGradient = (ctx, colorHex) => { let g = ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, colorHex); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  function upsertChart(key, ctx, config) { 
    try {
      const existing = myChartInstances[key]; 
      if (existing && existing.config && existing.config.type === config.type) { 
        existing.data = config.data; 
        if (config.options) existing.options = config.options; 
        existing.update(); 
      } else { 
        if (existing) existing.destroy(); 
        myChartInstances[key] = new Chart(ctx, config); 
      }
    } catch(err) {
      console.warn(`Chart ${key} rendering bypassed to prevent crash:`, err);
    }
  }

  const fullDateTimeTooltip = { callbacks: { title: (items) => { if(!items.length) return ''; const l = activeLogs[items[0].dataIndex]; if(!l) return ''; const d = new Date(l.timestamp); return `${d.toLocaleDateString([], {month:'short', day:'numeric'})} · ${formatAppTime(d)}`; } } };
  const mergeTooltip = (base, extra) => ({ ...base, ...extra, callbacks: { ...(base.callbacks || {}), ...(extra.callbacks || {}) } });

  // Downsample large datasets for readability
  function downsample(lbls, vals, maxPoints) {
    if (lbls.length <= maxPoints) return { labels: lbls, data: vals };
    const bucketSize = Math.ceil(lbls.length / maxPoints);
    const newLabels = [], newData = [];
    for (let i = 0; i < lbls.length; i += bucketSize) {
      const chunk = vals.slice(i, i + bucketSize).filter(v => v !== null && v !== undefined);
      newLabels.push(lbls[i]);
      newData.push(chunk.length > 0 ? Math.round(chunk.reduce((a,b) => a+b, 0) / chunk.length) : 0);
    }
    return { labels: newLabels, data: newData };
  }

  const MAX_CHART_POINTS = 30;
  const ds1 = downsample(chart1Labels, chart1Data, MAX_CHART_POINTS);

  try {
    const ctx1 = document.getElementById('chart1').getContext('2d');
    const chart1Tooltip = {
      callbacks: {
        title: (items) => items.length ? (ds1.labels[items[0].dataIndex] || '') : '',
        label: (ctx) => { const v = ctx.parsed.y; return ` ${ctx.dataset.label}: ${formatGapSmart(v)}`; }
      }
    };
    upsertChart(1, ctx1, {
      type: 'line',
      data: { labels: ds1.labels, datasets: [{
        label: isMultiDay ? 'Daily Avg Gap' : 'Gap',
        data: ds1.data,
        borderColor: '#10B981',
        backgroundColor: createPremiumGradient(ctx1, '#10B981'),
        borderWidth: 2.5,
        tension: 0.45,
        fill: true,
        pointRadius: ds1.data.length <= 15 ? 3 : 0,
        pointHitRadius: 15,
        pointBackgroundColor: '#10B981',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        spanGaps: true
      }] },
      options: {
        ...proOptions,
        plugins: { ...proOptions.plugins, tooltip: mergeTooltip(proOptions.plugins.tooltip, chart1Tooltip) },
        scales: {
          ...proOptions.scales,
          x: { ...proOptions.scales.x, offset: true },
          y: { ...proOptions.scales.y, ticks: { ...proOptions.scales.y.ticks, callback: (v) => formatChartTime(v), precision: 0 } }
        }
      },
      plugins: [crosshairPlugin]
    });
  } catch(e){}

  try {
    let cumulativeSpend = 0; let spendData = []; let savedData = [];
    if (activeLogs.length > 0) {
      let periodStartTime = activeLogs[0].timestamp;
      activeLogs.forEach((l, i) => {
        cumulativeSpend += pricePerStick; spendData.push(parseFloat(cumulativeSpend.toFixed(1)));
        let timeElapsed = l.timestamp - periodStartTime; let expectedCigs = 1 + (timeElapsed / baselineGapMs); let actualCigs = i + 1;
        let savedAmount = Math.max(0, expectedCigs - actualCigs) * pricePerStick; savedData.push(parseFloat(savedAmount.toFixed(1)));
      });
    }
    const ctx3 = document.getElementById('chart3').getContext('2d');
    const ds3s = downsample(labels, spendData, MAX_CHART_POINTS);
    const ds3v = downsample(labels, savedData, MAX_CHART_POINTS);
    upsertChart(3, ctx3, { type: 'line', data: { labels: ds3s.labels, datasets: [{ label: 'Spent', data: ds3s.data, borderColor: '#EF4444', backgroundColor: createGradient(ctx3, 'rgba(239, 68, 68, 0.15)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: ds3s.data.length <= 15 ? 3 : 0, pointHitRadius: 15 }, { label: 'Saved', data: ds3v.data, borderColor: '#10B981', backgroundColor: createGradient(ctx3, 'rgba(16, 185, 129, 0.15)'), fill: true, tension: 0.4, borderWidth: 3, pointRadius: ds3v.data.length <= 15 ? 3 : 0, pointHitRadius: 15 }] }, options: { ...proOptions, plugins: { ...proOptions.plugins, tooltip: mergeTooltip(proOptions.plugins.tooltip, fullDateTimeTooltip) }, scales: { ...proOptions.scales, x: { ...proOptions.scales.x, offset: true }, y: { ...proOptions.scales.y, ticks: { ...proOptions.scales.y.ticks, callback: (v) => `${settings.currency} ${v}` } } } }, plugins: [crosshairPlugin] });
    let finalSaved = savedData.length > 0 ? savedData[savedData.length - 1] : '0.0';
    const baselinePerDay = baselineGapMs > 0 ? Math.round((24 * 60 * 60 * 1000) / baselineGapMs) : settings.dailyLimit;
    setBadge('badge-chart3', activeLogs.length > 0 ? `Saved ${settings.currency}${finalSaved} | @${baselinePerDay}/day` : '', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20');
  } catch(e){}

  try {
    const ctx5 = document.getElementById('chart5').getContext('2d');
    const triggerCountMap = {};
    triggers.forEach(t => triggerCountMap[t] = 0);
    activeLogs.forEach(l => {
        let tagsArr = [];
        if (Array.isArray(l.tags) && l.tags.length > 0) tagsArr = l.tags;
        else if (l.trigger) tagsArr = [l.trigger];
        else tagsArr = ['Uncategorized'];
        tagsArr.forEach(t => { if (triggerCountMap[t] !== undefined) triggerCountMap[t]++; });
    });
    // Sort by count, only show triggers with count > 0
    const sortedTriggers = triggers
      .map((t, i) => ({ name: t, count: triggerCountMap[t] || 0, color: CHART_COLORS[i % CHART_COLORS.length] }))
      .filter(t => t.count > 0)
      .sort((a, b) => b.count - a.count);
    const topTriggerIdx = sortedTriggers.length ? 0 : -1;
    // badge-chart5 removed (redundant with chart5 visual)
    if (sortedTriggers.length > 0) {
      upsertChart(5, ctx5, {
        type: 'bar',
        data: {
          labels: sortedTriggers.map(t => t.name),
          datasets: [{ label: 'Cigarettes', data: sortedTriggers.map(t => t.count), backgroundColor: sortedTriggers.map(t => t.color + '30'), borderColor: sortedTriggers.map(t => t.color), borderWidth: 1.5, borderRadius: { topLeft: 4, bottomLeft: 4, topRight: 4, bottomRight: 4 }, maxBarThickness: 18, barPercentage: 0.7 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 800, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: { ...chartTooltipTheme, backgroundColor: (isLightTheme()) ? 'rgba(255,255,255,0.98)' : 'rgba(15,23,42,0.98)', borderColor: (isLightTheme()) ? 'rgba(203,213,225,0.5)' : 'rgba(255,255,255,0.06)', borderWidth: 1, cornerRadius: 14, padding: 12, callbacks: { label: (ctx) => ` ${ctx.parsed.x} cigarettes` } }
          },
          scales: {
            x: { display: true, grid: { color: 'rgba(156,163,175,0.04)', drawBorder: false }, border: { display: false }, ticks: { color: chartTextColor, font: { family: "'Space Grotesk', monospace", size: 9, weight: '600' }, precision: 0, padding: 8 } },
            y: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: chartTextColor, font: { family: "'General Sans', sans-serif", size: 10, weight: '600' }, padding: 8, mirror: false } }
          }
        }
      });
    }
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
      let datasets = topTriggers.map((t, i) => ({ label: t, data: triggerByPart[t], backgroundColor: CHART_COLORS[i % CHART_COLORS.length], borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 }));
      if(otherByPart.some(v => v > 0)) datasets.push({ label: 'Other Triggers', data: otherByPart, backgroundColor: '#9CA3AF', borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 });
      datasets.push({ label: 'Resisted', data: wavesByPart, backgroundColor: '#0EA5E9', borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 });
      upsertChart(6, chart6El.getContext('2d'), { type: 'bar', data: { labels: dayParts, datasets: datasets }, options: { ...proOptions, scales: { x: { ...proOptions.scales.x, offset: true }, y: { ...proOptions.scales.y, ticks: { ...proOptions.scales.y.ticks, precision: 0 } } }, plugins: { ...proOptions.plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { family: APP_FONT_FAMILY, size: 9 }, color: chartTextColor } } } } });
    }
  } catch(e){}
  
  renderHeatmapCalendar(activeLogs);
  renderHeatMap('mapContainer', activeLogs);
  renderLifeRegainedCounter();
  renderRecoveryTimeline();

  // Premium: render sparklines in stat cards — REMOVED (redundant with full charts)
}

function renderHeatMap(containerId, activeLogs) {
  try {
    const mapEl = document.getElementById(containerId); if(!mapEl) return;
    let lastWithLoc = activeLogs.slice().reverse().find(l => l.lat && l.lng), lat = lastWithLoc ? lastWithLoc.lat : 25.2048, lng = lastWithLoc ? lastWithLoc.lng : 55.2708;
    let locCounts = {};
    activeLogs.filter(l => l.lat && l.lng).forEach(l => {
      const key = `${l.lat.toFixed(3)},${l.lng.toFixed(3)}`;
      locCounts[key] = (locCounts[key] || 0) + 1;
    });
    let maxLocCount = Math.max(...Object.values(locCounts), 1);
    let heatPoints = activeLogs.filter(l => l.lat && l.lng).map(l => {
      const key = `${l.lat.toFixed(3)},${l.lng.toFixed(3)}`;
      return [l.lat, l.lng, (locCounts[key] || 1) / maxLocCount];
    });
    const isModal = containerId === 'mapModalContainer';
    let m = isModal ? modalMapInstance : mapInstance;

    // If map already exists, just update heat layer data
    if (m && m._leaflet_id) {
      if (m._smokegapHeat) { m.removeLayer(m._smokegapHeat); m._smokegapHeat = null; }
      if (m._smokegapMarker) { m.removeLayer(m._smokegapMarker); m._smokegapMarker = null; }
      if (heatPoints.length > 0 && window.L.heatLayer) {
        m._smokegapHeat = L.heatLayer(heatPoints, {radius: 28, blur: 18, maxZoom: 17, minOpacity: 0.4}).addTo(m);
      } else {
        m._smokegapMarker = L.marker([lat, lng]).addTo(m);
      }
      m.setView([lat, lng], Math.min(m.getZoom(), 13));
      setTimeout(() => { try { m.invalidateSize(); } catch(e){} }, 100);
      return;
    }

    // Create new map only if none exists
    if (m) { try { m.remove(); } catch(e) {} }
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

// ==================== LIFE REGAINED COUNTER ====================
function renderLifeRegainedCounter() {
  try {
    const card = document.getElementById('lifeRegainedCard');
    const textEl = document.getElementById('lifeRegainedText');
    const subEl = document.getElementById('lifeRegainedSub');
    if (!card || !textEl) { return; }

    const settings = JSON.parse(localStorage.getItem('smoke_settings') || '{}');
    const baselineGapMs = parseInt(localStorage.getItem('smoke_baseline_gap'));
    const dailyLimit = settings.dailyLimit || 15;
    const effectiveBaseline = (!baselineGapMs || isNaN(baselineGapMs) || baselineGapMs <= 0)
      ? (24 * 60 * 60 * 1000) / dailyLimit : baselineGapMs;

    if (logs.length < 2) {
      // Show empty state for new users
      textEl.textContent = '—';
      textEl.style.fontSize = '1.5rem';
      if (subEl) subEl.textContent = 'Log more cigarettes to see life reclaimed';
      card.classList.remove('hidden');
      return;
    }

    const firstLog = logs[0].timestamp;
    const now = Date.now();
    const elapsedMs = now - firstLog;
    const expectedCigs = Math.floor(elapsedMs / effectiveBaseline);
    const actualCigs = logs.length;
    const reclaimedCigs = Math.max(0, expectedCigs - actualCigs);

    const reclaimedMin = reclaimedCigs * 11;
    const days = Math.floor(reclaimedMin / 1440);
    const hours = Math.floor((reclaimedMin % 1440) / 60);
    const mins = Math.round(reclaimedMin % 60);

    let display = '';
    if (days > 0) display += `${days}d `;
    if (hours > 0) display += `${hours}h `;
    display += `${mins}m`;
    textEl.textContent = display.trim();
    textEl.style.fontSize = '';

    if (subEl) {
      if (reclaimedCigs > 0) {
        subEl.textContent = `From ${reclaimedCigs.toLocaleString()} cigarettes not smoked`;
        textEl.style.color = '';
      } else {
        subEl.textContent = `You've smoked ${actualCigs} so far — keep going, every gap counts`;
        textEl.style.color = 'var(--accent)';
      }
    }
    card.classList.remove('hidden');
  } catch(e) { console.warn('Life Regained render error:', e); }
}

// ==================== BODY RECOVERY TIMELINE ====================
function renderRecoveryTimeline() {
  try {
    const card = document.getElementById('recoveryTimelineCard');
    const subtitle = document.getElementById('recoverySubtitle');
    const list = document.getElementById('recoveryTimelineList');
    if (!card || !list) return;

    const settings = JSON.parse(localStorage.getItem('smoke_settings') || '{}');
    const quitDateStr = settings.quitDate;

    // Empty state — show CTA when quit date not set
    if (!quitDateStr || isNaN(new Date(quitDateStr + 'T00:00:00').getTime())) {
      if (subtitle) subtitle.textContent = 'Set your quit date to track recovery milestones';
      list.innerHTML = `<div class="flex flex-col items-center py-6 text-center">
        <div class="w-12 h-12 rounded-full flex items-center justify-center mb-3" style="background: linear-gradient(135deg, rgba(16,185,129,0.12), rgba(34,197,94,0.12));">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <p class="text-[11px] font-semibold mb-1" style="color: var(--text-main);">Track Your Body Recovery</p>
        <p class="text-[10px] font-medium mb-3" style="color: var(--text-muted);">See how your body heals after quitting — 9 milestones from 20 min to 15 months</p>
        <button onclick="switchTab('settings')" class="text-[10px] font-bold px-4 py-2 rounded-xl text-white transition-all" style="background: linear-gradient(135deg, #10b981, #059669);">Set Quit Date</button>
      </div>`;
      card.classList.remove('hidden');
      return;
    }

    const quitDate = new Date(quitDateStr + 'T00:00:00');
    const now = Date.now();
    const elapsedMs = now - quitDate.getTime();
    if (elapsedMs < 0) {
      if (subtitle) subtitle.textContent = 'Quit date is in the future';
      list.innerHTML = '';
      card.classList.remove('hidden');
      return;
    }
    const elapsedMin = elapsedMs / 60000;

    if (subtitle) {
      const days = Math.floor(elapsedMin / 1440);
      const hours = Math.floor((elapsedMin % 1440) / 60);
      let timeStr = '';
      if (days > 0) timeStr += `${days} day${days !== 1 ? 's' : ''}`;
      if (hours > 0 && days < 30) timeStr += `${timeStr ? ' ' : ''}${hours}h`;
      if (!timeStr) timeStr = `${Math.round(elapsedMin)} min`;
      subtitle.textContent = `Smoke-free for ${timeStr}`;
    }

    const milestones = [
      { min: 20, title: 'Pulse Normalizes', desc: 'Heart rate drops to normal levels', icon: 'heart-pulse' },
      { min: 480, title: 'CO Levels Halved', desc: 'Carbon monoxide in blood drops by 50%', icon: 'wind' },
      { min: 2880, title: 'Taste & Smell Return', desc: 'Nerve endings begin to regenerate', icon: 'nose' },
      { min: 20160, title: 'Circulation Improves', desc: 'Blood flow becomes noticeably better', icon: 'activity' },
      { min: 43200, title: 'Lung Function +10%', desc: 'Breathing becomes easier and deeper', icon: 'lungs' },
      { min: 87600, title: 'Heart Attack Risk Halved', desc: 'Your heart is significantly safer', icon: 'shield-check' },
      { min: 262800, title: 'Stroke Risk = Non-Smoker', desc: 'Your stroke risk matches a non-smoker', icon: 'brain' },
      { min: 525600, title: 'Lung Cancer Risk Halved', desc: 'Your lungs are healing deeply', icon: 'ribbon' },
      { min: 788400, title: 'Heart Disease = Non-Smoker', desc: 'Full cardiovascular recovery', icon: 'heart' }
    ];

    list.innerHTML = milestones.map((m, i) => {
      const unlocked = elapsedMin >= m.min;
      const nextMilestone = milestones.find(x => elapsedMin < x.min);
      const progress = unlocked ? 100 : (nextMilestone && milestones.indexOf(nextMilestone) === i ? Math.min(100, (elapsedMin / m.min) * 100) : 0);

      return `<div class="flex items-start gap-3 ${i < milestones.length - 1 ? 'pb-4' : ''}" style="position:relative;">
        <div class="flex flex-col items-center shrink-0" style="z-index:1;">
          <div class="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-700 ${
            unlocked
              ? 'bg-gradient-to-br from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/25'
              : 'border-2 border-gray-300 dark:border-gray-600'
          }" style="${unlocked ? '' : 'background: var(--card-bg);'}">
            ${unlocked
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
              : `<span class="text-[10px] font-bold" style="color: var(--text-muted);">${i + 1}</span>`}
          </div>
          ${i < milestones.length - 1 ? `<div class="w-0.5 flex-1 mt-1 rounded-full ${unlocked ? 'bg-emerald-500/40' : 'bg-gray-200 dark:bg-gray-700'}" style="min-height:16px;"></div>` : ''}
        </div>
        <div class="flex-1 ${unlocked ? '' : 'opacity-40'} pt-1">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold ${unlocked ? 'text-emerald-500' : ''}" style="${unlocked ? '' : 'color: var(--text-main);'}">${m.title}</span>
            ${unlocked ? '<span class="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 uppercase">Unlocked</span>' : ''}
          </div>
          <p class="text-[10px] font-medium mt-0.5" style="color: var(--text-muted);">${m.desc}</p>
          ${!unlocked && progress > 0 ? `<div class="mt-1.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"><div class="h-full rounded-full bg-emerald-500/50 transition-all duration-1000" style="width:${progress}%"></div></div>` : ''}
        </div>
      </div>`;
    }).join('');

    card.classList.remove('hidden');
  } catch(e) { console.warn('Recovery Timeline render error:', e); }
}

window.enterPin = enterPin; window.clearPin = clearPin; window.setupPin = setupPin; window.renderHistory = renderHistory;
window.switchTab = switchTab; window.updateSettings = updateSettings; window.resetData = resetData;
window.startSmokeTakeover = startSmokeTakeover; window.closeSmokeTakeover = closeSmokeTakeover; window.toggleTakeoverTag = toggleTakeoverTag; window.cancelSmokeTakeover = cancelSmokeTakeover;
window.openTriggerModal = openTriggerModal; window.closeTriggerModal = closeTriggerModal; window.toggleTag = toggleTag; window.saveTags = saveTags;
window.openWaveModal = openWaveModal; window.closeWaveModal = closeWaveModal; window.startWave = startWave; window.cancelActiveWave = cancelActiveWave;
window.renderAllCharts = renderAllCharts; window.openMapModal = openMapModal; window.closeMapModal = closeMapModal;
window.showStatDetail = showStatDetail; window.closeStatDetail = closeStatDetail; window.showShieldDashboard = showShieldDashboard; window.closeShieldDashboard = closeShieldDashboard;
window.exportLogsCSV = exportLogsCSV; window.addCustomTrigger = addCustomTrigger; window.removeCustomTrigger = removeCustomTrigger;
window.renderLifeRegainedCounter = renderLifeRegainedCounter; window.renderRecoveryTimeline = renderRecoveryTimeline;
window.closeConfirmModal = closeConfirmModal; window.confirmYes = confirmYes; window.setTakeoverIntensity = setTakeoverIntensity; window.exportJSON = exportJSON; window.importJSON = importJSON;
window.closePinSetupModal = closePinSetupModal; window.savePinSetup = savePinSetup;
window.requestNotifPermission = requestNotifPermission; window.toggleNotifSetting = toggleNotifSetting;
window.closeSosInterrupter = closeSosInterrupter;

// Handle wave completion while app was backgrounded
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Check if wave should have completed while app was hidden
    if (waveEndTime > 0 && Date.now() >= waveEndTime) {
      if (waveTimer) clearInterval(waveTimer);
      waveEndTime = 0; localStorage.removeItem('smoke_wave_end');
      const overlay = document.getElementById('waveOverlay');
      if (overlay) overlay.classList.add('hidden');
      waves.push(Date.now()); localStorage.setItem('smoke_waves', JSON.stringify(waves));
      logWaveAttempt('won');
      resetRideButton();
      showToast("🛡️ Craving Defeated! +1 Shield");
      sendSystemNotification("🛡️ Craving Defeated!", "Awesome job! You successfully rode out the craving wave. +1 Shield unlocked.", 'notifWaveComplete');
      celebrateBadgeIfUnlocked();
      try { updateUI(); } catch(e) {}
    }
    // Resume breathing exercise if it was active
    if (breathActive && breathPaused) {
      breathPaused = false;
      const btn = document.getElementById('breathPauseBtn');
      if (btn) btn.innerText = 'Pause';
      runBreathPhase(breathCurrentExercise, breathCurrentPhase);
    }
  } else {
    // App went to background — pause breathing exercise
    if (breathActive && !breathPaused) {
      breathPaused = true;
      clearTimeout(breathTimeout); clearInterval(breathInterval);
      const btn = document.getElementById('breathPauseBtn');
      if (btn) btn.innerText = 'Resume';
    }
  }
});
window.deleteLogFromHistory = function(idx) {
  if (logs[idx]) {
    showConfirm("Delete this log?", "This cannot be undone.", () => {
      // Save the log data before deleting so we can restore it
      const deletedLog = logs[idx];
      window.undoLog(idx, null);
      renderHistory('fullHistoryList');

      // Show undo toast
      const c = document.getElementById('toastContainer'); if(!c) return;
      const t = document.createElement('div');
      t.className = 'premium-card px-4 py-3 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300 flex items-center gap-3 border border-gray-500/20';
      t.style.background = 'var(--card-bg)';
      t.innerHTML = `<span class="flex items-center gap-1.5" style="color: var(--text-main);"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-red-400"></i> Deleted</span><div class="w-px h-3 bg-gray-500/30"></div><button onclick="window.restoreDeletedLog(this)" data-log='${JSON.stringify(deletedLog).replace(/'/g, "&#39;")}' class="text-sky-500 active:scale-95 transition-transform uppercase tracking-wider">Undo</button>`;
      t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
      c.appendChild(t); refreshIcons();
      requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
      const autoHide = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 5000);
      t.dataset.timerId = autoHide;
    });
  }
}

window.restoreDeletedLog = function(btn) {
  const toast = btn.closest('.premium-card');
  if (toast) { clearTimeout(toast.dataset.timerId); toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }
  try {
    const logData = JSON.parse(btn.getAttribute('data-log'));
    logs.push(logData);
    logs.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < logs.length; i++) { logs[i].gap = i > 0 ? Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000) : null; }
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    try { updateUI(); } catch(err){}
    renderHistory('fullHistoryList');
    showToast("Log restored");
  } catch(e) { showToast("Could not restore"); }
}
// ==================== HEALTH TIMELINE (Enhanced) ====================
function renderHealthTimeline() {
  const card = document.getElementById('healthTimelineCard');
  const timeline = document.getElementById('milestoneTimeline');
  const countEl = document.getElementById('milestoneCount');
  const bestGapEl = document.getElementById('milestoneBestGap');
  const progressBar = document.getElementById('milestoneProgressBar');
  if (!card || !timeline) return;

  if (!logs || logs.length < 2) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  if (allGaps.length === 0) { card.classList.add('hidden'); return; }

  const bestGapMins = Math.max(...allGaps);
  if (bestGapEl) bestGapEl.innerText = formatGap(Math.round(bestGapMins));

  let unlocked = 0;
  const maxMins = HEALTH_MILESTONES[HEALTH_MILESTONES.length - 1].mins;
  timeline.innerHTML = HEALTH_MILESTONES.map((m, idx) => {
    const isUnlocked = bestGapMins >= m.mins;
    if (isUnlocked) unlocked++;
    const progress = isUnlocked ? 100 : Math.min(100, (bestGapMins / m.mins) * 100);
    const nextGap = isUnlocked ? m.mins : m.mins;
    const label = isUnlocked ? 'Unlocked' : `Need ${formatGap(m.mins)}`;
    return `<div class="health-timeline-item ${isUnlocked ? 'unlocked' : ''}">
      <div class="health-timeline-dot"></div>
      <div class="flex items-start gap-3">
        <span class="text-lg shrink-0 ${isUnlocked ? '' : 'opacity-30'}">${m.emoji}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[11px] font-bold ${isUnlocked ? '' : 'opacity-50'}" style="color: ${isUnlocked ? 'var(--text-main)' : 'var(--text-muted)'};">${m.title}</p>
            <span class="text-[8px] font-bold px-2 py-0.5 rounded-full shrink-0 ${isUnlocked ? '' : 'opacity-40'}" style="background: ${isUnlocked ? 'var(--accent-glow)' : 'var(--input-bg)'}; color: ${isUnlocked ? 'var(--accent)' : 'var(--text-muted)'};">${label}</span>
          </div>
          <p class="text-[9px] leading-tight mt-0.5 ${isUnlocked ? '' : 'opacity-40'}" style="color: var(--text-muted);">${m.desc}</p>
          ${!isUnlocked ? `<div class="health-timeline-progress mt-1.5"><div class="health-timeline-progress-fill" style="width: ${progress}%;"></div></div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  if (countEl) countEl.innerText = `${unlocked} of ${HEALTH_MILESTONES.length} unlocked`;
  if (progressBar) progressBar.style.width = `${(unlocked / HEALTH_MILESTONES.length) * 100}%`;
  const recPct = Math.round((unlocked / HEALTH_MILESTONES.length) * 100);
  const recEl = document.getElementById('milestoneRecoveryPct');
  if (recEl) recEl.innerText = recPct;
  const ringEl = document.getElementById('milestoneRing');
  if (ringEl) ringEl.style.strokeDashoffset = (326.73 * (1 - recPct / 100)).toFixed(1);
  const countModalEl = document.getElementById('milestoneCountModal');
  if (countModalEl) countModalEl.innerText = `${unlocked}/${HEALTH_MILESTONES.length}`;
  const teaserLine = document.getElementById('milestoneTeaserLine');
  if (teaserLine) teaserLine.style.width = `${recPct}%`;
  refreshIcons();
}

// ==================== MONEY VISUALIZER ====================
const MONEY_EQUIVALENTS = [
  { emoji: '☕', label: 'Coffees', usd: 4 },
  { emoji: '🍕', label: 'Pizzas', usd: 12 },
  { emoji: '🎬', label: 'Movie Tickets', usd: 16 },
  { emoji: '📚', label: 'Books', usd: 11 },
  { emoji: '💪', label: 'Gym Sessions', usd: 8 },
  { emoji: '🚗', label: 'Uber Rides', usd: 7 },
  { emoji: '📺', label: 'Netflix Months', usd: 15 },
  { emoji: '⛽', label: 'Petrol Fills', usd: 27 },
  { emoji: '🎮', label: 'PS5 Games', usd: 68 },
];
const CURRENCY_RATES_FROM_USD = { AED: 3.67, USD: 1, EUR: 0.92, GBP: 0.79, INR: 85.5 };

function computeTotalSaved() {
  let pricePerStick = settings.packPrice / settings.packSize;
  let baselineGapMs = parseInt(localStorage.getItem('smoke_baseline_gap'));
  if (!baselineGapMs && logs.length > 1) { let limit = Math.min(logs.length, 10); baselineGapMs = (logs[limit - 1].timestamp - logs[0].timestamp) / (limit - 1); }
  if (!baselineGapMs || isNaN(baselineGapMs) || baselineGapMs <= 0) { baselineGapMs = (24 * 60 * 60 * 1000) / settings.dailyLimit; }
  if (logs.length === 0) return 0;
  let timeElapsed = new Date().getTime() - logs[0].timestamp;
  let expectedCigs = 1 + (timeElapsed / baselineGapMs);
  return Math.max(0, (expectedCigs - logs.length) * pricePerStick);
}

function renderMoneyVisualizer() {
  const total = computeTotalSaved();
  const totalEl = document.getElementById('moneyTotalSaved');
  const grid = document.getElementById('moneyEquivGrid');
  const cardTotal = document.getElementById('totalSavedCard');
  if (totalEl) totalEl.innerText = `${settings.currency} ${Math.round(total)}`;
  if (cardTotal) cardTotal.innerText = `${settings.currency} ${Math.round(total)}`;
  if (!grid) return;
  const rate = CURRENCY_RATES_FROM_USD[settings.currency] || CURRENCY_RATES_FROM_USD.AED;
  grid.innerHTML = MONEY_EQUIVALENTS.map(eq => {
    const localPrice = eq.usd * rate;
    const count = Math.floor(total / localPrice);
    return `<div class="money-equiv-item">
      <span class="money-equiv-icon">${eq.emoji}</span>
      <span class="money-equiv-count">${count}</span>
      <span class="money-equiv-label">${eq.label}</span>
    </div>`;
  }).join('');

  // Goal
  let goal = {};
  try { goal = JSON.parse(localStorage.getItem('smoke_savings_goal')) || {}; } catch(e) { goal = {}; }
  const nameEl = document.getElementById('goalItemName');
  const targetEl = document.getElementById('goalTargetAmount');
  const currLabel = document.getElementById('goalCurrencyLabel');
  const ringPct = document.getElementById('goalRingPct');
  const ringFill = document.getElementById('goalRingFill');
  const statusText = document.getElementById('goalStatusText');
  if (currLabel) currLabel.innerText = settings.currency;
  if (nameEl) nameEl.value = goal.name || '';
  if (targetEl) targetEl.value = goal.target || '';
  if (goal.target && goal.target > 0) {
    const pct = Math.min(100, Math.round((total / goal.target) * 100));
    const circumference = 2 * Math.PI * 42;
    if (ringFill) ringFill.style.strokeDashoffset = circumference - (circumference * pct / 100);
    if (ringPct) ringPct.innerText = `${pct}%`;
    if (statusText) {
      if (pct >= 100) statusText.innerHTML = `<span style="color: #10B981;">Goal reached! You saved enough for ${esc(goal.name || 'your goal')}!</span>`;
      else { const remaining = goal.target - total; statusText.innerHTML = `${esc(goal.name || 'Goal')}: ${settings.currency} ${Math.round(remaining)} to go`; }
    }
  } else {
    if (ringPct) ringPct.innerText = '0%';
    if (ringFill) ringFill.style.strokeDashoffset = 2 * Math.PI * 42;
    if (statusText) statusText.innerText = 'Set a goal to track your savings progress';
  }
}

window.openMoneyVisualizer = function() {
  renderMoneyVisualizer();
  document.getElementById('moneyVisualizerModal').classList.remove('hidden');
  refreshIcons();
};

window.closeMoneyVisualizer = function() {
  document.getElementById('moneyVisualizerModal').classList.add('hidden');
};

window.saveGoalSettings = function() {
  const name = (document.getElementById('goalItemName').value || '').trim();
  const target = parseFloat(document.getElementById('goalTargetAmount').value) || 0;
  localStorage.setItem('smoke_savings_goal', JSON.stringify({ name, target }));
  renderMoneyVisualizer();
  showToast('Goal saved');
};

// ==================== RELAPSE FLOW ====================
let relapseLogIdx = null;

function showRelapseModal(logIdx, gap) {
  relapseLogIdx = logIdx;
  const modal = document.getElementById('relapseModal');
  const msgEl = document.getElementById('relapseMessage');
  const statsEl = document.getElementById('relapseStats');
  if (!modal) return;

  // Calculate stats before the slip
  const allGaps = logs.slice(0, -1).map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGapMin = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;
  const bestGapMin = allGaps.length ? Math.max(...allGaps) : 0;

  // How many days since first log
  const daysSinceStart = logs.length > 1 ? Math.round((logs[logs.length - 1].timestamp - logs[0].timestamp) / 86400000) : 0;

  // How many cigarettes avoided in total
  let baselineGapMs = parseInt(localStorage.getItem('smoke_baseline_gap'));
  if (!baselineGapMs || isNaN(baselineGapMs) || baselineGapMs <= 0) baselineGapMs = (24 * 60 * 60 * 1000) / settings.dailyLimit;
  const timeElapsed = logs[logs.length - 1].timestamp - logs[0].timestamp;
  const expectedCigs = 1 + (timeElapsed / baselineGapMs);
  const avoided = Math.max(0, Math.round(expectedCigs - logs.length));

  if (gap && avgGapMin > 0 && gap >= avgGapMin * 1.5) {
    msgEl.innerText = `You went ${formatGap(Math.round(gap))} between cigarettes — that's incredible progress. Every gap matters, and this slip doesn't erase what you've achieved.`;
  } else if (bestGapMin >= 120) {
    msgEl.innerText = `Your best gap was ${formatGap(Math.round(bestGapMin))}. That's real progress. One slip doesn't define your journey — what you do next does.`;
  } else {
    msgEl.innerText = `Quitting is a journey, not a straight line. Every attempt teaches you something. Ready to try again?`;
  }

  statsEl.innerHTML = `
    <div class="grid grid-cols-3 gap-2">
      <div class="p-2.5 rounded-xl text-center" style="background: var(--input-bg);">
        <p class="numeric-display text-lg font-bold" style="color: var(--text-main);">${daysSinceStart}</p>
        <p class="text-[8px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Days Tracked</p>
      </div>
      <div class="p-2.5 rounded-xl text-center" style="background: var(--input-bg);">
        <p class="numeric-display text-lg font-bold" style="color: var(--accent);">${avoided}</p>
        <p class="text-[8px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Cigarettes Avoided</p>
      </div>
      <div class="p-2.5 rounded-xl text-center" style="background: var(--input-bg);">
        <p class="numeric-display text-lg font-bold" style="color: #10B981;">${formatGap(Math.round(bestGapMin))}</p>
        <p class="text-[8px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Best Gap</p>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  refreshIcons();
  if (window.posthog) posthog.capture('relapse_modal_shown', { gap_minutes: gap });
}

window.closeRelapseModal = function() {
  document.getElementById('relapseModal').classList.add('hidden');
  // Continue to normal takeover
  if (relapseLogIdx !== null) {
    startSmokeTakeover(relapseLogIdx, logs[relapseLogIdx]?.gap, false);
    relapseLogIdx = null;
  }
};

window.startRelapseRecovery = function() {
  document.getElementById('relapseModal').classList.add('hidden');
  relapseLogIdx = null;
  // Start a wave immediately
  startWave(10);
  showToast('Recovery wave started! You got this.');
};

// Patch actuallyLogCigarette to detect relapse
const _origActuallyLogCigarette = actuallyLogCigarette;
actuallyLogCigarette = function() {
  const wasLocked = new Date().getTime() < lockEndTime;
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGapMin = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;
  const prevTimestamp = logs.length > 0 ? logs[logs.length - 1].timestamp : null;
  const currentGapMin = prevTimestamp ? (new Date().getTime() - prevTimestamp) / 60000 : null;

  // Detect relapse: gap was much shorter than average (>2x shorter), and user had established a decent gap
  const isRelapse = currentGapMin !== null && avgGapMin > 60 && currentGapMin < avgGapMin * 0.5;

  _origActuallyLogCigarette();

  if (isRelapse && relapseLogIdx === null && !wasLocked) {
    relapseLogIdx = logs.length - 1;
    // Hide smokeTakeover so relapseModal isn't buried behind z-index:20000
    const takeover = document.getElementById('smokeTakeover');
    if (takeover && !takeover.classList.contains('hidden')) {
      takeover.classList.remove('opacity-100'); takeover.classList.add('opacity-0');
      setTimeout(() => { takeover.classList.add('hidden'); }, 50);
    }
    showRelapseModal(relapseLogIdx, currentGapMin);
  }
};

// ==================== BREATHING EXERCISES ====================
const BREATHING_EXERCISES = {
  '478': { name: '4-7-8 Relaxation', inhale: 4, hold: 7, exhale: 8, cycles: 4, color: '#8B5CF6', desc: 'Calms anxiety' },
  'box': { name: 'Box Breathing', inhale: 4, hold: 4, exhale: 4, cycles: 6, color: '#38BDF8', desc: 'Focus & relief' },
  'quick': { name: 'Quick Craving Buster', inhale: 4, hold: 2, exhale: 6, cycles: 3, color: '#10B981', desc: 'Beat the urge' },
};

let breathActive = false;
let breathPaused = false;
let breathTimeout = null;
let breathInterval = null;
let breathCycleCount = 0;
let breathCurrentExercise = null;
let breathCurrentPhase = 'inhale';

function vibratePattern(pattern) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

function runBreathPhase(exercise, phase, callback) {
  if (!breathActive || breathPaused) return;
  breathCurrentPhase = phase;
  const circle = document.getElementById('breathCircle');
  const phaseText = document.getElementById('breathPhaseText');
  const timerText = document.getElementById('breathTimerText');
  const cycleInfo = document.getElementById('breathCycleInfo');

  let duration = 0;
  let label = '';
  let circleClass = '';

  if (phase === 'inhale') {
    duration = exercise.inhale * 1000; label = 'Breathe In'; circleClass = 'breath-circle-inhale';
    circle.style.setProperty('--breath-inhale', exercise.inhale + 's');
  } else if (phase === 'hold') {
    duration = exercise.hold * 1000; label = 'Hold'; circleClass = 'breath-circle-hold';
    circle.style.setProperty('--breath-hold', exercise.hold + 's');
  } else if (phase === 'exhale') {
    duration = exercise.exhale * 1000; label = 'Breathe Out'; circleClass = 'breath-circle-exhale';
    circle.style.setProperty('--breath-exhale', exercise.exhale + 's');
    breathCycleCount++;
  }

  if (phaseText) phaseText.innerText = label;
  if (cycleInfo) cycleInfo.innerText = `Cycle ${Math.min(breathCycleCount + 1, exercise.cycles)} of ${exercise.cycles}`;

  // Remove old classes, add new
  circle.className = 'breath-circle mb-4 ' + circleClass;
  vibratePattern([50]);

  let remaining = Math.ceil(duration / 1000);
  if (timerText) timerText.innerText = remaining;

  breathInterval = setInterval(() => {
    if (breathPaused) return;
    remaining--;
    if (timerText) timerText.innerText = Math.max(0, remaining);
    if (remaining <= 3 && remaining > 0) vibratePattern([30]);
  }, 1000);

  breathTimeout = setTimeout(() => {
    clearInterval(breathInterval);
    if (!breathActive) return;

    // Determine next phase
    let nextPhase;
    if (phase === 'inhale') nextPhase = exercise.hold > 0 ? 'hold' : 'exhale';
    else if (phase === 'hold') nextPhase = 'exhale';
    else if (phase === 'exhale') {
      if (breathCycleCount >= exercise.cycles) {
        // Exercise complete
        breathActive = false;
        const circle2 = document.getElementById('breathCircle');
        const phaseText2 = document.getElementById('breathPhaseText');
        const timerText2 = document.getElementById('breathTimerText');
        if (circle2) circle2.className = 'breath-circle mb-4';
        if (phaseText2) { phaseText2.innerText = 'Complete'; phaseText2.style.color = '#10B981'; }
        if (timerText2) timerText2.innerText = '✓';
        vibratePattern([100, 50, 100]);
        showToast('Well done! Breathe easy.');
        if (window.posthog) posthog.capture('breathing_exercise_completed', { type: exercise.name });
        return;
      }
      nextPhase = 'inhale';
    }

    runBreathPhase(exercise, nextPhase, callback);
  }, duration);
}

window.openBreathingModal = function() {
  document.getElementById('breathingModal').classList.remove('hidden');
  document.getElementById('breathSelector').classList.remove('hidden');
  document.getElementById('breathActive').classList.add('hidden');
  refreshIcons();
};

window.closeBreathingModal = function() {
  breathActive = false; breathPaused = false;
  clearTimeout(breathTimeout); clearInterval(breathInterval);
  document.getElementById('breathingModal').classList.add('hidden');
};

window.selectBreathing = function(type) {
  // Wave Ride — open the wave duration modal
  if (type === 'wave') {
    window.closeBreathingModal();
    openWaveModal();
    return;
  }

  const exercise = BREATHING_EXERCISES[type];
  if (!exercise) return;

  breathActive = true;
  breathPaused = false;
  breathCycleCount = 0;
  breathCurrentPhase = 'inhale';
  breathCurrentExercise = exercise;

  document.getElementById('breathSelector').classList.add('hidden');
  document.getElementById('breathActive').classList.remove('hidden');
  document.getElementById('breathExerciseName').innerText = exercise.name;
  document.getElementById('breathExerciseName').style.color = exercise.color;
  document.getElementById('breathCircle').style.borderColor = exercise.color;

  const pauseBtn = document.getElementById('breathPauseBtn');
  if (pauseBtn) pauseBtn.innerText = 'Pause';

  if (window.posthog) posthog.capture('breathing_exercise_started', { type: exercise.name });

  setTimeout(() => runBreathPhase(exercise, 'inhale'), 500);
};

window.toggleBreathPause = function() {
  if (!breathActive) return;
  breathPaused = !breathPaused;
  const btn = document.getElementById('breathPauseBtn');
  if (btn) btn.innerText = breathPaused ? 'Resume' : 'Pause';

  if (breathPaused) {
    clearTimeout(breathTimeout); clearInterval(breathInterval);
  } else if (breathCurrentExercise) {
    // Resume — find current phase from the circle class
    const circle = document.getElementById('breathCircle');
    let phase = 'inhale';
    if (circle.classList.contains('breath-circle-hold')) phase = 'hold';
    else if (circle.classList.contains('breath-circle-exhale')) phase = 'exhale';
    runBreathPhase(breathCurrentExercise, phase);
  }
};

window.stopBreathing = function() {
  breathActive = false; breathPaused = false;
  clearTimeout(breathTimeout); clearInterval(breathInterval);
  document.getElementById('breathSelector').classList.remove('hidden');
  document.getElementById('breathActive').classList.add('hidden');
  const circle = document.getElementById('breathCircle');
  const phaseText = document.getElementById('breathPhaseText');
  if (circle) circle.className = 'breath-circle mb-4';
  if (phaseText) phaseText.style.color = '';
};

// ==================== SMART QUIT PATH (Onboarding Setup) ====================
let onboardSticks = 10;
let onboardGoal = 'quit';

window.onboardAdjustSticks = function(delta) {
  onboardSticks = Math.max(1, Math.min(80, onboardSticks + delta));
  document.getElementById('onboardSticksCount').innerText = onboardSticks;
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
};

window.onboardSelectGoal = function(goal) {
  onboardGoal = goal;
  ['quit', 'reduce', 'track'].forEach(g => {
    const el = document.getElementById('onboardGoal' + g.charAt(0).toUpperCase() + g.slice(1));
    if (el) {
      if (g === goal) {
        el.style.borderColor = 'var(--accent)';
        el.style.background = 'var(--accent-glow)';
      } else {
        el.style.borderColor = 'var(--card-border)';
        el.style.background = 'var(--input-bg)';
      }
    }
  });
};

window.updateOnboardCostPerCig = function() {
  const price = parseFloat(document.getElementById('onboardPackPrice').value) || 20;
  const size = parseInt(document.getElementById('onboardPackSize').value) || 20;
  const cur = document.getElementById('onboardCurrencySelect').value || 'AED';
  const cost = size > 0 ? (price / size).toFixed(1) : '0';
  const label = document.getElementById('onboardCostPerCig');
  if (label) label.innerText = `${cur} ${cost}`;
};

function initOnboardingSetup() {
  onboardSticks = Math.max(1, Math.min(80, settings.dailyLimit || 10));
  const sticksEl = document.getElementById('onboardSticksCount');
  if (sticksEl) sticksEl.innerText = onboardSticks;
  const curEl = document.getElementById('onboardCurrencySelect');
  if (curEl) {
    const cur = settings.currency || 'AED';
    curEl.value = cur;
    const label = document.getElementById('onboardCurrencyLabel');
    if (label) label.innerText = cur;
  }
  const priceEl = document.getElementById('onboardPackPrice');
  if (priceEl) priceEl.value = settings.packPrice || 20;
  const sizeEl = document.getElementById('onboardPackSize');
  if (sizeEl) sizeEl.value = settings.packSize || 20;
  updateOnboardCostPerCig();
}

function saveOnboardingSetup() {
  const sticks = onboardSticks;
  const packPrice = parseFloat(document.getElementById('onboardPackPrice').value) || 20;
  const packSize = parseInt(document.getElementById('onboardPackSize').value) || 20;
  const cur = document.getElementById('onboardCurrencySelect').value || 'AED';
  const quitDate = document.getElementById('onboardQuitDate').value || '';

  settings.dailyLimit = sticks;
  settings.packPrice = packPrice;
  settings.packSize = packSize;
  settings.currency = cur;

  if (onboardGoal === 'quit') {
    settings.autoReduce = true;
    if (quitDate) {
      settings.quitDate = quitDate;
      localStorage.setItem('smoke_quit_date', quitDate);
    }
  } else if (onboardGoal === 'reduce') {
    settings.autoReduce = true;
  } else {
    settings.autoReduce = false;
    settings.dailyLimit = sticks;
  }

  localStorage.setItem('smoke_settings', JSON.stringify(settings));
}

// Patch onboardingNext to handle 8 slides
const _origOnboardingNext = window.onboardingNext;
window.onboardingNext = function() {
  if (onboardingStep < 8) {
    document.getElementById('onboardSlide' + onboardingStep).classList.add('hidden');
    const prevDot = document.getElementById('onboardDot' + onboardingStep);
    if (prevDot) {
      prevDot.className = 'w-2.5 h-2.5 rounded-full transition-all';
      prevDot.style.backgroundColor = 'rgba(156,163,175,0.3)';
      prevDot.style.width = '10px';
    }
    onboardingStep++;
    document.getElementById('onboardSlide' + onboardingStep).classList.remove('hidden');
    const curDot = document.getElementById('onboardDot' + onboardingStep);
    if (curDot) {
      curDot.className = 'w-2.5 h-2.5 rounded-full transition-all';
      curDot.style.backgroundColor = 'var(--accent)';
      curDot.style.width = '20px';
    }

    if (onboardingStep >= 5) {
      document.getElementById('onboardSkipBtn').style.display = 'none';
    }
    if (onboardingStep === 8) {
      document.getElementById('onboardNextBtn').innerText = 'Get Started';
    } else {
      document.getElementById('onboardNextBtn').innerText = 'Next';
    }
  } else {
    saveOnboardingSetup();
    finishOnboarding();
  }
};

// Patch finishOnboarding to save setup
const _origFinishOnboarding = finishOnboarding;
finishOnboarding = function() {
  if (onboardingStep >= 5) saveOnboardingSetup();
  _origFinishOnboarding();
};

// ==================== SHARE PROGRESS CARD ====================
window.shareProgress = function() {
  const canvas = document.getElementById('shareCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 1080, H = 1920;

  // Detect theme
  const isLight = isLightTheme();
  const bg = isLight ? '#F8FAFC' : '#090A0F';
  const cardBg = isLight ? '#FFFFFF' : '#11131A';
  const textMain = isLight ? '#0F172A' : '#F3F4F6';
  const textMuted = isLight ? '#64748B' : '#9CA3AF';
  const accent = isLight ? '#2563EB' : '#F59E0B';

  // Calculate stats
  const totalDays = logs.length > 0 ? Math.round((Date.now() - logs[0].timestamp) / 86400000) : 0;
  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const bestGap = allGaps.length ? Math.max(...allGaps) : 0;
  const totalSaved = computeTotalSaved();
  const avoided = Math.max(0, Math.round((logs.length > 0 ? (Date.now() - logs[0].timestamp) / ((parseInt(localStorage.getItem('smoke_baseline_gap')) || (86400000 / settings.dailyLimit))) : 0) - logs.length));

  // Streak calc
  let streak = 0, slipDays = 0;
  let logsByDate = {};
  logs.forEach(l => { if (l && l.timestamp) { let d = new Date(l.timestamp).toDateString(); logsByDate[d] = (logsByDate[d] || 0) + 1; }});
  let uniqueDates = Object.keys(logsByDate).sort((a, b) => new Date(b) - new Date(a));
  for (let d of uniqueDates) { if (logsByDate[d] <= settings.dailyLimit) { streak++; } else { if (slipDays < 2) { slipDays++; streak++; } else break; } }

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header card
  ctx.fillStyle = cardBg;
  roundRect(ctx, 60, 120, W - 120, 320, 32);
  ctx.fill();

  // Brand
  ctx.fillStyle = accent;
  ctx.font = 'bold 72px "Clash Display", "SF Pro Display", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('pause', W / 2, 220);
  ctx.fillStyle = textMuted;
  ctx.font = '500 28px "General Sans", "SF Pro Text", sans-serif';
  ctx.fillText('Widen the gap.', W / 2, 270);

  // Stats grid
  const stats = [
    { value: totalDays, label: 'Days Tracked', color: accent },
    { value: avoided, label: 'Cigarettes Avoided', color: '#10B981' },
    { value: `${settings.currency} ${Math.round(totalSaved)}`, label: 'Money Saved', color: '#F59E0B' },
    { value: formatGap(Math.round(bestGap)), label: 'Best Gap', color: '#38BDF8' },
    { value: streak, label: 'Day Streak', color: '#EF4444' },
    { value: waves.length, label: 'Shields Earned', color: '#10B981' },
  ];

  const cols = 2, cellW = (W - 180) / cols, cellH = 220;
  stats.forEach((s, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 90 + col * cellW, y = 520 + row * (cellH + 24);
    ctx.fillStyle = cardBg;
    roundRect(ctx, x, y, cellW - 24, cellH, 24);
    ctx.fill();
    ctx.fillStyle = s.color;
    ctx.font = `bold 56px "Space Grotesk", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(s.value), x + (cellW - 24) / 2, y + 90);
    ctx.fillStyle = textMuted;
    ctx.font = '600 24px "General Sans", sans-serif';
    ctx.fillText(s.label, x + (cellW - 24) / 2, y + 140);
  });

  // Bottom tagline
  ctx.fillStyle = textMuted;
  ctx.font = '500 24px "General Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Tracked with pause', W / 2, H - 180);
  ctx.fillStyle = accent;
  ctx.font = 'bold 28px "General Sans", sans-serif';
  ctx.fillText('pauseapp.web.app', W / 2, H - 130);

  // Share
  canvas.toBlob(function(blob) {
    const file = new File([blob], 'pause-progress.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'My pause Progress', text: 'Check out my smoking cessation progress!' }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pause-progress.png'; a.click();
      URL.revokeObjectURL(url);
      showToast('Progress card saved!');
    }
  }, 'image/png');
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ==================== DAILY MICRO-CHALLENGE ====================
const DAILY_CHALLENGES = [
  { text: "Delay your first cigarette by 15 minutes today", icon: "⏰", type: "delay" },
  { text: "Take 3 deep breaths before any craving", icon: "🫁", type: "breathe" },
  { text: "Log your mood before lighting up", icon: "📝", type: "mood" },
  { text: "Drink a glass of water when you feel the urge", icon: "💧", type: "water" },
  { text: "Go for a 5-minute walk instead of smoking", icon: "🚶", type: "walk" },
  { text: "Chew gum or eat a mint when cravings hit", icon: "🍬", type: "gum" },
  { text: "Call or text someone when you want to smoke", icon: "📱", type: "social" },
  { text: "Identify your top trigger today and write it down", icon: "🔍", type: "trigger" },
  { text: "Hold an ice cube when the craving is strong", icon: "🧊", type: "ice" },
  { text: "Do 10 push-ups or squats when you want to smoke", icon: "💪", type: "exercise" },
  { text: "Listen to a favorite song instead of smoking", icon: "🎵", type: "music" },
  { text: "Eat a healthy snack when cravings come", icon: "🍎", type: "snack" },
  { text: "Sit quietly for 2 minutes and breathe deeply", icon: "🧘", type: "meditate" },
  { text: "Write down 3 reasons you're quitting", icon: "✍️", type: "reasons" },
  { text: "Reward yourself — you've earned it today", icon: "🎉", type: "reward" },
];

let todaysChallenge = null;
let challengeCompleted = false;

function getDailyChallengeSeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function renderDailyChallenge() {
  const card = document.getElementById('dailyChallengeCard');
  const textEl = document.getElementById('challengeText');
  const completeBtn = document.getElementById('challengeCompleteBtn');
  const completedMsg = document.getElementById('challengeCompletedMsg');
  if (!card) return;

  const todayKey = new Date().toDateString();
  const completedChallenges = JSON.parse(localStorage.getItem('smoke_completed_challenges') || '{}');
  challengeCompleted = completedChallenges[todayKey] === true;

  if (challengeCompleted) {
    card.classList.add('hidden');
    return;
  }

  const seed = getDailyChallengeSeed();
  const idx = seed % DAILY_CHALLENGES.length;
  todaysChallenge = DAILY_CHALLENGES[idx];

  card.classList.remove('hidden');
  if (textEl) textEl.innerText = todaysChallenge.text;
  if (completeBtn) {
    completeBtn.classList.remove('hidden');
    completeBtn.style.display = '';
  }
  if (completedMsg) completedMsg.classList.add('hidden');
}

window.completeDailyChallenge = function() {
  if (challengeCompleted || !todaysChallenge) return;

  challengeCompleted = true;
  const todayKey = new Date().toDateString();
  const completedChallenges = JSON.parse(localStorage.getItem('smoke_completed_challenges') || '{}');
  completedChallenges[todayKey] = true;
  localStorage.setItem('smoke_completed_challenges', JSON.stringify(completedChallenges));

  // Award shield
  waves.push(Date.now());
  localStorage.setItem('smoke_waves', JSON.stringify(waves));

  // UI updates
  const completeBtn = document.getElementById('challengeCompleteBtn');
  const completedMsg = document.getElementById('challengeCompletedMsg');
  if (completeBtn) completeBtn.style.display = 'none';
  if (completedMsg) completedMsg.classList.remove('hidden');

  showToast('Challenge completed! +1 Shield');
  spawnConfetti();
  if (window.posthog) posthog.capture('daily_challenge_completed', { challenge: todaysChallenge.text });
  try { updateUI(); } catch(e) {}
  celebrateBadgeIfUnlocked();
};

// ==================== PATTERN INTELLIGENCE ====================
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function periodForHour(h) {
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 21) return 'Evening';
  return 'Night';
}

function getThisWeekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday start
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - day);
  const end = new Date(now); end.setHours(23,59,59,999);
  return { start, end };
}

function getLastWeekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const thisStart = new Date(now); thisStart.setHours(0,0,0,0); thisStart.setDate(now.getDate() - day);
  const lastStart = new Date(thisStart); lastStart.setDate(thisStart.getDate() - 7);
  const lastEnd = new Date(thisStart); lastEnd.setMilliseconds(-1);
  return { start: lastStart, end: lastEnd };
}

function renderPatternIntel() {
  const card = document.getElementById('patternIntelCard');
  if (!card) return;

  // Need at least a few logs for meaningful patterns
  const recentLogs = logs.filter(l => l.timestamp);
  if (recentLogs.length < 4) { card.classList.add('hidden'); return; }

  const today = new Date();
  const nowMs = today.getTime();
  const thirtyDays = 30 * 86400000;

  // ---------- Weekly Comparison ----------
  const tw = getThisWeekRange(), lw = getLastWeekRange();
  const thisWeekCount = recentLogs.filter(l => l.timestamp >= tw.start.getTime() && l.timestamp <= tw.end.getTime()).length;
  const lastWeekCount = recentLogs.filter(l => l.timestamp >= lw.start.getTime() && l.timestamp <= lw.end.getTime()).length;

  const thisEl = document.getElementById('patternThisWeek');
  const lastEl = document.getElementById('patternLastWeek');
  const changeEl = document.getElementById('patternWeekChange');
  const arrowEl = document.getElementById('patternWeekArrow');

  if (thisEl) thisEl.innerText = thisWeekCount;
  if (lastEl) lastEl.innerText = lastWeekCount;

  if (changeEl) {
    if (lastWeekCount === 0 && thisWeekCount === 0) {
      changeEl.innerText = '—'; changeEl.style.color = 'var(--text-muted)';
    } else if (lastWeekCount === 0) {
      changeEl.innerText = 'NEW'; changeEl.style.color = '#38BDF8';
    } else {
      const pct = Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);
      const improved = pct <= 0;
      changeEl.innerText = (pct > 0 ? '+' : '') + pct + '%';
      changeEl.style.color = improved ? '#10B981' : '#EF4444';
    }
  }
  if (arrowEl) arrowEl.innerText = thisWeekCount <= lastWeekCount ? '↓' : '↑';
  if (arrowEl) arrowEl.style.color = thisWeekCount <= lastWeekCount ? '#10B981' : '#EF4444';

  // ---------- Day-of-Week Pattern ----------
  const dayCounts = [0,0,0,0,0,0,0];
  recentLogs.forEach(l => { const d = new Date(l.timestamp).getDay(); if (l.timestamp >= nowMs - thirtyDays) dayCounts[d]++; });
  const maxDay = Math.max(...dayCounts, 1);

  const barsEl = document.getElementById('patternDayBars');
  if (barsEl) {
    barsEl.innerHTML = dayCounts.map((c, i) => {
      const h = Math.max(6, Math.round((c / maxDay) * 44));
      const isPeak = c === Math.max(...dayCounts) && c > 0;
      const color = isPeak ? 'var(--accent)' : 'var(--input-bg)';
      const border = isPeak ? '' : 'border border-gray-500/20';
      return `<div class="flex-1 flex flex-col items-center gap-1" title="${DAY_SHORT[i]}: ${c}">
        <div class="w-full rounded-md ${border}" style="height:${h}px; background:${color}; transition: height 0.6s cubic-bezier(0.4,0,0.2,1);"></div>
        <span class="text-[7px] font-bold" style="color: var(--text-muted);">${DAY_SHORT[i]}</span>
      </div>`;
    }).join('');
  }

  const dayInsightEl = document.getElementById('patternDayInsight');
  if (dayInsightEl) {
    const peakIdx = dayCounts.indexOf(Math.max(...dayCounts));
    const peakCount = dayCounts[peakIdx];
    const avg = dayCounts.reduce((a,b) => a+b, 0) / Math.max(1, dayCounts.filter(c => c > 0).length || 7);
    if (peakCount > 0 && peakCount > avg * 1.4) {
      dayInsightEl.innerText = `${DAY_SHORT[peakIdx]} is your heaviest day (${peakCount} sticks) — ${Math.round(peakCount / avg)}x above average.`;
      dayInsightEl.style.color = '#EF4444';
    } else if (peakCount > 0) {
      dayInsightEl.innerText = `Fairly consistent. ${DAY_SHORT[peakIdx]} leads at ${peakCount}.`;
      dayInsightEl.style.color = 'var(--text-muted)';
    } else {
      dayInsightEl.innerText = 'Not enough day data yet.';
      dayInsightEl.style.color = 'var(--text-muted)';
    }
  }

  // ---------- Mood-Smoke Correlation ----------
  const moodCounts = {};
  recentLogs.forEach(l => {
    if (l.mood) {
      const m = moodDefFor(l.mood);
      if (m) moodCounts[m.id] = (moodCounts[m.id] || 0) + 1;
    }
  });
  const moodEntries = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]);
  const moodTotal = moodEntries.reduce((s, e) => s + e[1], 0);

  const moodEl = document.getElementById('patternMoodTriggers');
  if (moodEl) {
    if (moodEntries.length === 0) {
      moodEl.innerHTML = `<p class="text-[9px]" style="color: var(--text-muted);">Log your mood after smoking to reveal patterns.</p>`;
    } else {
      moodEl.innerHTML = moodEntries.slice(0, 4).map(([id, count]) => {
        const def = MOODS.find(m => m.id === id);
        const pct = Math.round((count / moodTotal) * 100);
        return `<div class="flex items-center gap-2">
          <i data-lucide="${def ? def.icon : 'smile'}" class="w-3 h-3 shrink-0" style="color: ${def ? def.color : '#6B7280'};"></i>
          <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--bg-body);">
            <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%; background: ${def ? def.color : '#6B7280'};"></div>
          </div>
          <span class="text-[9px] font-bold shrink-0" style="color: var(--text-main);">${count} (${pct}%)</span>
        </div>`;
      }).join('');
    }
  }

  // ---------- Risk Zones (mood + time combo) ----------
  const comboCounts = {};
  recentLogs.forEach(l => {
    if (l.mood) {
      const m = moodDefFor(l.mood);
      if (m) {
        const period = periodForHour(new Date(l.timestamp).getHours());
        const key = `${m.label}|${period}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
      }
    }
  });
  const comboEntries = Object.entries(comboCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const comboTotal = recentLogs.filter(l => l.mood).length;

  const comboEl = document.getElementById('patternRiskCombos');
  if (comboEl) {
    if (comboEntries.length === 0 || comboTotal < 3) {
      comboEl.innerHTML = `<p class="text-[9px]" style="color: var(--text-muted);">More mood data will reveal your riskiest combinations.</p>`;
    } else {
      comboEl.innerHTML = comboEntries.map(([key, count]) => {
        const [mood, period] = key.split('|');
        const def = MOODS.find(m => m.label === mood);
        const pct = Math.round((count / comboTotal) * 100);
        return `<div class="flex items-center gap-2">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background: ${def ? def.color + '1a' : 'var(--accent-glow)'}; color: ${def ? def.color : 'var(--accent)'};">${mood} + ${period}</span>
          <div class="flex-1 text-right text-[9px] font-bold" style="color: var(--text-muted);">${count}× (${pct}%)</div>
        </div>`;
      }).join('');
    }
  }

  // ---------- Trigger Escalation ----------
  const lastWkStart = getLastWeekRange().start.getTime();
  const lastWkEnd = getLastWeekRange().end.getTime();
  const currentStart = getThisWeekRange().start.getTime();
  const nowEnd = Date.now();

  const trendW = {}, trendC = {};
  recentLogs.forEach(l => {
    const tags = (l.tags || []).filter(Boolean);
    if (tags.length === 0) return;
    if (l.timestamp >= currentStart && l.timestamp <= nowEnd) {
      tags.forEach(t => trendC[t] = (trendC[t] || 0) + 1);
    } else if (l.timestamp >= lastWkStart && l.timestamp <= lastWkEnd) {
      tags.forEach(t => trendW[t] = (trendW[t] || 0) + 1);
    }
  });

  const trendEl = document.getElementById('patternTriggerTrends');
  if (trendEl) {
    const rising = Object.keys(trendC).filter(t => {
      const prev = trendW[t] || 0;
      const cur = trendC[t];
      return prev > 0 && cur >= prev * 2 && cur >= 2;
    }).sort((a, b) => trendC[b] - trendC[a]).slice(0, 3);

    if (rising.length > 0) {
      trendEl.innerHTML = rising.map(t => {
        const prev = trendW[t] || 0, cur = trendC[t];
        return `<div class="flex items-center gap-2">
          <span class="text-[9px] font-bold" style="color: #EF4444;">▲</span>
          <span class="text-[9px] font-bold flex-1" style="color: var(--text-main);">${esc(t)}</span>
          <span class="text-[9px] font-bold" style="color: var(--text-muted);">${prev} → ${cur}</span>
        </div>`;
      }).join('');
    } else {
      const improving = Object.keys(trendW).filter(t => {
        const prev = trendW[t] || 0;
        const cur = trendC[t] || 0;
        return prev > 0 && cur <= prev * 0.5;
      }).length;
      if (improving > 0) {
        trendEl.innerHTML = `<p class="text-[9px] font-bold" style="color: #10B981;">✓ No triggers escalating this week. Keep it up!</p>`;
      } else {
        trendEl.innerHTML = `<p class="text-[9px]" style="color: var(--text-muted);">No strong trigger trends yet.</p>`;
      }
    }
  }

  // ---------- Summary line ----------
  const summaryEl = document.getElementById('patternSummary');
  if (summaryEl) {
    if (thisWeekCount === 0 && lastWeekCount === 0) {
      summaryEl.innerText = 'Patterns will appear as you log.';
    } else if (lastWeekCount > 0 && thisWeekCount < lastWeekCount) {
      const pct = Math.round(((lastWeekCount - thisWeekCount) / lastWeekCount) * 100);
      summaryEl.innerText = `${pct}% fewer sticks this week. Nice trend!`;
    } else if (lastWeekCount > 0 && thisWeekCount > lastWeekCount) {
      const pct = Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);
      summaryEl.innerText = `+${pct}% this week. Check your triggers below.`;
    } else if (thisWeekCount > 0) {
      summaryEl.innerText = 'Building your weekly pattern...';
    } else {
      summaryEl.innerText = 'Patterns will appear as you log.';
    }
  }

  // ---------- Hero Insight (score + key finding) ----------
  const tagCounts = {};
  recentLogs.forEach(l => {
    const tags = (l.tags && l.tags.length ? l.tags : (l.trigger ? [l.trigger] : [])).filter(Boolean);
    tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
  });
  const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  const taggedCount = tagEntries.reduce((s, e) => s + e[1], 0);
  const depthScore = Math.min(100, Math.round(15 + recentLogs.length * 2 + Object.keys(moodCounts).length * 4 + Object.keys(tagCounts).length * 3));
  const scoreEl = document.getElementById('intelScore');
  const ringEl = document.getElementById('intelScoreRing');
  if (scoreEl) scoreEl.innerText = depthScore;
  if (ringEl) ringEl.style.strokeDashoffset = (175.93 * (1 - depthScore / 100)).toFixed(1);
  const teaserLine = document.getElementById('patternTeaserLine');
  if (teaserLine) teaserLine.style.width = `${depthScore}%`;

  const heroEl = document.getElementById('intelHeroText');
  if (heroEl) {
    if (recentLogs.length < 4) {
      heroEl.innerText = 'Log a few more cigarettes and your personal patterns will reveal themselves here.';
    } else if (tagEntries.length > 0) {
      const top = tagEntries[0];
      const topPct = Math.round((top[1] / Math.max(1, taggedCount)) * 100);
      heroEl.innerText = `Your top trigger is ${esc(top[0])} — it drives ${topPct}% of your smoking.`;
    } else if (dayCounts.some(c => c > 0)) {
      const peakIdx = dayCounts.indexOf(Math.max(...dayCounts));
      heroEl.innerText = `${DAY_SHORT[peakIdx]} is your heaviest smoking day (${dayCounts[peakIdx]} sticks).`;
    } else {
      heroEl.innerText = 'Patterns will appear as you log.';
    }
  }

  card.classList.remove('hidden');
  refreshIcons();
}

window.openPatternIntel = function() {
  try { renderPatternIntel(); } catch(e) {}
  document.getElementById('patternIntelModal').classList.remove('hidden');
  refreshIcons();
}
window.closePatternIntel = function() {
  document.getElementById('patternIntelModal').classList.add('hidden');
}

window.openHealthTimeline = function() {
  try { renderHealthTimeline(); } catch(e) {}
  document.getElementById('healthTimelineModal').classList.remove('hidden');
  refreshIcons();
}
window.closeHealthTimeline = function() {
  document.getElementById('healthTimelineModal').classList.add('hidden');
}

// ==================== PREMIUM CHART UPGRADES ====================

// Animated counter — smoothly counts from current value to target
function animateCounter(el, target, duration, prefix, suffix) {
  if (!el || target === null || target === undefined) return;
  const start = parseInt(el.textContent.replace(/[^0-9.-]/g, '')) || 0;
  const diff = target - start;
  if (diff === 0) return;
  const startTime = performance.now();
  prefix = prefix || '';
  suffix = suffix || '';
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + diff * eased);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Decimal-aware animated value (e.g. money amounts)
function animateValue(el, target, duration, prefix, suffix, decimals) {
  if (!el || target === null || target === undefined) return;
  const d = (decimals !== undefined) ? decimals : 0;
  const start = parseFloat(el.textContent.replace(/[^0-9.-]/g, '')) || 0;
  const diff = target - start;
  if (diff === 0) return;
  const startTime = performance.now();
  prefix = prefix || '';
  suffix = suffix || '';
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + diff * eased;
    el.textContent = prefix + current.toFixed(d) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Premium sparkline renderer
// Premium chart options — no grid, clean look
function getPremiumChartOptions(chartTextColor, chartTooltipTheme, extraOptions) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 800, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { left: 0, right: 0, top: 10, bottom: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltipTheme,
        backgroundColor: (isLightTheme()) ? 'rgba(255,255,255,0.98)' : 'rgba(15,23,42,0.98)',
        titleColor: (isLightTheme()) ? '#0F172A' : '#FFFFFF',
        bodyColor: (isLightTheme()) ? '#334155' : '#CBD5E1',
        titleFont: { family: "'Space Grotesk', monospace", size: 11, weight: '700' },
        bodyFont: { family: "'General Sans', sans-serif", size: 11, weight: '600' },
        borderColor: (isLightTheme()) ? 'rgba(203,213,225,0.5)' : 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        padding: { top: 10, bottom: 10, left: 14, right: 14 },
        cornerRadius: 14,
        boxPadding: 6,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => {
            let val;
            if (ctx.parsed && typeof ctx.parsed.y === 'number') val = ctx.parsed.y;
            else if (ctx.parsed && typeof ctx.parsed === 'number') val = ctx.parsed;
            else val = ctx.formattedValue;
            return ` ${ctx.dataset?.label || ''}: ${val}`;
          }
        }
      }
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: chartTextColor,
          font: { family: "'General Sans', sans-serif", size: 9, weight: '600' },
          maxTicksLimit: 5,
          padding: 8
        }
      },
      y: {
        display: true,
        beginAtZero: true,
        grid: { color: 'rgba(156,163,175,0.04)', drawBorder: false },
        border: { display: false },
        ticks: {
          color: chartTextColor,
          font: { family: "'Space Grotesk', monospace", size: 9, weight: '600' },
          padding: 8,
          maxTicksLimit: 5
        }
      },
      ...extraOptions
    }
  };
}

// Premium gradient fill for line charts
function createPremiumGradient(ctx, color, opacity1, opacity2) {
  const g = ctx.createLinearGradient(0, 0, 0, 180);
  g.addColorStop(0, color + (opacity1 || '30'));
  g.addColorStop(0.5, color + (opacity2 || '10'));
  g.addColorStop(1, color + '00');
  return g;
}

// ==================== END PREMIUM CHART UPGRADES ====================
