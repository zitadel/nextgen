#!/usr/bin/env sh
# Sync Vite build output into Go embed directories. Used by Moon release tasks and CI.
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

build_project() {
  project="$1"
  (cd "$root" && moon run "$project:build")
}

build_console() {
  if [ -f "$root/apps/console/package.json" ]; then
    build_project console
  fi
}

build_login() {
  if [ -f "$root/apps/login-ui/package.json" ]; then
    build_project login-ui
  fi
}

sync_one() {
  src="$1"
  dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  if [ -d "$src" ]; then
    cp -r "$src"/. "$dest"/
  fi
  touch "$dest/.gitkeep"
}

case "${1:-all}" in
  console)
    build_console
    sync_one "$root/apps/console/dist" "$root/internal/staticui/console/dist"
    ;;
  login)
    build_login
    sync_one "$root/apps/login-ui/dist" "$root/internal/staticui/login/dist"
    ;;
  all)
    build_console
    build_login
    sync_one "$root/apps/console/dist" "$root/internal/staticui/console/dist"
    sync_one "$root/apps/login-ui/dist" "$root/internal/staticui/login/dist"
    ;;
  *)
    echo "usage: $0 [all|console|login]" >&2
    exit 1
    ;;
esac
