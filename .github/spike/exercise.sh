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
t "api GET (raw)" z api -X GET /projects
t "schema get (first)" bash -c "id=\$(node '$CLI' schema list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' schema get \"\$id\" --json --no-telemetry"
t "policy get (first)" bash -c "id=\$(node '$CLI' policy list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' policy get \"\$id\" --json --no-telemetry"
t "branding get (first)" bash -c "id=\$(node '$CLI' branding list --json --no-telemetry | grep -o '\"id\": *\"[^\"]*\"' | head -1 | cut -d'\"' -f4); node '$CLI' branding get \"\$id\" --json --no-telemetry"

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
t "auth-method password disable" z auth-method password disable --json
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
RID=$(idof "$RUNNER_TEMP/last.log")
t "release get" z release get "$RID" --json
t "deployment create" z deployment create --release "$RID" --json
DID=$(idof "$RUNNER_TEMP/last.log")
t "deployment get" z deployment get "$DID" --json
t "deployment rollback" z deployment rollback --json
t "deploy --dry-run" z deploy --dry-run --json
t "preview (dry-run)" z preview --dry-run --json
t "release revoke" z release revoke "$RID" --force --json
t "upgrade --dry-run" z upgrade --dry-run --json

# --- 7. Project extras ---
t "skills add" z skills add --non-interactive
t "tests add --skip-install" z tests add --skip-install
t "eject --dry-run" z eject --dry-run --json

# --- 8. Teardown ---
pkill -f vite 2>/dev/null || true
cd "$RUNNER_TEMP/host"
t "stop" z stop
t "reset --force" z reset --force
t "start after reset" z start --non-interactive
t "stop (final)" z stop

{
  echo "## CLI findings on $RUNNER_OS"; echo; echo "Passed: $PASS, failed: $FAIL"; echo
  cat "$OUT"; echo; echo "## Failure output"; cat "$RUNNER_TEMP/details.md"
} > "$RUNNER_TEMP/summary.md"
cat "$RUNNER_TEMP/summary.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
