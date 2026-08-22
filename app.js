// ==========================================
// pause — Widen the gap.
// Application Engine (Unified & Optimized)
// ==========================================

// --- State Initialization ---
let logs = [];
try { 
  let raw = localStorage.getItem('smoke_logs');
  if (raw) logs = JSON.parse(raw);
  if (!Array.isArray(logs)) logs = [];
} catch(e) { logs = []; }

const DEFAULT_SETTINGS = {
  theme: 'white', haptics: true, dailyLimit: 15, lockSecs: 300, packPrice: 20, packSize: 20, currency: 'AED', timeFormat: '12h', motivation: '', autoReduce: false, quitDate: '',
  notifWaveComplete: true, notifGapWidened: true, notifInactivity: true, notifPredictive: true, notifEnableSos: false
};
let settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('smoke_settings')) || {});
if (!settings.packSize || settings.packSize <= 0) settings.packSize = 20;
if (!settings.timeFormat) settings.timeFormat = '12h';

let waves = [];
try { waves = JSON.parse(localStorage.getItem('smoke_waves')) || []; if (!Array.isArray(waves)) waves = []; } catch(e) { waves = []; }

let progressPhotos = [];
try { progressPhotos = JSON.parse(localStorage.getItem('smoke_progress_photos')) || []; if (!Array.isArray(progressPhotos)) progressPhotos = []; } catch(e) { progressPhotos = []; }

let waveAttempts = [];
try { waveAttempts = JSON.parse(localStorage.getItem('smoke_wave_attempts')) || []; if (!Array.isArray(waveAttempts)) waveAttempts = []; } catch(e) { waveAttempts = []; }

let triggers = JSON.parse(localStorage.getItem('smoke_triggers')) || [
  '🏠 Home', '💼 Work', '🚗 Car / Commute', '🎉 Outside / Social', 
  '😰 Stress', '🍽️ After Meal', '☕ Chai / Coffee', '📱 Boredom', 
  '👥 Peer Pressure', '🍺 Alcohol', '😡 Anger', '🌙 Habit'
];

let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let waveDurationMs = parseInt(localStorage.getItem('smoke_wave_duration')) || 600000;
let lastPeakNudgeDate = localStorage.getItem('smoke_peak_nudge') || '';
let gapWidenedNotified = localStorage.getItem('smoke_gap_widened_notified') === 'true';
let inactivityNotified = false;

let sosTimer = null;
let sosSecs = 15;
let holdTimerId = null;
let holdStartTime = 0;
let isHolding = false;
let editingLogIdx = null;
let currentSelectedTags = [];
let currentIntensity = 3;
let currentMood = null;
let takeoverTimer = null;
let takeoverCountdown = 6;
let historyRenderLimit = 30;
let pendingConfirmCallback = null;
let deferredInstallPrompt = null;
let hasAppBooted = false;

let myChartInstances = {};
let mapInstance = null;
let modalMapInstance = null;
let mainTimer = null;
let waveTimer = null;
let cooldownTimer = null;

let storedPinHash = localStorage.getItem('smoke_pin_hash');
let hasPin = !!storedPinHash;
let enteredPin = "";
let currentWatchStyle = parseInt(localStorage.getItem('smoke_watch_style')) || 1;
if (currentWatchStyle < 1 || currentWatchStyle > 3) currentWatchStyle = 1;
let touchStartXCoord = 0;

// Onboarding State
let onboardingStep = 1;
let onboardSticks = 10;
let onboardGoal = 'quit';

// Relapse & Breathing State
let relapseLogIdx = null;
let breathActive = false;
let breathPaused = false;
let breathTimeout = null;
let breathInterval = null;
let breathCycleCount = 0;
let breathCurrentExercise = null;

// Daily Challenge State
let todaysChallenge = null;
let challengeCompleted = false;

// --- Constants & Configs ---
const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1', '#F43F5E', '#84CC16', '#0EA5E9', '#D946EF', '#EAB308', '#1D4ED8', '#047857', '#B45309', '#BE123C', '#6D28D9'];
const INTENSITY_LABELS = { 1: 'Mild', 2: 'Light', 3: 'Moderate', 4: 'Severe', 5: 'Extreme' };
const THEME_META_COLORS = { white: '#F8FAFC', carbon: '#000000', aurora: '#0B0B14', oled: '#000000', paper: '#FAF6F0', calm: '#F5F5F0', default: '#090A0F' };
const LIGHT_THEMES = ['white', 'paper', 'calm'];
const APP_FONT_FAMILY = '"General Sans", -apple-system, BlinkMacSystemFont, sans-serif';
const NUMERIC_FONT_FAMILY = '"Space Grotesk", monospace';
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MOODS = [
  { id: 'calm', icon: 'smile', label: 'Calm', color: '#10B981' },
  { id: 'happy', icon: 'sun', label: 'Happy', color: '#F59E0B' },
  { id: 'neutral', icon: 'meh', label: 'Neutral', color: '#6B7280' },
  { id: 'anxious', icon: 'zap', label: 'Anxious', color: '#F97316' },
  { id: 'stressed', icon: 'alert-triangle', label: 'Stressed', color: '#EF4444' },
  { id: 'frustrated', icon: 'flame', label: 'Frustrated', color: '#DC2626' },
  { id: 'sad', icon: 'cloud-rain', label: 'Sad', color: '#3B82F6' },
  { id: 'craving', icon: 'cigarette', label: 'Craving', color: '#8B5CF6' }
];

const LEGACY_MOOD_EMOJI = { '😌':'calm', '😊':'happy', '😐':'neutral', '😰':'anxious', '😣':'stressed', '😡':'frustrated', '😢':'sad', '🙏':'craving' };

const HEALTH_MILESTONES = [
  { mins: 20, emoji: '❤️', title: 'Heart Rate Normalizes', desc: 'Blood pressure begins to drop after your last cigarette.' },
  { mins: 120, emoji: '🫁', title: 'Oxygen Improves', desc: 'Oxygen levels in your blood return toward normal.' },
  { mins: 480, emoji: '💨', title: 'CO Level Drops', desc: 'Carbon monoxide is cleared from your bloodstream.' },
  { mins: 1440, emoji: '💪', title: 'Heart Attack Risk Drops', desc: 'Risk of heart attack begins to decrease.' },
  { mins: 2880, emoji: '👅', title: 'Senses Heighten', desc: 'Nerve endings regrow. Taste and smell improve.' },
  { mins: 4320, emoji: '🧘', title: 'Breathing Eases', desc: 'Bronchial tubes relax. Lung capacity improves.' },
  { mins: 10080, emoji: '🧠', title: 'Mood Stabilizes', desc: 'Nicotine receptors return to normal levels.' },
  { mins: 20160, emoji: '🏃', title: 'Circulation Boosts', desc: 'Blood circulation improves significantly.' },
  { mins: 43200, emoji: '🌟', title: 'Lung Function Grows', desc: 'Cilia regrow and lung function increases.' },
];

const MONEY_EQUIVALENTS = [
  { emoji: '☕', label: 'Coffees', price: 15 },
  { emoji: '🍕', label: 'Pizzas', price: 45 },
  { emoji: '🎬', label: 'Movie Tickets', price: 60 },
  { emoji: '📚', label: 'Books', price: 40 },
  { emoji: '💪', label: 'Gym Sessions', price: 30 },
  { emoji: '🚗', label: 'Uber Rides', price: 25 },
  { emoji: '📺', label: 'Netflix Months', price: 55 },
  { emoji: '⛽', label: 'Petrol Fills', price: 100 },
  { emoji: '🎮', label: 'PS5 Games', price: 250 },
];

const BREATHING_EXERCISES = {
  '478': { name: '4-7-8 Relaxation', inhale: 4, hold: 7, exhale: 8, cycles: 4, color: '#8B5CF6', desc: 'Calms anxiety' },
  'box': { name: 'Box Breathing', inhale: 4, hold: 4, exhale: 4, cycles: 6, color: '#38BDF8', desc: 'Focus & relief' },
  'quick': { name: 'Quick Craving Buster', inhale: 4, hold: 2, exhale: 6, cycles: 3, color: '#10B981', desc: 'Beat the urge' },
};

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

// --- Auto-Reduce Calculation ---
let lastReduceDate = localStorage.getItem('smoke_last_reduce_date');
if (settings.autoReduce) {
  let nowStr = new Date().toDateString();
  if (!lastReduceDate) {
    localStorage.setItem('smoke_last_reduce_date', nowStr);
  } else {
    let diffDays = Math.floor((new Date() - new Date(lastReduceDate)) / (1000 * 60 * 60 * 24));
    let weeksMissed = Math.floor(diffDays / 7);
    if (weeksMissed > 0 && settings.dailyLimit > 1) {
      let decrement = Math.min(weeksMissed, settings.dailyLimit - 1);
      settings.dailyLimit -= decrement;
      localStorage.setItem('smoke_settings', JSON.stringify(settings));
      localStorage.setItem('smoke_last_reduce_date', nowStr);
    }
  }
}

