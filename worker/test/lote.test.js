import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rodar, medir, juntarBrutos } from '../lib/midia.js';
import { textoDocx, textoArquivo } from '../lib/documento.js';
import { criarLote } from '../lib/lote.js';
import { criarEtapas } from '../lib/etapas.js';
import { contraste } from '../lib/legenda.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l3lote-'));
const docx = path.join(tmp, 'Roteiros 05-11.docx');
execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
z.writestr('[Content_Types].xml', '<Types/>')
z.writestr('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Vídeo 1 &amp; vagas</w:t></w:r></w:p><w:p><w:r><w:t>Fala: estamos contratando</w:t></w:r></w:p><w:p><w:r><w:t>Vídeo 2</w:t></w:r></w:p></w:body></w:document>')
z.close()`, docx]);

const clipe = async (nome, { w = 1920, h = 1080, d = 2, audio = true } = {}) => {
  const a = path.join(tmp, nome);
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=25:duration=${d}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${d}`, '-shortest');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac'] : []), a);
  await rodar('ffmpeg', args);
  return a;
};

test('documento: lê .docx (zip) e .txt', async () => {
  const t = textoDocx(fs.readFileSync(docx));
  assert.match(t, /Vídeo 1 & vagas\nFala: estamos contratando\nVídeo 2/);
  const txt = path.join(tmp, 'r.txt'); fs.writeFileSync(txt, ' roteiro \n');
  assert.equal(await textoArquivo(txt, 'text/plain'), 'roteiro');
  assert.match(await textoArquivo(docx, ''), /contratando/);
});

test('legenda: texto do título contrasta com a cor da marca', () => {
  assert.equal(contraste('#5F27E0'), '#FFFFFF');
  assert.equal(contraste('#F5C542'), '#111111');
});

test('juntarBrutos: takes horizontal com áudio + vertical sem áudio → 9:16 com a soma das durações', async () => {
  const a = await clipe('t1.mov', { d: 2 }), b = await clipe('t2.mov', { w: 720, h: 1280, d: 1.5, audio: false });
  const saida = path.join(tmp, 'junto.mp4');
  await juntarBrutos([a, b], saida);
  const i = await medir(saida);
  assert.equal(i.largura, 1080); assert.equal(i.altura, 1920); assert.ok(i.temAudio);
  assert.ok(Math.abs(i.duracao - 3.5) < 0.2, `duração ${i.duracao}`);
});

test('lote: pasta + roteiro → 1 pedido de reel por roteiro, com os takes na ordem', async () => {
  const v = await clipe('base.mov', { d: 1 });
  const eventos = [], criados = [];
  const db = {
    atualizar: async (id, status, campos = {}, msg) => eventos.push({ status, campos, msg }),
    cliente: async () => ({ nome: 'GNX Group' }),
    criarJobs: async (linhas) => { criados.push(...linhas); return linhas.map((_, k) => ({ id: 'n' + k, numero: 10 + k })); },
  };
  const arquivos = [
    { id: 'r1', name: 'Roteiros 05-11.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { id: 'v12', name: 'IMG_5212.mov', mimeType: 'video/quicktime' },
    { id: 'v3', name: 'IMG_5203.mov', mimeType: 'video/quicktime' },
    { id: 'v30', name: 'IMG_5230.mov', mimeType: 'video/quicktime' },
    { id: 'f1', name: 'Fotos', mimeType: 'application/vnd.google-apps.folder' },
  ];
  const drive = {
    meta: async () => ({ id: 'pasta', name: 'Gravação 05,11', mimeType: 'application/vnd.google-apps.folder' }),
    listar: async () => arquivos,
    baixar: async (id, d) => fs.copyFileSync(id === 'r1' ? docx : v, d),
  };
  let pedidoClaude;
  const ia = {
    extrairAudio: async (a, d) => { fs.writeFileSync(d, 'x'); return d; },
    transcrever: async () => ({ texto: 'estamos contratando', palavras: [], segundos: 1 }),
    agruparPorRoteiro: async (p) => { pedidoClaude = p; return { reels: [{ titulo: 'Vagas', roteiro: 'Fala: estamos contratando', videos: [1, 2] }], sobras: [3], tokens: { entrada: 1000, saida: 200 }, usd: 0.006 }; },
  };
  const lote = criarLote({ db, drive, workDir: path.join(tmp, 'w'), ia, log: () => {} });
  const job = { id: 'L1', numero: 9, org_id: 'o', client_id: 'c', tipo: 'lote', origem_drive_id: 'pasta', comando: 'até 60 s', created_by: 'u1' };
  assert.equal(await lote(job), 'entregue');
  assert.match(pedidoClaude.roteiros, /estamos contratando/);
  assert.deepStrictEqual(pedidoClaude.videos.map((x) => x.nome), ['IMG_5203.mov', 'IMG_5212.mov', 'IMG_5230.mov']); // ordem de gravação
  assert.equal(criados.length, 1);
  assert.deepStrictEqual(criados[0].origens.map((o) => o.nome), ['IMG_5203.mov', 'IMG_5212.mov']);
  assert.equal(criados[0].lote_id, 'L1'); assert.equal(criados[0].tipo, 'reel');
  assert.match(criados[0].comando, /^Siga este roteiro:\nFala: estamos contratando\n\naté 60 s$/);
  const fim = eventos.pop();
  assert.equal(fim.status, 'entregue'); assert.match(fim.msg, /#10/);
  assert.deepStrictEqual(fim.campos.roteiro.sobras, ['IMG_5230.mov']);
});

test('reel com vários takes: baixa todos, junta e segue o fluxo normal', async () => {
  const a = await clipe('k1.mov', { d: 1.5 }), b = await clipe('k2.mov', { d: 1 });
  const ev = [], previas = path.join(tmp, 'prev'); fs.mkdirSync(previas, { recursive: true });
  const db = {
    atualizar: async (id, status, campos = {}, msg) => ev.push({ status, msg }), respostas: async () => [],
    cliente: async () => ({ nome: 'GNX' }), kit: async () => null,
    enviarPrevia: async (p, arq) => { fs.copyFileSync(arq, path.join(previas, 'p.mp4')); return p; },
  };
  const drive = { meta: async (id) => ({ name: id + '.mov', mimeType: 'video/quicktime' }), baixar: async (id, d) => fs.copyFileSync(id === 'k1' ? a : b, d) };
  const { processar } = criarEtapas({ db, drive, workDir: path.join(tmp, 'w2'), log: () => {} });
  const job = { id: 'R1', org_id: 'o', client_id: 'c', numero: 10, tipo: 'reel', status: 'na_fila', origem_drive_id: 'k1', origens: [{ id: 'k1' }, { id: 'k2' }] };
  assert.equal(await processar(job), 'previa_pronta');
  assert.ok(ev.some((e) => /juntados 2 takes/.test(e.msg || '')));
  const i = await medir(path.join(previas, 'p.mp4'));
  assert.ok(Math.abs(i.duracao - 2.5) < 0.2, `duração ${i.duracao}`);
});

test('retentativa: API ocupada (503) tenta de novo e segue', async () => {
  const { comRetentativa } = await import('../lib/ia.js');
  let n = 0;
  const f = async () => (++n < 2 ? new Response('{}', { status: 503 }) : Response.json({ ok: 1 }));
  const r = await comRetentativa(f, 'x', {}, 3);
  assert.equal(r.status, 200); assert.equal(n, 2);
  let m = 0;
  const g = async () => { m++; return new Response('{}', { status: 400 }); };
  assert.equal((await comRetentativa(g, 'x', {}, 3)).status, 400); assert.equal(m, 1);
});
