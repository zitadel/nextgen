# Sourced by the `server` service's build command (repo-root vercel.json),
# from the repository root, before `turbo run deploy`. The service is a
# Node.js function (server/index.mjs), and Vercel's Node.js build image has no
# Go, so this puts the toolchain apps/api/go.mod names on PATH: downloaded once
# into Vercel's build cache, reused while go.mod names the same version.
# Where `go` is already installed (a local run), it does nothing.
#
# The archive is extracted only if its SHA-256 matches the one go.dev lists for
# it in its release index; the archive itself is served from dl.google.com.
# A mismatch, or a version the index does not list, fails the build. Sourced,
# so a failure exits the build command's shell.
#
# The function runs on x86_64 Linux, which is also what Vercel builds on; the
# target is set anyway, as Vercel's Go builder set it.

if [ -n "${VERCEL:-}" ] && ! command -v go >/dev/null 2>&1; then
  go_version="$(sed -n 's/^toolchain go//p' apps/api/go.mod)"
  [ -n "$go_version" ] || go_version="$(sed -n 's/^go //p' apps/api/go.mod)"
  go_root="$PWD/.vercel/cache/go-toolchain/go$go_version"
  if [ ! -x "$go_root/bin/go" ]; then
    go_cache="$PWD/.vercel/cache/go-toolchain"
    go_archive="go$go_version.linux-amd64.tar.gz"
    rm -rf "$go_cache"
    mkdir -p "$go_root"
    go_want="$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | node -e '
      let index = "";
      process.stdin.on("data", (chunk) => (index += chunk));
      process.stdin.on("end", () => {
        const file = JSON.parse(index)
          .flatMap((release) => release.files)
          .find((file) => file.filename === process.argv[1]);
        if (file?.sha256) console.log(file.sha256);
      });
    ' "$go_archive")"
    if [ -z "$go_want" ]; then
      echo "install-go.sh: go.dev lists no checksum for $go_archive" >&2
      rm -rf "$go_cache"
      exit 1
    fi
    curl -fsSL -o "$go_cache/$go_archive" "https://go.dev/dl/$go_archive"
    go_got="$( (sha256sum "$go_cache/$go_archive" 2>/dev/null || shasum -a 256 "$go_cache/$go_archive") | cut -d' ' -f1)"
    if [ "$go_got" != "$go_want" ]; then
      echo "install-go.sh: $go_archive has SHA-256 ${go_got:-none}, go.dev lists $go_want" >&2
      rm -rf "$go_cache"
      exit 1
    fi
    if ! tar -xzf "$go_cache/$go_archive" -C "$go_root" --strip-components=1; then
      echo "install-go.sh: extracting $go_archive failed" >&2
      rm -rf "$go_cache"
      exit 1
    fi
    rm -f "$go_cache/$go_archive"
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