// --- Utility Functions ---
function hashPin(p) { let h = 0; for (let i = 0; i < p.length; i++) { h = ((h << 5) - h) + p.charCodeAt(i); h |= 0; } return h.toString(36); }
function esc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;' }[c])); }
function isLightTheme() { const t = settings.theme || 'white'; return LIGHT_THEMES.includes(t) || document.documentElement.classList.contains('theme-white') || document.documentElement.classList.contains('theme-paper') || document.documentElement.classList.contains('theme-calm'); }
function formatAppTime(dateObj) { return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' }); }
function formatGap(m) { if (m === null || m === undefined || isNaN(m)) return '—'; if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h ${m % 60 > 0 ? (m % 60) + 'm' : ''}`.trim(); }

let _lucideTimer = null;
function refreshIcons() {
  if (_lucideTimer) clearTimeout(_lucideTimer);
  _lucideTimer = setTimeout(() => {
    if (window.lucide) window.lucide.createIcons();
  }, 30);
}

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

function logWaveAttempt(outcome, customDurationMs) {
  const durMs = customDurationMs !== undefined ? customDurationMs : waveDurationMs;
  const mins = customDurationMs !== undefined ? +(durMs / 60000).toFixed(2) : Math.round(durMs / 60000);
  waveAttempts.push({ outcome, timestamp: Date.now(), durationMs: durMs, minutes: mins });
  if (waveAttempts.length > 500) waveAttempts = waveAttempts.slice(-500);
  localStorage.setItem('smoke_wave_attempts', JSON.stringify(waveAttempts));
}

// --- Chart Defaults & Plugins ---
if (typeof Chart !== 'undefined') {
  try { Chart.defaults.color = '#64748B'; } catch(e) {}
  try { Chart.defaults.font.family = APP_FONT_FAMILY; } catch(e) {}
}

const crosshairPlugin = {
  id: 'crosshair',
  afterDraw: chart => {
    if (chart.tooltip?._active?.length && (chart.config.type === 'line' || chart.config.type === 'bar')) {
      const activePoint = chart.tooltip._active[0];
      const ctx = chart.ctx;
      const x = activePoint.element.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chart.scales.y.top);
      ctx.lineTo(x, chart.scales.y.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isLightTheme() ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.2)';
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
      ctx.restore();
      let text = "";
      if (chart.canvas.id === 'chart4') {
        const smoked = chart.data.datasets[0].data[0] || 0;
        const resisted = chart.data.datasets[0].data[1] || 0;
        const total = smoked + resisted;
        text = total > 0 ? Math.round((resisted / total) * 100) + "%" : "🙌";
      } else {
        const total = chart.data.datasets[0].data.reduce((a,b) => a+b, 0);
        text = total > 0 ? total + " Logs" : "Keep\ngoing";
      }
      const isPct = chart.canvas.id === 'chart4';
      ctx.font = "700 " + (isPct ? '26px' : '14px') + " " + (isPct ? NUMERIC_FONT_FAMILY : APP_FONT_FAMILY);
      const x = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
      const y = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isLightTheme() ? "#0F172A" : "#E5E7EB";
      ctx.fillText(text, x, y);
      ctx.save();
    }
  }
};

// --- Service Worker & PWA ---
async function registerServiceWorker(retries = 3) {
  if (!('serviceWorker' in navigator)) return;
  for (let i = 0; i < retries; i++) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      if (reg.active) reg.active.postMessage({ type: 'GET_CACHE_STATUS' });
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.version) {
          setTimeout(() => showOfflineReadyToast(), 3000);
        }
      });
      return;
    } catch (err) {
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function showOfflineReadyToast() {
  if (sessionStorage.getItem('offline_ready_shown')) return;
  sessionStorage.setItem('offline_ready_shown', 'true');
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-24 left-4 right-4 z-[10002] premium-card p-3 text-center text-xs font-semibold shadow-lg transition-all duration-500';
  toast.style.background = 'var(--card-bg)';
  toast.style.color = 'var(--text-main)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(20px)';
  toast.innerHTML = `<div class="flex items-center justify-center gap-2"><i data-lucide="wifi-off" class="w-4 h-4 text-emerald-500"></i><span>App ready for offline use</span></div>`;
  document.body.appendChild(toast);
  refreshIcons();
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 500); }, 3000);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  setTimeout(() => {
    if (deferredInstallPrompt && logs.length >= 3) showInstallBanner();
  }, 5000);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.add('hidden');
  showToast('pause installed! 🎉');
});

function showInstallBanner() {
  if (document.getElementById('installBanner')) return;
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

function installApp() {
  if (!deferredInstallPrompt) { showToast('Already installed or not supported'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(res => {
    if (res.outcome === 'accepted') showToast('Installing pause...');
    deferredInstallPrompt = null;
    const banner = document.getElementById('installBanner');
    if (banner) banner.remove();
  });
}

// --- Watch Styles & Swipe ---
function touchStartX(e) {
  if (e.changedTouches && e.changedTouches.length > 0) touchStartXCoord = e.changedTouches[0].clientX;
}

function touchEndX(e) {
  if (e.changedTouches && e.changedTouches.length > 0) {
    let diff = e.changedTouches[0].clientX - touchStartXCoord;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        currentWatchStyle = currentWatchStyle === 1 ? 3 : currentWatchStyle - 1;
      } else {
        currentWatchStyle = currentWatchStyle === 3 ? 1 : currentWatchStyle + 1;
      }
      switchWatchStyle(currentWatchStyle);
    }
  }
}

function switchWatchStyle(styleNum) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
  currentWatchStyle = styleNum;
  localStorage.setItem('smoke_watch_style', styleNum);
  
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('watchStyle' + i);
    const dot = document.getElementById('watchDot' + i);
    if (el) el.classList.toggle('hidden', i !== styleNum);
    if (dot) {
      if (i === styleNum) {
        dot.className = "w-2.5 h-2.5 rounded-full transition-all duration-300 scale-125 shadow-[0_0_8px_var(--accent-glow)]";
        dot.style.backgroundColor = "var(--accent)";
      } else {
        dot.className = "w-2 h-2 rounded-full transition-all duration-300 bg-gray-500/30";
        dot.style.backgroundColor = "";
      }
    }
  }
}

function cycleNextWatch() {
  currentWatchStyle = currentWatchStyle >= 3 ? 1 : currentWatchStyle + 1;
  switchWatchStyle(currentWatchStyle);
}

// --- Main Log Hold Button ---
function startHold(e) {
  if (e && e.cancelable) e.preventDefault();
  if (new Date().getTime() < lockEndTime || waveEndTime > 0) {
    if (waveEndTime > 0) showToast("Wave in progress. Can't log now!");
    else showToast("Wait for the cooldown 🔒");
    return;
  }
  if (settings.haptics && navigator.vibrate) navigator.vibrate(15);
  isHolding = true; 
  holdStartTime = Date.now();
  const progressEl = document.getElementById('holdProgress');
  const textEl = document.getElementById('holdText');
  const iconEl = document.getElementById('holdIcon');
  const btnEl = document.getElementById('mainLogBtn');
  if (btnEl) btnEl.classList.add('is-holding');
  if (textEl) textEl.innerText = "Hold...";
  if (iconEl) { iconEl.classList.add('text-red-500'); iconEl.classList.remove('text-gray-400'); }
  
  let lastTick = 0;
  function update() {
    if (!isHolding) return;
    const elapsed = Date.now() - holdStartTime;
    const pct = Math.min((elapsed / 800) * 100, 100);
    if (progressEl) progressEl.style.width = pct + '%';

    const tickPct = Math.floor(pct / 25) * 25;
    if (tickPct > lastTick && tickPct > 0 && tickPct < 100) {
      lastTick = tickPct;
      if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
    }

    if (elapsed >= 800) {
      isHolding = false;
      if (btnEl) btnEl.classList.remove('is-holding');
      if (progressEl) progressEl.style.width = '100%';
      if (textEl) textEl.innerText = "Done";
      if (settings.haptics && navigator.vibrate) navigator.vibrate([30, 50, 30]);
      
      try {
        if (settings.notifEnableSos) {
          triggerSosInterrupterFirst();
        } else {
          actuallyLogCigarette();
        }
      } catch(err) { 
        console.error("Error logging", err); 
      } finally {
        setTimeout(() => { 
          if (progressEl) progressEl.style.width = '0%'; 
          if (textEl) textEl.innerText = "Hold to Smoke"; 
          if (iconEl) { iconEl.classList.add('text-gray-400'); iconEl.classList.remove('text-red-500'); }
        }, 500);
      }
    } else {
      holdTimerId = requestAnimationFrame(update);
    }
  }
  holdTimerId = requestAnimationFrame(update);
}

function cancelHold(e) {
  if (e && e.cancelable) e.preventDefault();
  if (isHolding && Date.now() - holdStartTime < 800 && Date.now() - holdStartTime > 10) showToast("Press and hold to log ⏱️");
  isHolding = false;
  if (holdTimerId) cancelAnimationFrame(holdTimerId);
  if (new Date().getTime() < lockEndTime) return; 

  const progressEl = document.getElementById('holdProgress');
  const textEl = document.getElementById('holdText');
  const iconEl = document.getElementById('holdIcon');
  const btnEl = document.getElementById('mainLogBtn');
  if (btnEl) btnEl.classList.remove('is-holding');
  if (progressEl) progressEl.style.width = '0%';
  if (textEl) textEl.innerText = "Hold to Smoke";
  if (iconEl) { iconEl.classList.add('text-gray-400'); iconEl.classList.remove('text-red-500'); }
}

function handleLogClick() {
  if (settings.notifEnableSos) triggerSosInterrupterFirst();
  else actuallyLogCigarette();
}

// --- SOS Interrupter ---
function triggerSosInterrupterFirst() {
  const actions = [
    "Drink a full glass of cold water 💧",
    "Take 3 deep breaths (4s in, 4s hold, 6s out) 🫁",
    "Walk away from your current room for 1 minute 🚶"
  ];
  const choice = actions[Math.floor(Math.random() * actions.length)];
  const actionTitle = document.getElementById('sosActionTitle');
  if (actionTitle) actionTitle.innerText = choice;

  sosSecs = 15;
  const numEl = document.getElementById('sosTimerNum');
  const proceedBtn = document.getElementById('sosProceedBtn');
  if (numEl) { numEl.innerText = sosSecs; numEl.style.transform = "scale(1)"; }
  if (proceedBtn) { 
    proceedBtn.className = "sheet-btn-ghost opacity-50";
    proceedBtn.innerText = "Skip & Proceed to Log"; 
  }

  const modal = document.getElementById('sosInterrupterModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();

  if (sosTimer) clearInterval(sosTimer);
  sosTimer = setInterval(() => {
    sosSecs--;
    if (numEl) {
      numEl.innerText = sosSecs;
      numEl.style.transform = "scale(1.3)";
      setTimeout(() => { if (numEl) numEl.style.transform = "scale(1)"; }, 150);
      if (sosSecs <= 3) numEl.className = "numeric-display text-4xl font-black text-red-500 transition-transform duration-150";
      else numEl.className = "numeric-display text-4xl font-black text-amber-500 transition-transform duration-150";
    }
    if (sosSecs <= 0) {
      clearInterval(sosTimer);
      if (proceedBtn) { 
        proceedBtn.className = "sheet-btn-primary";
        proceedBtn.innerText = "Ready to Proceed to Log →"; 
      }
    }
  }, 1000);
}

function closeSosInterrupter(cravingPassed) {
  if (sosTimer) clearInterval(sosTimer);
  const modal = document.getElementById('sosInterrupterModal');
  if (modal) modal.classList.add('hidden');

  if (cravingPassed) {
    waves.push(Date.now());
    localStorage.setItem('smoke_waves', JSON.stringify(waves));
    logWaveAttempt('won', 15000);
    showToast("🛡️ Craving Defeated! +1 Shield");
    spawnConfetti();
    try { updateUI(); } catch(e){}
  } else {
    actuallyLogCigarette();
  }
}

// --- Cigarette Logging & Relapse Flow ---
function actuallyLogCigarette() {
  gapWidenedNotified = false;
  inactivityNotified = false;
  localStorage.setItem('smoke_gap_widened_notified', 'false');

  let waveWasActive = false;
  if (waveEndTime > 0) {
    waveWasActive = true; 
    localStorage.removeItem('smoke_wave_end'); 
    waveEndTime = 0; 
    clearInterval(waveTimer);
    const o = document.getElementById('waveOverlay');
    if (o) o.classList.add('hidden');
    logWaveAttempt('lost'); 
    resetRideButton();
  }

  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp) / 60000) : null;

  const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGapMin = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;
  const isRelapse = gap !== null && avgGapMin > 60 && gap < avgGapMin * 0.5;

  logs.push({ timestamp: now, gap: gap, tags: [], lat: null, lng: null, intensity: 3, note: '', mood: null });
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
  checkLock();

  if (isRelapse) {
    showRelapseModal(newLogIdx, gap);
  } else {
    startSmokeTakeover(newLogIdx, gap, waveWasActive);
  }

  if (navigator.geolocation) {
    const logTimestamp = now;
    navigator.geolocation.getCurrentPosition(p => {
      const entry = logs.find(l => l.timestamp === logTimestamp);
      if (entry) { 
        entry.lat = p.coords.latitude; 
        entry.lng = p.coords.longitude; 
        localStorage.setItem('smoke_logs', JSON.stringify(logs)); 
        if (!document.getElementById('page-insights').classList.contains('hidden')) renderHeatMap('mapContainer', getFilteredLogs()); 
      }
    }, () => {}, { timeout: 10000, maximumAge: 60000 });
  }
}

function showRelapseModal(logIdx, gap) {
  relapseLogIdx = logIdx;
  const modal = document.getElementById('relapseModal');
  const msgEl = document.getElementById('relapseMessage');
  const statsEl = document.getElementById('relapseStats');
  if (!modal) return;

  const allGaps = logs.slice(0, -1).map(l => l.gap).filter(g => g !== null && g !== undefined);
  const avgGapMin = allGaps.length ? allGaps.reduce((a, b) => a + b, 0) / allGaps.length : 0;
  const bestGapMin = allGaps.length ? Math.max(...allGaps) : 0;
  const daysSinceStart = logs.length > 1 ? Math.round((logs[logs.length - 1].timestamp - logs[0].timestamp) / 86400000) : 0;

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
        <p class="text-[8px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Avoided</p>
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

function closeRelapseModal() {
  const modal = document.getElementById('relapseModal');
  if (modal) modal.classList.add('hidden');
  if (relapseLogIdx !== null) {
    startSmokeTakeover(relapseLogIdx, logs[relapseLogIdx]?.gap, false);
    relapseLogIdx = null;
  }
}

function startRelapseRecovery() {
  const modal = document.getElementById('relapseModal');
  if (modal) modal.classList.add('hidden');
  relapseLogIdx = null;
  startWave(10);
  showToast('Recovery wave started! You got this.');
}

// --- Smoke Takeover Modal ---
function applyIntensityStyling(val, prefix, sizeClass) {
  for (let i = 1; i <= 5; i++) {
    const b = document.getElementById(prefix + i);
    if (!b) continue;
    if (i === val) {
      b.className = `${sizeClass} rounded-full border text-xs font-bold transition-all scale-110`;
      b.style.background = "var(--accent)"; b.style.color = "#fff"; b.style.boxShadow = "0 4px 12px var(--accent-glow)"; b.style.borderColor = "transparent";
    } else {
      b.className = `${sizeClass} rounded-full border text-xs font-bold transition-all scale-100`;
      b.style.background = "transparent"; b.style.borderColor = "var(--card-border)"; b.style.color = "var(--text-main)"; b.style.boxShadow = "none";
    }
  }
}

function setTakeoverIntensity(val) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
  currentIntensity = val;
  applyIntensityStyling(val, 'toInt', 'w-9 h-9');
  const lbl = document.getElementById('takeoverIntensityLabel');
  if (lbl) lbl.innerText = INTENSITY_LABELS[val];
}

function startSmokeTakeover(logIdx, gap, waveWasActive) {
  editingLogIdx = logIdx; 
  currentSelectedTags = []; 
  currentMood = null; 
  setTakeoverIntensity(3); 
  takeoverCountdown = 6;
  const overlay = document.getElementById('smokeTakeover'); 
  const numberEl = document.getElementById('takeoverNumber'); 
  const ringEl = document.getElementById('takeoverRing'); 
  const factEl = document.getElementById('takeoverFact');
  
  let factText = "";
  if (waveWasActive) factText = "It's okay to slip. What triggered this strong urge?";
  else if (gap === null || gap === undefined) factText = "Setting your first baseline.";
  else if (gap < 60) factText = `It's been ${gap}m since your last one.`;
  else factText = `It's been ${Math.floor(gap/60)}h ${gap%60}m since your last one.`;
  
  if (factEl) { factEl.innerText = factText; factEl.style.opacity = 0; }
  renderTakeoverTags();
  renderTakeoverMoods();

  const updateTick = () => {
    if (numberEl) numberEl.innerText = takeoverCountdown;
    const offset = 339.29 - (339.29 * (takeoverCountdown / 6));
    if (ringEl) ringEl.style.strokeDashoffset = offset;
    if (takeoverCountdown === 3 && factEl) factEl.style.opacity = 1;
  };
  updateTick();

  overlay.classList.remove('hidden'); 
  requestAnimationFrame(() => { overlay.classList.remove('opacity-0'); overlay.classList.add('opacity-100'); });
  if (takeoverTimer) clearInterval(takeoverTimer);
  takeoverTimer = setInterval(() => {
    takeoverCountdown--;
    if (takeoverCountdown <= 0) { clearInterval(takeoverTimer); closeSmokeTakeover(); } else updateTick();
  }, 1000);
}

function renderTakeoverTags() {
  const grid = document.getElementById('takeoverTagsGrid'); 
  if (!grid) return;
  grid.innerHTML = triggers.map(t => {
    const isActive = currentSelectedTags.includes(t);
    const activeClasses = isActive ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-white/5 border-white/10';
    const textStyle = isActive ? 'style="color: var(--accent);"' : 'style="color: var(--text-main);"';
    const safeId = 'tagBtn_' + t.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/_+$/, '').substring(0, 50) || 'trigger';
    return `<button id="${safeId}" onclick="window.toggleTakeoverTag('${esc(t)}')" class="px-4 py-2.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all active:scale-95 ${activeClasses}" ${textStyle}>${esc(t)}</button>`;
  }).join('');
}

