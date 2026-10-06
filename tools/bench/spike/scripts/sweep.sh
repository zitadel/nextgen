#!/usr/bin/env bash
# Run every shape × scenario × VU level, one run at a time, writing k6's raw
# JSON samples per run under out/sweep-<stamp>/. Aggregate with aggregate.py.
#
#   scripts/sweep.sh [--dur 20s] [--vus "1 5 20"] [--shapes "owned owned-shared delegated prepared"] [--scen "login getUser"]
set -euo pipefail

DUR=20s
VUS="1 5 20"
SHAPES="owned owned-shared delegated prepared"
SCENS="login getUser"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dur) DUR="$2"; shift 2 ;;
    --vus) VUS="$2"; shift 2 ;;
    --shapes) SHAPES="$2"; shift 2 ;;
    --scen) SCENS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(cd "$HERE/../.." && pwd)"
OUT="$BENCH/out"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SWEEP="$OUT/sweep-$STAMP"
mkdir -p "$SWEEP"

set -a; . "$OUT/project.env"; set +a

{
  echo "commit=$(git -C "$BENCH" rev-parse --short HEAD)"
  echo "host=$(hostname) cpu=$(nproc) k6=$("$OUT/k6" version | head -1)"
  echo "dur=$DUR vus=$VUS shapes=$SHAPES scens=$SCENS"
} > "$SWEEP/run.txt"

for scen in $SCENS; do
  for shape in $SHAPES; do
    script="$shape"; transport=k6
    if [[ "$shape" == owned-shared ]]; then script=owned; transport=shared; fi
    for vus in $VUS; do
      name="$scen-$shape-$vus"
      echo "== $name"
      NEXTGEN_OWNED_TRANSPORT=$transport VUS=$vus DUR=$DUR SCEN=$scen \
        "$OUT/k6" run --quiet --no-color --out "json=$SWEEP/$name.json.gz" \
        --summary-mode compact "$HERE/$script.js" > "$SWEEP/$name.summary.txt" 2>&1 \
        || { echo "k6 failed for $name:"; tail -30 "$SWEEP/$name.summary.txt"; exit 1; }
      grep -E 'checks|_failed|iterations|errors|level=error|level=warn' "$SWEEP/$name.summary.txt" | head -5 || true
      sleep 2
    done
  done
done
echo "sweep written to $SWEEP"
