// ==================== TRACKER & TIMERS ====================
let mainTimer = null, waveTimer = null, cooldownTimer = null;
let displayRaf = null, lastHeroTime = '', prevHeroVictory = false;
let lastLogicCheck = 0;
const HOUR_MILESTONES = [1, 6, 12, 24, 72, 168, 336, 720];

let currentWatchStyle = parseInt(localStorage.getItem('smoke_watch_style')) || 1;
if (currentWatchStyle !== 1 && currentWatchStyle !== 3) currentWatchStyle = 1;
let touchStartXCoord = 0;

let holdTimerId = null, holdStartTime = 0, isHolding = false;
let editingLogIdx = null, currentSelectedTags = [], currentIntensity = 3, currentMood = null;
let takeoverTimer = null, takeoverCountdown = 6;
let sosTimer = null, sosSecs = 15;

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ==================== WATCH SWITCH & SWIPE LOGIC ====================
window.switchWatchStyle = function(styleNum) {
  if (styleNum !== 1 && styleNum !== 3) styleNum = 1;
  currentWatchStyle = styleNum;
  localStorage.setItem('smoke_watch_style', styleNum);

  // Watch 1 (The Climb)
  const watch1 = document.getElementById('watchStyle1');
  const dot1 = document.getElementById('watchDot1');
  if (watch1) watch1.classList.toggle('hidden', styleNum !== 1);
  if (dot1) {
    dot1.className = styleNum === 1 
      ? "w-2.5 h-2.5 rounded-full transition-all duration-300 scale-125 shadow-[0_0_8px_var(--accent-glow)]" 
      : "w-2 h-2 rounded-full transition-all duration-300 bg-gray-500/30";
    dot1.style.backgroundColor = styleNum === 1 ? "var(--accent)" : "";
  }

  // Watch 3 (The Horizon)
  const watch3 = document.getElementById('watchStyle3');
  const dot3 = document.getElementById('watchDot3');
  if (watch3) watch3.classList.toggle('hidden', styleNum !== 3);
  if (dot3) {
    dot3.className = styleNum === 3 
      ? "w-2.5 h-2.5 rounded-full transition-all duration-300 scale-125 shadow-[0_0_8px_var(--accent-glow)]" 
      : "w-2 h-2 rounded-full transition-all duration-300 bg-gray-500/30";
    dot3.style.backgroundColor = styleNum === 3 ? "var(--accent)" : "";
  }

  if (settings.haptics && navigator.vibrate) navigator.vibrate(10);
};

window.touchStartX = function(e) {
  if (e.changedTouches && e.changedTouches.length > 0) {
    touchStartXCoord = e.changedTouches[0].clientX;
  }
};

window.touchEndX = function(e) {
  if (e.changedTouches && e.changedTouches.length > 0) {
    const diff = e.changedTouches[0].clientX - touchStartXCoord;
    if (Math.abs(diff) > 40) {
      // 1 aur 3 ke beech smooth switch
      const nextStyle = currentWatchStyle === 1 ? 3 : 1;
      window.switchWatchStyle(nextStyle);
    }
  }
};

// ==================== DISPLAY & TICK ====================
function displayTick() {
  try {
    const now = Date.now();
    if (logs && logs.length > 0) {
      const lastLog = logs[logs.length-1];
      if (lastLog && typeof lastLog.timestamp === 'number') {
        const diff = now - lastLog.timestamp;
        const timeStr = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
        if (timeStr !== lastHeroTime) {
          lastHeroTime = timeStr;
          updateHeroDisplay(diff, lastLog.gap ? lastLog.gap * 60000 : 0, logsCache.avgGapMs);
        }
      }
    } else {
      if (lastHeroTime !== '00:00:00') {
        lastHeroTime = '00:00:00';
        for (let i = 1; i <= 3; i++) {
          if (i === 2) continue;
          const sw = document.getElementById('stopwatch' + i);
          if (sw) sw.innerText = '00:00:00';
        }
      }
    }

    if (now - lastLogicCheck >= 1000) {
      lastLogicCheck = now;
      if (!document.hidden) {
        ensureLogsCacheFresh();
        checkPeakNudge();
        updateLastSmokeDisplay();
        checkLock();
        checkWave();
        handleMilestones(now - (logs && logs.length ? logs[logs.length-1].timestamp : now));
      }
    }
  } catch(err) { console.error('Display tick error:', err); }
  displayRaf = requestAnimationFrame(displayTick);
}