function renderTakeoverMoods() {
  const grid = document.getElementById('takeoverMoodGrid'); 
  if (!grid) return;
  grid.innerHTML = MOODS.map((m, idx) => moodChipHtml(m, idx, 'toggleTakeoverMood', false)).join('');
  refreshIcons();
}

function toggleTakeoverMood(idx) {
  currentMood = currentMood === MOODS[idx].id ? null : MOODS[idx].id;
  renderTakeoverMoods();
}

function renderEditMood() {
  const grid = document.getElementById('editMoodGrid'); 
  if (!grid) return;
  grid.innerHTML = MOODS.map((m, idx) => moodChipHtml(m, idx, 'toggleEditMood', true)).join('');
  refreshIcons();
}

function toggleEditMood(idx) {
  currentMood = currentMood === MOODS[idx].id ? null : MOODS[idx].id;
  renderEditMood();
}

function toggleTakeoverTag(t) { 
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10); 
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
  if (e) e.stopPropagation(); 
  if (takeoverTimer) clearInterval(takeoverTimer);
  const overlay = document.getElementById('smokeTakeover'); 
  overlay.classList.remove('opacity-100'); 
  overlay.classList.add('opacity-0');
  
  if (editingLogIdx >= 0 && editingLogIdx === logs.length - 1 && logs[editingLogIdx] && Array.isArray(logs[editingLogIdx].tags) && logs[editingLogIdx].tags.length === 0 && logs[editingLogIdx].lat === null) {
    logs.pop(); 
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    lockEndTime = 0; 
    localStorage.setItem('smoke_lock_end', lockEndTime);
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    try { updateUI(); } catch(err){} 
    checkLock();
  }
  if (window.posthog) posthog.capture('takeover_cancelled');
  setTimeout(() => { overlay.classList.add('hidden'); }, 500);
}

function closeSmokeTakeover() {
  if (takeoverTimer) clearInterval(takeoverTimer);
  const overlay = document.getElementById('smokeTakeover'); 
  overlay.classList.remove('opacity-100'); 
  overlay.classList.add('opacity-0');
  
  if (editingLogIdx !== null && logs[editingLogIdx]) {
    logs[editingLogIdx].tags = [...currentSelectedTags]; 
    logs[editingLogIdx].intensity = currentIntensity;
    logs[editingLogIdx].mood = currentMood;
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    if (window.posthog) posthog.capture('takeover_saved', { tags: currentSelectedTags, intensity: currentIntensity });
    try { updateUI(); } catch(err){} 
    if (!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  }
  setTimeout(() => { overlay.classList.add('hidden'); showUndoToast(editingLogIdx); }, 500);
}

function showUndoToast(logIdx) {
  const c = document.getElementById('toastContainer'); 
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-3 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300 flex items-center gap-3 border border-gray-500/20';
  t.style.background = 'var(--card-bg)';
  t.innerHTML = `<span class="flex items-center gap-1.5" style="color: var(--text-main);"><i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-500"></i> Logged</span><div class="w-px h-3 bg-gray-500/30"></div><button onclick="window.undoLog(${logIdx}, this.parentElement)" class="text-sky-500 active:scale-95 transition-transform uppercase tracking-wider">Undo</button>`;
  t.style.opacity = '0'; 
  t.style.transform = 'translateY(-10px)';
  c.appendChild(t); 
  refreshIcons();
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  const autoHide = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 5000); 
  t.dataset.timerId = autoHide;
}

function undoLog(idx, element) {
  if (element) { clearTimeout(element.dataset.timerId); element.style.opacity = '0'; setTimeout(() => element.remove(), 300); }
  if (logs[idx]) {
    logs.splice(idx, 1);
    for (let i = 1; i < logs.length; i++) { logs[i].gap = Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000); }
    if (logs.length > 0) logs[0].gap = null;
    localStorage.setItem('smoke_logs', JSON.stringify(logs)); 
    lockEndTime = 0; 
    localStorage.setItem('smoke_lock_end', lockEndTime);
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    if (window.posthog) posthog.capture('log_undone');
    try { updateUI(); } catch(err){} 
    checkLock();
    if (!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  }
}

