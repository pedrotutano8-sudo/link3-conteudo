#!/usr/bin/env bash
# Guarda a chave secreta do app da Meta (Link3 Sistema) no worker, sem passar pelo chat.
# O app usa o "login unificado" da Meta (Login do Facebook para Empresas com configuração compatível com o Login do Instagram):
#   ID do app 2212705102675144 · configuração 2270334556865702 · retorno https://conteudo.agencialinktres.com.br/instagram/retorno
# Onde achar a chave: developers.facebook.com → app Link3 Sistema → Configurações do app → Básico → Chave Secreta do Aplicativo → Mostrar.
# Uso: bash /opt/link3/deploy/instagram-app.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Chave Secreta do Aplicativo (não aparece na tela) e Enter: " SEC; echo
[[ "$SEC" =~ ^[0-9a-f]{32}$ ]] || { echo "a chave tem 32 letras/números (0-9, a-f); confira e rode de novo"; exit 1; }
SEC="$SEC" python3 - <<'PY'
import os, re
s = open('worker.env').read()
for k, v in (('META_APP_ID', '2212705102675144'), ('META_APP_SECRET', os.environ['SEC']), ('META_LOGIN_CONFIG_ID', '2270334556865702'),
             ('META_REDIRECT_URI', 'https://conteudo.agencialinktres.com.br/instagram/retorno')):
    if re.search(rf'(?m)^{k}=', s): s = re.sub(rf'(?m)^{k}=.*$', lambda m: f'{k}={v}', s)
    else: s = s.rstrip('\n') + f'\n{k}={v}\n'
open('worker.env', 'w').write(s)
print('worker.env atualizado (META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID, META_REDIRECT_URI)')
PY
chmod 600 worker.env
docker compose --profile worker up -d worker
echo "Pronto."
