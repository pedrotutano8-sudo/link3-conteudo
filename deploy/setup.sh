#!/usr/bin/env bash
# Prepara o servidor da Link3 do zero (Ubuntu 24.04). Pode rodar de novo sem quebrar nada.
set -euo pipefail
cd "$(dirname "$0")"
IP=$(curl -s4 ifconfig.me || hostname -I | awk '{print $1}')

echo "== 1/5 atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl ufw fail2ban unattended-upgrades

echo "== 2/5 Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "== 3/5 firewall"
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 5678/tcp
ufw --force enable
systemctl enable --now fail2ban

echo "== 4/5 configuração do n8n"
if [ ! -f n8n.env ]; then
  cat > n8n.env <<EOT
N8N_ENCRYPTION_KEY=$(openssl rand -hex 24)
N8N_HOST=$IP
N8N_PORT=5678
N8N_PROTOCOL=http
WEBHOOK_URL=http://$IP:5678/
N8N_SECURE_COOKIE=false
GENERIC_TIMEZONE=America/Sao_Paulo
TZ=America/Sao_Paulo
N8N_RUNNERS_ENABLED=true
N8N_DIAGNOSTICS_ENABLED=false
EOT
  chmod 600 n8n.env
fi
if [ ! -f worker.env ]; then
  cat > worker.env <<'EOT'
SUPABASE_URL=https://ayivmcaqfyzywopiebwy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
WORKER_ID=vps-1
POLL_MS=4000
EOT
  chmod 600 worker.env
fi

echo "== 5/5 subindo n8n e construindo o worker"
docker compose pull n8n
docker compose up -d n8n
docker compose --profile worker build worker
docker compose ps
echo
echo "PRONTO. n8n: http://$IP:5678"
echo "Falta: preencher /opt/link3/deploy/worker.env e rodar: docker compose --profile worker up -d"
