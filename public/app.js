const SETTINGS_KEY = 'discordify-settings-v4';
const LEGACY_SETTINGS_KEYS = [
  'discordify-settings-v3',
  'discordify-settings-v2',
  'discordify-settings-v1',
  'undiscord-local-settings-v1',
];
const UI_PREFS_KEY = 'discordify-ui-prefs-v1';
const TOKEN_LIBRARY_KEY = 'discordify-token-library-v1';
const POLL_MS = 1200;
const VALID_SCOPE_MODES = new Set(['selected', 'all-dms', 'all-servers', 'all-sources']);
const VALID_WORKFLOWS = new Set(['bulk', 'direct']);
const VALID_SELECTED_KINDS = new Set(['server', 'dm-list']);
const VALID_THEMES = new Set(['linen', 'midnight', 'signal', 'newsprint']);
const DEFAULT_SERVER_LOOKUP =
  'Inspect a server to list channels here, or switch to Custom DM list to import <code>messages/index.json</code>.';
const DEFAULT_DM_LOOKUP =
  'Paste DM or group DM channel IDs, or import <code>messages/index.json</code> from your Discord data export.';
const DEFAULT_GLOBAL_LOOKUP =
  'Global modes load the reachable servers and DM conversations for this token automatically when the job starts.';

const elements = {
  body: document.body,
  themePicker: document.querySelector('#themePicker'),
  streamerModeToggle: document.querySelector('#streamerModeToggle'),
  streamerBanner: document.querySelector('#streamerBanner'),
  token: document.querySelector('#token'),
  tokenLabel: document.querySelector('#tokenLabel'),
  saveCurrentToken: document.querySelector('#saveCurrentToken'),
  forgetCurrentToken: document.querySelector('#forgetCurrentToken'),
  savedTokensList: document.querySelector('#savedTokensList'),
  savedTokenCount: document.querySelector('#savedTokenCount'),
  rememberSettings: document.querySelector('#rememberSettings'),
  clearSavedSettings: document.querySelector('#clearSavedSettings'),
  validateSession: document.querySelector('#validateSession'),
  stopActiveJob: document.querySelector('#stopActiveJob'),
  sessionBadge: document.querySelector('#sessionBadge'),
  jobBadge: document.querySelector('#jobBadge'),
  accountBadge: document.querySelector('#accountBadge'),
  scopeBadge: document.querySelector('#scopeBadge'),
  authorId: document.querySelector('#authorId'),
  useValidatedUser: document.querySelector('#useValidatedUser'),
  bulkPanel: document.querySelector('#bulkPanel'),
  directPanel: document.querySelector('#directPanel'),
  workflowButtons: Array.from(document.querySelectorAll('[data-workflow]')),
  scopeButtons: Array.from(document.querySelectorAll('[data-scope-mode]')),
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
  filtersCard: document.querySelector('#filtersCard'),
  clearFilters: document.querySelector('#clearFilters'),
  searchDelayField: document.querySelector('#searchDelayField'),
  searchDelay: document.querySelector('#searchDelay'),
  deleteDelay: document.querySelector('#deleteDelay'),
  maxAttempt: document.querySelector('#maxAttempt'),
  note: document.querySelector('#note'),
  previewBulk: document.querySelector('#previewBulk'),
  startBulkDelete: document.querySelector('#startBulkDelete'),
  directTargets: document.querySelector('#directTargets'),
  startDirectDelete: document.querySelector('#startDirectDelete'),
  scopeTitle: document.querySelector('#scopeTitle'),
  scopeDescription: document.querySelector('#scopeDescription'),
  scopeModeValue: document.querySelector('#scopeModeValue'),
  scopeTargetValue: document.querySelector('#scopeTargetValue'),
  scopeFilterValue: document.querySelector('#scopeFilterValue'),
  scopeSafetyValue: document.querySelector('#scopeSafetyValue'),
  scopeWarning: document.querySelector('#scopeWarning'),
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
  activeJobId: null,
  currentAccount: null,
  validatedToken: '',
  pollHandle: null,
  workflow: 'bulk',
  scopeMode: 'selected',
  selectedKind: 'server',
  isBusy: false,
  theme: 'linen',
  streamerMode: false,
  savedTokens: [],
  selectedTokenId: '',
  serverLookup: {
    mode: 'html',
    value: DEFAULT_SERVER_LOOKUP,
  },
  dmLookup: {
    mode: 'html',
    value: DEFAULT_DM_LOOKUP,
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&#39;';
  });
}

function setLookupContent(mode, value) {
  if (mode === 'html') {
    elements.scopeLookupBox.innerHTML = value;
    return;
  }

  elements.scopeLookupBox.textContent = value;
}

