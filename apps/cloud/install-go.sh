# Sourced by the `server` service's build command (repo-root vercel.json),
# from the repository root, before `turbo run deploy`. The service is a
# Node.js function (server/index.mjs), and Vercel's Node.js build image has no
# Go, so this puts the toolchain apps/api/go.mod names on PATH: downloaded once
# into Vercel's build cache, reused while go.mod names the same version.
# Where `go` is already installed (a local run), it does nothing.
#
# The function runs on x86_64 Linux, which is also what Vercel builds on; the
# target is set anyway, as Vercel's Go builder set it.

if [ -n "${VERCEL:-}" ] && ! command -v go >/dev/null 2>&1; then
  go_version="$(sed -n 's/^toolchain go//p' apps/api/go.mod)"
  [ -n "$go_version" ] || go_version="$(sed -n 's/^go //p' apps/api/go.mod)"
  go_root="$PWD/.vercel/cache/go-toolchain/go$go_version"
  if [ ! -x "$go_root/bin/go" ]; then
    rm -rf "$PWD/.vercel/cache/go-toolchain"
    mkdir -p "$go_root"
    curl -fsSL "https://go.dev/dl/go$go_version.linux-amd64.tar.gz" | tar -xz -C "$go_root" --strip-components=1
  fi
  PATH="$go_root/bin:$PATH"
  export PATH
  GOTOOLCHAIN=local
  export GOTOOLCHAIN
fi
if [ -n "${VERCEL:-}" ]; then
  GOOS="${GOOS:-linux}"
  GOARCH="${GOARCH:-amd64}"
  export GOOS GOARCH
fi
go version
