#!/usr/bin/env bash
# Scaffold one more project against the running server and serve it on its own
# port, so a preset/provider permutation can be walked independently.
#   variant.sh <name> <port> <preset> [--sso]
set -euo pipefail
ROOT=/private/tmp/claude-501/-Users-mridang-Code-zitadel-nextgen--claude-worktrees-confident-dewdney-d97a60/bea6d5da-5f21-419c-aed6-2ea9dcd4dc5d/scratchpad
CLI=$ROOT/cli
NAME=$1; PORT=$2; PRESET=$3; SSO=${4:-}
APP=/tmp/sso-v-$NAME
rm -rf $APP; mkdir -p $APP/app
echo "{ \"name\": \"$NAME\", \"private\": true, \"dependencies\": { \"next\": \"^15\" } }" > $APP/package.json
echo 'export default function L({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>;}' > $APP/app/layout.tsx
printf '.env*\nnode_modules\n' > $APP/.gitignore
(cd $APP && git init -q . && git add -A && git -c user.email=e@e -c user.name=e commit -qm init)

ARGS=(--cwd $APP --framework next --server http://localhost:8129 --dev-port $PORT --preset $PRESET --skip-install --non-interactive)
if [ -n "$SSO" ]; then ARGS+=(--sso google --sso-client-id mock-client-id); fi
printf 'mock-client-secret' | node $CLI/apps/cli/bin/run.js setup "${ARGS[@]}" > /tmp/sso-v-$NAME.log 2>&1

if [ -n "$SSO" ]; then
  python3 - "$APP" <<'PY'
import json, sys
p = f"{sys.argv[1]}/.zitadel/idps/google.json"
d = json.load(open(p))
d["oidc"]["issuer"] = "http://localhost:9100"
d["oidc"]["authorization_endpoint"] = "http://localhost:9100/authorize"
d["oidc"]["token_endpoint"] = "http://localhost:9100/token"
json.dump(d, open(p, "w"), indent=2)
PY
  node $CLI/apps/cli/bin/run.js apply --cwd $APP --non-interactive >> /tmp/sso-v-$NAME.log 2>&1
fi

PROJECT=$(python3 -c "import json;print(json.load(open('$APP/.zitadel/secret'))['project_id'])")
nohup node $ROOT/e2e/app-host.mjs --port $PORT --server http://localhost:8129 \
  --project "$PROJECT" --bundle $CLI/packages/components/dist/standalone.mjs > /tmp/sso-v-$NAME-host.log 2>&1 &
sleep 2
echo "$NAME on $PORT (preset=$PRESET sso=${SSO:-none}): $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/)"
