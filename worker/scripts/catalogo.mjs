// Catálogo da camada de design de uma marca: as 9 cenas e 4 transições com a identidade dela, sem precisar de vídeo.
// Serve para mostrar ao cliente o padrão antes do 1º reel e para conferir uma marca nova.
// Uso: docker compose exec -T worker node scripts/catalogo.mjs gnx [/work/catalogo-gnx.jpg] [estilo]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { designDoKit, montarHtml, fotografar, MARCAS_DIR } from '../lib/design.js';
import { config } from '../lib/config.js';
import { rodar } from '../lib/midia.js';

const [pasta = 'gnx', saida = `/work/catalogo-${process.argv[2] || 'gnx'}.jpg`, estilo = 'institucional'] = process.argv.slice(2);
const design = JSON.parse(fs.readFileSync(path.join(MARCAS_DIR, pasta, 'design.json'), 'utf8'));
const cfg = designDoKit({ acabamento: { design: { ...design, ativo: true }, ficha: { estilo } } });
if (!cfg) { console.log(`estilo "${estilo}" não tem camada de design`); process.exit(1); }
const logo = cfg.logo ? path.join(MARCAS_DIR, cfg.logo) : null;

// fala de exemplo (tempos inventados, 0,38 s por palavra)
const texto = `Oi, eu sou a Ana, coordenadora de operações da ${cfg.marca || 'marca'}. Sabe o que faz a diferença aqui? A gente cuida de tudo: recrutamento, treinamento, folha e gestão. São 27 anos conectando pessoas e resultados. Quem entra aqui cresce de verdade, e isso eu vivi na pele. Vem conhecer a gente.`;
let t = 0.3;
const palavras = texto.split(' ').map((p) => { const w = { p, i: +t.toFixed(2), f: +(t + 0.3).toFixed(2) }; t += 0.38 + (/[.,?:]$/.test(p) ? 0.25 : 0); return w; });
const duracao = +(t + 0.3).toFixed(2);
const ix = (s, depois = -1) => palavras.findIndex((w, k) => k > depois && w.p.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').startsWith(s));
const tm = (k) => palavras[k].i;
const kDif = ix('sabe'), kTudo = ix('tudo'), k27 = ix('27'), kQuem = ix('quem'), kPele = ix('pele'), kAna = ix('ana');
const itens = ['recrutamento', 'treinamento', 'folha', 'gestão'].map((s) => ix(s, kTudo));
const broll = [{ inicio: +(tm(k27) + 1.25).toFixed(2), fim: +(tm(k27) + 3.4).toFixed(2) }];
const plano = {
  gancho: { linha1: 'Por trás de uma grande', linha2: 'operação', destaque: 'operação' },
  destaques: [ix('diferença'), ix('pessoas'), ix('resultados'), ix('cresce')].filter((k) => k >= 0),
  capitulos: [{ t: +(tm(kDif) - 0.05).toFixed(2), rotulo: 'DIFERENCIAL', titulo: 'A gente cuida de tudo' }],
  impactos: [{ t: +(tm(k27) - 0.05).toFixed(2), texto: '27 anos' }],
  lista: itens.map((k, j) => ({ t: +(tm(k) - 0.1).toFixed(2), texto: ['Recrutamento', 'Treinamento', 'Folha de pagamento', 'Gestão da equipe'][j] })),
  listaFim: +Math.min(palavras[itens[3]].f + 1.4, tm(k27) - 0.4).toFixed(2),
  apresentacao: { t: 3.4, nome: 'Ana Souza', cargo: 'Coordenadora de operações' },
  citacao: { t: +(tm(kQuem) - 0.15).toFixed(2), fim: +(palavras[kPele].f + 1.2).toFixed(2), palavras: palavras.slice(kQuem, kPele + 1).map((w) => [w.p.replace(/[.,;:!?]+$/, ''), w.i]) },
  encerramento: { frase: 'Faça parte dessa história' },
  rosto: { topo: 30, base: 50 }, ganchoFim: 3.0,
};
const { html, total } = montarHtml({ plano, palavras, duracao, cfg, logo, broll });

const todas = [
  [0.25, '1 · Abertura P&B + gancho', 'gancho'], [1.1, 'Transição: flash P&B → cor', 'pb'],
  [tm(ix('coordenadora')) + 0.2, '2 · Legenda + destaque', 'legenda'], [3.9, '3 · Tarja de nome e cargo', 'tarja'],
  [tm(kDif) + 0.15, 'Transição: diagonal', 'capitulos'], [tm(kDif) + 0.8, '4 · Capítulo', 'capitulos'],
  [plano.lista[2].t + 0.4, '5 · Lista animada', 'lista'], [tm(k27) + 0.75, '6 · Impacto (número conta)', 'impactos'],
  [broll[0].inicio + 0.9, '7 · B-roll em cartão', 'cartoes'], [tm(kPele) - 0.4, '8 · Citação em destaque', 'citacao'],
  [duracao + 0.2, 'Transição: círculo', 'encerramento'], [duracao + 1.6, '9 · Encerramento', 'encerramento'],
];
// só o que o estilo liga (a legenda sempre)
const cenas = todas.filter(([, , k]) => k === 'legenda' || cfg.el[k] !== false);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-'));
const fotos = await fotografar(html, cenas.map((c) => Math.min(c[0], total - 0.05)), dir);
const fonte = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const quadros = [];
for (const [k, foto] of fotos.entries()) {
  const q = path.join(dir, `c${String(k).padStart(2, '0')}.jpg`);
  const naBroll = broll[0] && cenas[k][0] >= broll[0].inicio && cenas[k][0] < broll[0].fim;
  // fundo neutro no lugar do vídeo (o B-roll ganha um tom diferente para aparecer: cartão ou tela cheia)
  const caixa = cfg.el.cartoes === false ? 'x=0:y=0:w=1080:h=1920' : 'x=70:y=250:w=940:h=1100';
  const fundo = `color=c=0x5b6170:s=1080x1920,format=yuv420p,geq=lum='90+40*Y/1920':cb=128:cr=128${naBroll ? `,drawbox=${caixa}:color=0x8a7f6a@1:t=fill` : ''}`;
  await rodar(config.ffmpeg, ['-y', '-f', 'lavfi', '-i', fundo, '-i', foto, '-filter_complex',
    `[0:v][1:v]overlay=0:0:format=auto,scale=360:640,drawtext=fontfile=${fonte}:text='${cenas[k][1].replace(/'/g, '').replace(/:/g, '\\:')}':x=10:y=h-34:fontsize=17:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`,
    '-frames:v', '1', '-q:v', '3', q]);
  quadros.push(q);
}
// grade 6 x 2 (hstack/vstack: o filtro tile do ffmpeg deixava a grade vazia com imagens soltas); vaga sobrando fica escura
while (quadros.length < 12) { const v = path.join(dir, `v${quadros.length}.jpg`); await rodar(config.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x111111:s=360x640', '-frames:v', '1', v]); quadros.push(v); }
const ent = quadros.slice(0, 12).flatMap((q) => ['-i', q]);
const linha = (de) => `${[0, 1, 2, 3, 4, 5].map((j) => `[${de + j}:v]pad=376:656:8:8:color=0x111111[p${de + j}]`).join(';')};${[0, 1, 2, 3, 4, 5].map((j) => `[p${de + j}]`).join('')}hstack=inputs=6[l${de}]`;
await rodar(config.ffmpeg, ['-y', ...ent, '-filter_complex', `${linha(0)};${linha(6)};[l0][l6]vstack=inputs=2`, '-frames:v', '1', '-q:v', '3', saida]);
if (!process.env.MANTER) fs.rmSync(dir, { recursive: true, force: true });
console.log(`${saida} (${cenas.length} quadros, estilo ${estilo})`);
