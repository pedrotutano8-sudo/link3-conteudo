// Google Drive via conta de serviço: ler o bruto e gravar o finalizado.
// A pasta de clientes da Link3 é compartilhada com o e-mail da conta de serviço.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { GoogleAuth } from 'google-auth-library';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';

export function criarDrive({ credentials, fetchFn = fetch, token } = {}) {
  const auth = credentials ? new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] }) : null;
  const cabecalho = async () => ({ Authorization: `Bearer ${token || (await auth.getAccessToken())}` });

  async function req(url, opts = {}) {
    const r = await fetchFn(url, { ...opts, headers: { ...(await cabecalho()), ...(opts.headers || {}) } });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      const msg = r.status === 404 ? 'Arquivo não encontrado no Drive (confira o link e se a pasta está compartilhada com o sistema)'
        : r.status === 403 ? 'Sem permissão no Drive: compartilhe a pasta com a conta do sistema' : `Drive respondeu ${r.status}`;
      const e = new Error(`${msg}${txt ? ` · ${txt.slice(0, 200)}` : ''}`); e.status = r.status; throw e;
    }
    return r;
  }

  return {
    async meta(id) {
      const r = await req(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents&supportsAllDrives=true`);
      return r.json();
    },
    async listar(pastaId) {
      const q = encodeURIComponent(`'${pastaId}' in parents and trashed = false`);
      const r = await req(`${API}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
      return (await r.json()).files || [];
    },
    async baixar(id, destino) {
      const r = await req(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destino));
      return destino;
    },
    // acha (ou cria) uma subpasta pelo nome: usada para "Finalizados" dentro da pasta do cliente
    async pastaFilha(paiId, nome) {
      const q = encodeURIComponent(`'${paiId}' in parents and name = '${nome.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const r = await req(`${API}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
      const achou = (await r.json()).files?.[0];
      if (achou) return achou.id;
      const c = await req(`${API}/files?supportsAllDrives=true&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] }) });
      return (await c.json()).id;
    },
    // upload resumível: aguenta vídeos grandes
    async enviar(arquivo, { nome, pastaId, mime = 'video/mp4' }) {
      const ini = await req(`${UP}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
        body: JSON.stringify({ name: nome, parents: pastaId ? [pastaId] : undefined }),
      });
      const destino = ini.headers.get('location');
      const tamanho = fs.statSync(arquivo).size;
      const r = await req(destino, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(tamanho) }, body: fs.createReadStream(arquivo), duplex: 'half' });
      return r.json();
    },
  };
}
