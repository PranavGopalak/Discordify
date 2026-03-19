const DISCORD_EPOCH = 1420070400000n;

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function msToHMS(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function coerceBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toSnowflake(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return '';
  if (/^\d{16,20}$/.test(trimmed)) return trimmed;

  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) return trimmed;

  const millisecondsSinceDiscordEpoch = BigInt(parsedDate) - DISCORD_EPOCH;
  if (millisecondsSinceDiscordEpoch <= 0n) return '0';
  return String(millisecondsSinceDiscordEpoch << 22n);
}

export function buildQueryString(params) {
  return params
    .filter((pair) => pair[1] !== undefined && pair[1] !== null && pair[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function parseChannelIds(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((value) => safeTrim(value))
      .filter(Boolean);
  }

  return String(rawValue ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseMessageTargets(rawValue) {
  const lines = String(rawValue ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const targets = [];
  const errors = [];

  for (const line of lines) {
    const urlMatch = line.match(
      /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/([^/]+)\/(\d+)\/(\d+)\/?$/i
    );
    if (urlMatch) {
      targets.push({
        guildId: urlMatch[1],
        channelId: urlMatch[2],
        messageId: urlMatch[3],
        source: line,
      });
      continue;
    }

    const parts = line
      .split(/[,\s|]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      targets.push({
        guildId: '',
        channelId: parts[0],
        messageId: parts[1],
        source: line,
      });
      continue;
    }

    if (
      parts.length === 3 &&
      /^[\w@-]+$/.test(parts[0]) &&
      /^\d+$/.test(parts[1]) &&
      /^\d+$/.test(parts[2])
    ) {
      targets.push({
        guildId: parts[0],
        channelId: parts[1],
        messageId: parts[2],
        source: line,
      });
      continue;
    }

    errors.push(line);
  }

  return { targets, errors };
}

export function pickHitMessages(searchResponse) {
  return (searchResponse?.messages ?? [])
    .map((conversation) => conversation.find((message) => message?.hit === true))
    .filter(Boolean);
}

export function filterCandidateMessages(messages, options) {
  let matches = messages.slice();

  // Deletable message types observed in the original Undiscord implementation.
  matches = matches.filter(
    (message) => message.type === 0 || (message.type >= 6 && message.type <= 21)
  );
  matches = matches.filter((message) => (message.pinned ? options.includePinned : true));

  if (options.pattern) {
    try {
      const regex = new RegExp(options.pattern, 'i');
      matches = matches.filter((message) => regex.test(message.content));
    } catch {
      // Keep the original result set if the regex is invalid.
    }
  }

  const matchedIds = new Set(matches.map((message) => message.id));
  const skipped = messages.filter((message) => !matchedIds.has(message.id));

  return {
    messagesToDelete: matches,
    skippedMessages: skipped,
  };
}

export function describeMessage(message) {
  const author = message?.author?.username
    ? `${message.author.username}#${message.author.discriminator ?? '0000'}`
    : 'unknown-author';
  const content = String(message?.content ?? '').replace(/\s+/g, ' ').trim();
  const summary = content || (message?.attachments?.length ? '[attachments]' : '[empty]');
  return `${author}: ${summary.slice(0, 120)}`;
}

export function createPublicConfig(payload) {
  const { token, ...rest } = payload;
  return rest;
}
