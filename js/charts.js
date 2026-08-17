// ==================== CHARTS & ANALYTICS ====================
let myChartInstances = {};
let mapInstance = null, modalMapInstance = null;

const APP_FONT_FAMILY = '"General Sans", -apple-system, BlinkMacSystemFont, sans-serif';
const NUMERIC_FONT_FAMILY = '"Space Grotesk", monospace';

function renderAllCharts() {
  const activeLogs = getFilteredLogs();
  if(!activeLogs || activeLogs.length === 0) return;

  const totalSaved = computeTotalSaved();
  const savedEl = document.getElementById('insightTotalSaved');
  if(savedEl) savedEl.innerText = `${settings.currency} ${Math.round(totalSaved)}`;

  renderHeatmapCalendar(activeLogs);
  renderLifeRegainedCounter();
  renderRecoveryTimeline();
}

function getFilteredLogs() {
  const filter = document.getElementById('insightsDateFilter')?.value || '7days';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if(filter === 'today') return logs.filter(l => l.timestamp >= todayStart);
  if(filter === '7days') return logs.filter(l => l.timestamp >= todayStart - (6 * 86400000));
  if(filter === '1month') return logs.filter(l => l.timestamp >= todayStart - (29 * 86400000));
  return logs;
}

function renderHeatmapCalendar(logsArray) {
  const container = document.getElementById('calendarHeatmap');
  if(!container) return;
  container.innerHTML = `<p class="text-[10px] text-gray-500 py-2">Heatmap synced (${logsArray.length} entries)</p>`;
}

function renderLifeRegainedCounter() {
  const textEl = document.getElementById('lifeRegainedText');
  if(textEl && logs.length >= 2) {
    const avoided = Math.max(0, Math.floor((Date.now() - logs[0].timestamp) / 3600000) - logs.length);
    textEl.textContent = `${avoided * 11}m reclaimed`;
  }
}

function renderRecoveryTimeline() {}