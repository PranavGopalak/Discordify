# discordify - bulk delete Discord messages locally

`discordify` is an open-source local web app for bulk deleting Discord messages, Discord DMs, and Discord server messages without a browser extension. It runs on your machine, keeps the UI on `localhost`, and helps you delete all DMs, delete all server messages, or delete specific Discord message links and IDs from one place.

If people are searching for a Discord message deleter, Discord DM deleter, Discord message cleaner, bulk delete Discord messages tool, or an Undiscord alternative that runs locally, this project is built for that workflow.

Buy me a coffee: [Sponsor the project](https://paypal.me/Gopalakumaran)

## What discordify does

- Bulk delete your own Discord messages in one server, all servers, all DMs, or across both at once.
- Delete all Discord DMs or only matching DMs with filters.
- Delete all Discord server messages or only matching messages across every server you can access.
- Delete specific Discord messages from full message URLs or direct ID targets.
- Filter by text, regex, links, attachments, pinned messages, NSFW, and date range.
- Preview matches before deleting.
- Inspect server channels to build channel batches.
- Save tokens locally in the browser, switch themes, and use streamer mode to hide sensitive info on screen.

## Who this is for

`discordify` is useful if you want to:

- bulk delete Discord messages without a browser extension
- delete all Discord DMs from your own account
- delete all Discord server messages from one or many servers
- delete specific Discord messages by URL or message ID
- clean up Discord history from a local dashboard instead of a userscript tab

## Delete modes

### 1. Delete all Discord DMs

Use the `All DMs` mode to search every reachable DM and group DM conversation for the account token you loaded.

### 2. Delete all Discord server messages

Use the `All servers` mode to search every reachable server and delete your own messages across them.

### 3. Delete specific Discord messages

Use the `Exact targets` mode to delete:

- full Discord message URLs
- `channelId,messageId`
- `guildId,channelId,messageId`

### 4. Delete matching messages everywhere

Use the `Everywhere` mode to combine all servers and all DMs in one sweep. This is useful for deleting specific kinds of messages across your whole Discord history with filters.

## Why this project exists

Many Discord cleanup tools depend on browser extensions or userscripts. `discordify` keeps the interface local, works as a standalone web app, and aims to make Discord message cleanup easier to manage, preview, and monitor from a cleaner UI.

## Features

- Local-first UI served from `localhost`
- Bulk delete workflows for DMs, servers, and mixed scopes
- Exact-target delete mode for specific messages
- Preview mode before live deletion
- Channel inspection for server-scoped jobs
- Local activity log with progress, counters, and retry visibility
- Multiple themes
- Local token vault in the browser
- Streamer mode for hiding sensitive details on screen

## Quick start

### Requirements

- Node.js 18+

### Run locally

```bash
npm install
npm start
```

Then open:

```text
http://127.0.0.1:4782
```

For development with auto-restart:

```bash
npm run dev
```

## Support

If `discordify` saves you time, you can support ongoing work here:

- [Buy me a coffee / sponsor the project](https://paypal.me/Gopalakumaran)

## How it works

1. Paste a Discord authorization token.
2. Validate the session locally.
3. Choose a delete mode:
   - one server or custom DM list
   - all DMs
   - all servers
   - everywhere
   - exact targets
4. Add filters if you only want specific messages deleted.
5. Preview matches first.
6. Start the delete job and monitor progress in the activity log.

## Local storage, privacy, and safety

- The UI runs locally, but the app still needs your Discord authorization token to call Discord on your behalf.
- Saved tokens and UI preferences are stored in your browser's local storage on the machine running the app.
- Streamer mode hides sensitive information on screen, but it is a visual privacy feature, not encryption.
- Global DM sweeps can load reachable DM conversations automatically. Importing `messages/index.json` or pasting DM channel IDs is only needed for a custom DM list.
- "Files only" means messages that contain attachments. Discord does not support deleting only the attachment while keeping the message.
- This workflow can still hit Discord rate limits and may violate Discord's rules.

## FAQ

### Can this delete all Discord DMs?

Yes. Use the `All DMs` mode to sweep reachable DM and group DM conversations for the loaded account.

### Can this delete all Discord server messages?

Yes. Use `All servers` to search across every reachable server, or use `One server` if you only want one guild.

### Can this delete specific Discord messages?

Yes. Use the `Exact targets` mode and paste full message URLs or message ID formats supported by the UI.

### Does discordify work without a browser extension?

Yes. It is a standalone local web app served from your machine.

### Is this open source?

Yes. The project is designed to be published and easy to self-host locally.

## Search-friendly summary

`discordify` is a local, open-source Discord message deleter and Discord DM deleter for people who want to bulk delete Discord messages, clean up Discord history, delete all Discord DMs, delete all Discord server messages, or remove specific Discord messages by URL or ID without using a browser extension.

## License

`discordify` is licensed under the GNU General Public License v3.0. See [LICENSE](/C:/Users/prana/Documents/GitHub/undiscord-local-app/LICENSE).