function handleMilestones(diffMs) {
  try {
    if (prefersReducedMotion() || !logs || logs.length === 0) return;
    const lastLog = logs[logs.length-1];
    const key = 'smoke_milestone_' + lastLog.timestamp;
    const done = parseInt(localStorage.getItem(key) || '0', 10);
    const hours = diffMs / 3600000;
    let crossed = 0;
    for (let i=0; i<HOUR_MILESTONES.length; i++) {
      if (hours >= HOUR_MILESTONES[i]) crossed = HOUR_MILESTONES[i];
    }
    if (crossed > done) {
      localStorage.setItem(key, String(crossed));
      if (settings.haptics && navigator.vibrate) navigator.vibrate([50, 30, 80]);
    }
  } catch(e) {}
}

function updateHeroDisplay(diff, prevGapMs, avgGapMs) {
  const timeStr = `${Math.floor(diff/3600000).toString().padStart(2,'0')}:${Math.floor((diff%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((diff%60000)/1000).toString().padStart(2,'0')}`;
  for(let i=1; i<=3; i++) {
    const wrap = document.getElementById('watchStyle'+i);
    if (wrap && wrap.classList.contains('hidden')) continue;
    const sw = document.getElementById('stopwatch'+i);
    if(sw) sw.innerText = timeStr;
  }

  let pct = 0, isVictory = false, extraMins = 0, remMins = 0;
  if(avgGapMs > 0) {
    if (diff >= avgGapMs) {
      isVictory = true;
      extraMins = Math.floor((diff - avgGapMs) / 60000);
      pct = 70 + Math.min(30, Math.round(((diff - avgGapMs) / avgGapMs) * 30));
    } else {
      pct = Math.min(70, Math.round((diff / avgGapMs) * 70));
      remMins = Math.ceil((avgGapMs - diff) / 60000);
    }
  }

  const fill1 = document.getElementById('heroHorizonFill');
  if(fill1) fill1.style.width = `${pct}%`;
  const fill3 = document.getElementById('heroClimbFill');
  if(fill3) fill3.style.height = `${pct}%`;
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
  const mins = Math.floor((Date.now() - last.timestamp) / 60000);
  text.innerText = mins < 1 ? 'Last: Just now' : `Last: ${mins}m ago`;
  count.innerText = `Today: ${logsCache.todayCount}`;
}

function checkPeakNudge() {}
function checkWave() {}

// ==================== HOLD TO SMOKE ====================
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
  const btnEl = document.getElementById('mainLogBtn');
  if(btnEl) btnEl.classList.add('is-holding');
  if(textEl) textEl.innerText = "Hold...";
  
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
      
      try {
        actuallyLogCigarette();
      } catch(err) { console.error("Error logging", err); }
      finally {
        setTimeout(() => { 
          if(progressEl) progressEl.style.width = '0%'; 
          if(textEl) textEl.innerText = "Hold to Smoke"; 
        }, 500);
      }
    } else {
      holdTimerId = requestAnimationFrame(update);
    }
  }
  holdTimerId = requestAnimationFrame(update);
};

window.cancelHold = function(e) {
  if (e && e.cancelable) e.preventDefault();
  isHolding = false;
  if (holdTimerId) cancelAnimationFrame(holdTimerId);
  const progressEl = document.getElementById('holdProgress');
  const textEl = document.getElementById('holdText');
  const btnEl = document.getElementById('mainLogBtn');
  if(btnEl) btnEl.classList.remove('is-holding');
  if(progressEl) progressEl.style.width = '0%';
  if(textEl) textEl.innerText = "Hold to Smoke";
};

function actuallyLogCigarette() {
  const now = new Date().getTime();
  let gap = logs.length > 0 ? Math.round((now - logs[logs.length-1].timestamp)/60000) : null;
  logs.push({timestamp: now, gap: gap, tags: [], lat: null, lng: null, intensity: 3, note: '', mood: null});
  localStorage.setItem('smoke_logs', JSON.stringify(logs));
  lockEndTime = now + (settings.lockSecs * 1000);
  localStorage.setItem('smoke_lock_end', lockEndTime);

  try { updateUI(); } catch(e) {}
  checkLock();
}

function checkLock() {
  const btn = document.getElementById('mainLogBtn'); if(!btn) return;
  if(new Date().getTime() < lockEndTime) {
    btn.disabled = true; btn.style.opacity = '0.5';
  } else {
    btn.disabled = false; btn.style.opacity = '1';
  }
}