import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trocarCodigo, publicarReel, publicarImagens } from '../lib/instagram.js';

process.env.META_APP_ID = '111'; process.env.META_APP_SECRET = 'abc';
const resp = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });

test('troca o code pelo token e acha as contas pelos alvos da permissão', async () => {
  const chamadas = [];
  const f = async (u, o = {}) => {
    const url = new URL(u); chamadas.push(url.pathname + (o.method && o.method !== 'GET' ? ' ' + o.method : ''));
    if (url.pathname.endsWith('/oauth/access_token')) return resp({ access_token: 'TOK' });
    if (url.pathname.endsWith('/debug_token')) return resp({ data: { granular_scopes: [{ scope: 'instagram_basic', target_ids: ['178'] }, { scope: 'pages_show_list', target_ids: ['999'] }] } });
    if (url.pathname.endsWith('/178')) return resp({ id: '178', username: 'moovlar', profile_picture_url: 'x.jpg' });
    if (url.pathname.endsWith('/me/assigned_instagram_accounts')) return resp({ data: [] });
    return resp({ error: { message: 'inesperado' } }, 400);
  };
  const r = await trocarCodigo('CODE', { fetchImpl: f });
  assert.equal(r.token, 'TOK');
  assert.equal(r.expira, null);
  assert.deepEqual(r.contas, [{ ig_user_id: '178', username: 'moovlar', foto: 'x.jpg', host: 'graph.facebook.com' }]);
});

test('sem alvos: usa as páginas; sem nada: erro explicando', async () => {
  const f = async (u) => {
    const url = new URL(u);
    if (url.pathname.endsWith('/oauth/access_token')) return resp({ access_token: 'T', expires_in: 5184000 });
    if (url.pathname.endsWith('/debug_token')) return resp({ data: {} });
    if (url.pathname.endsWith('/me/accounts')) return resp({ data: [{ instagram_business_account: { id: '55', username: 'gnx' } }, {}] });
    return resp({ error: { message: 'x' } }, 400);
  };
  const r = await trocarCodigo('C', { fetchImpl: f });
  assert.equal(r.contas[0].username, 'gnx');
  assert.ok(r.expira);
  const vazio = async (u) => { const p = new URL(u).pathname; return p.endsWith('/oauth/access_token') ? resp({ access_token: 'T' }) : p.endsWith('/debug_token') ? resp({ data: {} }) : p.endsWith('/me/accounts') ? resp({ data: [] }) : resp({ error: { message: 'x' } }, 400); };
  await assert.rejects(trocarCodigo('C', { fetchImpl: vazio }), /nenhuma conta/);
});

test('publica reel: contêiner retomável, upload, espera, publica e pega o link', async () => {
  const arq = path.join(os.tmpdir(), 'reel-teste.mp4'); fs.writeFileSync(arq, Buffer.alloc(1234));
  const passos = []; let consultas = 0;
  const f = async (u, o = {}) => {
    const url = new URL(u); const m = o.method || 'GET';
    if (url.host === 'rupload.facebook.com') { passos.push('upload ' + o.headers.file_size + ' ' + o.headers.Authorization); return { ok: true, status: 200, text: async () => '{"success":true}' }; }
    if (url.pathname.endsWith('/178/media') && m === 'POST') { passos.push('container ' + url.searchParams.get('media_type') + ' ' + url.searchParams.get('upload_type')); return resp({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v24.0/C1' }); }
    if (url.pathname.endsWith('/C1')) { consultas++; return resp({ status_code: consultas < 2 ? 'IN_PROGRESS' : 'FINISHED' }); }
    if (url.pathname.endsWith('/178/media_publish')) { passos.push('publish ' + url.searchParams.get('creation_id')); return resp({ id: 'M9' }); }
    if (url.pathname.endsWith('/M9')) return resp({ permalink: 'https://instagram.com/reel/abc' });
    return resp({ error: { message: 'inesperado ' + url.pathname } }, 400);
  };
  const r = await publicarReel({ conta: { ig_user_id: '178', token: 'TOK' }, arquivo: arq, legenda: 'oi', fetchImpl: f, espera: async () => {} });
  assert.deepEqual(passos, ['container REELS resumable', 'upload 1234 OAuth TOK', 'publish C1']);
  assert.deepEqual(r, { container_id: 'C1', media_id: 'M9', permalink: 'https://instagram.com/reel/abc' });
});

test('login unificado: conta vem de me/assigned_instagram_accounts', async () => {
  const f = async (u) => {
    const p = new URL(u).pathname;
    if (p.endsWith('/oauth/access_token')) return resp({ access_token: 'EAAf' });
    if (p.endsWith('/debug_token')) return resp({ data: { type: 'SYSTEM_USER', granular_scopes: [{ scope: 'instagram_basic' }] } });
    if (p.endsWith('/me/assigned_instagram_accounts')) return resp({ data: [{ id: '1784', username: 'moovlar' }] });
    return resp({ error: { message: 'x' } }, 400);
  };
  const r = await trocarCodigo('C', { fetchImpl: f });
  assert.deepEqual(r.contas, [{ ig_user_id: '1784', username: 'moovlar', foto: null, host: 'graph.facebook.com' }]);
});

test('carrossel: um contêiner por imagem, contêiner CAROUSEL com os filhos e publica', async () => {
  const chamadas = [];
  let n = 0;
  const f = async (u, o) => {
    const url = new URL(u); chamadas.push([o.method, url.pathname, Object.fromEntries(url.searchParams)]);
    if (url.pathname.endsWith('/media') && o.method === 'POST') return resp({ id: url.searchParams.get('media_type') === 'CAROUSEL' ? 'car1' : `img${++n}` });
    if (url.pathname.endsWith('/media_publish')) return resp({ id: 'pub1' });
    if (url.searchParams.get('fields') === 'permalink') return resp({ permalink: 'https://www.instagram.com/p/abc/' });
    return resp({ status_code: 'FINISHED' });
  };
  const r = await publicarImagens({ conta: { ig_user_id: '178', token: 'T' }, urls: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'], legenda: 'oi', fetchImpl: f, espera: async () => {} });
  assert.deepEqual(r, { container_id: 'car1', media_id: 'pub1', permalink: 'https://www.instagram.com/p/abc/' });
  const posts = chamadas.filter((c) => c[0] === 'POST');
  assert.equal(posts.filter((c) => c[2].is_carousel_item === 'true').length, 3);
  const car = posts.find((c) => c[2].media_type === 'CAROUSEL');
  assert.equal(car[2].children, 'img1,img2,img3'); assert.equal(car[2].caption, 'oi');
  // post de 1 imagem: contêiner direto com a legenda, sem carrossel
  chamadas.length = 0; n = 0;
  await publicarImagens({ conta: { ig_user_id: '178', token: 'T' }, urls: ['https://x/1.jpg'], legenda: 'só uma', fetchImpl: f, espera: async () => {} });
  assert.ok(!chamadas.some((c) => c[2].media_type === 'CAROUSEL'));
  assert.equal(chamadas.find((c) => c[1].endsWith('/media'))[2].caption, 'só uma');
});
