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
  assert.ok(ehVicio('éé') && ehVicio('Ahn,') && !ehVicio('eu'));
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
    gancoECopy: async (a) => { chamadasClaude.push(a); return { remover: a.ajuste ? [] : [[1, 2]], titulo: a.ajuste ? 'Erros de clareamento' : '3 erros de clareamento', copy: 'Você comete esses erros?\nAgende pelo link da bio', tokens: { entrada: 900, saida: 120 }, usd: 0.0045 }; },
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
  assert.ok(!roteiro.palavras.some((w) => w.p === 'vou'));
  assert.ok(chamadasClaude[0].palavras.length === 9);
  assert.ok(rend.campos.segundos_audio === 8 && rend.campos.tokens_entrada === 900);
  const [prev] = fs.readdirSync(previas);
  const ip = await medir(path.join(previas, prev));
  assert.equal(ip.largura, 540); assert.equal(ip.altura, 960);
  assert.ok(Math.abs(ip.duracao - 3.02) < 0.15, `prévia com ${ip.duracao}s`);

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
  assert.ok(Math.abs(i.duracao - 3.28) < 0.15, `final com ${i.duracao}s`);
  assert.ok(i.temAudio);
  // quadro com título + legenda, pra conferência visual
  await rodar('ffmpeg', ['-y', '-ss', '0.9', '-i', path.join(drivePasta, fin), '-frames:v', '1', path.join(tmp, 'quadro.png')]);
  fs.writeFileSync(path.join(os.tmpdir(), 'l3m1-ultimo.txt'), tmp);
});
