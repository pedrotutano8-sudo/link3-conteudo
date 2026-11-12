#!/usr/bin/env bash
# Liga HTTPS no n8n depois que o DNS apontar pro servidor.
# Uso: bash /opt/link3/deploy/https.sh n8n.seudominio.com.br [conteudo.seudominio.com.br]
# O segundo domínio (opcional) serve o painel (pasta painel/).
set -euo pipefail
cd "$(dirname "$0")"
D=${1:?informe o domínio, ex: n8n.link3.com.br}
IP=$(curl -s4 ifconfig.me)
R=$(getent ahostsv4 "$D" | awk 'NR==1{print $1}' || true)
[ "$R" = "$IP" ] || { echo "DNS de $D aponta pra '${R:-nada}', servidor é $IP. Espera propagar."; exit 1; }
printf '%s {\n  reverse_proxy n8n:5678\n}\n' "$D" > Caddyfile
P=${2:-}
if [ -n "$P" ]; then
  RP=$(getent ahostsv4 "$P" | awk 'NR==1{print $1}' || true)
  [ "$RP" = "$IP" ] || { echo "DNS de $P aponta pra '${RP:-nada}', servidor é $IP. Espera propagar."; exit 1; }
  printf '%s {\n  root * /srv/painel\n  try_files {path} /index.html\n  file_server\n  header Cache-Control "no-cache"\n}\n' "$P" >> Caddyfile
fi
sed -i -e "s|^N8N_HOST=.*|N8N_HOST=$D|" -e "s|^N8N_PROTOCOL=.*|N8N_PROTOCOL=https|" \
       -e "s|^WEBHOOK_URL=.*|WEBHOOK_URL=https://$D/|" -e "s|^N8N_SECURE_COOKIE=.*|N8N_SECURE_COOKIE=true|" n8n.env
echo "N8N_BIND=127.0.0.1" > .env
docker compose --profile https up -d --force-recreate n8n caddy
ufw delete allow 5678/tcp >/dev/null 2>&1 || true
sleep 10
curl -sI "https://$D" | head -1 || true
[ -n "$P" ] && { curl -sI "https://$P" | head -1 || true; }
cat Caddyfile
