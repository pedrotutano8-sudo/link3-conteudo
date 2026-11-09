// Tudo vem de variáveis de ambiente (no servidor: segredos do GitHub → .env do worker)
import fs from 'node:fs';
import os from 'node:os';

const conta = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
export const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // aceita o JSON da conta de serviço inteiro ou o caminho do arquivo
  googleCredentials: conta.trim().startsWith('{') ? JSON.parse(conta) : conta && fs.existsSync(conta) ? JSON.parse(fs.readFileSync(conta, 'utf8')) : null,
  workDir: process.env.WORK_DIR || os.tmpdir() + '/link3-worker',
  workerId: process.env.WORKER_ID || os.hostname(),
  pollMs: Number(process.env.POLL_MS || 4000),
  ffmpeg: process.env.FFMPEG || 'ffmpeg',
  ffprobe: process.env.FFPROBE || 'ffprobe',
};

export function conferir() {
  const falta = [];
  if (!config.supabaseUrl) falta.push('SUPABASE_URL');
  if (!config.supabaseKey) falta.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.googleCredentials) falta.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  return falta;
}
