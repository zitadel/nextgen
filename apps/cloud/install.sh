#!/bin/sh
# Install step of the services in the repo-root vercel.json, and build.sh's
# fallback. Installs only the build machine's own native packages: the
# workspace installs every platform's (supportedArchitectures in
# pnpm-workspace.yaml), and on Vercel those push the build cache past its
# 1.5 GB limit, so Vercel drops it and every build starts from nothing.
set -eu
cd "$(dirname "$0")/../.."
exec corepack pnpm install --frozen-lockfile --os=current --cpu=current
