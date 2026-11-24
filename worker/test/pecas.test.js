import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rodar } from '../lib/midia.js';
import { limparPeca, posicaoFoto } from '../lib/carrossel.js';

const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome'].find((c) => c && fs.existsSync(c));

test('plano da IA: capa primeiro, cta no fim, limites e fotos válidas', () => {
  const p = limparPeca({ laminas: [
    { layout: 'texto', titulo: 'um dois três quatro cinco seis sete oito nove dez onze doze', texto: 'x' },
    { layout: 'foto', titulo: 'sem foto', foto: 7 },
    { layout: 'lista', titulo: 'lista curta', itens: ['só um'] },
    { layout: 'numero', titulo: 'sem número' },
    { layout: 'capa', titulo: 'outra capa', foto: 0, recorte: true },
    { layout: 'cta', titulo: 'fala com a gente', foto: 0 },
  ], focos: { 0: { x: 140, y: 'a' }, 9: { x: 1, y: 1 } }, cta: 'Fale com a gente' }, { nFotos: 1 });
  assert.equal(p.laminas[0].layout, 'capa');
  assert.equal(p.laminas.at(-1).layout, 'cta');
  assert.ok(p.laminas.every((l) => l.layout !== 'foto' || l.foto != null), 'foto sem foto vira texto');
  assert.ok(p.laminas.every((l) => l.layout !== 'lista' || l.itens.length >= 2));
  assert.equal(p.laminas.filter((l) => l.foto === 0).length, 1, 'cada foto no máximo uma vez');
  assert.deepEqual(p.focos, { 0: { x: 100, y: 40 } });
  assert.ok(p.laminas[1].titulo.endsWith('…'));
  const post = limparPeca({ laminas: [{ layout: 'texto', titulo: 'a' }, { layout: 'citacao', texto: 'frase' }] }, { tipo: 'post' });
  assert.equal(post.laminas.length, 1); assert.equal(post.laminas[0].layout, 'citacao');
  const muitas = limparPeca({ laminas: Array.from({ length: 14 }, (_, k) => ({ layout: k ? 'texto' : 'capa', titulo: `l${k}` })).concat([{ layout: 'cta', titulo: 'fim' }]) });
  assert.equal(muitas.laminas.length, 10); assert.equal(muitas.laminas.at(-1).titulo, 'fim');
});

test('foto: o ponto de interesse vai para o centro da caixa, sem sobrar borda', () => {
  // foto em pé 1080x1920 num cartão 904x660: rosto a 52% da altura
  assert.equal(posicaoFoto({ w: 1080, h: 1920, foco: { x: 50, y: 52 } }, 904, 660), '0px -506px');
  // ponto no topo: não deixa aparecer borda vazia
  assert.equal(posicaoFoto({ w: 1080, h: 1920, foco: { x: 50, y: 0 } }, 904, 660), '0px 0px');
});

