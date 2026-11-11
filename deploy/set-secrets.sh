#!/usr/bin/env bash
# Preenche os segredos do worker direto no servidor (nada passa por chat) e sobe o worker.
# Uso: bash /opt/link3/deploy/set-secrets.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Cole a service_role key do Supabase da Link3 (não aparece na tela) e Enter: " SR; echo
[ -n "$SR" ] || { echo "vazio, abortado"; exit 1; }
read -rp "Caminho do JSON da service account do Google [/root/gsa.json]: " GP; GP=${GP:-/root/gsa.json}
[ -f "$GP" ] || { echo "Arquivo $GP não existe. Suba o JSON pro servidor antes (ver passo a passo)."; exit 1; }
SR="$SR" GP="$GP" python3 - <<'PY'
import json, os, re
gj = json.dumps(json.load(open(os.environ['GP'])), separators=(',', ':'))
assert "'" not in gj
s = open('worker.env').read()
s = re.sub(r'(?m)^SUPABASE_SERVICE_ROLE_KEY=.*$', lambda m: 'SUPABASE_SERVICE_ROLE_KEY=' + os.environ['SR'], s)
s = re.sub(r'(?m)^GOOGLE_SERVICE_ACCOUNT_JSON=.*$', lambda m: "GOOGLE_SERVICE_ACCOUNT_JSON='" + gj + "'", s)
open('worker.env', 'w').write(s)
print('worker.env atualizado')
PY
chmod 600 worker.env
shred -u "$GP" 2>/dev/null || rm -f "$GP"
docker compose --profile worker up -d worker
sleep 8
docker compose logs --tail 15 worker
