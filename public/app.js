const SETTINGS_KEY = 'discordify-settings-v5';
const POLL_MS = 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);

const elements = {
  token: document.querySelector('#token'),
  tokenVisibility: document.querySelector('#tokenVisibility'),
  validateSession: document.querySelector('#validateSession'),
  sessionBadge: document.querySelector('#sessionBadge'),
  accountBadge: document.querySelector('#accountBadge'),
  stopActiveJob: document.querySelector('#stopActiveJob'),
  workflowButtons: Array.from(document.querySelectorAll('[data-workflow]')),
  bulkPanel: document.querySelector('#bulkPanel'),
  directPanel: document.querySelector('#directPanel'),
  scopeMode: document.querySelector('#scopeMode'),
  selectedKindButtons: Array.from(document.querySelectorAll('[data-selected-kind]')),
  selectedScopeFields: document.querySelector('#selectedScopeFields'),
  serverFieldGroup: document.querySelector('#serverFieldGroup'),
  guildId: document.querySelector('#guildId'),
  fetchGuildChannels: document.querySelector('#fetchGuildChannels'),
  channelIdsLabel: document.querySelector('#channelIdsLabel'),
  channelIds: document.querySelector('#channelIds'),
  archiveImportRow: document.querySelector('#archiveImportRow'),
  archiveImport: document.querySelector('#archiveImport'),
  scopeLookupHeading: document.querySelector('#scopeLookupHeading'),
  scopeLookupBox: document.querySelector('#scopeLookupBox'),
  content: document.querySelector('#content'),
  pattern: document.querySelector('#pattern'),
  hasLink: document.querySelector('#hasLink'),
  hasFile: document.querySelector('#hasFile'),
  includePinned: document.querySelector('#includePinned'),
  includeNsfw: document.querySelector('#includeNsfw'),
  minDate: document.querySelector('#minDate'),
  maxDate: document.querySelector('#maxDate'),
  clearFilters: document.querySelector('#clearFilters'),
  filterSummary: document.querySelector('#filterSummary'),
  searchDelay: document.querySelector('#searchDelay'),
  deleteDelay: document.querySelector('#deleteDelay'),
  maxAttempt: document.querySelector('#maxAttempt'),
  note: document.querySelector('#note'),
  rememberSettings: document.querySelector('#rememberSettings'),
  previewBulk: document.querySelector('#previewBulk'),
  startBulkDelete: document.querySelector('#startBulkDelete'),
  directTargets: document.querySelector('#directTargets'),
  startDirectDelete: document.querySelector('#startDirectDelete'),
  scopeTitle: document.querySelector('#scopeTitle'),
  scopeWarning: document.querySelector('#scopeWarning'),
  activityTitle: document.querySelector('#activity-title'),
  jobBadge: document.querySelector('#jobBadge'),
  deletedCount: document.querySelector('#deletedCount'),
  failedCount: document.querySelector('#failedCount'),
  matchedCount: document.querySelector('#matchedCount'),
  scannedCount: document.querySelector('#scannedCount'),
  skippedCount: document.querySelector('#skippedCount'),
  throttledCount: document.querySelector('#throttledCount'),
  progressTarget: document.querySelector('#progressTarget'),
  progressMeta: document.querySelector('#progressMeta'),
  progressBar: document.querySelector('#progressBar'),
  elapsedLabel: document.querySelector('#elapsedLabel'),
  throttleLabel: document.querySelector('#throttleLabel'),
  logStream: document.querySelector('#logStream'),
  logTemplate: document.querySelector('#logTemplate'),
};