function checkLock() {
  const btn = document.getElementById('mainLogBtn'); 
  if (!btn) return;
  if (new Date().getTime() < lockEndTime) {
    btn.disabled = true; 
    btn.style.opacity = '0.5';
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      let rem = Math.max(0, Math.ceil((lockEndTime - new Date().getTime()) / 1000)); 
      const textEl = document.getElementById('holdText');
      if (rem <= 0) { 
        clearInterval(cooldownTimer); 
        btn.disabled = false; 
        btn.style.opacity = '1'; 
        if (textEl) textEl.innerText = 'Hold to Smoke'; 
        if (settings.haptics && navigator.vibrate) navigator.vibrate([30, 50, 30]); 
        showToast("Ready to log 🔓"); 
      } else if (textEl) {
        textEl.innerText = `COOLDOWN (${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')})`;
      }
    }, 1000);
  }
}

// --- Wave Ride Logic ---
function openWaveModal() { 
  if (waveEndTime > 0) { showToast("A wave is already in progress 🌊"); return; } 
  const modal = document.getElementById('waveModal');
  if (modal) modal.classList.remove('hidden'); 
}

function closeWaveModal() { 
  const modal = document.getElementById('waveModal');
  if (modal) modal.classList.add('hidden'); 
}

function startWave(mins) { 
  closeWaveModal(); 
  waveDurationMs = mins * 60000; 
  localStorage.setItem('smoke_wave_duration', waveDurationMs); 
  waveEndTime = new Date().getTime() + waveDurationMs; 
  localStorage.setItem('smoke_wave_end', waveEndTime); 
  if (window.posthog) posthog.capture('ride_wave_started', { duration_mins: mins });
  checkWave(); 
}

function celebrateBadgeIfUnlocked() {
  const milestones = { 1: 'First Win Unlocked! 🥇', 10: 'Iron Will Unlocked! 🏅', 50: 'Unshakable Unlocked! 🏆' };
  if (!milestones[waves.length]) return;
  showToast(milestones[waves.length]);
  spawnConfetti();
}

function spawnConfetti() {
  if (window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
}

function cancelActiveWave() {
  if (waveEndTime <= 0) return;
  if (waveTimer) clearInterval(waveTimer);
  waveEndTime = 0; 
  localStorage.removeItem('smoke_wave_end');
  const o = document.getElementById('waveOverlay'); 
  if (o) o.classList.add('hidden');
  logWaveAttempt('cancelled');
  resetRideButton();
  if (window.posthog) posthog.capture('ride_wave_cancelled');
  showToast("Wave cancelled");
}

function resetRideButton() {}

function waveTick() {
  const o = document.getElementById('waveOverlay'); 
  if (!o) return;
  let rem = Math.ceil((waveEndTime - new Date().getTime()) / 1000); 
  let totalSecs = waveDurationMs / 1000;
  if (rem <= 0) {
    clearInterval(waveTimer); 
    waveEndTime = 0; 
    localStorage.removeItem('smoke_wave_end'); 
    o.classList.add('hidden');
    resetRideButton();
    waves.push(Date.now()); 
    localStorage.setItem('smoke_waves', JSON.stringify(waves)); 
    logWaveAttempt('won'); 
    showToast("🛡️ Craving Defeated! +1 Shield");
    sendSystemNotification("🛡️ Craving Defeated!", "Awesome job! You successfully rode out the craving wave. +1 Shield unlocked.", 'notifWaveComplete');
    celebrateBadgeIfUnlocked();
    if (window.posthog) posthog.capture('ride_wave_completed', { duration_mins: waveDurationMs / 60000 });
    try { updateUI(); } catch(e){}
  } else {
    const mm = Math.floor(rem/60).toString().padStart(2,'0'), ss = (rem%60).toString().padStart(2,'0');
    const countdownEl = document.getElementById('waveCountdown');
    if (countdownEl) countdownEl.innerText = `${mm}:${ss}`;
    const elapsedFrac = Math.min(1, Math.max(0, (totalSecs - rem) / totalSecs));

    let txt = "Breathe in... Hold... Exhale...";
    if (elapsedFrac < 0.2) txt = "Notice the urge without acting on it. Where do you feel it?";
    else if (elapsedFrac < 0.5) txt = "Cravings are like ocean waves. They rise, peak, and crash.";
    else if (elapsedFrac < 0.8) txt = "The urge is peaking now. Just ride it out, it will pass.";
    else txt = "You're doing great. The craving is fading away.";
    
    const txtEl = document.getElementById('waveMotivationalText');
    if (txtEl && txtEl.innerText !== txt) { 
      txtEl.style.opacity = '0'; 
      setTimeout(() => { txtEl.innerText = txt; txtEl.style.opacity = '1'; }, 300); 
    }
  }
}

function checkWave() {
  const o = document.getElementById('waveOverlay'); 
  if (!o) return;
  if (waveEndTime > 0) {
    o.classList.remove('hidden');
    if (waveTimer) clearInterval(waveTimer);
    waveTick();
    waveTimer = setInterval(waveTick, 1000);
  }
}

// --- Navigation ---
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

function switchTab(t) {
  try {
    if (settings.haptics && navigator.vibrate) navigator.vibrate(20);
    ['tracker','insights','history','settings'].forEach(x => { 
      const p = document.getElementById(`page-${x}`);
      const btn = document.getElementById(`tab-${x}`);
      if (p) p.classList.add('hidden'); 
      if (btn) btn.classList.remove('nav-active'); 
    });

    const activePage = document.getElementById(`page-${t}`);
    const activeBtn = document.getElementById(`tab-${t}`);
    if (activePage) activePage.classList.remove('hidden');
    if (activeBtn) activeBtn.classList.add('nav-active');
    moveNavIndicator(activeBtn);

    if (window.posthog) posthog.capture('tab_switched', { tab_name: t });
    localStorage.setItem('smoke_active_tab', t);
    if (t === 'history') renderHistory('fullHistoryList'); 
    if (t === 'insights') requestAnimationFrame(() => renderAllCharts());
    refreshIcons();
  } catch(err) { 
    console.error("switchTab Error:", err); 
  }
}

// --- Modals, Toasts & Alerts ---
function showToast(msg) {
  const c = document.getElementById('toastContainer'); 
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-2.5 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300';
  t.style.color = 'var(--text-main)'; 
  t.style.opacity = '0'; 
  t.style.transform = 'translateY(-10px)'; 
  t.innerText = msg;
  c.appendChild(t); 
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 2500);
}

function showConfirm(title, message, onConfirm, type) {
  document.getElementById('confirmTitle').innerText = title; 
  document.getElementById('confirmMessage').innerText = message;
  pendingConfirmCallback = onConfirm;
  const isDanger = type !== 'info';
  const btn = document.getElementById('confirmYesBtn');
  const iconWrap = document.getElementById('confirmIconWrap');
  const icon = document.getElementById('confirmIcon');
  if (btn) btn.style.backgroundColor = isDanger ? '#EF4444' : 'var(--accent)';
  if (iconWrap) iconWrap.style.backgroundColor = isDanger ? 'rgba(239,68,68,0.1)' : 'var(--accent-glow)';
  if (icon) { 
    icon.className = 'w-7 h-7 ' + (isDanger ? 'text-red-500' : ''); 
    icon.style.color = isDanger ? '' : 'var(--accent)'; 
    icon.setAttribute('data-lucide', isDanger ? 'alert-triangle' : 'sparkles'); 
  }
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

function closeConfirmModal() { 
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.add('hidden'); 
  pendingConfirmCallback = null; 
}

function confirmYes() { 
  const cb = pendingConfirmCallback; 
  closeConfirmModal(); 
  if (cb) cb(); 
}

function refreshAppCache() {
  showConfirm("Refresh App Cache?", "This will clear old cached files and reload the app. Your data (logs, settings) will NOT be lost.", () => {
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        if (navigator.serviceWorker) {
          navigator.serviceWorker.getRegistrations().then(regs => { regs.forEach(r => r.unregister()); });
        }
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  }, 'info');
}

// --- PIN Management ---
function enterPin(n) {
  if (enteredPin.length < 4) { 
    enteredPin += n; 
    document.querySelectorAll('.pin-dot').forEach((el, i) => { 
      el.classList.toggle('bg-gray-400', i < enteredPin.length); 
      el.classList.toggle('bg-gray-500', i >= enteredPin.length); 
    }); 
  }
  if (enteredPin.length === 4) { 
    const pinCheck = enteredPin; 
    setTimeout(() => { 
      if (hashPin(pinCheck) === storedPinHash) { 
        document.getElementById('lockScreen').classList.add('hidden'); 
        bootCore(); 
      } else { 
        showToast("Wrong PIN"); 
        shakePinDots(); 
        clearPin(); 
      } 
    }, 200); 
  }
}

function clearPin() { 
  enteredPin = ""; 
  document.querySelectorAll('.pin-dot').forEach(el => { el.classList.remove('bg-gray-400'); el.classList.add('bg-gray-500'); }); 
}

function shakePinDots() { 
  const d = document.getElementById('pinDots'); 
  if (!d) return; 
  d.classList.add('shake-anim'); 
  setTimeout(() => d.classList.remove('shake-anim'), 400); 
}

function setupPin() { 
  if (hasPin) { 
    showConfirm("Remove PIN?", "You won't need a PIN to open the app anymore.", () => { 
      localStorage.removeItem('smoke_pin_hash'); 
      hasPin = false; 
      storedPinHash = null; 
      location.reload(); 
    }); 
  } else { 
    const inp = document.getElementById('pinSetupInput'); 
    if (inp) inp.value = ''; 
    const err = document.getElementById('pinSetupError');
    if (err) err.classList.add('hidden'); 
    const modal = document.getElementById('pinSetupModal');
    if (modal) modal.classList.remove('hidden'); 
    setTimeout(() => { if (inp) { inp.focus({ preventScroll: true }); if (inp.click) inp.click(); } }, 300); 
  } 
}

function closePinSetupModal() { 
  const modal = document.getElementById('pinSetupModal');
  if (modal) modal.classList.add('hidden'); 
}

function savePinSetup() { 
  const inp = document.getElementById('pinSetupInput');
  const p = inp ? inp.value : ''; 
  if (/^\d{4}$/.test(p)) { 
    localStorage.setItem('smoke_pin_hash', hashPin(p)); 
    hasPin = true; 
    storedPinHash = hashPin(p); 
    closePinSetupModal(); 
    const btn = document.getElementById('pinStatusBtn');
    if (btn) btn.innerText = "Remove PIN"; 
    showToast("PIN saved"); 
  } else { 
    const err = document.getElementById('pinSetupError');
    if (err) err.classList.remove('hidden'); 
  } 
}

// --- Themes & Settings ---
function applyTheme(t) { 
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim(); 
  document.documentElement.className = document.documentElement.className.replace(/theme-\w+/g, '').trim(); 
  if (t !== 'default') { 
    document.body.classList.add(`theme-${t}`); 
    document.documentElement.classList.add(`theme-${t}`); 
  }
  const metaTheme = document.getElementById('theme-color-meta');
  if (metaTheme) metaTheme.setAttribute('content', THEME_META_COLORS[t] || THEME_META_COLORS.white);
}

function updateSettings() {
  settings.theme = document.getElementById('themeSelect').value; 
  settings.timeFormat = document.getElementById('timeFormatSelect').value; 
  settings.currency = document.getElementById('currencySelect').value;
  settings.dailyLimit = Math.max(1, Math.min(100, parseInt(document.getElementById('dailyLimitInput').value) || 15));
  settings.packPrice = Math.max(0, Math.min(9999, parseFloat(document.getElementById('packPriceInput').value) || 0));
  settings.packSize = Math.max(1, Math.min(100, parseInt(document.getElementById('packSizeInput').value) || 20));
  settings.lockSecs = parseInt(document.getElementById('lockSecsInput').value) || 300; 
  settings.haptics = document.getElementById('hapticsInput').checked;
  settings.motivation = document.getElementById('motivationInput').value.substring(0, 100);
  
  const prevAutoReduce = settings.autoReduce;
  settings.autoReduce = document.getElementById('autoReduceInput').checked;
  if (settings.autoReduce && !prevAutoReduce) {
    localStorage.setItem('smoke_last_reduce_date', new Date().toDateString());
  }
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  if (window.posthog) posthog.capture('settings_updated', { theme: settings.theme, dailyLimit: settings.dailyLimit, autoReduce: settings.autoReduce });
  
  applyTheme(settings.theme); 
  updateCostPerCigDisplay();
  try { updateUI(); } catch(err){}
  if (!document.getElementById('page-insights').classList.contains('hidden')) renderAllCharts();
  if (!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList');
}

function updateCostPerCigDisplay() { 
  const el = document.getElementById('costPerCigDisplay'); 
  if (el) el.innerText = `${settings.currency} ${(settings.packPrice / settings.packSize).toFixed(2)}`; 
}

function updateQuitDate() {
  const el = document.getElementById('quitDateInput');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  el.max = today;
  if (el.value && el.value > today) el.value = today;
  settings.quitDate = el.value || '';
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  showToast(settings.quitDate ? `Quit date set for ${settings.quitDate}` : 'Quit date cleared');
}

function resetSettings() {
  if (!confirm('Reset all settings to defaults? Your logs and progress will be kept.')) return;
  const keepLogs = { quitDate: settings.quitDate };
  settings = Object.assign({}, DEFAULT_SETTINGS, keepLogs);
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  location.reload();
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

function requestNotifPermission() {
  if (typeof Notification === 'undefined') { showToast("Notifications not supported in browser"); return; }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') showToast("Smart Reminders Enabled! 🔔");
    else showToast("Notification Permission Denied");
  });
}

function toggleNotifSetting(key) {
  const el = document.getElementById(key + 'Input');
  if (!el) return;
  settings[key] = el.checked;
  localStorage.setItem('smoke_settings', JSON.stringify(settings));
  if (el.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    requestNotifPermission();
  }
}

function addCustomTrigger() { 
  let val = document.getElementById('newTriggerInput').value.trim(); 
  if (val && !triggers.includes(val)) { 
    triggers.push(val); 
    localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); 
    document.getElementById('newTriggerInput').value = ''; 
    renderTriggerSettingsList(); 
    const filterSelect = document.getElementById('historyTagFilter'); 
    if (filterSelect) filterSelect.innerHTML += `<option value="${esc(val)}">${esc(val)}</option>`;
  } 
}

