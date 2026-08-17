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
}