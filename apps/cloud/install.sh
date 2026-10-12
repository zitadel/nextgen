#!/bin/sh
# Install step of every service in the repo-root vercel.json, and of
# build.sh when the Go preset skipped it. Installs only the build machine's
# native packages: the workspace installs every platform's
# (supportedArchitectures in pnpm-workspace.yaml), which on Vercel only
# fills the build cache, past its 1.5 GB limit, so that every build would
# start from nothing.
set -eu
cd "$(dirname "$0")/../.."
exec corepack pnpm install --frozen-lockfile --os=current --cpu=current
