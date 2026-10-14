#!/bin/sh
# Install step of the services in the repo-root vercel.json; build.sh runs it
# for the server, whose Go preset runs no installCommand. Installs only the
# build machine's own native packages: the workspace installs every
# platform's (supportedArchitectures in pnpm-workspace.yaml), and on Vercel
# those push the build cache past its 1.5 GB limit, so Vercel drops it and
# every build starts from nothing.
#
# Vercel builds a deployment's services one after another in one checkout,
# each running this script, so only the first one has anything to install.
# A node_modules on disk does not show that it did: the build cache restores
# node_modules from an earlier deployment, which may have installed another
# lockfile. The first install therefore leaves the deployment's id in a file
# at the repository root, which Vercel clones afresh for every deployment
# and leaves out of the build cache, and the later services skip when they
# find their own deployment's id there. Without one, outside Vercel, the
# script always installs.
set -eu
cd "$(dirname "$0")/../.."

marker=.cloud-installed
deployment="${VERCEL_DEPLOYMENT_ID:-}"
if [ -n "$deployment" ] && [ "$(cat "$marker" 2>/dev/null)" = "$deployment" ]; then
  echo "install.sh: installed for this deployment already, skipping"
  exit 0
fi

corepack pnpm install --frozen-lockfile --os=current --cpu=current
if [ -n "$deployment" ]; then
  echo "$deployment" >"$marker"
fi
