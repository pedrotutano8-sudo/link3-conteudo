// Testa ritmo / palavras atrás num pedido SEM mexer nele (status, prévia e roteiro ficam como estão).
// Uso: docker compose exec -T worker node scripts/teste-visual.mjs 26 "RITMO: dinâmico" "PALAVRAS-CHAVE: auto atrás"
// Sai em /work/_teste/teste-<n>.mp4 (copiar para o painel: docker compose cp worker:/work/_teste/teste-26.mp4 ../painel/_tmp/)
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';
import { criarDb } from '../lib/db.js';
import { criarDrive } from '../lib/drive.js';
import { criarEtapas } from '../lib/etapas.js';
import { criarAcabamento } from '../lib/acabamento.js';
import { lerPedidoVisual, mesclarVisual } from '../lib/visual.js';
import * as ia from '../lib/ia.js';

const [n, ...linhas] = process.argv.slice(2);
if (!Number(n)) { console.log('uso: node scripts/teste-visual.mjs <número> "RITMO: ..." "PALAVRAS-CHAVE: ..."'); process.exit(1); }
const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
const dbReal = criarDb({ url: config.supabaseUrl, key: config.supabaseKey });
// nada é gravado no pedido
const db = { ...dbReal, atualizar: async () => null, enviarPrevia: async () => null };
const drive = criarDrive({ credentials: config.googleCredentials, oauth: config.googleOAuth });
const acabamento = criarAcabamento({ drive, ia, workDir: config.workDir });
const { renderizarArquivo } = criarEtapas({ db, drive, workDir: config.workDir, acabamento });
const { data: job, error } = await sb.from('jobs').select('*').eq('numero', Number(n)).single();
if (error || !job?.roteiro) { console.log(`#${n}: não encontrado ou sem roteiro`); process.exit(1); }
const roteiro = JSON.parse(JSON.stringify(job.roteiro));
delete roteiro.design;
roteiro.visual = mesclarVisual(roteiro.visual, lerPedidoVisual(linhas.join('\n')));
console.log(`#${n}: pedido visual`, roteiro.visual);
const dir = path.join(config.workDir, '_teste'); fs.mkdirSync(dir, { recursive: true });
const saida = path.join(dir, `teste-${n}.mp4`);
const t0 = Date.now();
await renderizarArquivo(job, roteiro, saida);
const d = roteiro.design || {};
console.log(`#${n}: pronto em ${((Date.now() - t0) / 1000).toFixed(0)} s → ${saida}`);
console.log('palavras atrás:', (d.atras || []).map((a) => `${a.texto} @${a.t}s`).join(', ') || 'nenhuma', d.atrasFaltou?.length ? `| não couberam: ${d.atrasFaltou.join(', ')}` : '');
