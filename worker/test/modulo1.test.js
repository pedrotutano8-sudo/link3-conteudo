import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rodar, medir } from '../lib/midia.js';
import { calcularCortes, ehVicio } from '../lib/cortes.js';
import { gerarAss, corAss, agrupar } from '../lib/legenda.js';
import { criarEtapas } from '../lib/etapas.js';
import { criarPlanejadorM1 } from '../lib/modulo1.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l3m1-'));
export const SAIDA = tmp;

// fala de 0,2 a 1,8 s · pausa · fala de 4,2 a 5,8 s · pausa até 8 s
const palavrasFake = [
  { p: 'Hoje', i: 0.2, f: 0.5 }, { p: 'eu', i: 0.55, f: 0.7 }, { p: 'vou', i: 0.75, f: 0.95 }, { p: 'mostrar', i: 1.0, f: 1.4 }, { p: 'éé', i: 1.45, f: 1.8 },
  { p: 'três', i: 4.2, f: 4.5 }, { p: 'erros', i: 4.55, f: 4.9 }, { p: 'de', i: 4.95, f: 5.05 }, { p: 'clareamento.', i: 5.1, f: 5.8 },
];

test('cortes: tira pausas e vícios e remapeia o tempo', () => {
  assert.ok(ehVicio('éé') && ehVicio('Ahn,') && ehVicio('ééé') && !ehVicio('eu') && !ehVicio('e') && !ehVicio('é') && !ehVicio('É,'));
  const c = calcularCortes(palavrasFake, { duracao: 8, pausa: 0.45, respiro: 0.12 });
  assert.deepStrictEqual(c.trechos, [[0.08, 1.52], [4.08, 5.92]]);
  assert.equal(c.duracaoFinal, 3.28);
  assert.equal(c.cortado, 4.72);
  assert.equal(c.palavras.length, 8); // "éé" saiu
  assert.equal(c.palavras[4].p, 'três');
  assert.ok(Math.abs(c.palavras[4].i - (1.44 + 0.12)) < 1e-6);
});

test('cortes: sem fala mantém o vídeo inteiro', () => {
  assert.deepStrictEqual(calcularCortes([], { duracao: 5 }).trechos, [[0, 5]]);
});

test('legenda: cores, grupos, título e destaque', () => {
  assert.equal(corAss('#F0C41D'), '&H001DC4F0');
  assert.equal(agrupar(calcularCortes(palavrasFake, { duracao: 8 }).palavras, 3).length, 3);
  const ass = gerarAss({ palavras: calcularCortes(palavrasFake, { duracao: 8 }).palavras, duracao: 3.28, titulo: '3 erros de clareamento', kit: { cores: { principal: '#E63946' } } });
  assert.match(ass, /Style: Titulo/);
  assert.match(ass, /3 ERROS DE CLAREAMENTO/);
  assert.match(ass, /\{\\c&H4639E6&\}HOJE/);
  assert.ok(!/ÉÉ/.test(ass));
});

