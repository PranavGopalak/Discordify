# discordify

`discordify` is a focused local web app for previewing and deleting your own Discord messages. It supports DMs, servers, combined account sweeps, and exact message links without requiring a browser extension.

## What it does

1. Validates a Discord account and automatically restricts bulk search to that account's author ID.
2. Previews matches before a destructive run.
3. Searches one server, selected channels, every DM, every server, or all reachable sources.
4. Deletes exact message URLs or channel and message ID pairs.
5. Supports text, regex, link, file, pinned, NSFW, and date filters.
6. Displays progress, failures, rate limits, and a bounded activity log.
7. Reopens archived threads when Discord allows it, then retries the message delete.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://127.0.0.1:4782`.

For development with automatic server restarts:

```bash
npm run dev
```

## Safe workflow

1. Paste the account token and connect.
2. Choose a scope.
3. Add filters if the sweep should not match every message in that scope.
4. Run Preview.
5. Review the counts and scope.
6. Start the delete only when the preview matches your intent.

Deletion is permanent. The automated test suite never calls Discord and never deletes real messages.

## Privacy and security

The server binds only to `127.0.0.1`. The interface never saves a Discord token to local storage or disk. A token exists in process memory only while validating an account or running a job, and completed jobs explicitly release it. Planner preferences can be saved separately and never include the token.

The server rejects unknown hostnames and cross-origin write requests, limits request bodies, disables caching, and sends a restrictive content security policy. Any hosted deployment should remain behind an authenticated private access layer because the application accepts a sensitive account credential and exposes destructive actions.

Using a user account token for automation can violate Discord's rules. Review Discord's current policies and use the project only with an account and messages you are authorized to manage.

## Message sweep fix

Discord search results shrink as successful deletes remove messages. A failed, pinned, filtered, or otherwise retained message remains in the result set. Advancing the search as if every result disappeared can skip later messages, while never advancing past retained results can loop on the same page.

The sweep now advances only by the number of results that actually remain. Successful deletes are removed from pagination, retained failures are counted into the next offset, and archived threads are reopened once before the message is recorded as retained. Rate-limit delays follow Discord's reported wait and gradually return to the configured floor after successful requests.

## Validation

```bash
npm run validate
```

Validation includes syntax checks and deterministic tests for shrinking search pages, retained failures, archived threads, rate limits, token release, health and revision diagnostics, hostname restrictions, and cross-origin write protection.

## License

`discordify` is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
