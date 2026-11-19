// Instagram (login unificado da Meta): conecta a conta do cliente e publica o reel aprovado.
// Conectar: o painel grava o "code" que a Meta devolveu em instagram_conexoes; aqui ele vira token
// (com a chave secreta do app, que só existe no servidor) e as contas do Instagram autorizadas vão para instagram_contas.
// Publicar: publicacoes na fila → baixa o vídeo final do Drive → upload retomável no Instagram → publica.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const V = process.env.META_GRAPH_VERSION || 'v24.0';
export const metaConfig = () => ({
  appId: process.env.META_APP_ID || '',
  secret: process.env.META_APP_SECRET || '',
  redirect: process.env.META_REDIRECT_URI || 'https://conteudo.agencialinktres.com.br/instagram/retorno',
});
export const instagramAtivo = () => Boolean(metaConfig().appId && metaConfig().secret);

async function pedir(url, { method = 'GET', params = {}, token = null, body = null, headers = {}, fetchImpl = fetch } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  if (token && !headers.Authorization) u.searchParams.set('access_token', token);
  const r = await fetchImpl(u, { method, headers, body });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { bruto: txt.slice(0, 300) }; }
  if (!r.ok || j.error) {
    const e = j.error || {};
    const err = new Error(`Meta ${r.status}: ${e.message || j.bruto || 'erro'}${e.error_user_msg ? ` (${e.error_user_msg})` : ''}`);
    err.codigo = e.code; err.sub = e.error_subcode;
    throw err;
  }
  return j;
}

// code → token; contas do Instagram que a pessoa autorizou (pelos alvos das permissões ou pelas páginas)
export async function trocarCodigo(code, { fetchImpl = fetch } = {}) {
  const { appId, secret, redirect } = metaConfig();
  let t = await pedir(`https://graph.facebook.com/${V}/oauth/access_token`, { params: { client_id: appId, client_secret: secret, redirect_uri: redirect, code }, fetchImpl });
  let token = t.access_token, expira = t.expires_in ? Date.now() + t.expires_in * 1000 : null;
  // token curto (1-2 h) vira longo (60 dias); token de usuário do sistema não expira e não precisa
  if (expira && t.expires_in < 86400) {
    try {
      const l = await pedir(`https://graph.facebook.com/${V}/oauth/access_token`, { params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: token }, fetchImpl });
      token = l.access_token; expira = l.expires_in ? Date.now() + l.expires_in * 1000 : null;
    } catch { /* fica com o curto; o painel avisa para reconectar */ }
  }
  const ids = new Set();
  // diagnóstico (sem o token) para quando nenhuma conta aparecer
  const diag = { tipo_token: String(token).slice(0, 4) };
  try {
    const d = await pedir(`https://graph.facebook.com/${V}/debug_token`, { params: { input_token: token, access_token: `${appId}|${secret}` }, fetchImpl });
    diag.debug = { type: d.data?.type, scopes: d.data?.scopes, granular: d.data?.granular_scopes, user_id: d.data?.user_id ? 'sim' : 'não', profile_id: d.data?.profile_id ? 'sim' : 'não' };
    for (const g of d.data?.granular_scopes || []) if (/^instagram_/.test(g.scope)) (g.target_ids || []).forEach((x) => ids.add(String(x)));
    if (d.data?.profile_id && /^instagram/.test(String(d.data?.type || '').toLowerCase())) ids.add(String(d.data.profile_id));
    if (!expira && d.data?.expires_at) expira = d.data.expires_at * 1000;
  } catch (e) { diag.debug_erro = e.message.slice(0, 160); }
  const contas = [];
  for (const id of ids) {
    try { const c = await pedir(`https://graph.facebook.com/${V}/${id}`, { params: { fields: 'id,username,profile_picture_url' }, token, fetchImpl }); contas.push({ ig_user_id: c.id, username: c.username, foto: c.profile_picture_url || null, host: 'graph.facebook.com' }); } catch (e) { diag['alvo_' + id] = e.message.slice(0, 160); }
  }
  // contas do Instagram de empresas que a pessoa gerencia (login por empresa/usuário do sistema)
  if (!contas.length) {
    try {
      const b = await pedir(`https://graph.facebook.com/${V}/me/businesses`, { params: { fields: 'id,name,owned_instagram_accounts{id,username,profile_picture_url},instagram_accounts{id,username,profile_picture_url}', limit: 50 }, token, fetchImpl });
      diag.empresas = (b.data || []).length;
      for (const bz of b.data || []) for (const c of [...(bz.owned_instagram_accounts?.data || []), ...(bz.instagram_accounts?.data || [])]) if (c?.id && !contas.some((x) => x.ig_user_id === c.id)) contas.push({ ig_user_id: c.id, username: c.username, foto: c.profile_picture_url || null, host: 'graph.facebook.com' });
    } catch (e) { diag.empresas_erro = e.message.slice(0, 160); }
  }
  if (!contas.length) {
    try {
      const p = await pedir(`https://graph.facebook.com/${V}/me/accounts`, { params: { fields: 'instagram_business_account{id,username,profile_picture_url}', limit: 100 }, token, fetchImpl });
      diag.paginas = (p.data || []).length;
      for (const pg of p.data || []) { const c = pg.instagram_business_account; if (c?.id) contas.push({ ig_user_id: c.id, username: c.username, foto: c.profile_picture_url || null, host: 'graph.facebook.com' }); }
    } catch (e) { diag.paginas_erro = e.message.slice(0, 160); }
  }
  if (!contas.length) {
    try { const me = await pedir(`https://graph.instagram.com/${V}/me`, { params: { fields: 'user_id,username,profile_picture_url' }, token, fetchImpl }); contas.push({ ig_user_id: String(me.user_id || me.id), username: me.username, foto: me.profile_picture_url || null, host: 'graph.instagram.com' }); } catch (e) { diag.ig_me_erro = e.message.slice(0, 160); }
  }
  if (!contas.length) {
    try { const me = await pedir(`https://graph.facebook.com/${V}/me`, { params: { fields: 'id,name' }, token, fetchImpl }); diag.me = me.name ? 'usuário do Facebook' : JSON.stringify(me).slice(0, 80); } catch (e) { diag.me_erro = e.message.slice(0, 160); }
    const err = new Error('A Meta não devolveu nenhuma conta do Instagram. Na tela de login, marque a conta do Instagram (profissional) do cliente.');
    err.diag = diag; throw err;
  }
  return { token, expira: expira ? new Date(expira).toISOString() : null, contas };
}

