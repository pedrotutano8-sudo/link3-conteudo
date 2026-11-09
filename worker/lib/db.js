// Acesso ao Supabase com a chave service_role (só no servidor, nunca no painel)
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export function criarDb({ url, key }) {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    pegar: async (worker) => ok(await sb.rpc('pegar_job', { p_worker: worker }))?.[0] || null,
    atualizar: async (id, status, campos = {}, mensagem = null) => ok(await sb.rpc('atualizar_job', { p_job: id, p_status: status, p_campos: campos, p_mensagem: mensagem })),
    falhar: async (id, mensagem) => ok(await sb.rpc('falhar_job', { p_job: id, p_mensagem: mensagem })),
    perguntar: async (id, pergunta, opcoes) => ok(await sb.rpc('perguntar', { p_job: id, p_pergunta: pergunta, p_opcoes: opcoes || null })),
    cliente: async (id) => ok(await sb.from('clients').select('*').eq('id', id).single()),
    kit: async (clientId) => ok(await sb.from('brand_kits').select('*').eq('client_id', clientId).maybeSingle()),
    asset: async (id) => ok(await sb.from('brand_assets').select('*').eq('id', id).single()),
    respostas: async (jobId) => ok(await sb.from('questions').select('pergunta, resposta').eq('job_id', jobId).not('resposta', 'is', null)),
    ultimoAjuste: async (jobId) => ok(await sb.from('job_revisions').select('comando').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1))?.[0]?.comando || null,
    baixarAsset: async (path, destino) => { const blob = ok(await sb.storage.from('marcas').download(path)); fs.writeFileSync(destino, Buffer.from(await blob.arrayBuffer())); return destino; },
    enviarPrevia: async (path, arquivo, mime = 'video/mp4') => { ok(await sb.storage.from('previas').upload(path, fs.readFileSync(arquivo), { contentType: mime, upsert: true })); return path; },
  };
}
