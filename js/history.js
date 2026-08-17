// ==================== HISTORY & APP BOOTSTRAP ====================
function renderHistory(tId = 'fullHistoryList', homeLimit = 3) {
  const c = document.getElementById(tId); if(!c) return;
  if(!logs || logs.length === 0) {
    c.innerHTML = "<p class='text-center py-6 text-xs text-gray-500'>No logs recorded yet.</p>";
    return;
  }
  const list = tId === 'homeRecentLogs' ? logs.slice(-homeLimit).reverse() : logs.slice().reverse();
  c.innerHTML = list.map((l, i) => `
    <div class="premium-card p-3 flex justify-between items-center text-xs">
      <div>
        <p class="font-bold">${formatAppTime(new Date(l.timestamp))}</p>
        <p class="text-[10px] text-gray-400">${(l.tags || ['General']).join(', ')}</p>
      </div>
      <span class="font-bold text-amber-500">${formatGap(l.gap)}</span>
    </div>
  `).join('');
  refreshIcons();
}

window.switchTab = function(t) {
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

  if(t === 'history') renderHistory('fullHistoryList'); 
  if(t === 'insights') renderAllCharts();
  refreshIcons();
};

function updateUI() {
  recomputeLogsCache();
  const shield = document.getElementById('shieldCount');
  if(shield) shield.innerText = waves.length;
  renderHistory('homeRecentLogs', 3);
}

function bootApp() {
  recomputeLogsCache();
  updateUI();
  displayRaf = requestAnimationFrame(displayTick);
  refreshIcons();
}

window.bootApp = bootApp;