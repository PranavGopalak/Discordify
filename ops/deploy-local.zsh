#!/bin/zsh
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
revision="${1:-}"
runtime="/Users/pranav/.local/bin/node"
release_root="/Users/pranav/.local/share/discordify"
releases_dir="$release_root/releases"
current_link="$release_root/current"
launchagent_source="$repository_root/ops/dev.pranavg.discordify.plist"
launchagent_path="/Users/pranav/Library/LaunchAgents/dev.pranavg.discordify.plist"
service_target="gui/$(id -u)/dev.pranavg.discordify"
candidate_port="3115"
live_port="3015"

if [[ ! "$revision" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 "Usage: zsh ops/deploy-local.zsh <full-production-revision>"
  exit 64
fi

git -C "$repository_root" cat-file -e "$revision^{commit}"
test "$revision" = "$(git -C "$repository_root" rev-parse origin/production)"
test -x "$runtime"
plutil -lint "$launchagent_source" >/dev/null

temporary_root="$(mktemp -d /tmp/discordify-deploy.XXXXXX)"
candidate_dir="$temporary_root/candidate"
candidate_log="$temporary_root/candidate.log"
candidate_pid=""
previous_target=""
installed_plist_backup=""

cleanup() {
  if [[ -n "$candidate_pid" ]] && kill -0 "$candidate_pid" >/dev/null 2>&1; then
    kill "$candidate_pid" >/dev/null 2>&1 || true
    wait "$candidate_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$candidate_dir"
git -C "$repository_root" archive "$revision" | tar -x -C "$candidate_dir"

(
  cd "$candidate_dir"
  PORT="$candidate_port" DISCORDIFY_REVISION="$revision" \
    "$runtime" \
      --permission \
      "--allow-fs-read=$candidate_dir" \
      --max-old-space-size=192 \
      server.mjs >"$candidate_log" 2>&1
) &
candidate_pid=$!

for attempt in {1..40}; do
  if curl -fsS "http://127.0.0.1:$candidate_port/__health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$candidate_pid" >/dev/null 2>&1; then
    print -u2 "Discordify candidate exited before becoming healthy."
    sed -n '1,120p' "$candidate_log" >&2
    exit 1
  fi
  sleep 0.25
done

test "$(curl -fsS "http://127.0.0.1:$candidate_port/__version")" = "{\"revision\":\"$revision\"}"
curl -fsS "http://127.0.0.1:$candidate_port/" | grep -q 'Clear what you no longer need.'
kill "$candidate_pid"
wait "$candidate_pid" >/dev/null 2>&1 || true
candidate_pid=""

mkdir -p "$releases_dir" "$(dirname "$launchagent_path")" "$(dirname /Users/pranav/Library/Logs/discordify.log)"
release_path="$releases_dir/$revision"
if [[ ! -d "$release_path" ]]; then
  mv "$candidate_dir" "$release_path"
  find "$release_path" -type d -exec chmod 500 {} +
  find "$release_path" -type f -exec chmod 400 {} +
fi

if [[ -L "$current_link" ]]; then
  previous_target="$(readlink "$current_link")"
fi
ln -s "$release_path" "$temporary_root/current"
mv -f "$temporary_root/current" "$current_link"

if [[ -f "$launchagent_path" ]]; then
  installed_plist_backup="$temporary_root/previous.plist"
  cp "$launchagent_path" "$installed_plist_backup"
fi
sed "s/__REVISION__/$revision/g" "$launchagent_source" > "$temporary_root/dev.pranavg.discordify.plist"
plutil -lint "$temporary_root/dev.pranavg.discordify.plist" >/dev/null
chmod 600 "$temporary_root/dev.pranavg.discordify.plist"
cp "$temporary_root/dev.pranavg.discordify.plist" "$launchagent_path"
chmod 600 "$launchagent_path"

if launchctl print "$service_target" >/dev/null 2>&1; then
  launchctl bootout "$service_target"
fi
launchctl bootstrap "gui/$(id -u)" "$launchagent_path"
launchctl enable "$service_target"

for attempt in {1..40}; do
  if curl -fsS "http://127.0.0.1:$live_port/__health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! test "$(curl -fsS "http://127.0.0.1:$live_port/__version")" = "{\"revision\":\"$revision\"}"; then
  print -u2 "Discordify activation failed, restoring the previous release."
  launchctl bootout "$service_target" >/dev/null 2>&1 || true
  if [[ -n "$previous_target" ]]; then
    ln -s "$previous_target" "$temporary_root/rollback-current"
    mv -f "$temporary_root/rollback-current" "$current_link"
  fi
  if [[ -n "$installed_plist_backup" ]]; then
    cp "$installed_plist_backup" "$launchagent_path"
    chmod 600 "$launchagent_path"
    launchctl bootstrap "gui/$(id -u)" "$launchagent_path"
  fi
  exit 1
fi

launchctl print "$service_target" >/dev/null
lsof -nP -iTCP:"$live_port" -sTCP:LISTEN | grep -q '127.0.0.1:'
print "Discordify deployed at revision $revision"
