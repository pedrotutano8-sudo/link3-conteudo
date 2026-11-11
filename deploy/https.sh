#!/usr/bin/env bash
# Liga HTTPS no n8n depois que o DNS apontar pro servidor.
# Uso: bash /opt/link3/deploy/https.sh n8n.seudominio.com.br
set -euo pipefail
cd "$(dirname "$0")"
D=${1:?informe o domínio, ex: n8n.link3.com.br}
IP=$(curl -s4 ifconfig.me)
R=$(getent ahostsv4 "$D" | awk 'NR==1{print $1}' || true)
[ "$R" = "$IP" ] || { echo "DNS de $D aponta pra '${R:-nada}', servidor é $IP. Espera propagar."; exit 1; }
printf '%s {\n  reverse_proxy n8n:5678\n}\n' "$D" > Caddyfile
sed -i -e "s|^N8N_HOST=.*|N8N_HOST=$D|" -e "s|^N8N_PROTOCOL=.*|N8N_PROTOCOL=https|" \
       -e "s|^WEBHOOK_URL=.*|WEBHOOK_URL=https://$D/|" -e "s|^N8N_SECURE_COOKIE=.*|N8N_SECURE_COOKIE=true|" n8n.env
echo "N8N_BIND=127.0.0.1" > .env
docker compose --profile https up -d n8n caddy
ufw delete allow 5678/tcp >/dev/null 2>&1 || true
sleep 10
curl -sI "https://$D" | head -1 && echo "OK: https://$D"
