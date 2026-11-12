#!/usr/bin/env bash
# Liga o login do Google da Link 3 no worker, para ele GRAVAR no Drive (pasta "Finalizados" e upload do vídeo).
# Conta de serviço não tem espaço próprio em Drive de conta Gmail, então a gravação usa a conta dona das pastas.
# Antes: no Google Cloud da Link 3 → APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → App para computador.
# Uso: bash /opt/link3/deploy/google-oauth.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rp "ID do cliente OAuth (termina em .apps.googleusercontent.com): " CID
read -rsp "Chave secreta do cliente (não aparece na tela) e Enter: " CSEC; echo
[ -n "$CID" ] && [ -n "$CSEC" ] || { echo "vazio, abortado"; exit 1; }
URL=$(CID="$CID" python3 -c 'import os,urllib.parse as u;print("https://accounts.google.com/o/oauth2/v2/auth?"+u.urlencode({"client_id":os.environ["CID"],"redirect_uri":"http://localhost","response_type":"code","scope":"https://www.googleapis.com/auth/drive","access_type":"offline","prompt":"consent"}))')
echo
echo "1) Abra este link no navegador logado como agencia.linktres@gmail.com e autorize:"
echo
echo "$URL"
echo
echo "2) No fim o navegador vai para uma página que não abre (localhost). Copie o endereço inteiro da barra e cole aqui."
read -rp "Endereço: " VOLTA
CODE=$(VOLTA="$VOLTA" python3 -c 'import os,urllib.parse as u;print(u.parse_qs(u.urlparse(os.environ["VOLTA"].strip()).query).get("code",[""])[0])')
[ -n "$CODE" ] || { echo "não achei o código no endereço, tente de novo"; exit 1; }
RESP=$(curl -s https://oauth2.googleapis.com/token -d client_id="$CID" -d client_secret="$CSEC" -d code="$CODE" -d grant_type=authorization_code -d redirect_uri=http://localhost)
RT=$(RESP="$RESP" python3 -c 'import os,json;print(json.loads(os.environ["RESP"]).get("refresh_token",""))')
[ -n "$RT" ] || { echo "o Google não devolveu o token: $(RESP="$RESP" python3 -c 'import os,json;print(json.loads(os.environ["RESP"]).get("error_description","erro"))')"; exit 1; }
CID="$CID" CSEC="$CSEC" RT="$RT" python3 - <<'PY'
import os, re
s = open('worker.env').read()
for k, v in (('GOOGLE_OAUTH_CLIENT_ID', os.environ['CID']), ('GOOGLE_OAUTH_CLIENT_SECRET', os.environ['CSEC']), ('GOOGLE_OAUTH_REFRESH_TOKEN', os.environ['RT'])):
    if re.search(rf'(?m)^{k}=', s): s = re.sub(rf'(?m)^{k}=.*$', lambda m: f'{k}={v}', s)
    else: s = s.rstrip('\n') + f'\n{k}={v}\n'
open('worker.env', 'w').write(s)
print('worker.env atualizado')
PY
chmod 600 worker.env
docker compose --profile worker up -d worker
echo "Pronto: o worker grava no Drive como a conta que autorizou."