test('Módulo 1 ponta a ponta: Drive → transcrição → cortes + legenda + gancho → prévia → aprovado → Drive', async () => {
  const bruto = path.join(tmp, 'gravacao.mov'), logo = path.join(tmp, 'logo.png');
  await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=8',
    '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*440*t)*(between(t,0.2,1.8)+between(t,4.2,5.8))':s=44100:d=8",
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', bruto]);
  await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0xF0C41D:size=300x120', '-frames:v', '1', logo]);

  const eventos = [], drivePasta = path.join(tmp, 'drive'), previas = path.join(tmp, 'previas');
  fs.mkdirSync(drivePasta, { recursive: true }); fs.mkdirSync(previas, { recursive: true });
  const kit = { versao: 2, logo_id: 'a1', cores: { principal: '#E63946', texto: '#FFFFFF', fundo: '#111111' }, estilo_legenda: { palavras_por_linha: 3, maiusculas: true } };
  const db = {
    atualizar: async (id, status, campos = {}, msg) => eventos.push({ status, campos, msg }),
    perguntar: async () => {}, respostas: async () => [], ultimoAjuste: async () => 'título mais curto',
    cliente: async () => ({ nome: 'Clínica Sorriso', pasta_finalizados_id: 'fin', tom_voz: 'próximo', ctas: ['Agende pelo link da bio'] }),
    kit: async () => kit,
    asset: async () => ({ nome: 'logo.png', mime: 'image/png', storage_path: 'x' }),
    baixarAsset: async (p, d) => fs.copyFileSync(logo, d),
    enviarPrevia: async (p, arq) => { fs.copyFileSync(arq, path.join(previas, path.basename(p))); return p; },
  };
  const drive = {
    meta: async () => ({ id: 'b1', name: 'Gravação Maria.mov', mimeType: 'video/quicktime' }),
    baixar: async (id, d) => fs.copyFileSync(bruto, d),
    enviar: async (arq, { nome }) => { fs.copyFileSync(arq, path.join(drivePasta, nome)); return { id: 'f1' }; },
  };
  let transcricoes = 0, chamadasClaude = [];
  const ia = {
    extrairAudio: async (v, d) => { await rodar('ffmpeg', ['-y', '-i', v, '-vn', '-ac', '1', '-ar', '16000', d]); return d; },
    transcrever: async () => { transcricoes++; return { texto: palavrasFake.map((w) => w.p).join(' '), palavras: palavrasFake, segundos: 8 }; },
    gancoECopy: async (a) => { chamadasClaude.push(a); return { remover: a.ajuste ? [] : [[1, 2]], corrigir: [[8, 'clareamentos']], titulo: a.ajuste ? 'Erros de clareamento' : '3 erros de clareamento', copy: 'Você comete esses erros?\nAgende pelo link da bio', tokens: { entrada: 900, saida: 120 }, usd: 0.0045 }; },
  };

  const { processar } = criarEtapas({ db, drive, workDir: path.join(tmp, 'work'), planejar: criarPlanejadorM1({ ia }), log: () => {} });
  const job = { id: 'j1', org_id: 'org', client_id: 'c1', numero: 21, tipo: 'reel', comando: 'reel de dicas', origem_drive_id: 'b1', status: 'na_fila' };

  assert.equal(await processar(job), 'previa_pronta');
  const rend = eventos.find((e) => e.status === 'renderizando');
  const roteiro = rend.campos.roteiro;
  assert.equal(roteiro.versao, 'm1');
  assert.equal(roteiro.titulo, '3 erros de clareamento');
  assert.equal(roteiro.trechos.length, 3);
  assert.deepStrictEqual(roteiro.removido, ['eu vou']);
  assert.equal(roteiro.palavras[roteiro.palavras.length - 1].p, 'clareamentos.'); // correção mantém a pontuação
  assert.ok(!roteiro.palavras.some((w) => w.p === 'vou'));
  assert.ok(chamadasClaude[0].palavras.length === 9);
  assert.ok(rend.campos.segundos_audio === 8 && rend.campos.tokens_entrada === 900);
  const [prev] = fs.readdirSync(previas);
  const ip = await medir(path.join(previas, prev));
  assert.equal(ip.largura, 540); assert.equal(ip.altura, 960);
  assert.ok(ip.duracao > 2.5 && ip.duracao < 3.4, `prévia com ${ip.duracao}s`);

  // ajuste: não transcreve de novo, manda o pedido pro Claude
  job.roteiro = roteiro; job.status = 'ajuste_pedido';
  assert.equal(await processar(job), 'previa_pronta');
  assert.equal(transcricoes, 1);
  assert.equal(chamadasClaude[1].ajuste, 'título mais curto');
  job.roteiro = eventos.filter((e) => e.status === 'renderizando').pop().campos.roteiro;
  assert.equal(job.roteiro.titulo, 'Erros de clareamento');

  job.status = 'aprovado';
  assert.equal(await processar(job), 'entregue');
  const [fin] = fs.readdirSync(drivePasta);
  const i = await medir(path.join(drivePasta, fin));
  assert.equal(i.largura, 1080); assert.equal(i.altura, 1920);
  assert.ok(i.duracao > 2.5 && i.duracao < 3.6, `final com ${i.duracao}s`);
  assert.ok(i.temAudio);
  // quadro com título + legenda, pra conferência visual
  await rodar('ffmpeg', ['-y', '-ss', '0.9', '-i', path.join(drivePasta, fin), '-frames:v', '1', path.join(tmp, 'quadro.png')]);
  fs.writeFileSync(path.join(os.tmpdir(), 'l3m1-ultimo.txt'), tmp);
});

