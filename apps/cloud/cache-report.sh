#!/bin/sh
# TEMPORARY measurement for the build cache fix; removed before merge.
# Prints what Vercel's build cache collects from this build: every
# node_modules (static-build and Next.js presets), apps/docs/.next/cache
# (Next.js) and .vercel/cache/golang (Go preset), with gzip -1 estimates.
set +e
cd "$(dirname "$0")/../.."

line() { printf '%-28s %s\n' "$1" "$2"; }
size() {
  if [ ! -e "$1" ]; then line "absent" "$1"; return; fi
  p="$(readlink -f "$1")"
  line "$(du -sh --apparent-size "$p" | cut -f1) app $(du -sh "$p" | cut -f1) disk $(find "$p" -type f | wc -l)f" "$1"
}
gz() {
  start=$(date +%s)
  bytes=$(tar -cf - "$@" 2>/dev/null | gzip -1 | wc -c)
  line "$((bytes / 1048576)) MB gz1 ($(($(date +%s) - start))s)" "$*"
}

echo "=== cache report $(date -u +%H:%M:%S) go: $(go env GOROOT) | $(go env GOMODCACHE) | $(go env GOCACHE)"
modules="$(find . -path ./.vercel -prune -o -name node_modules -type d -prune -print 2>/dev/null | sort)"
echo "node_modules dirs: $(echo "$modules" | wc -l)"
for d in $modules; do
  [ "$(du -sm "$d" | cut -f1)" -ge 5 ] && size "$d"
done
size node_modules/.pnpm
for d in node_modules/.cache node_modules/.vite node_modules/.vite-temp apps/storybook/node_modules/.cache apps/console/node_modules/.vite apps/docs/.next/cache; do size "$d"; done
size .vercel/cache/golang
g="$(readlink -f .vercel/cache/golang)"
for d in bin pkg/tool src lib pkg/mod pkg/mod/cache/download go-build; do size "$g/$d"; done

# Native packages per platform in the virtual store, and what a
# linux-x64-glibc-only install would leave out.
node -e '
const { readdirSync, readFileSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const store = "node_modules/.pnpm";
const groups = new Map(); let foreign = 0, native = 0, all = 0;
const list = (v) => (v == null ? null : [].concat(v));
for (const entry of readdirSync(store)) {
  const name = entry.startsWith("@") ? entry.replace(/^(@[^+]+)\+([^@]+)@.*/, "$1/$2") : entry.replace(/@.*/, "");
  const dir = `${store}/${entry}/node_modules/${name}`;
  if (!existsSync(`${dir}/package.json`)) continue;
  const kb = Number(execFileSync("du", ["-sk", "--apparent-size", dir]).toString().split("\t")[0]);
  all += kb;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const os = list(pkg.os), cpu = list(pkg.cpu), libc = list(pkg.libc);
  if (!os && !cpu && !libc) continue;
  native += kb;
  const fits = (l, v) => !l || l.includes(v) || (l.every((x) => x.startsWith("!")) && !l.includes("!" + v));
  const key = `${(os ?? ["*"]).join("|")}/${(cpu ?? ["*"]).join("|")}/${(libc ?? ["*"]).join("|")}`;
  const g = groups.get(key) ?? { kb: 0, n: 0 }; g.kb += kb; g.n++; groups.set(key, g);
  if (!(fits(os, "linux") && fits(cpu, "x64") && fits(libc, "glibc"))) foreign += kb;
}
const mb = (kb) => `${Math.round(kb / 1024)} MB`;
console.log(`.pnpm packages ${mb(all)}, native ${mb(native)}, not for linux-x64-glibc ${mb(foreign)}`);
for (const [k, g] of [...groups].sort((a, b) => b[1].kb - a[1].kb)) console.log(`  ${mb(g.kb).padStart(7)} ${String(g.n).padStart(3)} ${k}`);
'

gz $modules
[ -d apps/docs/.next/cache ] && gz apps/docs/.next/cache
[ -n "$g" ] && gz "$g"
echo "=== cache report done $(date -u +%H:%M:%S)"
