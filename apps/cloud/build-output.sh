#!/bin/sh
# Build command of a Go service that emits its own Build Output: the server,
# compiled for Vercel's x86_64 functions, behind the proxy binary Vercel's Go
# preset puts in front of a server (the `executable` of @vercel/go, taken from
# that npm package), with the two fields the preset cannot be told and the
# cloud needs: `regions`, which pins the function to the region of its
# database, and the role of the service in its environment (CLOUD_ROLE,
# CLOUD_PATH_PREFIX, see the launcher), from which the launcher derives the
# public base and the home's URL. A service mounted under a path prefix also
# gets the route that strips the prefix before the preset's own catch-all,
# which the preset's builder would otherwise override.
#
#   CLOUD_SERVICE=server_eu sh apps/cloud/build-output.sh
#
# CLOUD_SERVICE names the service: home (fra1, the root, the home's database),
# server_eu (fra1, /eu), server_us (cle1, /us). Output goes to
# .vercel/output (CLOUD_OUTPUT_DIR), the Build Output API tree Vercel deploys
# when a build command produces one. Needs Go 1.26 or downloads it
# (GO_VERSION), npm for the proxy (VERCEL_GO_VERSION pins @vercel/go).
set -eu
cd "$(dirname "$0")/../.."

service=${CLOUD_SERVICE:?CLOUD_SERVICE names the service: home, server_eu or server_us}
case "$service" in
  home)      region=fra1; prefix=;    role=home ;;
  server_eu) region=fra1; prefix=/eu; role=region ;;
  server_us) region=cle1; prefix=/us; role=region ;;
  *) echo "build-output.sh: unknown service $service" >&2; exit 64 ;;
esac
out=${CLOUD_OUTPUT_DIR:-.vercel/output}
func="$out/functions/go.func"
GO_VERSION=${GO_VERSION:-1.26.9}
VERCEL_GO_VERSION=${VERCEL_GO_VERSION:-20.0.0}

# A Go that satisfies go.mod (1.26), else the pinned toolchain, cached.
go_ok() {
  v=$(go version 2>/dev/null | sed -n 's/.*go\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p')
  [ -n "$v" ] || return 1
  set -- $v
  [ "$1" -gt 1 ] || [ "$2" -ge 26 ]
}
if ! go_ok; then
  cache="${HOME:-/tmp}/.cache/nextgen-go/go$GO_VERSION"
  if [ ! -x "$cache/go/bin/go" ]; then
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "build-output.sh: unsupported machine $(uname -m)" >&2; exit 1 ;; esac
    echo "build-output.sh: downloading go$GO_VERSION.$os-$arch"
    mkdir -p "$cache"
    curl -sSfL "https://go.dev/dl/go$GO_VERSION.$os-$arch.tar.gz" | tar -xz -C "$cache"
  fi
  PATH="$cache/go/bin:$PATH"; export PATH
fi
echo "build-output.sh: $(go version)"

rm -rf "$func" "$out/config.json"
mkdir -p "$func"

# The server, for the function's platform.
GOOS=linux GOARCH=amd64 OUT="$func/user-server" sh apps/cloud/build.sh

# The proxy the Go preset runs in front of a server: @vercel/go ships it.
tmp=$(mktemp -d)
(cd "$tmp" && npm pack "@vercel/go@$VERCEL_GO_VERSION" >/dev/null 2>&1 && tar -xzf "vercel-go-$VERCEL_GO_VERSION.tgz" package/bin/proxy-linux-amd64)
cp "$tmp/package/bin/proxy-linux-amd64" "$func/executable"
chmod 755 "$func/executable"
rm -rf "$tmp"

# The function: what the preset writes, plus regions and the role.
env="\"CLOUD_ROLE\": \"$role\""
[ -n "$prefix" ] && env="$env, \"CLOUD_PATH_PREFIX\": \"$prefix\""
[ "$role" = home ] && env="$env, \"CLOUD_DATABASE_KEY\": \"HOME\""
cat > "$func/.vc-config.json" <<EOF
{
  "handler": "executable",
  "runtime": "executable",
  "runtimeLanguage": "go",
  "architecture": "x86_64",
  "environment": { $env },
  "supportsResponseStreaming": true,
  "regions": ["$region"]
}
EOF

# The routes: strip the prefix first, then the preset's own catch-all.
strip=
if [ -n "$prefix" ]; then
  strip="    { \"src\": \"^$prefix/(.*)\$\", \"dest\": \"/go\", \"transforms\": [{ \"type\": \"request.path\", \"op\": \"set\", \"args\": \"/\$1\" }] },
    { \"src\": \"^$prefix\$\", \"dest\": \"/go\", \"transforms\": [{ \"type\": \"request.path\", \"op\": \"set\", \"args\": \"/\" }] },
"
fi
cat > "$out/config.json" <<EOF
{
  "version": 3,
  "routes": [
$strip    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/go", "transforms": [{ "type": "request.path", "op": "set", "args": "/\$1" }] }
  ]
}
EOF
echo "build-output.sh: $service -> $func (region $region, prefix '${prefix:-/}')"