function removeCustomTrigger(idx) { 
  triggers.splice(idx, 1); 
  localStorage.setItem('smoke_triggers', JSON.stringify(triggers)); 
  renderTriggerSettingsList(); 
}

function renderTriggerSettingsList() { 
  const c = document.getElementById('triggerListSettings'); 
  if (!c) return; 
  c.innerHTML = triggers.map((t, idx) => `<span class="text-xs px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-medium" style="background-color: var(--input-bg); color: var(--text-main); border-color: var(--card-border);">${esc(t)} <button onclick="window.removeCustomTrigger(${idx})" class="text-red-500 font-bold hover:opacity-80">✕</button></span>`).join(''); 
}

// --- Data Export & Backup ---
function exportJSON() {
  if (!logs || logs.length === 0) { showToast("No data to backup yet."); return; }
  const data = { logs, settings, triggers, waves, version: '1.6' };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); 
  const url = URL.createObjectURL(blob); 
  const link = document.createElement("a"); 
  link.setAttribute("href", url); 
  link.setAttribute("download", `SmokeGap_Backup_${new Date().toISOString().slice(0,10)}.json`); 
  document.body.appendChild(link); 
  link.click(); 
  document.body.removeChild(link); 
  URL.revokeObjectURL(url);
  localStorage.setItem('smoke_last_backup', new Date().getTime().toString());
  const banner = document.getElementById('backupReminderBanner'); 
  if (banner) banner.classList.add('hidden');
  showToast("Backup downloaded ✅");
}

function importJSON(event) {
  const file = event.target.files && event.target.files[0]; 
  if (!file) return;
  showToast("Restoring data, please wait...");
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !Array.isArray(data.logs)) { showToast("Invalid backup file"); return; }
      showConfirm("Restore this backup?", `This will replace your current data with ${data.logs.length} logs from the backup file. This cannot be undone.`, () => {
        localStorage.setItem('smoke_logs', JSON.stringify(data.logs));
        if (Array.isArray(data.waves)) localStorage.setItem('smoke_waves', JSON.stringify(data.waves));
        if (Array.isArray(data.triggers)) localStorage.setItem('smoke_triggers', JSON.stringify(data.triggers));
        if (data.settings) localStorage.setItem('smoke_settings', JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, data.settings)));
        localStorage.setItem('smoke_last_backup', new Date().getTime().toString());
        location.reload();
      });
    } catch(err) { showToast("Could not read that file"); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function checkBackupReminder() {
  const banner = document.getElementById('backupReminderBanner'); 
  if (!banner) return;
  if (!logs || logs.length < 10) { banner.classList.add('hidden'); return; }
  const lastBackup = parseInt(localStorage.getItem('smoke_last_backup'));
  const daysSince = lastBackup ? Math.floor((new Date().getTime() - lastBackup) / 86400000) : Infinity;
  if (daysSince >= 7) {
    const textEl = document.getElementById('backupReminderText');
    if (textEl) textEl.innerText = lastBackup ? `Last backup: ${daysSince} days ago` : "You haven't backed up your data yet";
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}

function resetData(type) { 
  if (type === '24h') { 
    showConfirm("Delete last 24h logs?", "This will permanently remove cigarette logs from the last 24 hours. Your Shield achievements are never affected.", () => { 
      const now = new Date().getTime(); 
      logs = logs.filter(l => (now - l.timestamp) > 86400000); 
      localStorage.setItem('smoke_logs', JSON.stringify(logs)); 
      location.reload(); 
    }); 
  } else { 
    showConfirm("Wipe ALL data?", "This cannot be undone. All logs, settings, and tags will be erased.", () => { 
      localStorage.clear(); 
      location.reload(); 
    }); 
  }
}

function exportLogsCSV() {
  if (!logs || logs.length === 0) { showToast("No logs to export yet"); return; }
  let csvContent = "Timestamp,Date,Time,Gap_Minutes,Tags,Intensity,Latitude,Longitude\n";
  logs.forEach(l => {
    let d = new Date(l.timestamp); 
    let tagsArr = (Array.isArray(l.tags) && l.tags.length > 0) ? l.tags : (l.trigger ? [l.trigger] : ['Uncategorized']);
    let tagsStr = tagsArr.join(' | ');
    csvContent += `${l.timestamp},"${d.toLocaleDateString()}","${formatAppTime(d)}",${l.gap ?? ''},"${tagsStr}",${l.intensity||3},${l.lat||''},${l.lng||''}\n`;
  });
  let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
  let url = URL.createObjectURL(blob); 
  let link = document.createElement("a"); 
  link.setAttribute("href", url); 
  link.setAttribute("download", `SmokeGap_Logs_${new Date().toISOString().slice(0,10)}.csv`); 
  document.body.appendChild(link); 
  link.click(); 
  document.body.removeChild(link); 
  URL.revokeObjectURL(url);
}

// --- History & Editing ---
function setEditIntensity(val) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10); 
  currentIntensity = val;
  applyIntensityStyling(val, 'editInt', 'w-10 h-10');
  const lbl = document.getElementById('editIntensityLabel'); 
  if (lbl) lbl.innerText = INTENSITY_LABELS[val];
}