test('cortes: pausa medida no áudio é cortada mesmo quando a transcrição "estica" a palavra', () => {
  const ws = [{ p: 'Bom', i: 0.1, f: 0.6 }, { p: 'dia', i: 0.6, f: 2.6 }, { p: 'pessoal', i: 2.6, f: 3.2 }];
  const c = calcularCortes(ws, { duracao: 4, silencios: [[1.0, 2.4]] });
  assert.equal(c.trechos.length, 2);
  assert.ok(c.duracaoFinal < 2.2, `duração ${c.duracaoFinal}`);
  assert.equal(c.palavras.length, 3);
  assert.ok(c.palavras.every((w, k, a) => w.f >= w.i && (k === 0 || w.i >= a[k - 1].i)));
});

test('silêncio detectado pelo áudio', async () => {
  const { detectarSilencios } = await import('../lib/midia.js');
  const a = path.join(tmp, 'sil.wav');
  await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*300*t)*(lt(t,1)+gt(t,2))':s=16000:d=3", a]);
  const { silencios } = await detectarSilencios(a);
  assert.equal(silencios.length, 1);
  assert.ok(Math.abs(silencios[0][0] - 1) < 0.1 && Math.abs(silencios[0][1] - 2) < 0.1, JSON.stringify(silencios));
});

test('revisão: o que o Claude marca na fala já editada sai do bruto no lugar certo', async () => {
  const { criarPlanejadorM1 } = await import('../lib/modulo1.js');
  const bruto = path.join(tmp, 'rev.mov');
  await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', bruto]);
  // fala contínua 0–6 s; a 2ª transcrição (da fala editada) mostra "pela pela" entre 2,0 e 2,6 s
  const ws = ['não', 'somente', 'pela', 'bagagem', 'mas', 'pela', 'experiência'].map((p, k) => ({ p, i: 0.2 + k * 0.8, f: 0.9 + k * 0.8 }));
  let chamadas = 0;
  const ia = {
    extrairAudio: async (v, d) => { await rodar('ffmpeg', ['-y', '-i', v, '-vn', d]); return d; },
    transcrever: async () => (++chamadas === 1
      ? { texto: '', palavras: ws, segundos: 6 }
      : { texto: '', palavras: [{ p: 'não', i: 0, f: 0.5 }, { p: 'somente', i: 0.6, f: 1.4 }, { p: 'pela,', i: 1.5, f: 1.9 }, { p: 'pela', i: 2.0, f: 2.4 }, { p: 'bagagem', i: 2.5, f: 3.2 }], segundos: 5 }),
    gancoECopy: async () => ({ remover: [], corrigir: [], titulo: 't', copy: 'c', tokens: { entrada: 1, saida: 1 }, usd: 0 }),
    revisarFala: async ({ palavras }) => { assert.equal(palavras[2].p, 'pela,'); return { remover: [[2, 2]], tokens: { entrada: 1, saida: 1 }, usd: 0 }; },
  };
  const plan = criarPlanejadorM1({ ia });
  const r = await plan({ job: { comando: '' }, cliente: { nome: 'X' }, kit: {}, info: { duracao: 6, temAudio: true }, bruto, pasta: tmp });
  assert.equal(chamadas, 2);
  assert.deepStrictEqual(r.roteiro.qa.revisao, ['pela,']);
  assert.ok(r.roteiro.trechos.length >= 2, JSON.stringify(r.roteiro.trechos));
  assert.ok(r.roteiro.duracao_final < 6 - 0.3);
});

