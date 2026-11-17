// Refaz só a prévia de pedidos que já têm roteiro, sem chamar a IA de novo (ajuste de áudio, trilha ou visual).
// Uso: docker compose exec -T worker node scripts/previa.mjs 29 [27 ...]   (--novo-design: pede de novo o plano da camada de design)
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';
import { criarDb } from '../lib/db.js';
import { criarDrive } from '../lib/drive.js';
import { criarEtapas } from '../lib/etapas.js';
import { criarAcabamento } from '../lib/acabamento.js';
import * as ia from '../lib/ia.js';

const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
const db = criarDb({ url: config.supabaseUrl, key: config.supabaseKey });
const drive = criarDrive({ credentials: config.googleCredentials, oauth: config.googleOAuth });
const acabamento = criarAcabamento({ drive, ia, workDir: config.workDir });
const { refazerPrevia } = criarEtapas({ db, drive, workDir: config.workDir, acabamento });
const novoDesign = process.argv.includes('--novo-design');
for (const n of process.argv.slice(2).map(Number).filter(Boolean)) {
  const { data: job, error } = await sb.from('jobs').select('*').eq('numero', n).single();
  if (error || !job) { console.log(`#${n}: não encontrado`); continue; }
  if (novoDesign && job.roteiro) delete job.roteiro.design;
  const t0 = Date.now();
  try { await refazerPrevia(job); console.log(`#${n}: prévia refeita em ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
  catch (e) { console.log(`#${n}: falhou: ${e.message}`); }
}
