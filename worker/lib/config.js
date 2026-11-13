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
  // Parakeet local (padrão quando o modelo existe na pasta): mesmo motor do kit Edição Sem Editor
  asr: process.env.ASR || '',
  parakeetDir: process.env.PARAKEET_DIR || '/models/parakeet',
  parakeetThreads: Number(process.env.PARAKEET_THREADS || 3),
  // trilhas de fundo (mp3/wav com licença para uso comercial), montadas do servidor em /trilhas
  trilhasDir: process.env.TRILHAS_DIR || '/trilhas',
  // ElevenLabs Scribe (opcional): transcrição literal, preferida quando a chave existe
  elevenlabsKey: process.env.ELEVENLABS_API_KEY || '',
  modeloScribe: process.env.MODELO_SCRIBE || 'scribe_v2',
  precoScribeMinuto: Number(process.env.PRECO_SCRIBE_MINUTO || 0.0037),   // US$ 0,22/hora
  modeloClaude: process.env.MODELO_CLAUDE || 'claude-sonnet-5-5',
  precoClaudeEntrada: Number(process.env.PRECO_CLAUDE_ENTRADA || 3),   // US$ por milhão de tokens
  precoClaudeSaida: Number(process.env.PRECO_CLAUDE_SAIDA || 15),
  // login do Google da conta dona das pastas (opcional, para gravar no Drive de conta Gmail)
  googleOAuth: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '', refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '' },
  revisao: process.env.REVISAO !== '0',   // 2ª passada na fala já editada (padrão: ligada)
  pausaMax: Number(process.env.PAUSA_MAX || 0.35),                   // silêncio maior que isso é cortado (s)
};

export const modulo1Ativo = () => Boolean(config.anthropicKey && (config.openaiKey || config.elevenlabsKey || fs.existsSync(config.parakeetDir + '/tokens.txt')));

export function conferir() {
  const falta = [];
  if (!config.supabaseUrl) falta.push('SUPABASE_URL');
  if (!config.supabaseKey) falta.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.googleCredentials) falta.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  return falta;
}
