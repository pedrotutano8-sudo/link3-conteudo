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
  // Módulo 1 (opcionais: sem as duas chaves o worker segue na Base, só com logo)
  openaiKey: process.env.OPENAI_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  modeloTranscricao: process.env.MODELO_TRANSCRICAO || 'whisper-1',
  modeloClaude: process.env.MODELO_CLAUDE || 'claude-sonnet-5-5',
  precoClaudeEntrada: Number(process.env.PRECO_CLAUDE_ENTRADA || 3),   // US$ por milhão de tokens
  precoClaudeSaida: Number(process.env.PRECO_CLAUDE_SAIDA || 15),
  pausaMax: Number(process.env.PAUSA_MAX || 0.45),                   // silêncio maior que isso é cortado (s)
};

export const modulo1Ativo = () => Boolean(config.openaiKey && config.anthropicKey);

export function conferir() {
  const falta = [];
  if (!config.supabaseUrl) falta.push('SUPABASE_URL');
  if (!config.supabaseKey) falta.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.googleCredentials) falta.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  return falta;
}
