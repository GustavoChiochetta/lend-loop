#!/bin/sh
# Loads the workflows into a running n8n and makes them live. Safe to rerun.
# The SMTP credential has no secret (Mailpit takes any sender), and its fixed id
# is the one the workflow JSON references.
set -eu

n8n() { docker compose exec -T n8n n8n "$@"; }

printf '%s' '[{"id":"mailpitSmtp00001","name":"Mailpit SMTP","type":"smtp","data":{"host":"mailpit","port":1025,"secure":false,"disableStartTls":true,"user":"","password":""}}]' |
  docker compose exec -T n8n sh -c 'cat > /tmp/mailpit-smtp.json && n8n import:credentials --input=/tmp/mailpit-smtp.json && rm /tmp/mailpit-smtp.json'

n8n import:workflow --separate --input=/workflows

# Import deactivates every workflow it touches, so each file's workflow is published again.
for file in n8n/workflows/*.json; do
  n8n publish:workflow --id="$(node -p "require('./$file').id")"
done

docker compose restart n8n
echo "Waiting for n8n to come back..."
until curl -sf http://localhost:5678/healthz >/dev/null; do sleep 1; done
n8n list:workflow --active=true