const state = {
  workflow: 'bulk',
  selectedKind: 'server',
  currentAccount: null,
  validatedToken: '',
  activeJobId: null,
  pollHandle: null,
  busy: false,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function setStatus(element, label, tone = 'neutral') {
  element.textContent = label;
  element.dataset.tone = tone;
}

function isConnected() {
  return Boolean(
    state.currentAccount &&
    state.validatedToken &&
    state.validatedToken === elements.token.value.trim()
  );
}

function splitList(value) {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function countTargets() {
  return String(elements.directTargets.value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function formatDuration(label) {
  const match = String(label ?? '').match(/(\d+)h\s+(\d+)m\s+(\d+)s/);
  if (!match) return label || '0m';
  const [, hours, minutes, seconds] = match.map(Number);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function api(path, body, method = 'POST') {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.details || `Request failed (${response.status}).`);
  }
  return payload;
}

function plannerSnapshot() {
  return {
    workflow: state.workflow,
    selectedKind: state.selectedKind,
    scopeMode: elements.scopeMode.value,
    guildId: elements.guildId.value,
    channelIds: elements.channelIds.value,
    content: elements.content.value,
    pattern: elements.pattern.value,
    hasLink: elements.hasLink.checked,
    hasFile: elements.hasFile.checked,
    includePinned: elements.includePinned.checked,
    includeNsfw: elements.includeNsfw.checked,
    minDate: elements.minDate.value,
    maxDate: elements.maxDate.value,
    searchDelay: elements.searchDelay.value,
    deleteDelay: elements.deleteDelay.value,
    maxAttempt: elements.maxAttempt.value,
    note: elements.note.value,
  };
}

function persistPlanner() {
  if (!elements.rememberSettings.checked) {
    localStorage.removeItem(SETTINGS_KEY);
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(plannerSnapshot()));
}

function restorePlanner() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.workflow = saved.workflow === 'direct' ? 'direct' : 'bulk';
    state.selectedKind = saved.selectedKind === 'dm-list' ? 'dm-list' : 'server';
    const values = {
      scopeMode: saved.scopeMode,
      guildId: saved.guildId,
      channelIds: saved.channelIds,
      content: saved.content,
      pattern: saved.pattern,
      minDate: saved.minDate,
      maxDate: saved.maxDate,
      searchDelay: saved.searchDelay,
      deleteDelay: saved.deleteDelay,
      maxAttempt: saved.maxAttempt,
      note: saved.note,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && elements[key]) elements[key].value = value;
    }
    for (const key of ['hasLink', 'hasFile', 'includePinned', 'includeNsfw']) {
      elements[key].checked = Boolean(saved[key]);
    }
    elements.rememberSettings.checked = true;
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

function filterLabels() {
  const labels = [];
  if (elements.content.value.trim()) labels.push('text');
  if (elements.pattern.value.trim()) labels.push('regex');
  if (elements.hasLink.checked) labels.push('links');
  if (elements.hasFile.checked) labels.push('files');
  if (elements.includePinned.checked) labels.push('pinned');
  if (elements.includeNsfw.checked) labels.push('NSFW');
  if (elements.minDate.value) labels.push('after date');
  if (elements.maxDate.value) labels.push('before date');
  return labels;
}

function scopeLabel() {
  switch (elements.scopeMode.value) {
    case 'all-dms': return 'All DMs';
    case 'all-servers': return 'All servers';
    case 'all-sources': return 'Everywhere';
    default:
      return state.selectedKind === 'dm-list' ? 'Custom DM list' : 'One server';
  }
}

function hasValidBulkTarget() {
  if (elements.scopeMode.value !== 'selected') return true;
  if (state.selectedKind === 'server') return Boolean(elements.guildId.value.trim());
  return splitList(elements.channelIds.value).length > 0;
}

function refreshSummary() {
  const filters = filterLabels();
  const broad = filters.length === 0;
  elements.filterSummary.textContent = broad
    ? 'No filters, all of your messages in scope'
    : filters.join(', ');
  elements.scopeTitle.textContent = scopeLabel();
  elements.scopeWarning.textContent = broad
    ? 'All of your messages in this scope will match. Preview first.'
    : `Filtered by ${filters.join(', ')}.`;
}

function refreshScopeUi() {
  const selected = elements.scopeMode.value === 'selected';
  const server = state.selectedKind === 'server';
  elements.selectedScopeFields.hidden = !selected;
  elements.serverFieldGroup.hidden = !server;
  elements.archiveImportRow.hidden = server;
  elements.channelIdsLabel.innerHTML = server
    ? 'Channel IDs <small>optional</small>'
    : 'DM or group DM channel IDs';
  elements.channelIds.placeholder = server
    ? 'Leave blank to search the whole server'
    : 'Paste one channel ID per line';
  elements.scopeLookupHeading.textContent = server ? 'Channel helper' : 'Import helper';
  if (!server) {
    elements.scopeLookupBox.innerHTML = '<strong>Custom DM list</strong><span>Paste channel IDs above, or import <code>messages/index.json</code>.</span>';
  } else if (!elements.scopeLookupBox.querySelector('.guild-line')) {
    elements.scopeLookupBox.innerHTML = '<strong>Channel helper</strong><span>Connect your account, add a server ID, then list its channels here.</span>';
  }

  for (const button of elements.selectedKindButtons) {
    button.classList.toggle('active', button.dataset.selectedKind === state.selectedKind);
  }
  refreshSummary();
  refreshDisabled();
}

function refreshWorkflowUi() {
  const bulk = state.workflow === 'bulk';
  elements.bulkPanel.hidden = !bulk;
  elements.directPanel.hidden = bulk;
  for (const button of elements.workflowButtons) {
    button.classList.toggle('active', button.dataset.workflow === state.workflow);
  }
  refreshDisabled();
}

function refreshDisabled() {
  const connected = isConnected();
  const bulkReady = connected && hasValidBulkTarget() && !state.busy;
  const directReady = connected && countTargets() > 0 && !state.busy;

  elements.validateSession.disabled = state.busy || !elements.token.value.trim();
  elements.fetchGuildChannels.disabled = state.busy || !connected || !elements.guildId.value.trim();
  elements.previewBulk.disabled = !bulkReady;
  elements.startBulkDelete.disabled = !bulkReady;
  elements.startDirectDelete.disabled = !directReady;
  elements.stopActiveJob.disabled = !state.activeJobId;
  elements.scopeMode.disabled = state.busy;
  for (const button of [...elements.workflowButtons, ...elements.selectedKindButtons]) {
    button.disabled = state.busy;
  }
}

function setBusy(busy) {
  state.busy = busy;
  refreshDisabled();
}

function invalidateConnection() {
  state.currentAccount = null;
  state.validatedToken = '';
  elements.accountBadge.textContent = 'No account connected';
  setStatus(elements.sessionBadge, elements.token.value.trim() ? 'Reconnect' : 'Not connected', 'neutral');
  refreshDisabled();
}

async function validateToken() {
  const token = elements.token.value.trim();
  if (!token) throw new Error('Paste a Discord token first.');

  setBusy(true);
  setStatus(elements.sessionBadge, 'Connecting', 'warn');
  try {
    const { user } = await api('/api/account/lookup', { token });
    state.currentAccount = user;
    state.validatedToken = token;
    const name = user.globalName || user.username || user.id;
    elements.accountBadge.textContent = `${name} · ${user.id}`;
    setStatus(elements.sessionBadge, 'Connected', 'good');
  } catch (error) {
    invalidateConnection();
    setStatus(elements.sessionBadge, 'Connection failed', 'bad');
    throw error;
  } finally {
    setBusy(false);
  }
}

function renderGuildChannels(channels) {
  if (!channels.length) {
    elements.scopeLookupBox.innerHTML = '<strong>No channels found</strong><span>Check the server ID and account access.</span>';
    return;
  }
  elements.scopeLookupBox.innerHTML = channels.map((channel) => `
    <span class="guild-line">
      <strong>${escapeHtml(channel.name || 'unnamed')}</strong>
      <code>${escapeHtml(channel.id)}</code>
    </span>
  `).join('');
}

async function fetchGuildChannels() {
  const guildId = elements.guildId.value.trim();
  if (!isConnected()) throw new Error('Connect the account first.');
  if (!guildId) throw new Error('Add a server ID first.');
  setBusy(true);
  try {
    const payload = await api('/api/guilds/channels', {
      token: state.validatedToken,
      guildId,
    });
    renderGuildChannels(payload.channels);
  } finally {
    setBusy(false);
  }
}

function buildBulkPayload(previewOnly) {
  if (!isConnected()) throw new Error('Reconnect the account before starting.');
  return {
    token: state.validatedToken,
    authorId: state.currentAccount.id,
    scopeMode: elements.scopeMode.value,
    guildId: elements.scopeMode.value === 'selected'
      ? (state.selectedKind === 'dm-list' ? '@me' : elements.guildId.value.trim())
      : '',
    channelIds: elements.scopeMode.value === 'selected' ? elements.channelIds.value : '',
    content: elements.content.value.trim(),
    pattern: elements.pattern.value.trim(),
    hasLink: elements.hasLink.checked,
    hasFile: elements.hasFile.checked,
    includePinned: elements.includePinned.checked,
    includeNsfw: elements.includeNsfw.checked,
    minDate: elements.minDate.value,
    maxDate: elements.maxDate.value,
    searchDelay: elements.searchDelay.value,
    deleteDelay: elements.deleteDelay.value,
    maxAttempt: elements.maxAttempt.value,
    previewOnly,
    note: elements.note.value.trim(),
  };
}

function confirmBulkDelete() {
  const filters = filterLabels();
  const detail = filters.length ? `Filters: ${filters.join(', ')}` : 'No filters are set.';
  return window.confirm(
    `Delete your matching messages from ${scopeLabel()}?\n\n${detail}\n\nThis cannot be undone.`
  );
}

async function startBulk(previewOnly) {
  if (!hasValidBulkTarget()) throw new Error('Complete the selected scope first.');
  if (!previewOnly && !confirmBulkDelete()) return;
  setBusy(true);
  try {
    const { job } = await api('/api/jobs/bulk', buildBulkPayload(previewOnly));
    applyJob(job);
    startPolling(job.id);
  } finally {
    setBusy(false);
  }
}

async function startDirectDelete() {
  const targetCount = countTargets();
  if (!isConnected()) throw new Error('Connect the account first.');
  if (!targetCount) throw new Error('Add at least one message link or ID.');
  if (!window.confirm(`Delete ${targetCount} exact message target${targetCount === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) return;

  setBusy(true);
  try {
    const { job } = await api('/api/jobs/direct', {
      token: state.validatedToken,
      targetsText: elements.directTargets.value,
      deleteDelay: elements.deleteDelay.value,
      maxAttempt: elements.maxAttempt.value,
      note: elements.note.value.trim(),
    });
    applyJob(job);
    startPolling(job.id);
  } finally {
    setBusy(false);
  }
}

function renderLogs(logs) {
  if (!logs?.length) {
    elements.logStream.innerHTML = '<div class="log-empty">The job has started. Activity will appear here.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const log of logs.slice(-80).reverse()) {
    const node = elements.logTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.level = log.level;
    node.querySelector('.log-message').textContent = log.message;
    node.querySelector('.log-time').textContent = new Date(log.timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    const meta = node.querySelector('.log-meta');
    if (log.meta === undefined) {
      meta.remove();
    } else {
      meta.textContent = typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta, null, 2);
    }
    fragment.append(node);
  }
  elements.logStream.replaceChildren(fragment);
}

function applyJob(job) {
  const progress = job.progress ?? {};
  const stats = job.stats ?? {};
  const running = !TERMINAL_STATUSES.has(job.status);
  state.activeJobId = running ? job.id : null;

  const tone = job.status === 'completed'
    ? 'good'
    : job.status === 'failed'
      ? 'bad'
      : running
        ? 'warn'
        : 'neutral';
  setStatus(elements.jobBadge, job.status.replaceAll('-', ' '), tone);
  elements.activityTitle.textContent = job.kind === 'bulk' && job.config?.previewOnly
    ? 'Preview activity'
    : running
      ? 'Deletion in progress'
      : job.status === 'completed'
        ? 'Run complete'
        : 'Run finished';

  elements.deletedCount.textContent = progress.deleted ?? 0;
  elements.failedCount.textContent = progress.failed ?? 0;
  elements.matchedCount.textContent = progress.matched ?? 0;
  elements.scannedCount.textContent = progress.scanned ?? 0;
  elements.skippedCount.textContent = progress.skipped ?? 0;
  elements.throttledCount.textContent = stats.throttledCount ?? 0;
  elements.progressTarget.textContent = job.currentTarget || job.currentAction || 'Finishing';

  const queueIndex = progress.queueIndex ?? 0;
  const queueSize = progress.queueSize ?? 0;
  elements.progressMeta.textContent = queueSize ? `${queueIndex} / ${queueSize}` : `${progress.deleted ?? 0} deleted`;
  const percentage = queueSize > 0
    ? Math.min(100, Math.max(0, (queueIndex / queueSize) * 100))
    : (job.status === 'completed' ? 100 : 0);
  elements.progressBar.style.width = `${percentage}%`;
  elements.elapsedLabel.textContent = `${formatDuration(stats.elapsedLabel)} elapsed`;
  elements.throttleLabel.textContent = `${formatDuration(stats.throttledLabel)} waiting`;
  renderLogs(job.logs);
  refreshDisabled();
}

function stopPolling() {
  if (state.pollHandle) window.clearInterval(state.pollHandle);
  state.pollHandle = null;
}

async function pollJob() {
  if (!state.activeJobId) return;
  try {
    const { job } = await api(`/api/jobs/${state.activeJobId}`, undefined, 'GET');
    applyJob(job);
    if (TERMINAL_STATUSES.has(job.status)) stopPolling();
  } catch (error) {
    stopPolling();
    window.alert(error.message);
  }
}

function startPolling(jobId) {
  stopPolling();
  state.activeJobId = jobId;
  state.pollHandle = window.setInterval(pollJob, POLL_MS);
  window.setTimeout(pollJob, 150);
}

async function stopActiveJob() {
  if (!state.activeJobId) return;
  const { job } = await api(`/api/jobs/${state.activeJobId}/stop`, {});
  applyJob(job);
}

async function importArchive(event) {
  const [file] = event.target.files;
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('That file does not look like messages/index.json.');
  }
  const ids = Object.keys(parsed).filter((id) => /^\d+$/.test(id));
  if (!ids.length) throw new Error('No DM channel IDs were found in that file.');
  elements.channelIds.value = ids.join('\n');
  elements.scopeLookupBox.innerHTML = `<strong>Import ready</strong><span>${ids.length} DM channel ID${ids.length === 1 ? '' : 's'} loaded.</span>`;
  persistPlanner();
  refreshDisabled();
}

function clearFilters() {
  for (const element of [elements.content, elements.pattern, elements.minDate, elements.maxDate]) {
    element.value = '';
  }
  for (const element of [elements.hasLink, elements.hasFile, elements.includePinned, elements.includeNsfw]) {
    element.checked = false;
  }
  persistPlanner();
  refreshSummary();
}

function handleError(action) {
  return () => action().catch((error) => window.alert(error.message));
}

function bindEvents() {
  elements.token.addEventListener('input', invalidateConnection);
  elements.tokenVisibility.addEventListener('change', () => {
    elements.token.type = elements.tokenVisibility.checked ? 'text' : 'password';
  });
  elements.validateSession.addEventListener('click', handleError(validateToken));
  elements.fetchGuildChannels.addEventListener('click', handleError(fetchGuildChannels));
  elements.previewBulk.addEventListener('click', handleError(() => startBulk(true)));
  elements.startBulkDelete.addEventListener('click', handleError(() => startBulk(false)));
  elements.startDirectDelete.addEventListener('click', handleError(startDirectDelete));
  elements.stopActiveJob.addEventListener('click', handleError(stopActiveJob));
  elements.archiveImport.addEventListener('change', (event) => {
    importArchive(event).catch((error) => window.alert(error.message));
  });
  elements.clearFilters.addEventListener('click', clearFilters);

  for (const button of elements.workflowButtons) {
    button.addEventListener('click', () => {
      state.workflow = button.dataset.workflow;
      refreshWorkflowUi();
      persistPlanner();
    });
  }
  for (const button of elements.selectedKindButtons) {
    button.addEventListener('click', () => {
      state.selectedKind = button.dataset.selectedKind;
      refreshScopeUi();
      persistPlanner();
    });
  }

  elements.scopeMode.addEventListener('change', () => {
    refreshScopeUi();
    persistPlanner();
  });
  elements.rememberSettings.addEventListener('change', persistPlanner);

  const plannerFields = [
    elements.guildId,
    elements.channelIds,
    elements.content,
    elements.pattern,
    elements.hasLink,
    elements.hasFile,
    elements.includePinned,
    elements.includeNsfw,
    elements.minDate,
    elements.maxDate,
    elements.searchDelay,
    elements.deleteDelay,
    elements.maxAttempt,
    elements.note,
    elements.directTargets,
  ];
  for (const field of plannerFields) {
    for (const eventName of ['input', 'change']) {
      field.addEventListener(eventName, () => {
        persistPlanner();
        refreshSummary();
        refreshDisabled();
      });
    }
  }
}

function init() {
  restorePlanner();
  bindEvents();
  invalidateConnection();
  refreshWorkflowUi();
  refreshScopeUi();
  refreshSummary();
}

init();
