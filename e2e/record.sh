#!/usr/bin/env bash
# Records the whole feature as one video: the CLI scaffolding, then every
# login permutation, driven in a real browser and stitched with ffmpeg.
set -euo pipefail
ROOT=/private/tmp/claude-501/-Users-mridang-Code-zitadel-nextgen--claude-worktrees-confident-dewdney-d97a60/bea6d5da-5f21-419c-aed6-2ea9dcd4dc5d/scratchpad
CLI=$ROOT/cli
VID=$ROOT/video
OUT=$VID/segments
rm -rf $OUT && mkdir -p $OUT

# playwright resolves from the script's own directory, so the recorder runs
# from inside the package that depends on it.
REC=$CLI/packages/components/.record.mjs
cp $ROOT/e2e/record.mjs $REC
cp $ROOT/e2e/overlay.mjs $CLI/packages/components/overlay.mjs
trap 'rm -f $REC $CLI/packages/components/overlay.mjs' EXIT

FFMPEG=${FFMPEG:-$(ls -d /nix/store/*ffmpeg*/bin/ffmpeg 2>/dev/null | head -1)}
[ -x "$FFMPEG" ] || { echo "no ffmpeg found"; exit 1; }

run_rec() {  # name, extra args...
  local name=$1; shift
  local dir=$OUT/$name
  mkdir -p $dir
  (cd $CLI/packages/components && node $REC --root $CLI --out $dir "$@") > $OUT/$name.log 2>&1 \
    || echo "    driver failed -- see $OUT/$name.log: $(tail -1 $OUT/$name.log)"
  # Playwright names the file by page guid; give it ours.
  local f
  f=$(ls $dir/*.webm 2>/dev/null | head -1)
  [ -n "$f" ] && mv "$f" $OUT/$name.webm && rmdir $dir 2>/dev/null || true
  echo "  segment $name: $([ -f $OUT/$name.webm ] && echo ok || echo MISSING)"
}

echo "== 1. the CLI, scaffolding a project =="
run_rec 00-cli --segment cli --transcript /tmp/rec-cli.log

echo "== 2. browser permutations =="
run_rec 01-password-first --segment login --app http://localhost:4300 \
  --title "Password first" --subtitle "Google beside the password path"
run_rec 02-password-register --segment register --app http://localhost:4300 \
  --title "Password first — register" --subtitle "the provider is offered here too"
run_rec 03-passkey-first --segment login --app http://localhost:4310 \
  --title "Passkey first" --subtitle "Google on the very first screen"
run_rec 04-passkey-email --segment email-fallback --app http://localhost:4310 \
  --title "Passkey first — email screen" --subtitle "still offered one screen in"
run_rec 05-conflict --segment conflict --app http://localhost:4300 \
  --title "The address already has an account" --subtitle "the provider hands back an email that is already registered"
run_rec 06-no-provider --segment control --app http://localhost:4320 \
  --title "No provider enabled" --subtitle "nothing is added — the control"

echo "== 3. stitching =="
cd $VID
: > list.txt
for f in $(ls $OUT/*.webm | sort); do echo "file '$f'" >> list.txt; done
$FFMPEG -y -f concat -safe 0 -i list.txt \
  -c:v libx264 -pix_fmt yuv420p -r 12 -vf "scale=1280:-2" $VID/sso-walkthrough.mp4 2>/dev/null
$FFMPEG -y -i $VID/sso-walkthrough.mp4 -vf "fps=8,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 $VID/sso-walkthrough.gif 2>/dev/null
ls -la $VID/sso-walkthrough.* | awk '{print $NF, $5}'
