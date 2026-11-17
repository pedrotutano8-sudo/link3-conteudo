// Liga a camada de design de uma marca: copia marcas/<pasta>/design.json para brand_kits.acabamento.design do cliente.
// Uso: docker compose exec -T worker node scripts/design.mjs gnx "GNX"      (pasta da marca, trecho do nome do cliente)
//      docker compose exec -T worker node scripts/design.mjs gnx "GNX" off  (desliga e volta para a legenda simples)
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';
import { MARCAS_DIR } from '../lib/design.js';

const [pasta, nome, modo] = process.argv.slice(2);
if (!pasta || !nome) { console.log('uso: node scripts/design.mjs <pasta-da-marca> <nome do cliente> [off]'); process.exit(1); }
const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
const { data: clientes, error } = await sb.from('clients').select('id, nome').ilike('nome', `%${nome}%`);
if (error || clientes?.length !== 1) { console.log('cliente não encontrado ou ambíguo:', error?.message || (clientes || []).map((c) => c.nome).join(', ')); process.exit(1); }
const cliente = clientes[0];
const { data: kit } = await sb.from('brand_kits').select('id, acabamento').eq('client_id', cliente.id).single();
if (!kit) { console.log(`${cliente.nome}: sem kit de marca`); process.exit(1); }
const design = modo === 'off' ? { ...(kit.acabamento?.design || {}), ativo: false } : JSON.parse(fs.readFileSync(path.join(MARCAS_DIR, pasta, 'design.json'), 'utf8'));
const { error: e2 } = await sb.from('brand_kits').update({ acabamento: { ...(kit.acabamento || {}), design } }).eq('id', kit.id);
console.log(e2 ? `falhou: ${e2.message}` : `${cliente.nome}: design ${design.ativo ? 'ligado' : 'desligado'}`);
