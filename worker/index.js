// Worker da Link3: pega o próximo pedido, processa e volta para a fila.
import { config, conferir, modulo1Ativo } from './lib/config.js';
import { criarPlanejadorM1 } from './lib/modulo1.js';
import { criarLote } from './lib/lote.js';
import { criarDb } from './lib/db.js';
import { criarDrive } from './lib/drive.js';
import { criarEtapas } from './lib/etapas.js';

const falta = conferir();
if (falta.length) { console.error('Faltam variáveis de ambiente:', falta.join(', ')); process.exit(1); }

const db = criarDb({ url: config.supabaseUrl, key: config.supabaseKey });
const drive = criarDrive({ credentials: config.googleCredentials, oauth: config.googleOAuth });
const { processar } = criarEtapas({ db, drive, workDir: config.workDir,
  ...(modulo1Ativo() ? { planejar: criarPlanejadorM1(), lote: criarLote({ db, drive, workDir: config.workDir }) } : {}) });
let parar = false;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { console.log('encerrando depois do pedido atual…'); parar = true; });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`worker ${config.workerId} no ar · ${modulo1Ativo() ? 'Módulo 1 (transcrição, cortes, legenda, gancho e copy)' : 'Base (só logo)'}`);
while (!parar) {
  let job = null;
  try {
    job = await db.pegar(config.workerId);
    if (!job) { await espera(config.pollMs); continue; }
    const t = Date.now();
    const fim = await processar(job);
    console.log(`#${job.numero} ${job.status} → ${fim} em ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error(job ? `#${job.numero} falhou:` : 'erro no laço:', e.message);
    if (job) await db.falhar(job.id, e.message).catch((x) => console.error('não consegui registrar a falha:', x.message));
    else await espera(config.pollMs);
  }
}
process.exit(0);
