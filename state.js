// ==================== STATE & STORAGE ====================
let logs = [];
try {
  let raw = localStorage.getItem('smoke_logs');
  if(raw) logs = JSON.parse(raw);
  if(!Array.isArray(logs)) logs = [];
} catch(e) { logs = []; }

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

let waves = [];
try { waves = JSON.parse(localStorage.getItem('smoke_waves')) || []; if(!Array.isArray(waves)) waves = []; } catch(e) { waves = []; }

let progressPhotos = [];
try { progressPhotos = JSON.parse(localStorage.getItem('smoke_progress_photos')) || []; if(!Array.isArray(progressPhotos)) progressPhotos = []; } catch(e) { progressPhotos = []; }

let waveAttempts = [];
try { waveAttempts = JSON.parse(localStorage.getItem('smoke_wave_attempts')) || []; if(!Array.isArray(waveAttempts)) waveAttempts = []; } catch(e) { waveAttempts = []; }

let lockEndTime = parseInt(localStorage.getItem('smoke_lock_end')) || 0;
let waveEndTime = parseInt(localStorage.getItem('smoke_wave_end')) || 0;
let waveDurationMs = parseInt(localStorage.getItem('smoke_wave_duration')) || 600000;
let lastPeakNudgeDate = localStorage.getItem('smoke_peak_nudge') || '';
let gapWidenedNotified = localStorage.getItem('smoke_gap_widened_notified') === 'true';
let inactivityNotified = false;

function hashPin(p) { let h = 0; for (let i = 0; i < p.length; i++) { h = ((h << 5) - h) + p.charCodeAt(i); h |= 0; } return h.toString(36); }
function esc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c])); }
function formatGap(m) { if (m === null || m === undefined || isNaN(m)) return '—'; if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h ${m % 60 > 0 ? (m % 60) + 'm' : ''}`.trim(); }
function formatAppTime(dateObj) { return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' }); }

let _lucideTimer = null;
function refreshIcons() {
  if (_lucideTimer) clearTimeout(_lucideTimer);
  _lucideTimer = setTimeout(() => {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }, 30);
}