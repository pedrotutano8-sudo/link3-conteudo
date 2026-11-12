#!/usr/bin/env bash
# Liga a transcrição literal (ElevenLabs Scribe) no worker. A chave é colada direto no servidor
# (não aparece na tela, nada passa por chat). Sem essa chave o worker segue no Whisper.
# Uso: bash /opt/link3/deploy/set-elevenlabs.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Cole a API key da ElevenLabs (não aparece na tela) e Enter: " EL; echo
[ -n "$EL" ] || { echo "chave vazia, abortado"; exit 1; }
EL="$EL" python3 - <<'PY'
import os, re
s = open('worker.env').read()
k, v = 'ELEVENLABS_API_KEY', os.environ['EL']
if re.search(rf'(?m)^{k}=', s): s = re.sub(rf'(?m)^{k}=.*$', lambda m: f'{k}={v}', s)
else: s = s.rstrip('\n') + f'\n{k}={v}\n'
open('worker.env', 'w').write(s)
print('worker.env atualizado')
PY
chmod 600 worker.env
docker compose --profile worker up -d --build worker
sleep 8
docker compose logs --tail 5 worker
