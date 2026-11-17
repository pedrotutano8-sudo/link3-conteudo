// Folha de conferência de uma prévia: baixa a prévia do pedido e monta uma grade de quadros (JPG) para revisar o visual.
// Uso: docker compose exec -T worker node scripts/folha.mjs 27 [/work/folha-27.jpg] [colunas=6] [linhas=3]
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';
import { rodar, medir } from '../lib/midia.js';

const [n, saida = `/work/folha-${process.argv[2]}.jpg`, col = '6', lin = '3'] = process.argv.slice(2);
const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
const { data: job } = await sb.from('jobs').select('id, previa_path').eq('numero', Number(n)).single();
if (!job?.previa_path) { console.log('sem prévia'); process.exit(1); }
const { data: blob, error } = await sb.storage.from('previas').download(job.previa_path);
if (error) { console.log(error.message); process.exit(1); }
const mp4 = `/work/previa-${n}.mp4`;
fs.writeFileSync(mp4, Buffer.from(await blob.arrayBuffer()));
const { duracao } = await medir(mp4);
const q = Number(col) * Number(lin);
await rodar(config.ffmpeg, ['-y', '-i', mp4, '-vf', `fps=${q}/${duracao.toFixed(2)},scale=300:-2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='%{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${col}x${lin}`, '-frames:v', '1', '-q:v', '3', saida]);
console.log(`${saida} (${duracao.toFixed(1)} s)`);