function splitList(rawText) {
  return String(rawText ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function countDirectTargets(rawText) {
  return String(rawText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function createTokenId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildAccountLabel(user) {
  const primaryName = user.globalName || user.username || 'Saved account';
  return user.username && user.globalName
    ? `${primaryName} (${user.username})`
    : primaryName;
}

function formatTimestamp(rawValue) {
  const parsed = Date.parse(rawValue);
  if (Number.isNaN(parsed)) return 'Unknown time';
  return new Date(parsed).toLocaleString();
}

function readJsonStorage(keys) {
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      return { key, value: JSON.parse(raw) };
    } catch {
      localStorage.removeItem(key);
    }
  }

  return null;
}

function clearPlannerSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  for (const key of LEGACY_SETTINGS_KEYS) {
    localStorage.removeItem(key);
  }
}

function writePlannerSettings() {
  if (!elements.rememberSettings.checked) {
    clearPlannerSettings();
    return;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(formValueMap()));
}

function writeUiPrefs() {
  localStorage.setItem(
    UI_PREFS_KEY,
    JSON.stringify({
      theme: state.theme,
      streamerMode: state.streamerMode,
    })
  );
}

function saveTokenLibrary() {
  localStorage.setItem(TOKEN_LIBRARY_KEY, JSON.stringify(state.savedTokens));
}

function formValueMap() {
  return {
    token: elements.token.value,
    tokenLabel: elements.tokenLabel.value,
    selectedTokenId: state.selectedTokenId,
    authorId: elements.authorId.value,
    workflow: state.workflow,
    scopeMode: state.scopeMode,
    selectedKind: state.selectedKind,
    guildId: state.selectedKind === 'server' ? elements.guildId.value : '@me',
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
    directTargets: elements.directTargets.value,
    rememberSettings: elements.rememberSettings.checked,
  };
}

function restorePlannerSettings() {
  const stored = readJsonStorage([SETTINGS_KEY, ...LEGACY_SETTINGS_KEYS]);
  if (!stored) return;

  const saved = stored.value ?? {};

  state.workflow = VALID_WORKFLOWS.has(saved.workflow) ? saved.workflow : 'bulk';
  state.scopeMode = VALID_SCOPE_MODES.has(saved.scopeMode) ? saved.scopeMode : 'selected';

  const inferredSelectedKind =
    saved.selectedKind || (saved.guildId === '@me' ? 'dm-list' : 'server');
  state.selectedKind = VALID_SELECTED_KINDS.has(inferredSelectedKind)
    ? inferredSelectedKind
    : 'server';

  const shouldMigrateLegacyDeleteDelay =
    stored.key !== SETTINGS_KEY &&
    (saved.deleteDelay === undefined || saved.deleteDelay === null || String(saved.deleteDelay) === '1000');

  elements.token.value = saved.token ?? '';
  elements.tokenLabel.value = saved.tokenLabel ?? '';
  state.selectedTokenId = typeof saved.selectedTokenId === 'string' ? saved.selectedTokenId : '';
  elements.authorId.value = saved.authorId ?? '';
  elements.guildId.value = saved.guildId && saved.guildId !== '@me' ? saved.guildId : '';
  elements.channelIds.value = saved.channelIds ?? '';
  elements.content.value = saved.content ?? '';
  elements.pattern.value = saved.pattern ?? '';
  elements.hasLink.checked = Boolean(saved.hasLink);
  elements.hasFile.checked = Boolean(saved.hasFile);
  elements.includePinned.checked = Boolean(saved.includePinned);
  elements.includeNsfw.checked = Boolean(saved.includeNsfw);
  elements.minDate.value = saved.minDate ?? '';
  elements.maxDate.value = saved.maxDate ?? '';
  elements.searchDelay.value = saved.searchDelay ?? '30000';
  elements.deleteDelay.value = shouldMigrateLegacyDeleteDelay
    ? '300'
    : (saved.deleteDelay ?? '300');
  elements.maxAttempt.value = saved.maxAttempt ?? '2';
  elements.note.value = saved.note ?? '';
  elements.directTargets.value = saved.directTargets ?? '';
  elements.rememberSettings.checked = Boolean(saved.rememberSettings);

  if (stored.key !== SETTINGS_KEY && saved.rememberSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(formValueMap()));
    localStorage.removeItem(stored.key);
  }
}

function restoreUiPrefs() {
  const stored = readJsonStorage([UI_PREFS_KEY]);
  if (!stored) return;

  const saved = stored.value ?? {};
  state.theme = VALID_THEMES.has(saved.theme) ? saved.theme : 'linen';
  state.streamerMode = Boolean(saved.streamerMode);
}

function restoreTokenLibrary() {
  const stored = readJsonStorage([TOKEN_LIBRARY_KEY]);
  if (!stored) return;

  if (!Array.isArray(stored.value)) {
    localStorage.removeItem(TOKEN_LIBRARY_KEY);
    return;
  }

  state.savedTokens = stored.value
    .map((entry) => ({
      id: typeof entry?.id === 'string' && entry.id ? entry.id : createTokenId(),
      label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : 'Saved token',
      token: typeof entry?.token === 'string' ? entry.token : '',
      createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
    }))
    .filter((entry) => entry.token.trim());

  saveTokenLibrary();
}

