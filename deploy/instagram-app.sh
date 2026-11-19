#!/usr/bin/env bash
# Guarda o ID e a chave secreta do app do Instagram (Meta for Developers) no worker, sem passar pelo chat.
# Onde achar: developers.facebook.com → app "Link3 Sistema" → Casos de uso → Instagram → Configuração da API com login do Instagram
#   → "ID do app do Instagram" e "Chave secreta do app do Instagram" (botão Mostrar).
# Uso: bash /opt/link3/deploy/instagram-app.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rp "ID do app do Instagram (só números): " IGID
read -rsp "Chave secreta do app do Instagram (não aparece na tela) e Enter: " IGSEC; echo
[[ "$IGID" =~ ^[0-9]+$ ]] && [ -n "$IGSEC" ] || { echo "ID ou chave inválidos, abortado"; exit 1; }
IGID="$IGID" IGSEC="$IGSEC" python3 - <<'PY'
import os, re
s = open('worker.env').read()
for k, v in (('INSTAGRAM_APP_ID', os.environ['IGID']), ('INSTAGRAM_APP_SECRET', os.environ['IGSEC']),
             ('INSTAGRAM_REDIRECT_URI', 'https://conteudo.agencialinktres.com.br/instagram/retorno')):
    if re.search(rf'(?m)^{k}=', s): s = re.sub(rf'(?m)^{k}=.*$', lambda m: f'{k}={v}', s)
    else: s = s.rstrip('\n') + f'\n{k}={v}\n'
open('worker.env', 'w').write(s)
print('worker.env atualizado (INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI)')
PY
chmod 600 worker.env
docker compose --profile worker up -d worker
echo "Pronto."
