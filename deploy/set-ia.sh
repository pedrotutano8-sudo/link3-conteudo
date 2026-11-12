#!/usr/bin/env bash
# Liga o Módulo 1 do worker (transcrição + gancho + copy): grava as chaves da OpenAI e da Anthropic
# direto no servidor (nada passa por chat), reconstrói e reinicia o worker.
# Uso: bash /opt/link3/deploy/set-ia.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Cole a API key da OpenAI (não aparece na tela) e Enter: " OA; echo
read -rsp "Cole a API key da Anthropic (não aparece na tela) e Enter: " AN; echo
[ -n "$OA" ] && [ -n "$AN" ] || { echo "chave vazia, abortado"; exit 1; }
OA="$OA" AN="$AN" python3 - <<'PY'
import os, re
s = open('worker.env').read()
for k, v in (('OPENAI_API_KEY', os.environ['OA']), ('ANTHROPIC_API_KEY', os.environ['AN'])):
    if re.search(rf'(?m)^{k}=', s): s = re.sub(rf'(?m)^{k}=.*$', lambda m: f'{k}={v}', s)
    else: s = s.rstrip('\n') + f'\n{k}={v}\n'
open('worker.env', 'w').write(s)
print('worker.env atualizado')
PY
chmod 600 worker.env
docker compose --profile worker up -d --build worker
sleep 8
docker compose logs --tail 5 worker