function applyUiPrefs() {
  elements.body.dataset.theme = state.theme;
  elements.body.classList.toggle('streamer-mode', state.streamerMode);
  elements.themePicker.value = state.theme;
  elements.streamerModeToggle.checked = state.streamerMode;
  elements.streamerBanner.hidden = !state.streamerMode;
}

function setPill(element, label, tone = 'neutral') {
  element.textContent = label;
  element.className = `pill ${tone}`;
}

function setDisabled(isBusy) {
  state.isBusy = isBusy;
  syncPlannerUi();
}

async function api(path, body, method = 'POST') {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = payload.error || payload.details || `Request failed with ${response.status}`;
    throw new Error(reason);
  }

  return payload;
}

function invalidateValidatedSession(label = 'Needs validation') {
  state.currentAccount = null;
  state.validatedToken = '';
  elements.accountBadge.textContent = 'No account loaded';
  setPill(elements.sessionBadge, elements.token.value.trim() ? label : 'Not validated', 'neutral');
}

function renderGuildChannels(channels) {
  if (!channels.length) {
    state.serverLookup = {
      mode: 'text',
      value: 'No channels were returned for that server.',
    };
    refreshScopeLookup();
    return;
  }

  state.serverLookup = {
    mode: 'html',
    value: channels
      .map((channel) => {
        const flags = [
          channel.nsfw ? 'NSFW' : '',
          channel.parentId ? `parent:${escapeHtml(channel.parentId)}` : '',
        ]
          .filter(Boolean)
          .join(' | ');

        return `
          <div class="guild-line">
            <strong>#${escapeHtml(channel.name || 'unnamed')}</strong>
            <span class="mono">${escapeHtml(channel.id)}</span>
            <span>${escapeHtml(flags || 'Text channel')}</span>
          </div>
        `;
      })
      .join(''),
  };
  refreshScopeLookup();
}

function renderLogs(logs) {
  elements.logStream.innerHTML = '';

  if (!logs || logs.length === 0) {
    elements.logStream.innerHTML = '<div class="log-empty">Job logs will appear here.</div>';
    return;
  }

  for (const log of logs) {
    const fragment = elements.logTemplate.content.cloneNode(true);
    fragment.querySelector('.log-time').textContent = new Date(log.timestamp).toLocaleTimeString();
    fragment.querySelector('.log-level').textContent = log.level;
    fragment.querySelector('.log-message').textContent = log.message;

    const metaElement = fragment.querySelector('.log-meta');
    if (log.meta !== undefined) {
      metaElement.textContent =
        typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta, null, 2);
    } else {
      metaElement.remove();
    }

    elements.logStream.appendChild(fragment);
  }
}

function updateProgress(job) {
  const processed = job.progress.deleted + job.progress.failed + job.progress.skipped;
  const totalBase = Math.max(job.progress.totalEstimate, processed, job.progress.matched, 1);
  const percent = Math.min(100, Math.round((processed / totalBase) * 100));
  const queueLabel =
    job.progress.queueSize > 0
      ? `Target ${Math.max(job.progress.queueIndex, 0)} / ${job.progress.queueSize}`
      : 'Target 0 / 0';

  elements.deletedCount.textContent = String(job.progress.deleted);
  elements.failedCount.textContent = String(job.progress.failed);
  elements.matchedCount.textContent = String(job.progress.matched);
  elements.scannedCount.textContent = String(job.progress.scanned);
  elements.skippedCount.textContent = String(job.progress.skipped);
  elements.throttledCount.textContent = String(job.stats.throttledCount);
  elements.progressTarget.textContent = job.currentTarget || 'No current target';
  elements.progressMeta.textContent = `${processed} / ${totalBase} | ${queueLabel}`;
  elements.progressBar.style.width = `${percent}%`;
  elements.elapsedLabel.textContent = `Elapsed: ${job.stats.elapsedLabel}`;
  elements.throttleLabel.textContent = `Throttle: ${job.stats.throttledLabel}`;
}

function stopPolling() {
  if (state.pollHandle) {
    window.clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
}

function applyJobState(job) {
  state.activeJobId = job.id;
  elements.stopActiveJob.disabled = !['queued', 'running', 'stopping'].includes(job.status);

  if (job.status === 'completed') {
    setPill(elements.jobBadge, 'Completed', 'good');
  } else if (job.status === 'failed') {
    setPill(elements.jobBadge, 'Failed', 'bad');
  } else if (job.status === 'stopped') {
    setPill(elements.jobBadge, 'Stopped', 'warn');
  } else if (job.status === 'stopping') {
    setPill(elements.jobBadge, 'Stopping', 'warn');
  } else if (job.status === 'running') {
    setPill(elements.jobBadge, 'Running', 'good');
  } else {
    setPill(elements.jobBadge, job.status, 'neutral');
  }

  updateProgress(job);
  renderLogs(job.logs);

  if (['completed', 'failed', 'stopped'].includes(job.status)) {
    elements.stopActiveJob.disabled = true;
    stopPolling();
  }
}

async function pollJob() {
  if (!state.activeJobId) return;

  try {
    const payload = await api(`/api/jobs/${state.activeJobId}`, undefined, 'GET');
    applyJobState(payload.job);
  } catch (error) {
    stopPolling();
    renderLogs([
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: error.message,
      },
    ]);
  }
}

