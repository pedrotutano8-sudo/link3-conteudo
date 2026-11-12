// Cadastra o kit de marca de um cliente a partir de uma pasta com kit.json + arquivos.
// Uso (no servidor): docker compose cp ../marcas/gnx worker:/tmp/kit && docker compose exec -T worker node scripts/kit.mjs /tmp/kit
// kit.json: { "cliente": "GNX Group", "logo": "logo-branco.png", "logo_tipo": "logo_branca", "fonte": "Montserrat-Bold.ttf", "cores": {...}, "estilo_legenda": {...} }
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';

const dir = process.argv[2];
const k = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8'));
const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const cli = ok(await sb.from('clients').select('id, org_id, nome').eq('nome', k.cliente).single());
const mimes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf' };
async function subir(arquivo, tipo) {
  const caminho = `${cli.org_id}/${cli.id}/${arquivo}`;
  const buf = fs.readFileSync(path.join(dir, arquivo));
  const mime = mimes[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
  ok(await sb.storage.from('marcas').upload(caminho, buf, { contentType: mime, upsert: true }));
  const existe = ok(await sb.from('brand_assets').select('id').eq('client_id', cli.id).eq('storage_path', caminho).maybeSingle());
  if (existe) return existe.id;
  return ok(await sb.from('brand_assets').insert({ org_id: cli.org_id, client_id: cli.id, tipo, nome: arquivo, storage_path: caminho, mime, tamanho: buf.length }).select('id').single()).id;
}

const logo = k.logo ? await subir(k.logo, k.logo_tipo || 'logo') : null;
const fonte = k.fonte ? await subir(k.fonte, 'fonte') : null;
const kit = { org_id: cli.org_id, client_id: cli.id, cores: k.cores || {}, estilo_legenda: k.estilo_legenda || {},
  fontes: fonte ? { titulo: fonte, corpo: fonte } : {}, logo_id: logo };
ok(await sb.from('brand_kits').upsert(kit, { onConflict: 'client_id' }));
const r = ok(await sb.from('brand_kits').select('versao').eq('client_id', cli.id).single());
console.log(`kit de ${cli.nome} salvo (versão ${r.versao}): logo ${logo ? 'ok' : '-'}, fonte ${fonte ? 'ok' : '-'}`);
