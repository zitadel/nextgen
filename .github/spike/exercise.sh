#!/usr/bin/env bash
# Spike: drive the CLI built from this ref on Windows and record every result.
set -u
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
CLI="$GITHUB_WORKSPACE/apps/cli/bin/run.js"
OUT="$RUNNER_TEMP/findings.md"
: > "$OUT"
PASS=0; FAIL=0

mkdir -p "$RUNNER_TEMP/bin"
printf '#!/usr/bin/env bash\nexec node "%s" "$@" --no-telemetry\n' "$CLI" > "$RUNNER_TEMP/bin/z"
chmod +x "$RUNNER_TEMP/bin/z"
export PATH="$RUNNER_TEMP/bin:$PATH"

# t <name> <command...>: run, log, never abort.
t() {
  local name="$1"; shift
  local log="$RUNNER_TEMP/last.log"
  timeout 180 "$@" > "$log" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    PASS=$((PASS+1)); echo "| PASS | $name | 0 |" >> "$OUT"
  else
    FAIL=$((FAIL+1)); echo "| FAIL | $name | $code |" >> "$OUT"
    { echo; echo "<details><summary>$name (exit $code)</summary>"; echo; echo '```'; tail -n 40 "$log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-200; echo '```'; echo "</details>"; echo; } >> "$RUNNER_TEMP/details.md"
  fi
  echo "::group::$name (exit $code)"; sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -n 25 | cut -c1-220; echo "::endgroup::"
  return 0
}
# idof <file>: first "id" value in a JSON log.
jid() { grep -o "\"$2\": *\"[^\"]*\"" "$1" | head -1 | cut -d'"' -f4; }
# tx <name> <command...>: a refusal is the right answer, so a non-zero exit passes.
tx() {
  local name="$1"; shift
  timeout 180 "$@" > "$RUNNER_TEMP/last.log" 2>&1
  local code=$?
  if [ "$code" -ne 0 ]; then PASS=$((PASS+1)); echo "| PASS | $name (refused, exit $code) | $code |" >> "$OUT"
  else FAIL=$((FAIL+1)); echo "| FAIL | $name (expected a refusal) | 0 |" >> "$OUT"; fi
  echo "::group::$name (exit $code)"; sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/last.log" | tail -n 12 | cut -c1-220; echo "::endgroup::"
  return 0
}
idof() { grep -o '"id": *"[^"]*"' "$1" | head -1 | cut -d'"' -f4; }
last() { cat "$RUNNER_TEMP/last.log"; }
: > "$RUNNER_TEMP/details.md"

echo "| Result | Step | Exit |" >> "$OUT"; echo "| --- | --- | --- |" >> "$OUT"

# --- 1. Same-directory start then setup (what a user does) ---
mkdir -p "$RUNNER_TEMP/same" && cd "$RUNNER_TEMP/same"
t "same-dir: start" z start --non-interactive
t "same-dir: setup in the dir the server runs in" z setup --framework react --server local --non-interactive --no-git --dev-port 3100
t "same-dir: stop" z stop
cd "$RUNNER_TEMP"

# --- 2. Server lifecycle ---
mkdir -p "$RUNNER_TEMP/host/app" && cd "$RUNNER_TEMP/host"
t "server: start" z start --non-interactive
t "server: status" z status
t "server: status --json" z status --json
t "server: logs" z logs
t "server: stop" z stop
t "server: status after stop (should report stopped)" z status
t "server: start again" z start --non-interactive
t "server: console (prints link)" z console --json

# --- 3. Scaffold + dev server ---
cd "$RUNNER_TEMP/host/app"
t "setup react" z setup --framework react --server local --non-interactive --no-git --dev-port 3000
t "doctor" z doctor
t "doctor -v (all checks)" z doctor -v
if [ -f package.json ]; then
  (npm run dev > "$RUNNER_TEMP/dev.log" 2>&1 &) ; sleep 12
  t "dev server answers on :3000" curl -fsS -m 20 http://localhost:3000/
  t "dev server /login" curl -fsS -m 20 http://localhost:3000/login
  tail -n 15 "$RUNNER_TEMP/dev.log" | sed 's/\x1b\[[0-9;]*m//g'
fi

# --- 4. Read commands ---
for c in "project list" "schema list" "flow-definition list" "policy list" "branding list" "idp list" \
         "user list" "team list" "grant list" "session list" "invitation list" "origin list" "variable list" "env list" \
         "event list" "release list" "deployment list" "preview list" "resources" "api ls"; do
  # shellcheck disable=SC2086
  t "$c --json" z $c --json
done
t "event list --limit 5" z event list --limit 5 --json
t "event get (first event)" bash -c "id=\$(node '$CLI' event list --limit 1 --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' event get \"\$id\" --json --no-telemetry"
t "api (raw path)" z api /users/query
t "schema get (first)" bash -c "id=\$(node '$CLI' schema list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' schema get \"\$id\" --json --no-telemetry"
t "policy get (first)" bash -c "id=\$(node '$CLI' policy list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' policy get \"\$id\" --json --no-telemetry"

# --- 5. Write commands ---
SCH=$(node "$CLI" schema list --json --no-telemetry | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
t "user create" z user create --non-interactive --json --schema "$SCH" --attributes email=win@example.test
UID_=$(idof "$RUNNER_TEMP/last.log")
t "user get" z user get "$UID_" --json
t "user update" z user update "$UID_" --attributes email=win2@example.test --json
t "team create" z team create --name win-team --json
TID=$(idof "$RUNNER_TEMP/last.log")
t "team get" z team get "$TID" --json
t "team update" z team update "$TID" --set "name=win-team-2" --json
t "invitation create" z invitation create --name win-invite --relation viewer --json
IID=$(idof "$RUNNER_TEMP/last.log")
t "invitation get" z invitation get "$IID" --json
t "invitation cancel" z invitation cancel "$IID" --force --json
t "origin add" z origin add "https://win.example.test" --kind primary --json
t "origin rm" z origin rm "https://win.example.test" --force --json
t "variable set" z variable set WIN_VAR hello --json
t "variable get" z variable get WIN_VAR --json
t "variable resolve" z variable resolve --json
t "variable rm" z variable rm WIN_VAR --force --json
t "env add (dry-run)" z env add staging --server https://api.zitadel.cloud --dry-run --json
tx "auth-method password disable" z auth-method password disable --json
t "project get (id from project list)" bash -c "id=\$(node '$CLI' project list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' project get \"\$id\" --json --no-telemetry"
t "auth-method password enable" z auth-method password enable --json
t "auth-method passkey enable" z auth-method passkey enable --json
t "auth-method passkey disable" z auth-method passkey disable --json
t "policy test" z policy test --json
t "branding eject" z branding eject --json
t "user delete" z user delete "$UID_" --force --json
t "team deactivate" z team deactivate "$TID" --force --json

# --- 6. Release flow ---
t "pull" z pull --json
t "release create" z release create -m "windows spike" --json
RID=$(jid "$RUNNER_TEMP/last.log" release_id)
t "release get" z release get "$RID" --json
t "deployment create" z deployment create --release "$RID" --json
DID=$(jid "$RUNNER_TEMP/last.log" deployment_id)
t "deployment get" z deployment get "$DID" --json
t "deployment rollback" z deployment rollback "$DID" --force --json
t "deploy --dry-run" z deploy --dry-run --json
t "preview (dry-run)" z preview --dry-run --json
tx "release revoke (still live, refused)" z release revoke "$RID" --force --json
t "upgrade --dry-run" z upgrade --dry-run --json

# --- 7. Project extras ---
t "skills add" z skills add --non-interactive
tx "tests add --skip-install (react unsupported)" z tests add --skip-install
t "eject --dry-run" z eject --dry-run --json

# --- 7b. Other frameworks and a path with spaces ---
pkill -f vite 2>/dev/null || true
cd "$RUNNER_TEMP/host"
for fw in vue svelte next; do
  mkdir -p "$RUNNER_TEMP/host/fw $fw" && cd "$RUNNER_TEMP/host/fw $fw"
  t "setup $fw (path with a space)" z setup --framework "$fw" --server local --non-interactive --no-git --dev-port 3200
  t "doctor in $fw project" z doctor
  t "project list in $fw project" z project list --json
  cd "$RUNNER_TEMP/host"
done

# --- 8. Teardown ---
pkill -f vite 2>/dev/null || true
cd "$RUNNER_TEMP/host"
t "stop" z stop
t "reset --force" z reset --force
t "start after reset" z start --non-interactive
t "stop (final)" z stop

# --- 7c. Port in use, free-port fallback and shutdown hygiene ---
mkdir -p "$RUNNER_TEMP/ports" && cd "$RUNNER_TEMP/ports"
node -e 'require("net").createServer().listen(8080,"127.0.0.1");require("net").createServer().listen(8080,"::");setInterval(()=>{},1000)' > /dev/null 2>&1 &
BLOCKER=$!
sleep 2
tx "port: start --port on a held port is refused" z start --port 8080 --non-interactive --json
if grep -q E_PORT_IN_USE "$RUNNER_TEMP/last.log"; then PASS=$((PASS+1)); echo "| PASS | port: refusal code is E_PORT_IN_USE | - |" >> "$OUT"
else FAIL=$((FAIL+1)); echo "| FAIL | port: refusal code is E_PORT_IN_USE | - |" >> "$OUT"; { echo "<details><summary>port refusal output</summary>"; echo '```'; tail -n 30 "$RUNNER_TEMP/last.log" | cut -c1-200; echo '```'; echo "</details>"; } >> "$RUNNER_TEMP/details.md"; fi
t "port: start without --port takes a free port" z start --non-interactive --json
t "port: status reports a running server" z status --json
t "port: stop" z stop
LEFT=$( { pgrep -fl "zitadel-server|nextgen" 2>/dev/null; tasklist 2>/dev/null | grep -iE "zitadel|nextgen"; } || true)
if [ -n "$LEFT" ]; then
  FAIL=$((FAIL+1)); echo "| FAIL | stop leaves no server process behind | - |" >> "$OUT"
  { echo "<details><summary>processes left after stop</summary>"; echo '```'; echo "$LEFT"; echo '```'; echo "</details>"; } >> "$RUNNER_TEMP/details.md"
else PASS=$((PASS+1)); echo "| PASS | stop leaves no server process behind | - |" >> "$OUT"; fi
WAL=$(find "$RUNNER_TEMP/ports/.zitadel" -name '*-wal' -size +0 2>/dev/null)
if [ -n "$WAL" ]; then
  FAIL=$((FAIL+1)); echo "| FAIL | stop leaves a non-empty SQLite WAL (not a clean shutdown) | - |" >> "$OUT"
  { echo "<details><summary>WAL files after stop</summary>"; echo '```'; ls -l $WAL; echo '```'; echo "</details>"; } >> "$RUNNER_TEMP/details.md"
else PASS=$((PASS+1)); echo "| PASS | stop leaves no pending SQLite WAL | - |" >> "$OUT"; fi
kill "$BLOCKER" 2>/dev/null || true
cd "$RUNNER_TEMP"

{
  echo "## CLI findings on $RUNNER_OS"; echo; echo "Passed: $PASS, failed: $FAIL"; echo
  cat "$OUT"; echo; echo "## Failure output"; cat "$RUNNER_TEMP/details.md"
} > "$RUNNER_TEMP/summary.md"
cat "$RUNNER_TEMP/summary.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