function startPolling(jobId) {
  state.activeJobId = jobId;
  stopPolling();
  state.pollHandle = window.setInterval(pollJob, POLL_MS);
}

function buildFilterSummary() {
  const parts = [];

  if (elements.content.value.trim()) {
    parts.push(`text contains "${elements.content.value.trim().slice(0, 28)}"`);
  }
  if (elements.pattern.value.trim()) {
    parts.push(`regex ${elements.pattern.value.trim().slice(0, 28)}`);
  }
  if (elements.hasLink.checked) parts.push('links only');
  if (elements.hasFile.checked) parts.push('files only');
  if (elements.includePinned.checked) parts.push('includes pinned');
  if (elements.includeNsfw.checked) parts.push('NSFW on');
  if (elements.minDate.value) parts.push(`after ${elements.minDate.value.replace('T', ' ')}`);
  if (elements.maxDate.value) parts.push(`before ${elements.maxDate.value.replace('T', ' ')}`);

  return parts.length > 0 ? parts.join(' | ') : 'No filters set';
}

function hasBroadDeleteShape() {
  return !(
    elements.content.value.trim() ||
    elements.pattern.value.trim() ||
    elements.hasLink.checked ||
    elements.hasFile.checked ||
    elements.minDate.value ||
    elements.maxDate.value
  );
}

function describeBulkTarget() {
  const channelCount = splitList(elements.channelIds.value).length;

  if (state.scopeMode === 'all-dms') {
    return 'All reachable DM and group DM conversations';
  }

  if (state.scopeMode === 'all-servers') {
    return 'All reachable servers on this account';
  }

  if (state.scopeMode === 'all-sources') {
    return 'All reachable servers plus all DM conversations';
  }

  if (state.selectedKind === 'dm-list') {
    return channelCount > 0 ? `${channelCount} custom DM channel(s)` : 'Custom DM list';
  }

  const guildId = elements.guildId.value.trim();
  if (channelCount > 0) {
    return guildId
      ? `${channelCount} channel(s) inside server ${guildId}`
      : `${channelCount} selected channel(s)`;
  }

  return guildId ? `All searchable channels in server ${guildId}` : 'One server';
}

function describeScopeCard() {
  if (state.workflow === 'direct') {
    return {
      title: 'Exact targets',
      description:
        'Paste exact message URLs or channel/message IDs from any DM or server. Only those pasted targets will be deleted.',
    };
  }

  if (state.scopeMode === 'all-dms') {
    return {
      title: 'All DMs',
      description:
        'Search every reachable DM and group DM. Leave filters blank to delete everything you authored there, or add filters to narrow the sweep.',
    };
  }

  if (state.scopeMode === 'all-servers') {
    return {
      title: 'All servers',
      description:
        'Sweep every reachable server using one job. This is the fastest way to remove server history or to delete only matching messages across all servers.',
    };
  }

  if (state.scopeMode === 'all-sources') {
    return {
      title: 'Everywhere',
      description:
        'Combine every reachable server with every reachable DM conversation. This gives you one cross-account sweep for matching messages.',
    };
  }

  if (state.selectedKind === 'dm-list') {
    return {
      title: 'Custom DM list',
      description:
        'Run only on the DM or group DM channels you pasted or imported from messages/index.json.',
    };
  }

  return {
    title: 'One server or custom DM list',
    description:
      'Target a single server, a chosen channel batch, or a custom DM list. Preview first if you are about to do a wide delete.',
  };
}

function getSafetySummary() {
  if (state.workflow === 'direct') {
    const targetCount = countDirectTargets(elements.directTargets.value);
    return targetCount > 0 ? 'Deletes only the pasted targets' : 'Paste targets before deleting';
  }

  if (!elements.authorId.value.trim()) {
    return 'Set your author ID before a live delete';
  }

  return hasBroadDeleteShape() ? 'Preview recommended' : 'Filtered delete';
}

function getWarningText() {
  if (state.workflow === 'direct') {
    const targetCount = countDirectTargets(elements.directTargets.value);
    return targetCount > 0
      ? `Exact-target mode is armed for ${targetCount} line(s). Check the list carefully before deleting.`
      : 'Paste at least one message URL or ID pair to use exact-target delete mode.';
  }

  if (!elements.token.value.trim()) {
    return 'Validate your token before starting a delete job.';
  }

  if (!elements.authorId.value.trim()) {
    return 'Author ID is blank. Searches may include messages you cannot delete. Using your validated user ID is the safest setup.';
  }

  if (state.scopeMode === 'selected' && state.selectedKind === 'server' && !elements.guildId.value.trim()) {
    return 'Add a server ID, or switch to All DMs, All servers, or Everywhere.';
  }

  if (state.scopeMode === 'selected' && state.selectedKind === 'dm-list' && splitList(elements.channelIds.value).length === 0) {
    return 'Paste DM channel IDs or import messages/index.json to build a custom DM list.';
  }

  if (hasBroadDeleteShape()) {
    return `No text, file, link, or date filters are set. This will delete nearly every matching message you authored in ${describeBulkTarget().toLowerCase()}.`;
  }

  return 'Preview is the safest first pass before you run a live delete.';
}

