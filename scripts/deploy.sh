#!/usr/bin/env bash
# Deploy to a server that runs Boards with Docker Compose: upload the source, rebuild the container.
# The database (in the server's data folder) and the server's .env are never touched.
#
# Settings come from scripts/deploy.env (not committed; copy scripts/deploy.env.example):
#   DEPLOY_HOST   ssh destination, e.g. root@203.0.113.10
#   DEPLOY_DIR    folder on the server holding docker-compose.yml (source goes in $DEPLOY_DIR/app)
#   SITE_URL      public address, used to check the site came back up
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/deploy.env ] && source scripts/deploy.env
: "${DEPLOY_HOST:?Set DEPLOY_HOST in scripts/deploy.env (see scripts/deploy.env.example)}"
: "${DEPLOY_DIR:?Set DEPLOY_DIR in scripts/deploy.env}"
: "${SITE_URL:?Set SITE_URL in scripts/deploy.env}"

npx tsc --noEmit
COPYFILE_DISABLE=1 tar czf - --no-xattrs --exclude=node_modules --exclude=dist --exclude=data --exclude=.git \
  --exclude=.claude --exclude='.env*' --exclude='deploy.env' --exclude='*.db*' --exclude=.DS_Store . 2>/dev/null \
  | ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR/app' && tar xzf - -C '$DEPLOY_DIR/app' 2>/dev/null && cd '$DEPLOY_DIR' && docker compose up -d --build 2>&1 | tail -3"
for i in $(seq 1 15); do
  if curl -fsS -o /dev/null "$SITE_URL/api/auth/me" 2>/dev/null; then echo "✓ $SITE_URL is up"; exit 0; fi
  sleep 2
done
echo "✗ site not responding after 30s — check: ssh $DEPLOY_HOST docker compose -f $DEPLOY_DIR/docker-compose.yml logs" >&2; exit 1