test('repetição colada sai sem depender da IA (e não corta as duas cópias)', async () => {
  const { repeticoes } = await import('../lib/cortes.js');
  const mk = (txt) => txt.split(' ').map((p, k) => ({ p, i: k * 0.4, f: k * 0.4 + 0.3 }));
  const fica = (t) => mk(t).filter((_, k) => !repeticoes(mk(t)).has(k)).map((w) => w.p).join(' ');
  assert.equal(fica('eu trabalho pela pela empresa'), 'eu trabalho pela empresa');
  assert.equal(fica('a gente a gente trabalha'), 'a gente trabalha');
  assert.equal(fica('muito, muito bom'), 'muito, muito bom');
  assert.equal(fica('foi isso. Isso mesmo'), 'foi isso. Isso mesmo');
  assert.equal(fica('tra- trabalho aqui'), 'trabalho aqui');
  assert.equal(fica('e é essa construção'), 'e é essa construção');
});

test('Parakeet: tokens viram palavras com tempo e o áudio é dividido em pedaços de até 12 s', async () => {
  const { tokensParaPalavras, pontosDeCorte } = await import('../lib/parakeet.js');
  const r = { tokens: [' No', ' preg', 'unt', 'es', ' que', ',', ' GNX', '.'], timestamps: [0, 0.24, 0.48, 0.64, 0.8, 1.0, 1.2, 1.5], durations: [0.24, 0.24, 0.16, 0.16, 0.16, 0.08, 0.3, 0.08] };
  const p = tokensParaPalavras(r, 10);
  assert.deepStrictEqual(p.map((w) => w.p), ['No', 'preguntes', 'que,', 'GNX.']);
  assert.equal(p[1].i, 10.24); assert.equal(p[1].f, 10.8);
  assert.deepStrictEqual(tokensParaPalavras({ tokens: [' tinha', '3', '4', ' anos'], timestamps: [0, 0.3, 0.4, 0.6], durations: [0.2, 0.1, 2.0, 0.2] }).map((w) => [w.p, w.f]), [['tinha', 0.2], ['34', 0.8], ['anos', 0.8]]);
  const s = new Float32Array(16000 * 40).fill(0.3);
  s.fill(0, 16000 * 9, 16000 * 9.5);
  const c = pontosDeCorte(s);
  assert.equal(c[0], 0); assert.equal(c[c.length - 1], s.length);
  for (let k = 1; k < c.length; k++) assert.ok(c[k] - c[k - 1] <= 12 * 16000);
  assert.ok(Math.abs(c[1] / 16000 - 9.25) < 0.3, 'corta no silêncio');
});

test('pausa do áudio sai mesmo quando a transcrição estica a palavra por cima dela (critério do kit)', async () => {
  const { calcularCortes } = await import('../lib/cortes.js');
  const palavras = [{ p: 'pelo', i: 17.62, f: 17.86 }, { p: 'reconhecimento,', i: 17.86, f: 18.98 }, { p: 'acho', i: 19.06, f: 19.22 }, { p: 'que', i: 19.6, f: 19.8 }];
  const c = calcularCortes(palavras, { duracao: 25, silencios: [[18.63, 19.52]] });
  const mantido = (t) => c.trechos.some(([a, b]) => t >= a && t <= b);
  assert.ok(mantido(18.6) && mantido(19.6), 'fala fica');
  assert.ok(!mantido(19.0), 'a pausa sai');
});

test('pedaço sem fala (sobra de outro take) não entra no vídeo', async () => {
  const { calcularCortes } = await import('../lib/cortes.js');
  const palavras = [{ p: 'gestão', i: 15.0, f: 15.6 }, { p: 'de', i: 15.7, f: 15.8 }, { p: 'pessoas.', i: 15.9, f: 16.8 }, { p: 'Pouco', i: 34.3, f: 34.6 }];
  const c = calcularCortes(palavras, { duracao: 40, silencios: [[16.95, 17.5], [17.95, 34.1]] });
  assert.ok(!c.trechos.some(([a, b]) => a >= 17.4 && b <= 18.0), JSON.stringify(c.trechos));
});