function updateBulkActionLabel() {
  if (state.workflow !== 'bulk') return;

  const wideDelete = hasBroadDeleteShape();

  if (state.scopeMode === 'all-dms') {
    elements.startBulkDelete.textContent = wideDelete ? 'Delete all DMs' : 'Delete matching DMs';
    return;
  }

  if (state.scopeMode === 'all-servers') {
    elements.startBulkDelete.textContent = wideDelete
      ? 'Delete all server messages'
      : 'Delete matching server messages';
    return;
  }

  if (state.scopeMode === 'all-sources') {
    elements.startBulkDelete.textContent = wideDelete
      ? 'Delete everything in scope'
      : 'Delete matching messages everywhere';
    return;
  }

  if (state.selectedKind === 'dm-list') {
    elements.startBulkDelete.textContent = wideDelete
      ? 'Delete this DM list'
      : 'Delete matching messages in this DM list';
    return;
  }

  elements.startBulkDelete.textContent = wideDelete ? 'Delete selected scope' : 'Delete matching messages';
}

function refreshScopeLookup() {
  if (state.workflow !== 'bulk') {
    elements.scopeLookupHeading.textContent = 'Format help';
    setLookupContent(
      'html',
      'Direct mode accepts full Discord message URLs, <code>channelId,messageId</code>, or <code>guildId,channelId,messageId</code>.'
    );
    return;
  }

  if (state.scopeMode !== 'selected') {
    elements.scopeLookupHeading.textContent = 'Global scope helper';
    setLookupContent('text', DEFAULT_GLOBAL_LOOKUP);
    return;
  }

  if (state.selectedKind === 'dm-list') {
    elements.scopeLookupHeading.textContent = 'DM import helper';
    setLookupContent(state.dmLookup.mode, state.dmLookup.value);
    return;
  }

  elements.scopeLookupHeading.textContent = 'Server channels';
  setLookupContent(state.serverLookup.mode, state.serverLookup.value);
}

function updateScopeSummary() {
  const cardDetails = describeScopeCard();
  const directTargetCount = countDirectTargets(elements.directTargets.value);
  const targetLabel = state.workflow === 'direct'
    ? (directTargetCount > 0 ? `${directTargetCount} exact target line(s)` : 'Exact URLs or IDs')
    : describeBulkTarget();

  elements.scopeTitle.textContent = cardDetails.title;
  elements.scopeDescription.textContent = cardDetails.description;
  elements.scopeModeValue.textContent = state.workflow === 'bulk' ? 'Match and sweep' : 'Exact targets';
  elements.scopeTargetValue.textContent = targetLabel;
  elements.scopeFilterValue.textContent =
    state.workflow === 'bulk'
      ? buildFilterSummary()
      : (directTargetCount > 0 ? `${directTargetCount} target line(s) ready` : 'No target lines pasted');
  elements.scopeSafetyValue.textContent = getSafetySummary();
  elements.scopeWarning.textContent = getWarningText();
  elements.scopeBadge.textContent = targetLabel;
  updateBulkActionLabel();
}

function isLoadedTokenEntry(entry) {
  return elements.token.value.trim() && entry.token === elements.token.value.trim();
}

