#!/usr/bin/env bash
# Spike: scaffold every framework beside a running local server and check what the move-in leaves.
set -u
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
CLI="$GITHUB_WORKSPACE/apps/cli/bin/run.js"
OUT="$RUNNER_TEMP/findings.md"
: > "$OUT"; : > "$RUNNER_TEMP/details.md"
PASS=0; FAIL=0
mkdir -p "$RUNNER_TEMP/bin"
printf '#!/usr/bin/env bash\nexec node "%s" "$@" --no-telemetry\n' "$CLI" > "$RUNNER_TEMP/bin/z"
chmod +x "$RUNNER_TEMP/bin/z"
export PATH="$RUNNER_TEMP/bin:$PATH"

t() {
  local name="$1"; shift
  timeout 300 "$@" > "$RUNNER_TEMP/last.log" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "| PASS | $name |" >> "$OUT"
  else
    FAIL=$((FAIL+1)); echo "| FAIL | $name (exit $code) |" >> "$OUT"
    { echo "<details><summary>$name (exit $code)</summary>"; echo '```'; tail -n 40 "$RUNNER_TEMP/last.log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-200; echo '```'; echo "</details>"; } >> "$RUNNER_TEMP/details.md"
  fi
  echo "::group::$name (exit $code)"; sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/last.log" | tail -n 15 | cut -c1-200; echo "::endgroup::"
}
check() { # check <name> <test-expression...>
  local name="$1"; shift
  if "$@"; then PASS=$((PASS+1)); echo "| PASS | $name |" >> "$OUT"
  else FAIL=$((FAIL+1)); echo "| FAIL | $name |" >> "$OUT"; fi
}
echo "| Result | Step |" >> "$OUT"; echo "| --- | --- |" >> "$OUT"

for fw in react vue svelte next nuxt sveltekit solid qwik angular tanstack-start solid-start; do
  mkdir -p "$RUNNER_TEMP/aside/$fw app" && cd "$RUNNER_TEMP/aside/$fw app"
  t "$fw: start" z start --non-interactive
  t "$fw: setup beside the running server" z setup --framework "$fw" --server local --non-interactive --no-git --dev-port 3300 --skip-install
  check "$fw: package.json was moved in" test -f package.json
  check "$fw: the runtime stayed in place" test -f .zitadel/local/runtime.json
  check "$fw: .gitignore keeps the runtime ignore" grep -q "zitadel/local" .gitignore
  check "$fw: nothing is left beside the project" test -z "$(find "$RUNNER_TEMP/aside" -maxdepth 1 -name '.*scaffold*')"
  check "$fw: no absolute path of the work directory leaked into a file" bash -c "! grep -rIl --exclude-dir=node_modules --exclude-dir=.zitadel --exclude-dir=.git -e 'fresh-scaffold-stash' . "
  t "$fw: doctor" z doctor
  t "$fw: stop" z stop
  cd "$RUNNER_TEMP"
done

{ echo "## Aside scaffold on $RUNNER_OS"; echo; echo "Passed: $PASS, failed: $FAIL"; echo; cat "$OUT"; echo; echo "## Failure output"; cat "$RUNNER_TEMP/details.md"; } > "$RUNNER_TEMP/summary.md"
cat "$RUNNER_TEMP/summary.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