function openTriggerModal(logIdx = null) {
  try {
    editingLogIdx = logIdx !== null ? logIdx : logs.length - 1;
    const log = logs[editingLogIdx]; 
    if (!log) return;
    
    currentSelectedTags = (Array.isArray(log.tags) && log.tags.length > 0) ? [...log.tags] : (log.trigger ? [log.trigger] : []);
    currentMood = (moodDefFor(log.mood) || {}).id || log.mood || null;
    
    setEditIntensity(log.intensity || 3);
    const d = new Date(log.timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');

    const dateInput = document.getElementById('editLogDate');
    const timeInput = document.getElementById('editLogTime');
    if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
    if (timeInput) timeInput.value = `${hh}:${min}`;

    const noteInput = document.getElementById('editLogNote');
    const noteCounter = document.getElementById('editLogNoteCounter');
    if (noteInput) noteInput.value = log.note || '';
    if (noteCounter) noteCounter.innerText = `${(log.note || '').length}/200`;

    renderModalTriggerGrid();
    renderEditMood();
    const modal = document.getElementById('triggerModal');
    if (modal) modal.classList.remove('hidden');
    refreshIcons();
  } catch(e) { 
    console.error("openTriggerModal Error:", e); 
  }
}

function renderModalTriggerGrid() {
  const grid = document.getElementById('modalTriggerGrid'); 
  if (!grid) return;
  grid.innerHTML = triggers.map((t, idx) => {
    const isSelected = currentSelectedTags.includes(t);
    const bgClass = isSelected ? 'text-white border-sky-400' : 'border-transparent';
    const inlineStyle = isSelected ? `style="background: var(--accent); box-shadow: 0 4px 15px var(--accent-glow);"` : `style="background: var(--input-bg); color: var(--text-main); border-color: var(--card-border);"`;
    return `<button onclick="window.toggleTag(${idx})" class="px-4 py-2.5 rounded-full text-xs font-semibold active:scale-95 transition-all border ${bgClass}" ${inlineStyle}>${esc(t)}</button>`;
  }).join('');
}

function toggleTag(idx) { 
  const t = triggers[idx]; 
  if (currentSelectedTags.includes(t)) currentSelectedTags = currentSelectedTags.filter(tag => tag !== t); 
  else currentSelectedTags.push(t); 
  renderModalTriggerGrid(); 
}

function saveTags() {
  if (editingLogIdx !== null && logs[editingLogIdx]) {
    const dateVal = document.getElementById('editLogDate').value; 
    const timeVal = document.getElementById('editLogTime').value;
    if (dateVal && timeVal) { 
      const dt = new Date(`${dateVal}T${timeVal}`); 
      if (!isNaN(dt.getTime())) logs[editingLogIdx].timestamp = dt.getTime(); 
    }
    logs[editingLogIdx].tags = [...currentSelectedTags]; 
    logs[editingLogIdx].intensity = currentIntensity; 
    logs[editingLogIdx].mood = currentMood;
    const noteEl = document.getElementById('editLogNote');
    if (noteEl) logs[editingLogIdx].note = noteEl.value.trim().substring(0, 200);
    logs.sort((a,b) => a.timestamp - b.timestamp);
    for (let i = 0; i < logs.length; i++) { logs[i].gap = i > 0 ? Math.round((logs[i].timestamp - logs[i-1].timestamp)/60000) : null; }
    localStorage.setItem('smoke_logs', JSON.stringify(logs));
    try { updateUI(); } catch(err){}
    if (!document.getElementById('page-history').classList.contains('hidden')) renderHistory('fullHistoryList'); 
    if (!document.getElementById('page-insights').classList.contains('hidden')) requestAnimationFrame(() => renderAllCharts());
  }
  closeTriggerModal();
}

function deleteCurrentLog() {
  showConfirm("Delete this log?", "This action cannot be undone.", () => {
    if (editingLogIdx !== null && logs[editingLogIdx]) {
      undoLog(editingLogIdx, null);
      closeTriggerModal();
      showToast("Log deleted permanently.");
    }
  });
}

function closeTriggerModal() { 
  const modal = document.getElementById('triggerModal');
  if (modal) modal.classList.add('hidden'); 
}

function toggleHistoryClearBtn() {
  const searchVal = document.getElementById('historySearch')?.value.trim() || '';
  const fromVal = document.getElementById('historyDateFrom')?.value || '';
  const toVal = document.getElementById('historyDateTo')?.value || '';
  const btn = document.getElementById('historyClearFilters');
  if (btn) btn.classList.toggle('hidden', !(searchVal || fromVal || toVal));
  renderHistory('fullHistoryList');
}

function clearHistoryFilters() {
  const search = document.getElementById('historySearch');
  const from = document.getElementById('historyDateFrom');
  const to = document.getElementById('historyDateTo');
  const btn = document.getElementById('historyClearFilters');
  if (search) search.value = '';
  if (from) from.value = '';
  if (to) to.value = '';
  if (btn) btn.classList.add('hidden');
  renderHistory('fullHistoryList');
}

function loadMoreHistory() {
  historyRenderLimit += 30;
  renderHistory('fullHistoryList');
}

function renderHistory(tId = 'fullHistoryList', homeLimit = 3) {
  try {
    const c = document.getElementById(tId); 
    if (!c) return;
    if (!logs || logs.length === 0) { 
      c.innerHTML = "<p class='text-center py-6 text-xs flex flex-col items-center gap-2' style='color: var(--text-muted);'><i data-lucide='inbox' class='w-6 h-6 opacity-50'></i> No logs recorded yet.</p>"; 
      refreshIcons(); 
      return; 
    }

    let filteredLogs = logs.map((l, i) => ({ ...l, origIdx: i })).reverse();

    let searchVal = '';
    if (tId === 'fullHistoryList') {
      const searchInput = document.getElementById('historySearch');
      searchVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
      if (searchVal) {
        filteredLogs = filteredLogs.filter(l => {
          let tagsArr = (Array.isArray(l.tags) && l.tags.length > 0) ? l.tags : (l.trigger ? [l.trigger] : []);
          const tagsText = tagsArr.join(' ').toLowerCase();
          const dateText = l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }).toLowerCase() : '';
          const timeText = l.timestamp ? formatAppTime(new Date(l.timestamp)).toLowerCase() : '';
          return tagsText.includes(searchVal) || dateText.includes(searchVal) || timeText.includes(searchVal);
        });
      }

      const fromInput = document.getElementById('historyDateFrom');
      const toInput = document.getElementById('historyDateTo');
      const fromVal = fromInput ? fromInput.value : '';
      const toVal = toInput ? toInput.value : '';
      if (fromVal) filteredLogs = filteredLogs.filter(l => l.timestamp >= new Date(fromVal + 'T00:00:00').getTime());
      if (toVal) filteredLogs = filteredLogs.filter(l => l.timestamp <= new Date(toVal + 'T23:59:59').getTime());
    }

    const filterSelect = document.getElementById('historyTagFilter');
    if (filterSelect && tId === 'fullHistoryList' && filterSelect.value !== 'all') {
      filteredLogs = filteredLogs.filter(l => {
        let tagsArr = (Array.isArray(l.tags) && l.tags.length > 0) ? l.tags : (l.trigger ? [l.trigger] : []);
        return tagsArr.includes(filterSelect.value);
      });
    }

    if (filteredLogs.length === 0) {
      const isFiltered = searchVal || (document.getElementById('historyDateFrom') && document.getElementById('historyDateFrom').value) || (document.getElementById('historyDateTo') && document.getElementById('historyDateTo').value) || (document.getElementById('historyTagFilter') && document.getElementById('historyTagFilter').value !== 'all');
      if (isFiltered) {
        c.innerHTML = `<div class="premium-card p-6 text-center space-y-2"><div class="w-10 h-10 rounded-2xl mx-auto flex items-center justify-center" style="background: rgba(245,158,11,0.1);"><i data-lucide="filter" class="w-5 h-5" style="color: var(--accent);"></i></div><p class="text-xs font-bold" style="color: var(--text-main);">No Matches</p><p class="text-[11px]" style="color: var(--text-muted);">No logs match your filters. Try adjusting the date range or search.</p></div>`;
      } else {
        c.innerHTML = `<div class="premium-card p-6 text-center space-y-2"><div class="w-10 h-10 rounded-2xl mx-auto flex items-center justify-center" style="background: var(--accent-glow);"><i data-lucide="inbox" class="w-5 h-5" style="color: var(--accent);"></i></div><p class="text-xs font-bold" style="color: var(--text-main);">No Logs Yet</p><p class="text-[11px]" style="color: var(--text-muted);">Your first log hasn't happened yet. Every stick counted brings clarity.</p></div>`;
      }
      const btnBox = document.getElementById('historyLoadMore');
      if (btnBox) btnBox.classList.add('hidden');
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
      c.innerHTML = mappedLogs.map(l => renderHistoryItem(l)).join(''); 
    } else {
      let groups = {};
      mappedLogs.forEach(l => { const k = new Date(l.timestamp).toDateString(); if (!groups[k]) groups[k] = []; groups[k].push(l); });
      const todayStr = new Date().toDateString(); 
      let yest = new Date(); yest.setDate(yest.getDate() - 1); 
      const yestStr = yest.toDateString();
      let html = '';
      for (let k in groups) {
        let headerLabel = k;
        if (k === todayStr) headerLabel = 'TODAY'; 
        else if (k === yestStr) headerLabel = 'YESTERDAY';
        else { 
          const d = new Date(k); 
          headerLabel = `${d.toLocaleDateString('en-US', {weekday:'short'}).toUpperCase()}, ${d.toLocaleDateString('en-US', {month:'short', day:'numeric'}).toUpperCase()}`; 
        }
        html += `<div class="pt-4 pb-1 flex items-center justify-between"><h4 class="text-[10px] font-bold uppercase tracking-widest text-gray-500">${headerLabel}</h4><span class="text-xs font-black px-2.5 py-1 rounded-full" style="background: var(--input-bg); color: var(--accent);">${groups[k].length} ${groups[k].length === 1 ? 'cig' : 'cigs'}</span></div>`;
        html += `<div class="space-y-3">` + groups[k].map(l => renderHistoryItem(l)).join('') + `</div>`;
      }
      c.innerHTML = html;
    }
    refreshIcons();
  } catch (err) { 
    console.error("renderHistory Error", err); 
  }
}

function renderHistoryItem(l) {
  const prev = l.origIdx > 0 ? logs[l.origIdx - 1] : null;
  let trendClass = 'bg-gray-500/10 text-gray-400', trendIcon = 'minus', valueColor = 'var(--accent)';
  if (l.gap !== null && l.gap !== undefined && prev && prev.gap !== null && prev.gap !== undefined) {
    if (l.gap > prev.gap) { trendClass = 'bg-emerald-500/10 text-emerald-500'; trendIcon = 'trending-up'; valueColor = '#10B981'; }
    else if (l.gap < prev.gap) { trendClass = 'bg-red-500/10 text-red-500'; trendIcon = 'trending-down'; valueColor = '#EF4444'; }
  }
  
  let tagsArr = (Array.isArray(l.tags) && l.tags.length > 0) ? l.tags : (l.trigger ? [l.trigger] : ['Uncategorized']);
  const visibleTags = tagsArr.slice(0, 2).map(esc).join(', ');
  const extraCount = tagsArr.length - 2; 
  const tagsDisplay = extraCount > 0 ? `${visibleTags} <span class="opacity-60">+${extraCount} more</span>` : visibleTags;
  
  let intensityDots = ''; 
  let intVal = l.intensity || 3;
  for (let i = 1; i <= 5; i++) { 
    intensityDots += `<div class="w-1.5 h-1.5 rounded-full" style="background-color: ${i <= intVal ? 'var(--accent)' : 'rgba(156,163,175,0.2)'};"></div>`; 
  }

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

function deleteLogFromHistory(idx) {
  if (logs[idx]) {
    showConfirm("Delete this log?", "This cannot be undone.", () => {
      const deletedLog = logs[idx];
      undoLog(idx, null);
      renderHistory('fullHistoryList');

      const c = document.getElementById('toastContainer'); 
      if (!c) return;
      const t = document.createElement('div');
      t.className = 'premium-card px-4 py-3 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300 flex items-center gap-3 border border-gray-500/20';
      t.style.background = 'var(--card-bg)';
      t.innerHTML = `<span class="flex items-center gap-1.5" style="color: var(--text-main);"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-red-400"></i> Deleted</span><div class="w-px h-3 bg-gray-500/30"></div><button onclick="window.restoreDeletedLog(this)" data-log='${JSON.stringify(deletedLog).replace(/'/g, "&#39;")}' class="text-sky-500 active:scale-95 transition-transform uppercase tracking-wider">Undo</button>`;
      t.style.opacity = '0'; 
      t.style.transform = 'translateY(-10px)';
      c.appendChild(t); 
      refreshIcons();
      requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
      const autoHide = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 5000);
      t.dataset.timerId = autoHide;
    });
  }
}