function renderTokenLibrary() {
  elements.savedTokenCount.textContent = `${state.savedTokens.length} saved`;

  if (state.savedTokens.length === 0) {
    elements.savedTokensList.innerHTML = '<div class="vault-empty">No saved tokens yet.</div>';
    return;
  }

  const sorted = state.savedTokens
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  elements.savedTokensList.innerHTML = sorted
    .map((entry) => {
      const isLoaded = isLoadedTokenEntry(entry);
      const metaParts = [];

      if (isLoaded) {
        metaParts.push('Loaded in the editor');
      }
      metaParts.push(`Updated ${formatTimestamp(entry.updatedAt)}`);

      return `
        <article class="token-item ${isLoaded ? 'active' : ''}">
          <div class="token-main">
            <strong class="sensitive-value">${escapeHtml(entry.label)}</strong>
            <span class="token-meta sensitive-value">${escapeHtml(metaParts.join(' | '))}</span>
          </div>
          <div class="token-actions">
            <button class="button small secondary" type="button" data-token-action="load" data-token-id="${escapeHtml(entry.id)}">Load</button>
            <button class="button small ghost" type="button" data-token-action="delete" data-token-id="${escapeHtml(entry.id)}">Delete</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function syncCurrentTokenState() {
  const token = elements.token.value.trim();
  const matchingEntry = state.savedTokens.find((entry) => entry.token === token) ?? null;

  state.selectedTokenId = matchingEntry?.id ?? '';
  if (matchingEntry && !elements.tokenLabel.value.trim()) {
    elements.tokenLabel.value = matchingEntry.label;
  }

  if (token !== state.validatedToken) {
    invalidateValidatedSession('Needs validation');
  }

  renderTokenLibrary();
  updateScopeSummary();
}

function generateTokenLabel() {
  if (elements.tokenLabel.value.trim()) {
    return elements.tokenLabel.value.trim();
  }

  if (state.currentAccount) {
    return buildAccountLabel(state.currentAccount);
  }

  if (elements.authorId.value.trim()) {
    return `User ${elements.authorId.value.trim()}`;
  }

  return `Saved token ${state.savedTokens.length + 1}`;
}

function saveCurrentTokenLocally() {
  const token = elements.token.value.trim();
  if (!token) {
    throw new Error('Paste a token before saving it locally.');
  }

  const label = generateTokenLabel();
  const now = new Date().toISOString();
  const selectedEntry = state.selectedTokenId
    ? state.savedTokens.find((entry) => entry.id === state.selectedTokenId)
    : null;
  const matchingEntry = state.savedTokens.find((entry) => entry.token === token) ?? null;
  const existingEntry = selectedEntry ?? matchingEntry;

  if (existingEntry) {
    existingEntry.label = label;
    existingEntry.token = token;
    existingEntry.updatedAt = now;
    state.selectedTokenId = existingEntry.id;
  } else {
    const entry = {
      id: createTokenId(),
      label,
      token,
      createdAt: now,
      updatedAt: now,
    };
    state.savedTokens.push(entry);
    state.selectedTokenId = entry.id;
  }

  elements.tokenLabel.value = label;
  saveTokenLibrary();
  renderTokenLibrary();
  writePlannerSettings();
}

function loadSavedToken(tokenId) {
  const entry = state.savedTokens.find((item) => item.id === tokenId);
  if (!entry) {
    throw new Error('That saved token no longer exists.');
  }

  elements.token.value = entry.token;
  elements.tokenLabel.value = entry.label;
  state.selectedTokenId = entry.id;
  invalidateValidatedSession('Loaded locally');
  renderTokenLibrary();
  updateScopeSummary();
  writePlannerSettings();
}

function deleteSavedToken(tokenId) {
  const entry = state.savedTokens.find((item) => item.id === tokenId);
  if (!entry) {
    throw new Error('That saved token no longer exists.');
  }

  if (!window.confirm(`Delete the saved token "${entry.label}" from this browser?`)) {
    return;
  }

  state.savedTokens = state.savedTokens.filter((item) => item.id !== tokenId);
  if (state.selectedTokenId === tokenId) {
    state.selectedTokenId = '';
  }

  saveTokenLibrary();
  renderTokenLibrary();
  writePlannerSettings();
}

function forgetCurrentSavedToken() {
  const token = elements.token.value.trim();
  const entry = state.savedTokens.find((item) => item.id === state.selectedTokenId)
    ?? state.savedTokens.find((item) => item.token === token)
    ?? null;

  if (!entry) {
    throw new Error('The current token does not have a saved local copy to forget.');
  }

  deleteSavedToken(entry.id);
}

function syncPlannerUi() {
  const bulkActive = state.workflow === 'bulk';
  const selectedScopeActive = state.scopeMode === 'selected';
  const serverSelected = state.selectedKind === 'server';

  for (const button of elements.workflowButtons) {
    button.classList.toggle('active', button.dataset.workflow === state.workflow);
    button.disabled = state.isBusy;
  }

  for (const button of elements.scopeButtons) {
    button.classList.toggle('active', button.dataset.scopeMode === state.scopeMode);
    button.disabled = state.isBusy || !bulkActive;
  }

  for (const button of elements.selectedKindButtons) {
    button.classList.toggle('active', button.dataset.selectedKind === state.selectedKind);
    button.disabled = state.isBusy || !bulkActive || !selectedScopeActive;
  }

  elements.bulkPanel.hidden = !bulkActive;
  elements.directPanel.hidden = bulkActive;
  elements.filtersCard.hidden = !bulkActive;
  elements.searchDelayField.hidden = !bulkActive;
  elements.selectedScopeFields.hidden = !bulkActive || !selectedScopeActive;
  elements.serverFieldGroup.hidden = !bulkActive || !selectedScopeActive || !serverSelected;
  elements.archiveImportRow.hidden = !bulkActive || !selectedScopeActive || serverSelected;

  elements.channelIdsLabel.textContent = serverSelected
    ? 'Specific channel IDs (optional)'
    : 'DM or group DM channel IDs';
  elements.channelIds.placeholder = serverSelected
    ? 'Leave blank to sweep every searchable channel in this server.'
    : 'Paste one DM or group DM channel ID per line, or import messages/index.json.';

  elements.validateSession.disabled = state.isBusy;
  elements.useValidatedUser.disabled = state.isBusy;
  elements.clearSavedSettings.disabled = state.isBusy;
  elements.fetchGuildChannels.disabled =
    state.isBusy || !bulkActive || !selectedScopeActive || !serverSelected;
  elements.previewBulk.disabled = state.isBusy || !bulkActive;
  elements.startBulkDelete.disabled = state.isBusy || !bulkActive;
  elements.startDirectDelete.disabled = state.isBusy || bulkActive;
  elements.saveCurrentToken.disabled = state.isBusy;
  elements.forgetCurrentToken.disabled = state.isBusy;
  elements.clearFilters.disabled = state.isBusy || !bulkActive;

  refreshScopeLookup();
  updateScopeSummary();
}

async function validateToken() {
  const token = elements.token.value.trim();
  if (!token) {
    throw new Error('Paste a Discord token first.');
  }

  setDisabled(true);
  try {
    const payload = await api('/api/account/lookup', { token });
    state.currentAccount = payload.user;
    state.validatedToken = token;
    elements.accountBadge.textContent = `${payload.user.username} (${payload.user.id})`;
    setPill(elements.sessionBadge, 'Validated', 'good');

    if (!elements.authorId.value.trim()) {
      elements.authorId.value = payload.user.id;
    }

    if (!elements.tokenLabel.value.trim()) {
      elements.tokenLabel.value = buildAccountLabel(payload.user);
    }

    updateScopeSummary();
    writePlannerSettings();
  } catch (error) {
    setPill(elements.sessionBadge, 'Invalid token', 'bad');
    throw error;
  } finally {
    setDisabled(false);
  }
}

function buildBulkPayload(previewOnly) {
  const payload = {
    token: elements.token.value.trim(),
    authorId: elements.authorId.value.trim(),
    scopeMode: state.scopeMode,
    guildId: '',
    channelIds: '',
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

  if (state.scopeMode === 'selected') {
    payload.guildId = state.selectedKind === 'dm-list' ? '@me' : elements.guildId.value.trim();
    payload.channelIds = elements.channelIds.value;
  }

  return payload;
}

function confirmBulkDelete(payload) {
  if (payload.previewOnly) return true;

  return window.confirm(
    `Start delete job?\n\n` +
      `Workflow: Match and sweep\n` +
      `Scope: ${describeBulkTarget()}\n` +
      `Author ID: ${payload.authorId || '(blank)'}\n` +
      `Filters: ${buildFilterSummary()}\n\n` +
      `${getWarningText()}`
  );
}

async function startBulk(previewOnly) {
  const bulkPayload = buildBulkPayload(previewOnly);
  if (!confirmBulkDelete(bulkPayload)) return;

  setDisabled(true);
  try {
    const payload = await api('/api/jobs/bulk', bulkPayload);
    applyJobState(payload.job);
    startPolling(payload.job.id);
    await pollJob();
  } finally {
    setDisabled(false);
  }
}

async function startDirectDelete() {
  const targetCount = countDirectTargets(elements.directTargets.value);
  if (!targetCount) {
    throw new Error('Paste at least one message target first.');
  }

  if (!window.confirm(`Delete the ${targetCount} exact target line(s) currently listed?`)) {
    return;
  }

  setDisabled(true);
  try {
    const payload = await api('/api/jobs/direct', {
      token: elements.token.value.trim(),
      targetsText: elements.directTargets.value,
      deleteDelay: elements.deleteDelay.value,
      maxAttempt: elements.maxAttempt.value,
      note: elements.note.value.trim(),
    });
    applyJobState(payload.job);
    startPolling(payload.job.id);
    await pollJob();
  } finally {
    setDisabled(false);
  }
}

async function stopActiveJob() {
  if (!state.activeJobId) return;
  const payload = await api(`/api/jobs/${state.activeJobId}/stop`, {});
  applyJobState(payload.job);
}

async function fetchGuildChannels() {
  const token = elements.token.value.trim();
  const guildId = elements.guildId.value.trim();
  if (!token || !guildId) {
    throw new Error('Add a token and a server ID first.');
  }

  setDisabled(true);
  try {
    const payload = await api('/api/guilds/channels', { token, guildId });
    renderGuildChannels(payload.channels);
  } finally {
    setDisabled(false);
  }
}

async function importArchive(event) {
  const [file] = event.target.files;
  if (!file) return;

  const rawText = await file.text();
  const json = JSON.parse(rawText);
  const channelIds = Object.keys(json);
  state.workflow = 'bulk';
  state.scopeMode = 'selected';
  state.selectedKind = 'dm-list';
  elements.channelIds.value = channelIds.join(',\n');
  state.dmLookup = {
    mode: 'text',
    value: `Imported ${channelIds.length} DM or user channel ID(s) from messages/index.json.`,
  };
  syncPlannerUi();
  writePlannerSettings();
}

function clearFilters() {
  elements.content.value = '';
  elements.pattern.value = '';
  elements.hasLink.checked = false;
  elements.hasFile.checked = false;
  elements.includePinned.checked = false;
  elements.includeNsfw.checked = false;
  elements.minDate.value = '';
  elements.maxDate.value = '';
  writePlannerSettings();
  updateScopeSummary();
}

function clearSaved() {
  clearPlannerSettings();
  elements.rememberSettings.checked = false;
  writePlannerSettings();
}

function applyTheme(theme) {
  state.theme = VALID_THEMES.has(theme) ? theme : 'linen';
  applyUiPrefs();
  writeUiPrefs();
}

function applyStreamerMode(enabled) {
  state.streamerMode = Boolean(enabled);
  applyUiPrefs();
  writeUiPrefs();
}

function bindFieldEvents() {
  const fieldsNeedingSummaryOnly = [
    elements.authorId,
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
    elements.rememberSettings,
    elements.tokenLabel,
  ];

  elements.token.addEventListener('input', () => {
    syncCurrentTokenState();
    writePlannerSettings();
  });
  elements.token.addEventListener('change', () => {
    syncCurrentTokenState();
    writePlannerSettings();
  });

  for (const field of fieldsNeedingSummaryOnly) {
    field.addEventListener('input', () => {
      writePlannerSettings();
      updateScopeSummary();
    });
    field.addEventListener('change', () => {
      writePlannerSettings();
      updateScopeSummary();
    });
  }
}

function bindSavedTokenActions() {
  elements.savedTokensList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token-action]');
    if (!button) return;

    const tokenId = button.getAttribute('data-token-id');
    const action = button.getAttribute('data-token-action');

    try {
      if (action === 'load') {
        loadSavedToken(tokenId);
      } else if (action === 'delete') {
        deleteSavedToken(tokenId);
      }
    } catch (error) {
      window.alert(error.message);
    }
  });
}

function bindEventHandlers() {
  elements.themePicker.addEventListener('change', () => applyTheme(elements.themePicker.value));
  elements.streamerModeToggle.addEventListener('change', () =>
    applyStreamerMode(elements.streamerModeToggle.checked)
  );

  elements.validateSession.addEventListener('click', () =>
    validateToken().catch((error) => window.alert(error.message))
  );

  elements.useValidatedUser.addEventListener('click', () => {
    if (!state.currentAccount) return;
    elements.authorId.value = state.currentAccount.id;
    writePlannerSettings();
    updateScopeSummary();
  });

  elements.saveCurrentToken.addEventListener('click', () => {
    try {
      saveCurrentTokenLocally();
    } catch (error) {
      window.alert(error.message);
    }
  });

  elements.forgetCurrentToken.addEventListener('click', () => {
    try {
      forgetCurrentSavedToken();
    } catch (error) {
      window.alert(error.message);
    }
  });

  elements.fetchGuildChannels.addEventListener('click', () =>
    fetchGuildChannels().catch((error) => window.alert(error.message))
  );
  elements.previewBulk.addEventListener('click', () =>
    startBulk(true).catch((error) => window.alert(error.message))
  );
  elements.startBulkDelete.addEventListener('click', () =>
    startBulk(false).catch((error) => window.alert(error.message))
  );
  elements.startDirectDelete.addEventListener('click', () =>
    startDirectDelete().catch((error) => window.alert(error.message))
  );
  elements.stopActiveJob.addEventListener('click', () =>
    stopActiveJob().catch((error) => window.alert(error.message))
  );
  elements.archiveImport.addEventListener('change', (event) =>
    importArchive(event).catch((error) => window.alert(error.message))
  );
  elements.clearSavedSettings.addEventListener('click', clearSaved);
  elements.clearFilters.addEventListener('click', clearFilters);

  for (const button of elements.workflowButtons) {
    button.addEventListener('click', () => {
      state.workflow = button.dataset.workflow;
      syncPlannerUi();
      writePlannerSettings();
    });
  }

  for (const button of elements.scopeButtons) {
    button.addEventListener('click', () => {
      state.scopeMode = button.dataset.scopeMode;
      syncPlannerUi();
      writePlannerSettings();
    });
  }

  for (const button of elements.selectedKindButtons) {
    button.addEventListener('click', () => {
      state.selectedKind = button.dataset.selectedKind;
      syncPlannerUi();
      writePlannerSettings();
    });
  }

  bindFieldEvents();
  bindSavedTokenActions();
}

function init() {
  restoreTokenLibrary();
  restoreUiPrefs();
  restorePlannerSettings();
  bindEventHandlers();
  applyUiPrefs();
  setPill(elements.jobBadge, 'Idle', 'neutral');
  renderTokenLibrary();
  invalidateValidatedSession(elements.token.value.trim() ? 'Needs validation' : 'Not validated');
  syncCurrentTokenState();
  syncPlannerUi();
}

init();