// publica um reel: contêiner com upload retomável → espera processar → publica → link
export async function publicarReel({ conta, arquivo, legenda, fetchImpl = fetch, log = () => {}, espera = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = `https://${conta.host || 'graph.facebook.com'}/${V}`;
  const tamanho = fs.statSync(arquivo).size;
  const c = await pedir(`${base}/${conta.ig_user_id}/media`, { method: 'POST', params: { media_type: 'REELS', upload_type: 'resumable', caption: legenda || '', share_to_feed: true }, token: conta.token, fetchImpl });
  if (!c.uri) throw new Error('A Meta não devolveu o endereço de upload');
  log(`instagram: contêiner ${c.id}, enviando ${(tamanho / 1e6).toFixed(1)} MB`);
  const up = await fetchImpl(c.uri, { method: 'POST', headers: { Authorization: `OAuth ${conta.token}`, offset: '0', file_size: String(tamanho) }, body: fs.readFileSync(arquivo) });
  if (!up.ok) throw new Error(`upload do vídeo recusado (${up.status}): ${(await up.text()).slice(0, 200)}`);
  for (let i = 0; i < 60; i++) {
    const s = await pedir(`${base}/${c.id}`, { params: { fields: 'status_code,status' }, token: conta.token, fetchImpl });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`o Instagram não processou o vídeo: ${s.status || s.status_code}`);
    if (i === 59) throw new Error('o Instagram demorou demais para processar o vídeo (10 min)');
    await espera(10000);
  }
  const p = await pedir(`${base}/${conta.ig_user_id}/media_publish`, { method: 'POST', params: { creation_id: c.id }, token: conta.token, fetchImpl });
  let permalink = null;
  try { permalink = (await pedir(`${base}/${p.id}`, { params: { fields: 'permalink' }, token: conta.token, fetchImpl })).permalink || null; } catch { /* sem link */ }
  return { container_id: c.id, media_id: p.id, permalink };
}

