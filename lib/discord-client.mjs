import { buildQueryString } from './helpers.mjs';

const API_BASE = 'https://discord.com/api/v9';
const DEFAULT_HEADERS = {
  Accept: '*/*',
  Origin: 'https://discord.com',
  Referer: 'https://discord.com/channels/@me',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
};

export class DiscordClient {
  constructor(token, metricsSink) {
    this.token = token;
    this.metricsSink = metricsSink;
  }

  async raw(path, options = {}) {
    const query = options.query ? buildQueryString(options.query) : '';
    const url = `${API_BASE}${path}${query ? `?${query}` : ''}`;

    const headers = {
      ...DEFAULT_HEADERS,
      Authorization: this.token,
      ...(options.headers ?? {}),
    };

    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const startedAt = Date.now();
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });
    this.metricsSink?.recordPing(Date.now() - startedAt);
    return response;
  }

  getCurrentUser(signal) {
    return this.raw('/users/@me', { signal });
  }

  getPrivateChannels(signal) {
    return this.raw('/users/@me/channels', { signal });
  }

  getGuilds(options = {}, signal) {
    return this.raw('/users/@me/guilds', {
      signal,
      query: [
        ['limit', options.limit ?? 200],
        ['after', options.after || undefined],
      ],
    });
  }

  getGuildChannels(guildId, signal) {
    return this.raw(`/guilds/${guildId}/channels`, { signal });
  }

  searchMessages(options, signal) {
    const path =
      options.guildId === '@me'
        ? `/channels/${options.channelId}/messages/search`
        : `/guilds/${options.guildId}/messages/search`;

    return this.raw(path, {
      signal,
      query: [
        ['author_id', options.authorId || undefined],
        ['channel_id', options.guildId !== '@me' ? options.channelId || undefined : undefined],
        ['min_id', options.minId || undefined],
        ['max_id', options.maxId || undefined],
        ['sort_by', 'timestamp'],
        ['sort_order', 'desc'],
        ['offset', options.offset || 0],
        ['has', options.hasLink ? 'link' : undefined],
        ['has', options.hasFile ? 'file' : undefined],
        ['content', options.content || undefined],
        ['include_nsfw', options.includeNsfw ? true : undefined],
      ],
    });
  }

  deleteMessage(channelId, messageId, signal) {
    return this.raw(`/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      signal,
    });
  }
}
