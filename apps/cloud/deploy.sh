#!/bin/sh
# The `deploy` task of @zitadel/cloud (apps/cloud/turbo.json), the last of
# the `server` service's build (repo-root vercel.json), after `migrate`. The
# service is a Node.js function (server/index.mjs) that ships the migrated
# launcher, dist/nextgen-launcher, through its includeFiles, so nothing is
# handed over: the task only marks the end of the build the service runs.
set -eu
cd "$(dirname "$0")"

test -x dist/nextgen-launcher
echo "the launcher stays in apps/cloud/dist/nextgen-launcher, where server/index.mjs runs it"