function restoreDeletedLog(btn) {
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

// --- Photos Management ---
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

function handlePhotoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (progressPhotos.length >= 5) { showToast('Maximum 5 photos allowed.'); e.target.value = ''; return; }
  compressImage(file, 800, 800, 0.7, function(dataUrl) {
    progressPhotos.push({ id: Date.now(), dataUrl: dataUrl, timestamp: Date.now() });
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

function openPhotoViewer(id) {
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

function closePhotoViewer() {
  const modal = document.getElementById('photoViewerModal');
  if (modal) modal.classList.add('hidden');
  const img = document.getElementById('photoViewerImage');
  if (img) img.src = '';
}

function deleteViewedPhoto() {
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

// --- Health Timeline ---
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
  timeline.innerHTML = HEALTH_MILESTONES.map((m) => {
    const isUnlocked = bestGapMins >= m.mins;
    if (isUnlocked) unlocked++;
    const progress = isUnlocked ? 100 : Math.min(100, (bestGapMins / m.mins) * 100);
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

function openHealthTimeline() {
  try { renderHealthTimeline(); } catch(e) {}
  const modal = document.getElementById('healthTimelineModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

function closeHealthTimeline() {
  const modal = document.getElementById('healthTimelineModal');
  if (modal) modal.classList.add('hidden');
}

// --- Money Visualizer ---
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
  
  grid.innerHTML = MONEY_EQUIVALENTS.map(eq => {
    const count = Math.floor(total / eq.price);
    return `<div class="money-equiv-item">
      <span class="money-equiv-icon">${eq.emoji}</span>
      <span class="money-equiv-count">${count}</span>
      <span class="money-equiv-label">${eq.label}</span>
    </div>`;
  }).join('');

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

function openMoneyVisualizer() {
  renderMoneyVisualizer();
  const modal = document.getElementById('moneyVisualizerModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

function closeMoneyVisualizer() {
  const modal = document.getElementById('moneyVisualizerModal');
  if (modal) modal.classList.add('hidden');
}

function saveGoalSettings() {
  const name = (document.getElementById('goalItemName').value || '').trim();
  const target = parseFloat(document.getElementById('goalTargetAmount').value) || 0;
  localStorage.setItem('smoke_savings_goal', JSON.stringify({ name, target }));
  renderMoneyVisualizer();
  showToast('Goal saved');
}

// --- Breathing Exercises ---
function vibratePattern(pattern) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

function runBreathPhase(exercise, phase, callback) {
  if (!breathActive || breathPaused) return;
  const circle = document.getElementById('breathCircle');
  const phaseText = document.getElementById('breathPhaseText');
  const timerText = document.getElementById('breathTimerText');
  const cycleInfo = document.getElementById('breathCycleInfo');

  let duration = 0;
  let label = '';
  let circleClass = '';

  if (phase === 'inhale') {
    duration = exercise.inhale * 1000; 
    label = 'Breathe In'; 
    circleClass = 'breath-circle-inhale';
    circle.style.setProperty('--breath-inhale', exercise.inhale + 's');
  } else if (phase === 'hold') {
    duration = exercise.hold * 1000; 
    label = 'Hold'; 
    circleClass = 'breath-circle-hold';
    circle.style.setProperty('--breath-hold', exercise.hold + 's');
  } else if (phase === 'exhale') {
    duration = exercise.exhale * 1000; 
    label = 'Breathe Out'; 
    circleClass = 'breath-circle-exhale';
    circle.style.setProperty('--breath-exhale', exercise.exhale + 's');
    breathCycleCount++;
  }

  if (phaseText) phaseText.innerText = label;
  if (cycleInfo) cycleInfo.innerText = `Cycle ${Math.min(breathCycleCount + 1, exercise.cycles)} of ${exercise.cycles}`;

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

    let nextPhase;
    if (phase === 'inhale') nextPhase = exercise.hold > 0 ? 'hold' : 'exhale';
    else if (phase === 'hold') nextPhase = 'exhale';
    else if (phase === 'exhale') {
      if (breathCycleCount >= exercise.cycles) {
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

function openBreathingModal() {
  const modal = document.getElementById('breathingModal');
  if (modal) modal.classList.remove('hidden');
  const sel = document.getElementById('breathSelector');
  if (sel) sel.classList.remove('hidden');
  const act = document.getElementById('breathActive');
  if (act) act.classList.add('hidden');
  refreshIcons();
}

function closeBreathingModal() {
  breathActive = false; 
  breathPaused = false;
  clearTimeout(breathTimeout); 
  clearInterval(breathInterval);
  const modal = document.getElementById('breathingModal');
  if (modal) modal.classList.add('hidden');
}

function selectBreathing(type) {
  if (type === 'wave') {
    closeBreathingModal();
    openWaveModal();
    return;
  }

  const exercise = BREATHING_EXERCISES[type];
  if (!exercise) return;

  breathActive = true;
  breathPaused = false;
  breathCycleCount = 0;
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
}

function toggleBreathPause() {
  if (!breathActive) return;
  breathPaused = !breathPaused;
  const btn = document.getElementById('breathPauseBtn');
  if (btn) btn.innerText = breathPaused ? 'Resume' : 'Pause';

  if (breathPaused) {
    clearTimeout(breathTimeout); 
    clearInterval(breathInterval);
  } else if (breathCurrentExercise) {
    const circle = document.getElementById('breathCircle');
    let phase = 'inhale';
    if (circle.classList.contains('breath-circle-hold')) phase = 'hold';
    else if (circle.classList.contains('breath-circle-exhale')) phase = 'exhale';
    runBreathPhase(breathCurrentExercise, phase);
  }
}

function stopBreathing() {
  breathActive = false; 
  breathPaused = false;
  clearTimeout(breathTimeout); 
  clearInterval(breathInterval);
  document.getElementById('breathSelector').classList.remove('hidden');
  document.getElementById('breathActive').classList.add('hidden');
  const circle = document.getElementById('breathCircle');
  const phaseText = document.getElementById('breathPhaseText');
  if (circle) circle.className = 'breath-circle mb-4';
  if (phaseText) phaseText.style.color = '';
}

// --- Onboarding Setup ---
function onboardAdjustSticks(delta) {
  onboardSticks = Math.max(1, Math.min(80, onboardSticks + delta));
  const el = document.getElementById('onboardSticksCount');
  if (el) el.innerText = onboardSticks;
  if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
}

function onboardSelectGoal(goal) {
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
}

function updateOnboardCostPerCig() {
  const price = parseFloat(document.getElementById('onboardPackPrice').value) || 20;
  const size = parseInt(document.getElementById('onboardPackSize').value) || 20;
  const cur = document.getElementById('onboardCurrencySelect').value || 'AED';
  const cost = size > 0 ? (price / size).toFixed(1) : '0';
  const label = document.getElementById('onboardCostPerCig');
  if (label) label.innerText = `${cur} ${cost}`;
}

function initOnboardingSetup() {
  onboardSticks = Math.max(1, Math.min(80, settings.dailyLimit || 10));
  const sticksEl = document.getElementById('onboardSticksCount');
  if (sticksEl) sticksEl.innerText = onboardSticks;
  const curEl = document.getElementById('onboardCurrencySelect');
  if (curEl) curEl.value = settings.currency || 'AED';
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
    if (quitDate) settings.quitDate = quitDate;
  } else if (onboardGoal === 'reduce') {
    settings.autoReduce = true;
  } else {
    settings.autoReduce = false;
  }

  localStorage.setItem('smoke_settings', JSON.stringify(settings));
}

function showOnboarding() {
  document.getElementById('onboardingOverlay').classList.remove('hidden');
  initOnboardingSetup();
  refreshIcons();
}

function onboardingNext() {
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
      const skipBtn = document.getElementById('onboardSkipBtn');
      if (skipBtn) skipBtn.style.display = 'none';
    }
    const nextBtn = document.getElementById('onboardNextBtn');
    if (nextBtn) {
      nextBtn.innerText = onboardingStep === 8 ? 'Get Started' : 'Next';
    }
  } else {
    saveOnboardingSetup();
    finishOnboarding();
  }
}

function onboardingSkip() {
  finishOnboarding();
}

function restartOnboarding() {
  localStorage.removeItem('smoke_onboarding_done');
  location.reload();
}

function finishOnboarding() {
  if (onboardingStep >= 5) saveOnboardingSetup();
  localStorage.setItem('smoke_onboarding_done', 'true');
  document.getElementById('onboardingOverlay').classList.add('hidden');
  if (hasPin) {
    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('pinStatusBtn').innerText = "Remove PIN";
  } else {
    bootCore();
  }
}

// --- Daily Micro-Challenge ---
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

function completeDailyChallenge() {
  if (challengeCompleted || !todaysChallenge) return;

  challengeCompleted = true;
  const todayKey = new Date().toDateString();
  const completedChallenges = JSON.parse(localStorage.getItem('smoke_completed_challenges') || '{}');
  completedChallenges[todayKey] = true;
  localStorage.setItem('smoke_completed_challenges', JSON.stringify(completedChallenges));

  waves.push(Date.now());
  localStorage.setItem('smoke_waves', JSON.stringify(waves));

  const completeBtn = document.getElementById('challengeCompleteBtn');
  const completedMsg = document.getElementById('challengeCompletedMsg');
  if (completeBtn) completeBtn.style.display = 'none';
  if (completedMsg) completedMsg.classList.remove('hidden');

  showToast('Challenge completed! +1 Shield');
  spawnConfetti();
  if (window.posthog) posthog.capture('daily_challenge_completed', { challenge: todaysChallenge.text });
  try { updateUI(); } catch(e) {}
  celebrateBadgeIfUnlocked();
}

// --- Pattern Intelligence ---
function periodForHour(h) {
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 21) return 'Evening';
  return 'Night';
}

function getThisWeekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
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

  const recentLogs = logs.filter(l => l.timestamp);
  if (recentLogs.length < 4) { card.classList.add('hidden'); return; }

  const today = new Date();
  const nowMs = today.getTime();
  const thirtyDays = 30 * 86400000;

  // Weekly Comparison
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
  if (arrowEl) {
    arrowEl.innerText = thisWeekCount <= lastWeekCount ? '↓' : '↑';
    arrowEl.style.color = thisWeekCount <= lastWeekCount ? '#10B981' : '#EF4444';
  }

  // Day of Week
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

  // Mood Triggers
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

  // Risk Zones
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

  // Trigger Trends
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
      trendEl.innerHTML = `<p class="text-[9px] font-bold" style="color: #10B981;">✓ No triggers escalating this week. Keep it up!</p>`;
    }
  }

  // Hero Summary
  const tagCounts = {};
  recentLogs.forEach(l => {
    const tags = (l.tags && l.tags.length ? l.tags : (l.trigger ? [l.trigger] : [])).filter(Boolean);
    tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
  });
  const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
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
      const topPct = Math.round((top[1] / Math.max(1, recentLogs.length)) * 100);
      heroEl.innerText = `Your top trigger is ${esc(top[0])} — it drives ${topPct}% of your smoking.`;
    } else {
      heroEl.innerText = 'Patterns will appear as you log.';
    }
  }

  card.classList.remove('hidden');
  refreshIcons();
}

function openPatternIntel() {
  try { renderPatternIntel(); } catch(e) {}
  const modal = document.getElementById('patternIntelModal');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

function closePatternIntel() {
  const modal = document.getElementById('patternIntelModal');
  if (modal) modal.classList.add('hidden');
}

// --- App Core Bootstrapping ---
function bootCore() {
  switchWatchStyle(currentWatchStyle);
  initNavIndicator();

  const savedTab = localStorage.getItem('smoke_active_tab');
  if (savedTab && ['tracker','insights','history','settings'].includes(savedTab)) {
    switchTab(savedTab);
  }

  try { updateUI(); } catch(e) { console.error("updateUI error on boot", e); }
  checkLock(); 
  checkWave();
  setTimeout(() => showDailyRecap(), 1000);
  
  if (mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    try {
      checkPeakNudge();
      updateLastSmokeDisplay();

      if (!logs || logs.length === 0) return;
      const diff = new Date().getTime() - logs[logs.length-1].timestamp;
      const prevLog = logs[logs.length-1];
      const prevGapMs = prevLog.gap ? prevLog.gap * 60000 : 0;
      const allGaps = logs.map(l => l.gap).filter(g => g !== null && g !== undefined);
      const avgGapMs = allGaps.length ? (allGaps.reduce((a,b)=>a+b, 0) / allGaps.length) * 60000 : 3600000;

      if (prevGapMs > 0 && diff >= prevGapMs && !gapWidenedNotified) {
        gapWidenedNotified = true;
        localStorage.setItem('smoke_gap_widened_notified', 'true');
        sendSystemNotification("🎉 Gap Widened!", `Great progress! You just beat your previous gap (${formatGap(Math.round(prevGapMs/60000))}). You're setting a personal best.`, 'notifGapWidened');
        spawnConfetti();
      }
      if (avgGapMs > 0 && diff >= avgGapMs * 1.5 && waveEndTime <= 0 && !inactivityNotified) {
        inactivityNotified = true;
        sendSystemNotification("🚬 Did you forget to log?", "It's been longer than your average gap. Log your stick or keep widening the gap!", 'notifInactivity');
      }

      if (document.hidden) return; 
      updateHeroDisplay(diff, prevGapMs, avgGapMs);
    } catch(err) { 
      console.error('Main timer error:', err); 
    }
  }, 1000);
}

function bootApp() {
  if (hasAppBooted) return;
  hasAppBooted = true;

  applyTheme(settings.theme);
  try {
    const dLim = document.getElementById('dailyLimitInput'); if (dLim) dLim.value = settings.dailyLimit;
    const pPrice = document.getElementById('packPriceInput'); if (pPrice) pPrice.value = settings.packPrice;
    const pSize = document.getElementById('packSizeInput'); if (pSize) pSize.value = settings.packSize;
    const thm = document.getElementById('themeSelect'); if (thm) thm.value = settings.theme;
    const tf = document.getElementById('timeFormatSelect'); if (tf) tf.value = settings.timeFormat;
    const cur = document.getElementById('currencySelect'); if (cur) cur.value = settings.currency || 'AED';
    const lk = document.getElementById('lockSecsInput'); if (lk) lk.value = settings.lockSecs;
    const hap = document.getElementById('hapticsInput'); if (hap) hap.checked = settings.haptics;
    const mot = document.getElementById('motivationInput'); if (mot) mot.value = settings.motivation || '';
    const autoR = document.getElementById('autoReduceInput'); if (autoR) autoR.checked = settings.autoReduce || false;

    const notifKeys = ['notifWaveComplete', 'notifGapWidened', 'notifInactivity', 'notifPredictive', 'notifEnableSos'];
    notifKeys.forEach(k => {
      const el = document.getElementById(k + 'Input');
      if (el) el.checked = settings[k] !== false;
    });
  } catch(e) {}

  updateCostPerCigDisplay();

  const qdInput = document.getElementById('quitDateInput');
  if (qdInput) {
    qdInput.value = settings.quitDate || '';
    qdInput.max = new Date().toISOString().split('T')[0];
  }

  try { loadChartOrder(); } catch(e) {}
  try { initDragAndDrop(); } catch(e) {}
  renderTriggerSettingsList();
  
  const filterSelect = document.getElementById('historyTagFilter');
  if (filterSelect) {
    filterSelect.innerHTML = `<option value="all">All Tags</option>` + triggers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  refreshIcons();

  const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || document.referrer.includes('android-app://');
  const hideSkeleton = () => {
    const skel = document.getElementById('appSkeleton');
    if (skel) {
      if (isPWA) skel.remove();
      else {
        skel.style.opacity = '0';
        setTimeout(() => skel.remove(), 300);
      }
    }
  };

  if (isPWA) {
    const skel = document.getElementById('appSkeleton');
    if (skel) skel.remove();
  }

  const onboardingDone = localStorage.getItem('smoke_onboarding_done');
  if (!onboardingDone && logs.length === 0) {
    showOnboarding();
    hideSkeleton();
    return;
  }

  if (hasPin) {
    const lockScreen = document.getElementById('lockScreen');
    if (lockScreen) lockScreen.classList.remove('hidden');
    const pinStatusBtn = document.getElementById('pinStatusBtn');
    if (pinStatusBtn) pinStatusBtn.innerText = "Remove PIN";
    hideSkeleton();
  } else {
    bootCore();
    hideSkeleton();
  }
}

// --- Global Window Object Exports ---
window.touchStartX = touchStartX;
window.touchEndX = touchEndX;
window.switchWatchStyle = switchWatchStyle;
window.cycleNextWatch = cycleNextWatch;
window.startHold = startHold;
window.cancelHold = cancelHold;
window.handleLogClick = handleLogClick;
window.closeSosInterrupter = closeSosInterrupter;
window.setTakeoverIntensity = setTakeoverIntensity;
window.toggleTakeoverMood = toggleTakeoverMood;
window.toggleTakeoverTag = toggleTakeoverTag;
window.cancelSmokeTakeover = cancelSmokeTakeover;
window.closeSmokeTakeover = closeSmokeTakeover;
window.undoLog = undoLog;
window.openWaveModal = openWaveModal;
window.closeWaveModal = closeWaveModal;
window.startWave = startWave;
window.cancelActiveWave = cancelActiveWave;
window.switchTab = switchTab;
window.showToast = showToast;
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;
window.confirmYes = confirmYes;
window.refreshAppCache = refreshAppCache;
window.enterPin = enterPin;
window.clearPin = clearPin;
window.setupPin = setupPin;
window.closePinSetupModal = closePinSetupModal;
window.savePinSetup = savePinSetup;
window.updateSettings = updateSettings;
window.updateQuitDate = updateQuitDate;
window.resetSettings = resetSettings;
window.requestNotifPermission = requestNotifPermission;
window.toggleNotifSetting = toggleNotifSetting;
window.addCustomTrigger = addCustomTrigger;
window.removeCustomTrigger = removeCustomTrigger;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.resetData = resetData;
window.exportLogsCSV = exportLogsCSV;
window.setEditIntensity = setEditIntensity;
window.openTriggerModal = openTriggerModal;
window.toggleTag = toggleTag;
window.toggleEditMood = toggleEditMood;
window.saveTags = saveTags;
window.deleteCurrentLog = deleteCurrentLog;
window.closeTriggerModal = closeTriggerModal;
window.toggleHistoryClearBtn = toggleHistoryClearBtn;
window.clearHistoryFilters = clearHistoryFilters;
window.loadMoreHistory = loadMoreHistory;
window.renderHistory = renderHistory;
window.deleteLogFromHistory = deleteLogFromHistory;
window.restoreDeletedLog = restoreDeletedLog;
window.handlePhotoUpload = handlePhotoUpload;
window.openPhotoViewer = openPhotoViewer;
window.closePhotoViewer = closePhotoViewer;
window.deleteViewedPhoto = deleteViewedPhoto;
window.openHealthTimeline = openHealthTimeline;
window.closeHealthTimeline = closeHealthTimeline;
window.openMoneyVisualizer = openMoneyVisualizer;
window.closeMoneyVisualizer = closeMoneyVisualizer;
window.saveGoalSettings = saveGoalSettings;
window.openBreathingModal = openBreathingModal;
window.closeBreathingModal = closeBreathingModal;
window.selectBreathing = selectBreathing;
window.toggleBreathPause = toggleBreathPause;
window.stopBreathing = stopBreathing;
window.onboardAdjustSticks = onboardAdjustSticks;
window.onboardSelectGoal = onboardSelectGoal;
window.updateOnboardCostPerCig = updateOnboardCostPerCig;
window.onboardingNext = onboardingNext;
window.onboardingSkip = onboardingSkip;
window.restartOnboarding = restartOnboarding;
window.completeDailyChallenge = completeDailyChallenge;
window.openPatternIntel = openPatternIntel;
window.closePatternIntel = closePatternIntel;
window.shareProgress = shareProgress;
window.showShieldDashboard = showShieldDashboard;
window.closeShieldDashboard = closeShieldDashboard;
window.showStatDetail = showStatDetail;
window.closeStatDetail = closeStatDetail;
window.closeRelapseModal = closeRelapseModal;
window.startRelapseRecovery = startRelapseRecovery;
window.installApp = installApp;
window.toggleInsightsCustomRange = toggleInsightsCustomRange;
window.clearInsightsCustomRange = clearInsightsCustomRange;
window.validateInsightsDates = validateInsightsDates;
window.renderAllCharts = renderAllCharts;
window.openMapModal = openMapModal;
window.closeMapModal = closeMapModal;
window.bootApp = bootApp;

// Auto-register Service Worker
registerServiceWorker();
