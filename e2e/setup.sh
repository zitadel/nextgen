#!/usr/bin/env bash
# Stands up the whole local stack for the SSO browser test:
#   mock provider :9100 | zitadel :8129 | app host :4300
set -euo pipefail
ROOT=/private/tmp/claude-501/-Users-mridang-Code-zitadel-nextgen--claude-worktrees-confident-dewdney-d97a60/bea6d5da-5f21-419c-aed6-2ea9dcd4dc5d/scratchpad
CLI=$ROOT/cli
APP=/tmp/sso-e2e-app

pkill -f "/tmp/zsso" 2>/dev/null || true
pkill -f "app-host.mjs" 2>/dev/null || true
rm -rf /tmp/sso-e2e-data $APP
mkdir -p /tmp/sso-e2e-data

# The mock provider runs on localhost, which the hardened egress client denies
# by default (ADR 061). Re-allow it here only — this is what the allow list is
# for, and a real deployment never sets it.
cat > /tmp/sso-e2e.yaml <<'YAML'
server:
  address: ":8129"
  data_dir: /tmp/sso-e2e-data
httpclient:
  allow_list:
    - localhost
    - 127.0.0.0/8
YAML
nohup /tmp/zsso -c /tmp/sso-e2e.yaml --migrate > /tmp/sso-e2e-server.log 2>&1 &
for i in $(seq 1 40); do
  curl -sf -o /dev/null http://localhost:8129/healthz && break || sleep 0.5
done
echo "server: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8129/healthz)"

# A minimal Next-shaped project so `setup` detects a framework without
# scaffolding one over the network.
mkdir -p $APP/app
echo '{ "name": "sso-e2e", "private": true, "dependencies": { "next": "^15" } }' > $APP/package.json
echo 'export default function L({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>;}' > $APP/app/layout.tsx
printf '.env*\nnode_modules\n' > $APP/.gitignore
(cd $APP && git init -q . && git add -A && git -c user.email=e@e -c user.name=e commit -qm init)

printf 'mock-client-secret' | node $CLI/apps/cli/bin/run.js setup \
  --cwd $APP --framework next --server http://localhost:8129 --dev-port 4300 \
  --sso google --sso-client-id mock-client-id --skip-install --non-interactive > /tmp/sso-e2e-setup.log 2>&1
echo "setup: $(grep -c 'Created project' /tmp/sso-e2e-setup.log) project(s)"

# Point the connection at the mock provider. This is the "customizable
# redirect" the test needs: the connection file is the source of truth, so a
# local provider is a file edit, not a code change.
python3 - "$APP" <<'PY'
import json, sys
p = f"{sys.argv[1]}/.zitadel/idps/google.json"
d = json.load(open(p))
d["oidc"]["issuer"] = "http://localhost:9100"
d["oidc"]["authorization_endpoint"] = "http://localhost:9100/authorize"
d["oidc"]["token_endpoint"] = "http://localhost:9100/token"
json.dump(d, open(p, "w"), indent=2)
PY
node $CLI/apps/cli/bin/run.js apply --cwd $APP --non-interactive > /tmp/sso-e2e-apply.log 2>&1
tail -2 /tmp/sso-e2e-apply.log

PROJECT=$(python3 -c "import json;print(json.load(open('$APP/.zitadel/secret'))['project_id'])")
echo "project: $PROJECT"

nohup node $ROOT/e2e/app-host.mjs --port 4300 --server http://localhost:8129 \
  --project "$PROJECT" --bundle $CLI/packages/components/dist/standalone.mjs > /tmp/sso-e2e-app.log 2>&1 &
sleep 2
echo "app host: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4300/)"
echo "mock idp: $(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:9100/authorize?redirect_uri=x&state=y')"