test('carrossel: Drive (pasta com fotos e documento) → IA → lâminas → prévia → ajuste → Drive', { skip: !chrome && 'sem Chromium' }, async () => {
  process.env.CHROME_BIN = chrome;
  process.env.MARCAS_DIR = path.resolve('../marcas');
  const { criarPecas } = await import('../lib/pecas.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l3p-'));
  const foto = path.join(tmp, 'f.jpg');
  await rodar('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1200x1600', '-frames:v', '1', foto]);
  const eventos = [], previas = [], drivePasta = {};
  const db = {
    atualizar: async (id, status, campos = {}, msg) => eventos.push({ status, campos, msg }),
    cliente: async () => ({ nome: 'GNX Group', pasta_finalizados_id: 'fin' }),
    kit: async () => ({ versao: 2, acabamento: { design: JSON.parse(fs.readFileSync('../marcas/gnx/design.json', 'utf8')), ficha: { sobre: 'RH e terceirização' } } }),
    enviarPrevia: async (p, arq, mime) => { previas.push({ p, mime, tam: fs.statSync(arq).size }); return p; },
    ultimoAjuste: async () => 'troca o título da capa',
  };
  const drive = {
    meta: async () => ({ id: 'pasta1', name: 'Material', mimeType: 'application/vnd.google-apps.folder' }),
    listarMidia: async () => [{ id: 'd1', name: 'texto.gdoc', mimeType: 'application/vnd.google-apps.document' }, { id: 'p1', name: 'equipe.jpg', mimeType: 'image/jpeg', thumbnailLink: 'x' }],
    exportarTexto: async () => 'A GNX tem 27 anos de mercado.',
    miniatura: async (f, d) => { fs.copyFileSync(foto, d); return d; },
    pastaFilha: async (pai, nome) => { drivePasta.nome = nome; return 'sub1'; },
    enviar: async (arq, { nome, pastaId, mime }) => { (drivePasta.arquivos ||= []).push({ nome, pastaId, mime }); return { id: nome }; },
  };
  const pedidos = [];
  const claudeJson = async ({ texto, imagens }) => {
    pedidos.push({ texto, imagens: imagens.length });
    return { usd: 0.02, tokens: { entrada: 1000, saida: 500 }, saida: { laminas: [
      { layout: 'capa', rotulo: 'Carreira', titulo: texto.includes('AJUSTE') ? 'Título *novo*' : 'Contratar *bem*', foto: 0 },
      { layout: 'numero', numero: '27', titulo: 'anos de *mercado*' },
      { layout: 'lista', titulo: 'Como *fazemos*', itens: ['um', 'dois', 'três'] },
      { layout: 'cta', titulo: 'Fale com a *GNX*' },
    ], focos: { 0: { x: 50, y: 40 } }, copy: 'Legenda do post', cta: 'Fale com a GNX' } };
  };
  const { processar } = criarPecas({ db, drive, workDir: path.join(tmp, 'work'), claudeJson, log: () => {} });
  const job = { id: 'j9', org_id: 'org', client_id: 'c1', numero: 31, tipo: 'carrossel', origem_drive_id: 'pasta1', comando: 'carrossel sobre contratação', status: 'na_fila' };
  assert.equal(await processar(job), 'previa_pronta');
  assert.deepEqual(eventos.map((e) => e.status), ['baixando', 'preparando', 'planejando', 'renderizando', 'previa_pronta']);
  assert.match(pedidos[0].texto, /27 anos de mercado/); assert.equal(pedidos[0].imagens, 1);
  assert.equal(previas.filter((p) => p.mime === 'image/jpeg').length, 5, '4 lâminas + folha');
  const fim = eventos.at(-1).campos;
  assert.equal(fim.roteiro.previas.length, 4); assert.match(fim.previa_path, /folha\.jpg$/);
  assert.equal(eventos[3].campos.custo_ia_usd, 0.02);

  // ajuste: reaproveita as fotos (não baixa de novo) e manda o plano anterior para a IA
  const comRoteiro = { ...job, status: 'ajuste_pedido', roteiro: fim.roteiro, custo_ia_usd: 0.02 };
  assert.equal(await processar(comRoteiro), 'previa_pronta');
  assert.equal(eventos.filter((e) => e.status === 'baixando').length, 1);
  assert.match(pedidos[1].texto, /PLANO ANTERIOR[\s\S]*troca o título da capa/);
  const r2 = eventos.at(-1).campos.roteiro;
  assert.equal(r2.laminas[0].titulo, 'Título *novo*');

  assert.equal(await processar({ ...job, status: 'aprovado', roteiro: r2 }), 'entregue');
  assert.equal(drivePasta.nome, 'GNX Group - 31 - Carrossel - Titulo novo');
  assert.deepEqual(drivePasta.arquivos.map((a) => a.nome), ['01.jpg', '02.jpg', '03.jpg', '04.jpg', 'legenda.txt']);
  assert.equal(eventos.at(-1).campos.final_drive_id, 'sub1');
  assert.ok(!fs.existsSync(path.join(tmp, 'work', 'j9')));
});

test('paleta do kit: destaque e texto sempre legíveis (cor da marca clara vira destaque em fundo escuro)', async () => {
  const { paletaDoKit, contraste } = await import('../lib/carrossel.js');
  for (const cores of [{ principal: '#f0c41d', secundaria: '#161614', fundo: '#fff' }, { principal: '#1d4ed8', secundaria: '#0f172a' }, { principal: '#C2410C', destaque: '#E4572E' }, { principal: '#fff' }, { principal: '#abc' }]) {
    const c = paletaDoKit(cores);
    assert.ok(contraste(c.destaque, c.roxo) >= 2.5, `destaque sobre o fundo: ${JSON.stringify(cores)}`);
    assert.ok(contraste('#FFFFFF', c.escuro) >= 7, `texto branco sobre o escuro: ${JSON.stringify(cores)}`);
    assert.ok(contraste(c.destaqueClaro, c.claro) >= 3, `destaque na lâmina clara: ${JSON.stringify(cores)}`);
    assert.match(c.roxo, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(paletaDoKit({ principal: '#f0c41d', secundaria: '#161614' }).destaque, '#f0c41d');
});