// ciclo chamado pelo worker entre um pedido e outro
export function criarInstagram({ supabaseUrl, supabaseKey, drive, workDir, log = console.log }) {
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  async function conexoes() {
    const fila = ok(await sb.from('instagram_conexoes').select('*').eq('status', 'pendente').order('created_at').limit(5));
    for (const c of fila) {
      try {
        const r = await trocarCodigo(c.code);
        const salvas = [];
        for (const x of r.contas) {
          const linha = { org_id: c.org_id, ig_user_id: x.ig_user_id, username: x.username, foto: x.foto, host: x.host, token: r.token, token_expira: r.expira, ativo: true, conectado_por: c.created_by, updated_at: new Date().toISOString(), ...(c.client_id ? { client_id: c.client_id } : {}) };
          const s = ok(await sb.from('instagram_contas').upsert(linha, { onConflict: 'org_id,ig_user_id' }).select('id, username').single());
          salvas.push(s);
        }
        ok(await sb.from('instagram_conexoes').update({ status: 'ok', code: '-', contas: salvas }).eq('id', c.id));
        log(`instagram: conectado ${salvas.map((s) => '@' + s.username).join(', ')}`);
      } catch (e) {
        await sb.from('instagram_conexoes').update({ status: 'erro', code: '-', erro: e.message.slice(0, 500), contas: e.diag ? { diagnostico: e.diag } : null }).eq('id', c.id);
        if (e.diag) log(`instagram: diagnóstico ${JSON.stringify(e.diag).slice(0, 1500)}`);
        log(`instagram: conexão falhou: ${e.message}`);
      }
    }
  }

  async function publicacoes() {
    const fila = ok(await sb.from('publicacoes').select('*').eq('status', 'na_fila').lte('agendada_para', new Date().toISOString()).order('agendada_para').limit(1));
    for (const p of fila) {
      // trava: só um worker pega
      const pegou = ok(await sb.from('publicacoes').update({ status: 'publicando', tentativas: p.tentativas + 1 }).eq('id', p.id).eq('status', 'na_fila').select('id'));
      if (!pegou.length) continue;
      const arq = path.join(workDir, `pub-${p.id}.mp4`);
      try {
        const conta = ok(await sb.from('instagram_contas').select('*').eq('id', p.conta_id).single());
        if (!conta.ativo || !conta.token) throw new Error('conta do Instagram desconectada: conecte de novo no painel');
        const job = p.job_id ? ok(await sb.from('jobs').select('numero, final_drive_id, roteiro').eq('id', p.job_id).single()) : null;
        if (!job?.final_drive_id) throw new Error('o pedido ainda não tem o vídeo final no Drive (aprove a prévia primeiro)');
        fs.mkdirSync(workDir, { recursive: true });
        await drive.baixar(job.final_drive_id, arq);
        const legenda = p.legenda ?? job.roteiro?.copy ?? '';
        const r = await publicarReel({ conta, arquivo: arq, legenda, log });
        ok(await sb.from('publicacoes').update({ status: 'publicada', ...r, erro: null, publicada_em: new Date().toISOString() }).eq('id', p.id));
        log(`instagram: #${job.numero} publicado em @${conta.username} ${r.permalink || ''}`);
      } catch (e) {
        await sb.from('publicacoes').update({ status: 'erro', erro: e.message.slice(0, 500) }).eq('id', p.id);
        log(`instagram: publicação falhou: ${e.message}`);
      } finally { fs.rmSync(arq, { force: true }); }
    }
  }

  return {
    async ciclo() {
      if (!instagramAtivo()) return;
      try { await conexoes(); } catch (e) { log(`instagram (conexões): ${e.message}`); }
      try { await publicacoes(); } catch (e) { log(`instagram (publicações): ${e.message}`); }
    },
  };
}
