// ==================== MODALS & WORKFLOWS ====================
const BREATHING_EXERCISES = {
  '478': { name: '4-7-8 Relaxation', inhale: 4, hold: 7, exhale: 8, cycles: 4 },
  'box': { name: 'Box Breathing', inhale: 4, hold: 4, exhale: 4, cycles: 6 },
  'quick': { name: 'Quick Craving Buster', inhale: 4, hold: 2, exhale: 6, cycles: 3 }
};

window.openBreathingModal = function() {
  const m = document.getElementById('breathingModal');
  if(m) m.classList.remove('hidden');
  refreshIcons();
};

window.closeBreathingModal = function() {
  const m = document.getElementById('breathingModal');
  if(m) m.classList.add('hidden');
};

window.showShieldDashboard = function() {
  const m = document.getElementById('shieldDashboardModal');
  if(m) m.classList.remove('hidden');
  const count = document.getElementById('modalShieldCount');
  if(count) count.innerText = waves.length;
  refreshIcons();
};

window.closeShieldDashboard = function() {
  const m = document.getElementById('shieldDashboardModal');
  if(m) m.classList.add('hidden');
};

function showToast(msg) {
  const c = document.getElementById('toastContainer'); if(!c) return;
  const t = document.createElement('div');
  t.className = 'premium-card px-4 py-2.5 rounded-full text-xs font-bold shadow-lg pointer-events-auto transition-all duration-300';
  t.style.color = 'var(--text-main)'; t.innerText = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function computeTotalSaved() {
  let pricePerStick = settings.packPrice / settings.packSize;
  let baselineGapMs = 86400000 / settings.dailyLimit;
  if (logs.length === 0) return 0;
  let timeElapsed = Date.now() - logs[0].timestamp;
  let expectedCigs = 1 + (timeElapsed / baselineGapMs);
  return Math.max(0, (expectedCigs - logs.length) * pricePerStick);
}// ==================== APP CACHE REFRESH & CONFIRM ====================
let pendingConfirmCallback = null;

function showConfirm(title, message, onConfirm, type) {
  const tEl = document.getElementById('confirmTitle');
  const mEl = document.getElementById('confirmMessage');
  const modal = document.getElementById('confirmModal');
  if (tEl) tEl.innerText = title;
  if (mEl) mEl.innerText = message;
  pendingConfirmCallback = onConfirm;
  if (modal) modal.classList.remove('hidden');
}

window.closeConfirmModal = function() {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.add('hidden');
  pendingConfirmCallback = null;
};

window.confirmYes = function() {
  const cb = pendingConfirmCallback;
  window.closeConfirmModal();
  if (cb) cb();
};

window.refreshAppCache = function() {
  showConfirm("Refresh App Cache?", "This will clear old cached files and reload the app. Your data (logs, settings) will NOT be lost.", () => {
    if ('caches' in window) {
      caches.keys().then(keys => {
        return Promise.all(keys.map(k => caches.delete(k)));
      }).then(() => {
        if (navigator.serviceWorker) {
          navigator.serviceWorker.getRegistrations().then(regs => {
            regs.forEach(r => r.unregister());
          });
        }
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  }, 'info');
};