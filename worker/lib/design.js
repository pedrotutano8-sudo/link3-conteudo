// Camada de design da marca (motion), no padrão do kit Edição Sem Editor: HTML animado renderizado quadro a quadro
// no Chromium, com fundo transparente, e composto por cima do vídeo no ffmpeg.
// Elementos: gancho (abertura em P&B + título), legenda palavra a palavra com palavra-chave na cor de destaque,
// cartão de capítulo em tela cheia com o gradiente da marca, palavra de impacto, lista, moldura dos cartões de
// B-roll e encerramento com logo e chamada. Tudo depende só do tempo (sem relógio), então cada quadro é reproduzível.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { fichaDoKit, contextoFicha, ELEMENTOS } from './estilos.js';

const FONTES = fileURLToPath(new URL('../node_modules/@fontsource/montserrat/files/', import.meta.url));
export const MARCAS_DIR = process.env.MARCAS_DIR || '/marcas';

// geometria do cartão de B-roll (o ffmpeg põe o vídeo, a camada desenha borda e sombra no mesmo lugar)
export const CARTAO = { x: 70, y: 250, w: 940, h: 1100, raio: 44, sobe: 70, entra: 0.4, sai: 0.22 };
export const CAUDA = 2.4;      // segundos de encerramento depois da última fala
export const PB = 1.0;         // abertura em preto e branco até aqui

// identidade da marca (design.json) + ficha de edição. Sem identidade ou com estilo "Simples": sem camada de design.
export function designDoKit(kit) {
  const d = kit?.acabamento?.design;
  const ficha = fichaDoKit(kit);
  if (!d?.ativo || !ficha.design) return null;
  return { fonte: 'Montserrat', cta: 'Saiba mais', arroba: '', assinatura: '', ...d, ficha, el: ficha.elementos, cores: { escuro: '#16207F', roxo: '#5F27E0', azul: '#0A33B0', verde: '#0E7A6A', destaque: '#F5C542', texto: '#FFFFFF', ...(d.cores || {}) } };
}

const PROMPT = `Você é diretor de arte de reels de empresas. O vídeo é uma pessoa falando para a câmera; por cima dela vai uma camada de design com a identidade da marca. Escolha o que entra e onde, como um editor premium faria — com critério, sem poluir.
Elementos:
- gancho: título da abertura (primeiros 3 s), em duas linhas: linha1 curta de contexto (até 5 palavras) e linha2 forte (até 4 palavras). "destaque" é UMA palavra da linha2 que vai na cor de destaque. Baseie-se no título sugerido e na fala; português correto, sem emoji.
- destaques: índices das palavras-chave da legenda (substantivo, número, benefício, nome da marca). No máximo uma a cada 3 ou 4 palavras faladas; nunca artigo, preposição ou palavra de ligação.
- capitulos: 0 a 2 cartões de tela cheia quando a fala MUDA de assunto (ex.: começa a explicar um serviço, um diferencial, um resultado). "palavra" é o índice da palavra em que o cartão entra (ele fica 1,4 s). "rotulo" 1 ou 2 palavras em caixa alta (ex.: DIFERENCIAL), "titulo" até 5 palavras. Só entre 5 s e o fim menos 4 s.
- impactos: 0 a 2 palavras isoladas muito fortes (número, resultado, adjetivo central) mostradas grandes; "palavra" é o índice, "texto" a palavra (pode ser o número escrito com algarismos).
- lista: só se a pessoa enumerar 3 ou 4 itens (serviços, etapas, benefícios); cada item com "palavra" (índice em que o item é dito) e "texto" (até 4 palavras). Senão, lista vazia.
- apresentacao: se a pessoa disser o próprio nome e/ou cargo, uma tarja com "nome" (como ela se apresenta) e "cargo" (curto, até 4 palavras; se não disser o cargo, deixe vazio), e "palavra" = índice em que ela diz o nome. Senão, null.
- citacao: 0 ou 1 frase marcante dita pela pessoa (de 5 a 14 palavras seguidas: opinião forte, resultado, depoimento), que merece ficar em destaque na tela enquanto é dita. "de" e "ate" são os índices da primeira e da última palavra. Se não houver frase assim, null.
- encerramento: "frase" de até 7 palavras para o cartão final (pode ser a ideia central do vídeo ou um convite).
- rosto: nas imagens (quadros do vídeo), onde fica a cabeça da pessoa, em porcentagem da altura do quadro: "topo" (topo do cabelo) e "base" (queixo). Se houver mais de um quadro, use a faixa que cobre todos.
Responda só com JSON: {"gancho": {"linha1": "", "linha2": "", "destaque": ""}, "destaques": [], "capitulos": [{"palavra": 0, "rotulo": "", "titulo": ""}], "impactos": [{"palavra": 0, "texto": ""}], "lista": [{"palavra": 0, "texto": ""}], "apresentacao": {"palavra": 0, "nome": "", "cargo": ""}, "citacao": {"de": 0, "ate": 0}, "encerramento": {"frase": ""}, "rosto": {"topo": 0, "base": 0}}`;

// tempos que dependem do estilo: abertura em P&B e cauda de encerramento
export function temposDesign(cfg) {
  const el = cfg?.el || {};
  return { pb: el.pb === false ? 0 : PB, cauda: el.encerramento === false ? 0 : CAUDA };
}

const PEDIDO_ATRAS = `\n\nPALAVRAS ATRÁS DA PESSOA (pedido para este vídeo): escolha 2 ou 3 palavras-chave fortes da fala (substantivo, número, resultado, nome da marca) que vão passar gigantes por TRÁS da pessoa enquanto ela fala. Espaçadas (pelo menos 4 s entre elas), fora dos 3 primeiros segundos e longe do B-roll. "palavra" é o índice; "texto" é a palavra (ou duas palavras curtas) como deve aparecer. Acrescente no JSON: "atras": [{"palavra": 0, "texto": ""}]`;

export async function planejarDesign({ palavras, duracao, titulo = '', broll = [], marca = '', quadros = [], ficha = null, opcoes = {} }, { claudeJson }) {
  const desligados = ficha ? Object.entries(ficha.elementos).filter(([, v]) => !v).map(([k]) => k) : [];
  const avisoDesl = desligados.length ? `\nELEMENTOS DESLIGADOS PARA ESTA MARCA (devolva vazio/null para eles): ${desligados.map((k) => ({ gancho: 'gancho', capitulos: 'capitulos', impactos: 'impactos', lista: 'lista', tarja: 'apresentacao', citacao: 'citacao', encerramento: 'encerramento' })[k]).filter(Boolean).join(', ') || 'nenhum'}` : '';
  const texto = `${ficha ? contextoFicha(ficha) + '\n' : ''}${avisoDesl}\nMARCA: ${marca}\nTÍTULO SUGERIDO: ${titulo}\nDURAÇÃO: ${duracao.toFixed(1)} s\nB-ROLL JÁ PLANEJADO (não ponha capítulo nem impacto nesses intervalos): ${broll.map((b) => `${b.inicio.toFixed(1)}-${b.fim.toFixed(1)} s`).join(', ') || 'nenhum'}\n\nFALA (índice:palavra@segundo):\n${palavras.map((w, k) => `${k}:${w.p}@${w.i.toFixed(1)}`).join(' ')}`;
  const r = await claudeJson({ system: PROMPT, texto: texto + (opcoes.atras === 'auto' ? PEDIDO_ATRAS : ''), imagens: quadros, max: 4000 });
  return { plano: limparPlano(r.saida || {}, { palavras, duracao, broll, el: ficha?.elementos, atras: opcoes.atras || null }), usd: r.usd || 0, tokens: r.tokens || { entrada: 0, saida: 0 } };
}

// confere o que a IA devolveu: índices válidos, sem sobreposição com B-roll, abertura ou fim
export const ATRAS_DUR = 2.3;   // quanto tempo cada palavra passa atrás da pessoa
const normal = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// onde a palavra (ou expressão) pedida é dita: índices das ocorrências, na ordem
export function acharFala(palavras, alvo) {
  const toks = String(alvo || '').split(/\s+/).map(normal).filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (let k = 0; k + toks.length <= palavras.length; k++) {
    if (toks.every((t, j) => { const w = normal(palavras[k + j].p); return w === t || (t.length >= 4 && w.startsWith(t.slice(0, -1)) && Math.abs(w.length - t.length) <= 2); })) out.push(k);
  }
  return out;
}

export function limparPlano(p, { palavras, duracao, broll = [], el = {}, atras = null }) {
  const liga = (k) => el[k] !== false;
  const n = palavras.length;
  const ok = (k) => Number.isInteger(k) && k >= 0 && k < n;
  const ocupado = broll.map((b) => [b.inicio - 0.6, b.fim + 0.6]);
  const livre = (a, b) => !ocupado.some(([x, y]) => a < y && b > x);
  const reservar = (a, b) => ocupado.push([a - 0.8, b + 0.8]);
  const corta = (s, max) => String(s || '').trim().split(/\s+/).slice(0, max).join(' ');
  const g = p.gancho || {};
  const plano = {
    gancho: liga('gancho') ? { linha1: corta(g.linha1, 6), linha2: corta(g.linha2, 5), destaque: String(g.destaque || '').trim() } : { linha1: '', linha2: '', destaque: '' },
    destaques: [...new Set((p.destaques || []).filter(ok))],
    capitulos: [], impactos: [], lista: [],
    encerramento: { frase: corta(p.encerramento?.frase, 8) },
  };
  // rosto (porcentagem da altura) e duração do gancho: termina antes do primeiro B-roll
  const r = p.rosto || {};
  const topo = Number(r.topo), base = Number(r.base);
  plano.rosto = Number.isFinite(topo) && Number.isFinite(base) && base > topo ? { topo: Math.max(0, Math.min(100, topo)), base: Math.max(0, Math.min(100, base)) } : null;
  const b0 = broll.length ? Math.min(...broll.map((b) => b.inicio)) : Infinity;
  plano.ganchoFim = +Math.max(1.6, Math.min(3.2, b0 - 0.15, duracao - 1)).toFixed(2);
  // palavras atrás da pessoa (pedido do reel ou da marca): vêm antes dos outros elementos, porque foram pedidas
  if (atras) {
    plano.atras = []; plano.atrasFaltou = [];
    const cabe = (t) => t >= plano.ganchoFim + 0.2 && t + ATRAS_DUR <= duracao - 1 && livre(t, t + ATRAS_DUR);
    const limpa = (x) => String(x || '').replace(/[.,;:!?…"]+/g, '').trim();
    // automático: o que a IA escolheu (no índice dela ou em outra vez que a palavra é dita); se sobrar espaço,
    // completa com as palavras-chave da legenda (destaques) que cabem
    const pedidos = Array.isArray(atras)
      ? atras.map((txt) => ({ txt, ks: acharFala(palavras, txt) }))
      : [...(p.atras || []).filter((x) => ok(x.palavra)).map((x) => { const txt = limpa(x.texto) || limpa(palavras[x.palavra].p); return { txt, ks: [x.palavra, ...acharFala(palavras, txt)] }; }),
        ...(p.destaques || []).filter(ok).map((k) => ({ txt: limpa(palavras[k].p), ks: [k, ...acharFala(palavras, palavras[k].p)], reserva: true })).filter((x) => x.txt.length >= 4)];
    const usados = new Set();
    for (const { txt, ks, reserva } of pedidos) {
      if (plano.atras.length >= 3) break;
      if (reserva && plano.atras.length >= 2) break;
      if (usados.has(normal(txt))) continue;
      const k = ks.find((k) => cabe(palavras[k].i - 0.15) && plano.atras.every((a) => Math.abs(a.t - (palavras[k].i - 0.15)) >= 3));
      if (k == null) { if (!reserva) plano.atrasFaltou.push(txt); continue; }
      usados.add(normal(txt));
      const t = palavras[k].i - 0.15;
      plano.atras.push({ t: +t.toFixed(2), fim: +(t + ATRAS_DUR).toFixed(2), texto: corta(limpa(txt), 3).toUpperCase() });
      reservar(t, t + ATRAS_DUR);
    }
    plano.atras.sort((a, b) => a.t - b.t);
  }
  const ap = p.apresentacao;
  if (liga('tarja') && ap && ok(ap.palavra) && String(ap.nome || '').trim()) {
    const t = Math.max(palavras[ap.palavra].i - 0.1, plano.ganchoFim + 0.15);
    if (t + 2.6 < duracao - 1.5 && livre(t, t + 2.6)) { plano.apresentacao = { t: +t.toFixed(2), nome: corta(ap.nome, 4), cargo: corta(ap.cargo, 5) }; reservar(t, t + 2.6); }
  }
  for (const c of (liga('capitulos') ? p.capitulos || [] : []).filter((c) => ok(c.palavra)).slice(0, 2)) {
    const t = palavras[c.palavra].i - 0.05;
    if (t < 5 || t + 1.4 > duracao - 3.5 || !livre(t, t + 1.4)) continue;
    plano.capitulos.push({ t: +t.toFixed(2), rotulo: corta(c.rotulo, 2).toUpperCase(), titulo: corta(c.titulo, 6) });
    reservar(t, t + 1.4);
  }
  const lista = (liga('lista') ? p.lista || [] : []).filter((x) => ok(x.palavra)).sort((a, b) => a.palavra - b.palavra).slice(0, 4);
  if (lista.length >= 3) {
    const a = palavras[lista[0].palavra].i - 0.1, b = Math.min(duracao - 2.5, palavras[lista[lista.length - 1].palavra].f + 1.6);
    if (a > 3 && b > a && livre(a, b)) { plano.lista = lista.map((x) => ({ t: +(palavras[x.palavra].i - 0.1).toFixed(2), texto: corta(x.texto, 5) })); plano.listaFim = +b.toFixed(2); reservar(a, b); }
  }
  // citação: a fala literal fica em destaque enquanto é dita (cada palavra acende no seu tempo)
  const ci = p.citacao;
  if (liga('citacao') && ci && ok(ci.de) && ok(ci.ate) && ci.ate >= ci.de && ci.ate - ci.de <= 15 && ci.ate - ci.de >= 3) {
    const t = palavras[ci.de].i - 0.15, fim = palavras[ci.ate].f + 1.2;
    if (t > 3.5 && fim < duracao - 1.5 && livre(t, fim)) {
      plano.citacao = { t: +t.toFixed(2), fim: +fim.toFixed(2), palavras: palavras.slice(ci.de, ci.ate + 1).map((w) => [w.p.replace(/[.,;:!?…]+$/, ''), +w.i.toFixed(2)]) };
      reservar(t, fim);
    }
  }
  for (const m of (liga('impactos') ? p.impactos || [] : []).filter((x) => ok(x.palavra)).slice(0, 2)) {
    const t = palavras[m.palavra].i - 0.05;
    if (t < 3.2 || t + 1.1 > duracao - 2 || !livre(t, t + 1.1)) continue;
    plano.impactos.push({ t: +t.toFixed(2), texto: corta(m.texto, 2) });
    reservar(t, t + 1.1);
  }
  return plano;
}

// legenda: grupos de 1 a 3 palavras (até 18 letras), quebra em pausa ou pontuação
export function gruposLegenda(palavras) {
  const grupos = []; let g = [];
  palavras.forEach((w, k) => {
    const texto = g.map((x) => x.p).concat(w.p).join(' ');
    const ant = g[g.length - 1];
    if (g.length && (g.length >= 3 || texto.length > 18 || w.i - ant.f > 0.35 || /[.!?,;:]$/.test(ant.p))) { grupos.push(g); g = []; }
    g.push({ ...w, k });
  });
  if (g.length) grupos.push(g);
  return grupos;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dataUrl = (arq) => {
  if (!arq || !fs.existsSync(arq)) return '';
  const ext = path.extname(arq).slice(1).toLowerCase();
  return `data:image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(arq).toString('base64')}`;
};

/**
 * Monta a página da camada. Tempos no vídeo já cortado.
 * @param {object} o.plano  saída de planejarDesign
 * @param {Array<{p,i,f}>} o.palavras
 * @param {number} o.duracao  duração da fala (a camada dura duracao + CAUDA)
 * @param {object} o.cfg  designDoKit(kit)
 * @param {string} [o.logo]  arquivo da logo (de preferência a versão branca)
 * @param {Array<{inicio,fim}>} [o.broll]  cartões de B-roll
 */
export function montarHtml({ plano, palavras, duracao, cfg, logo = null, broll = [], ritmo = false, cortes = [], cartao = CARTAO }) {
  const c = cfg.cores;
  const el = cfg.el || {};
  const liga = (k) => el[k] !== false;
  const { pb, cauda } = temposDesign(cfg);
  const total = duracao + cauda;
  // plano feito antes de um elemento ser desligado na ficha: o que está desligado não aparece
  plano = { ...plano, capitulos: liga('capitulos') ? plano.capitulos : [], impactos: liga('impactos') ? plano.impactos : [], lista: liga('lista') ? plano.lista : [], apresentacao: liga('tarja') ? plano.apresentacao : null, citacao: liga('citacao') ? plano.citacao : null,
    gancho: liga('gancho') ? plano.gancho : { linha1: '', linha2: '', destaque: '' } };
  const temGancho = Boolean(plano.gancho?.linha1 || plano.gancho?.linha2);
  const cartoes = liga('cartoes') ? broll : [];
  const elemento = dataUrl(cfg.elemento ? path.join(MARCAS_DIR, cfg.elemento) : '');
  const logoUrl = dataUrl(logo);
  const destaques = new Set(plano.destaques || []);
  const grupos = gruposLegenda(palavras);
  // janelas sem legenda: capítulos, lista (a lista ocupa o lugar dela) e encerramento
  const semLegenda = [...(plano.capitulos || []).map((x) => [x.t, x.t + 1.4]), ...(plano.lista?.length ? [[plano.lista[0].t, plano.listaFim]] : []), ...(plano.citacao ? [[plano.citacao.t, plano.citacao.fim]] : []), ...(cauda > 0 ? [[duracao, total]] : [])];
  const fonte = (peso, estilo = 'normal') => `@font-face{font-family:'M';font-weight:${peso};font-style:${estilo};src:url('file://${FONTES}montserrat-latin-${peso}-${estilo}.woff2') format('woff2')}`;
  const g = plano.gancho || {};
  const b0 = broll.length ? Math.min(...broll.map((b) => b.inicio)) : Infinity;
  const ganchoFim = temGancho ? Math.max(1.6, Math.min(3.2, b0 - 0.15, duracao - 1)) : 0;
  // gancho no alto quando a cabeça começa abaixo de 28% da altura; senão vai para baixo do queixo e a legenda espera ele sair
  const rosto = plano.rosto;
  const ganchoEmBaixo = Boolean(rosto && rosto.topo < 28);
  const gTopo = ganchoEmBaixo ? Math.round(Math.min(1000, Math.max(700, rosto.base * 19.2 + 50))) : 250;
  if (temGancho && ganchoEmBaixo) semLegenda.push([0, ganchoFim + 0.1]);
  // ritmo dinâmico: lampejo nos cortes (fora do gancho, de cartões de tela cheia, B-roll e encerramento), no máximo um a cada 2,2 s
  const ocupadoFlash = [[0, ganchoFim + 0.2], ...semLegenda, ...broll.map((b) => [b.inicio - 0.2, b.fim + 0.2])];
  const flashes = [];
  if (ritmo) for (const c of cortes) if (c < duracao - 0.5 && !ocupadoFlash.some(([a, b]) => c >= a && c < b) && (!flashes.length || c - flashes[flashes.length - 1] >= 2.2)) flashes.push(c);
  const linha2 = esc(g.linha2 || '').split(' ').map((w, k) => `<span class="gw" id="gw${k}"${g.destaque && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === g.destaque.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ? ' data-d="1"' : ''}>${w}</span>`).join(' ');
  const fundo = `background:
      radial-gradient(55% 32% at 0% 0%, ${c.verde}cc 0%, transparent 70%),
      radial-gradient(60% 30% at 100% 100%, ${c.verde}bb 0%, transparent 70%),
      radial-gradient(70% 45% at 30% 60%, ${c.roxo} 0%, transparent 75%),
      linear-gradient(150deg, ${c.escuro} 0%, ${c.roxo} 48%, ${c.azul} 82%, ${c.escuro} 100%);`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fonte(500)}${fonte(800)}${fonte(900)}${fonte(800, 'italic')}${fonte(900, 'italic')}
html,body{margin:0;padding:0;background:transparent;width:1080px;height:1920px;overflow:hidden}
*{box-sizing:border-box}
#r{position:absolute;inset:0;width:1080px;height:1920px;font-family:'M',sans-serif;color:${c.texto};-webkit-font-smoothing:antialiased}
.x{position:absolute;opacity:0;will-change:transform,opacity}
.grao{position:absolute;inset:0;background-image:var(--grao);opacity:.10;mix-blend-mode:overlay}
.tela{position:absolute;left:0;top:0;width:1080px;height:1920px;${fundo}}
.elem{position:absolute;background:url('${elemento}') center/contain no-repeat}
/* gancho */
#gsombra{left:0;top:${ganchoEmBaixo ? gTopo - 220 : 0}px;width:1080px;height:${ganchoEmBaixo ? 760 : 760}px;background:${ganchoEmBaixo ? 'linear-gradient(to bottom, rgba(10,12,48,0) 0%, rgba(10,12,48,.72) 32%, rgba(10,12,48,.72) 68%, rgba(10,12,48,0) 100%)' : 'linear-gradient(to bottom, rgba(10,12,48,.78) 0%, rgba(10,12,48,.45) 55%, rgba(10,12,48,0) 100%)'}}
#g1{left:80px;top:${gTopo}px;width:920px;font-weight:500;font-size:54px;line-height:1.15;letter-spacing:.01em;color:rgba(255,255,255,.92);text-shadow:0 4px 18px rgba(0,0,0,.45)}
#g2{left:80px;top:${gTopo + 76}px;width:920px;font-weight:900;font-size:124px;line-height:.98;letter-spacing:-.025em;text-shadow:0 8px 30px rgba(0,0,0,.45)}
#g2 .gw{display:inline-block;opacity:0}
#g2 .gw[data-d]{color:${c.destaque};font-style:italic}
#gbarra{left:80px;top:${gTopo - 30}px;width:120px;height:8px;border-radius:4px;background:${c.destaque}}
#flash{left:0;top:0;width:1080px;height:1920px;background:#fff}
/* legenda */
.leg{left:50px;width:980px;top:1120px;text-align:center;font-weight:800;font-size:86px;line-height:1.08;letter-spacing:-.015em}
.leg span{display:inline-block;margin:0 10px;opacity:0;text-shadow:0 3px 3px rgba(0,0,0,.35),0 6px 26px rgba(0,0,0,.55)}
.leg span.d{color:${c.destaque};font-weight:900;font-style:italic}
/* capítulo */
.cap{left:0;top:0;width:1080px;height:1920px}
.cap .elem{right:-150px;bottom:180px;width:760px;height:780px;opacity:.95;transform:rotate(-6deg)}
.cap .rot{position:absolute;left:90px;top:660px;display:flex;align-items:center;gap:16px;font-weight:800;font-size:32px;letter-spacing:.22em;color:${c.destaque}}
.cap .rot i{display:block;width:14px;height:14px;border-radius:50%;background:${c.destaque};box-shadow:0 0 14px ${c.destaque}}
.cap .tit{position:absolute;left:90px;top:730px;width:860px;font-weight:900;font-size:128px;line-height:1.0;letter-spacing:-.03em}
.cap .marca{position:absolute;left:90px;bottom:200px;width:190px;height:86px;background:url('${logoUrl}') left center/contain no-repeat;opacity:.95}
/* tarja de apresentação */
#tarja{left:70px;top:900px;display:flex;align-items:stretch;border-radius:22px;overflow:hidden;box-shadow:0 18px 44px rgba(0,0,0,.45)}
#tarja .barra{width:12px;background:${c.destaque}}
#tarja .txt{padding:20px 34px 22px 26px;background:${c.escuro}e6}
#tarja b{display:block;font-weight:900;font-size:52px;line-height:1.05;letter-spacing:-.02em}
#tarja span{display:block;margin-top:6px;font-weight:500;font-size:32px;color:rgba(255,255,255,.88)}
/* citação */
#cit{left:70px;width:940px;top:1030px;padding:58px 52px 44px;border-radius:32px;background:${c.escuro}e6;border:2px solid rgba(255,255,255,.14);box-shadow:0 24px 60px rgba(0,0,0,.5)}
#cit .aspas{position:absolute;left:34px;top:-70px;font-weight:900;font-size:190px;line-height:1;color:${c.destaque};text-shadow:0 10px 30px rgba(0,0,0,.4)}
#cit .txt{font-weight:800;font-size:56px;line-height:1.12;letter-spacing:-.015em}
#cit .txt span{opacity:.32}
/* impacto */
.imp{left:50px;width:980px;top:200px;text-align:center;font-weight:900;font-style:italic;font-size:170px;line-height:1;letter-spacing:-.03em;color:${c.destaque};text-shadow:0 12px 50px rgba(0,0,0,.55)}
/* lista */
.lista{left:70px;width:940px;top:1110px}
.item{position:absolute;left:0;width:940px;height:104px;display:flex;align-items:center;gap:24px;padding:0 30px;border-radius:26px;background:${c.escuro}e0;border:2px solid rgba(255,255,255,.16);box-shadow:0 18px 44px rgba(0,0,0,.45);font-weight:800;font-size:46px;opacity:0}
.item em{font-style:normal;flex:none;display:grid;place-items:center;width:62px;height:62px;border-radius:50%;background:${c.destaque};color:${c.escuro};font-weight:900;font-size:34px}
/* moldura do B-roll */
.moldura{left:${cartao.x}px;top:${cartao.y}px;width:${cartao.w}px;height:${cartao.h}px;border-radius:${cartao.raio}px;border:5px solid rgba(255,255,255,.92);box-shadow:0 40px 90px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.2)}
/* encerramento */
#fim .elem{right:-140px;top:110px;width:640px;height:660px;transform:rotate(8deg)}
#fim .col{position:absolute;left:90px;top:720px;width:900px;display:flex;flex-direction:column;align-items:flex-start}
#fim .logo{width:380px;height:170px;background:url('${logoUrl}') left center/contain no-repeat}
#fim .frase{margin-top:44px;font-weight:900;font-size:80px;line-height:1.03;letter-spacing:-.025em}
#fim .sub{margin-top:26px;font-weight:500;font-size:38px;line-height:1.3;color:rgba(255,255,255,.86)}
#fim .cta{margin-top:56px;display:flex;align-items:center;gap:18px;padding:26px 50px;border-radius:999px;background:${c.destaque};color:${c.escuro};font-weight:900;font-size:46px;box-shadow:0 18px 40px rgba(0,0,0,.35)}
#fim .arroba{margin-top:30px;margin-left:6px;font-weight:800;font-size:36px;letter-spacing:.02em;color:rgba(255,255,255,.9)}
</style></head><body><div id="r">
<div class="x" id="gsombra"></div>
<div class="x" id="gbarra"></div>
<div class="x" id="g1">${esc(g.linha1)}</div>
<div class="x fit" id="g2">${linha2}</div>
${cartoes.map((b, k) => `<div class="x moldura" id="m${k}"></div>`).join('\n')}
${grupos.map((gr, k) => `<div class="x leg" id="l${k}">${gr.map((w) => `<span id="w${w.k}"${destaques.has(w.k) ? ' class="d"' : ''}>${esc(w.p.replace(/[.,;:!?…]+$/, ''))}</span>`).join('')}</div>`).join('\n')}
${plano.apresentacao ? `<div class="x" id="tarja"><div class="barra"></div><div class="txt"><b>${esc(plano.apresentacao.nome)}</b>${plano.apresentacao.cargo ? `<span>${esc(plano.apresentacao.cargo)}</span>` : ''}</div></div>` : ''}
${(plano.impactos || []).map((m, k) => { const n = String(m.texto).match(/^(\D*?)(\d[\d.]*)(.*)$/); return `<div class="x imp fit" id="i${k}"${n ? ` data-pre="${esc(n[1])}" data-num="${n[2].replace(/\./g, '')}" data-pos="${esc(n[3])}"` : ''}>${esc(m.texto)}</div>`; }).join('\n')}
${plano.citacao ? `<div class="x" id="cit"><div class="aspas">“</div><div class="txt">${plano.citacao.palavras.map(([w], k) => `<span id="cw${k}">${esc(w)}</span>`).join(' ')}</div></div>` : ''}
${plano.lista?.length ? `<div class="x lista" id="lista" style="opacity:1">${plano.lista.map((it, k) => `<div class="item" id="it${k}" style="top:${k * 122}px"><em>${k + 1}</em>${esc(it.texto)}</div>`).join('')}</div>` : ''}
${(plano.capitulos || []).map((x, k) => `<div class="x cap" id="c${k}"><div class="tela"><div class="grao"></div><div class="elem"></div><div class="rot"><i></i>${esc(x.rotulo)}</div><div class="tit fit">${esc(x.titulo)}</div><div class="marca"></div></div></div>`).join('\n')}
${cauda > 0 ? '' : '<!-- sem encerramento -->'}<div class="x" id="fim" style="${cauda > 0 ? '' : 'display:none;'}"left:0;top:0;width:1080px;height:1920px"><div class="tela"><div class="grao"></div><div class="elem"></div><div class="col"><div class="logo"></div><div class="frase fit" style="width:900px">${esc(plano.encerramento?.frase || '')}</div>${cfg.assinatura ? `<div class="sub">${esc(cfg.assinatura)}</div>` : ''}<div class="cta">${esc(cfg.cta)} <span>→</span></div>${cfg.arroba ? `<div class="arroba">${esc(cfg.arroba)}</div>` : ''}</div></div></div>
<div class="x" id="flash"></div>
</div>
<script>
(function(){
  // grão com semente (igual em todo quadro)
  const cv=document.createElement('canvas');cv.width=cv.height=256;const cx=cv.getContext('2d');const im=cx.createImageData(256,256);
  let s=7;const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff};
  for(let i=0;i<im.data.length;i+=4){const v=(r()*255)|0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}
  cx.putImageData(im,0,0);document.documentElement.style.setProperty('--grao','url('+cv.toDataURL()+')');

  const D=${JSON.stringify({ duracao, total, pb, cartao, broll: cartoes.map((b) => [b.inicio, b.fim]), grupos: grupos.map((gr) => gr.map((w) => [w.k, +w.i.toFixed(3), +w.f.toFixed(3)])), sem: semLegenda, caps: (plano.capitulos || []).map((x) => x.t), imps: (plano.impactos || []).map((x) => x.t), lista: (plano.lista || []).map((x) => x.t), listaFim: plano.listaFim || 0, ganchoFim, ritmo, flashes, tarja: plano.apresentacao ? plano.apresentacao.t : -1, cit: plano.citacao ? { t: plano.citacao.t, fim: plano.citacao.fim, w: plano.citacao.palavras.map((x) => x[1]) } : null })};
  const cl=(x)=>Math.max(0,Math.min(1,x)), eo=(p)=>1-Math.pow(1-p,3), eio=(p)=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
  const back=(p)=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(p-1,3)+c1*Math.pow(p-1,2)};
  const $=(id)=>document.getElementById(id);
  const sig=[];
  function set(el,o,tf,extra){ if(!el)return; o=Math.round(o*1000)/1000;
    const css=o<=0?'0':o+'|'+(tf||'')+'|'+(extra||'');
    if(el.__c!==css){ el.__c=css; const st=el.style;
      st.opacity=o<=0?0:o; st.transform=o<=0?'':(tf||''); st.filter=''; st.clipPath='';
      if(o>0&&extra) extra.split(';').forEach((d)=>{const i=d.indexOf(':'); if(i>0) st.setProperty(d.slice(0,i).trim(), d.slice(i+1).trim())});
    }
    sig.push(css);
  }
  const dentro=(t,j)=>j.some(([a,b])=>t>=a&&t<b);

  window.__seek=function(t){
    sig.length=0;
    // flash na volta da cor
    const pf=(t-D.pb)/0.18; let fl=D.pb>0&&pf>=0&&pf<1?0.32*(1-pf):0;
    for(const c of D.flashes){const q=(t-c)/0.14; if(q>=0&&q<1) fl=Math.max(fl,0.26*Math.pow(1-q,2));}
    set($('flash'), fl);
    // gancho
    const gf=D.ganchoFim, saiG=gf>0?cl((t-gf)/0.3):1;
    set($('gsombra'), cl(t/0.15)*(1-saiG));
    set($('gbarra'), t<gf+0.3?cl((t-0.02)/0.25)*(1-saiG):0, 'scaleX('+eo(cl((t-0.02)/0.35))+')', 'transform-origin:0 50%');
    const p1=eo(cl((t-0.05)/0.3));
    set($('g1'), t<gf+0.3?p1*(1-saiG):0, 'translateY('+(24*(1-p1)-40*saiG)+'px)', 'filter:blur('+(8*(1-p1)+8*saiG).toFixed(1)+'px)');
    const g2=$('g2'); if(g2){ set(g2, t<gf+0.3?1-saiG:0, 'translateY('+(-40*saiG)+'px)');
      g2.querySelectorAll('.gw').forEach((w,k)=>{const p=cl((t-0.22-k*0.09)/0.26);const b=back(p);set(w,cl(p*1.6),'translateY('+(40*(1-eo(p)))+'px) scale('+(0.85+0.15*b)+')','filter:blur('+(10*(1-eo(p))).toFixed(1)+'px)')}); }
    // molduras dos cartões de B-roll (mesma conta do ffmpeg)
    D.broll.forEach(([a,b],k)=>{const el=$('m'+k); if(t<a||t>=b){set(el,0);return}
      const p=cl((t-a)/D.cartao.entra), y=D.cartao.sobe*Math.pow(1-p,3);
      const o=Math.min(cl((t-a)/0.25), cl((b-t)/D.cartao.sai)); set(el,o,'translateY('+y.toFixed(1)+'px)')});
    // legenda
    const oculta=dentro(t,D.sem);
    D.grupos.forEach((gr,k)=>{const el=$('l'+k); const ini=gr[0][1]-0.08, prox=k<D.grupos.length-1?D.grupos[k+1][0][1]-0.08:gr[gr.length-1][2]+0.6;
      const fim=Math.min(prox, gr[gr.length-1][2]+0.9);
      if(oculta||t<ini||t>=fim){set(el,0);gr.forEach(([w])=>set($('w'+w),0));return}
      // com o cartão de B-roll na tela, a legenda desce para baixo dele (fica sobre o fundo escurecido)
      set(el,1,dentro(t,D.broll.map(([a,b])=>[a-0.05,b]))?'translateY(300px)':'');
      gr.forEach(([w,wi])=>{ if(D.ritmo){ const p=cl((t-wi+0.06)/0.12); set($('w'+w),cl(p*2),'translateY('+(18*(1-eo(p))).toFixed(1)+'px) scale('+(0.6+0.4*back(p)).toFixed(3)+')','filter:blur('+(4*(1-eo(p))).toFixed(1)+'px)'); return; }
        const p=cl((t-wi+0.08)/0.16); set($('w'+w),cl(p*1.4),'translateY('+(26*(1-eo(p))).toFixed(1)+'px) scale('+(0.92+0.08*eo(p)).toFixed(3)+')','filter:blur('+(7*(1-eo(p))).toFixed(1)+'px)')});
    });
    // tarja de apresentação: desliza da esquerda, fica 2,6 s
    if(D.tarja>=0){const a=D.tarja, b=a+2.6, el=$('tarja'); if(t<a||t>=b) set(el,0); else { const p=eo(cl((t-a)/0.4)), s=cl((b-t)/0.3);
      set(el,Math.min(cl(p*1.4),s),'translateX('+(-120*(1-p)-40*(1-s)).toFixed(1)+'px)','clip-path:inset(0 '+(100*(1-p)).toFixed(1)+'% 0 0 round 22px)')}}
    // impacto
    D.imps.forEach((a,k)=>{const el=$('i'+k); if(t<a||t>=a+1.1){set(el,0);return}
      const p=cl((t-a)/0.28), s=cl((a+1.1-t)/0.22); set(el,Math.min(cl(p*1.5),s),'scale('+(1.35-0.35*back(p)).toFixed(3)+') translateY('+(-30*(1-s)).toFixed(1)+'px)','filter:blur('+(10*(1-eo(p))+6*(1-s)).toFixed(1)+'px)');
      // número conta até o valor nos primeiros 0,6 s
      if(el.dataset.num){ const alvo=Number(el.dataset.num), v=Math.round(alvo*eo(cl((t-a)/0.6))); const txt=el.dataset.pre+v.toLocaleString('pt-BR')+el.dataset.pos; if(el.textContent!==txt) el.textContent=txt; sig.push(txt); }});
    // citação: cartão sobe, cada palavra acende quando é dita
    if(D.cit){ const el=$('cit'), a=D.cit.t, b=D.cit.fim; if(t<a||t>=b){set(el,0)} else {
      const p=eo(cl((t-a)/0.35)), s=cl((b-t)/0.3); set(el,Math.min(p,s),'translateY('+(50*(1-p)+30*(1-s)).toFixed(1)+'px)');
      set(el.querySelector('.aspas'),1,'scale('+(0.6+0.4*back(cl((t-a-0.05)/0.4))).toFixed(3)+')','transform-origin:30% 70%');
      D.cit.w.forEach((wi,k)=>{ const q=cl((t-wi+0.05)/0.15); set($('cw'+k),0.32+0.68*q,'',q>=1?'color:#fff':''); }); } }
    // lista
    D.lista.forEach((a,k)=>{const el=$('it'+k); const fim=D.listaFim; if(t<a||t>=fim){set(el,0);return}
      const p=eo(cl((t-a)/0.35)), s=cl((fim-t)/0.25), apaga=k<D.lista.length-1&&t>D.lista[k+1]?0.45:1;
      set(el,Math.min(p,s)*apaga,'translateX('+(-80*(1-p)).toFixed(1)+'px)')});
    // capítulos: entra em diagonal, segura e sai
    D.caps.forEach((a,k)=>{const el=$('c'+k); const b=a+1.4; if(t<a||t>=b){set(el,0);return}
      const pi=eio(cl((t-a)/0.32)), po=eio(cl((t-(b-0.3))/0.3));
      const L=(1-pi)*160, R=po*160;
      set(el,1,'','clip-path:polygon('+(L-30)+'% 0%,'+(130-R)+'% 0%,'+(100-R)+'% 100%,'+(L-60)+'% 100%)');
      const tx=el.querySelector('.tit'), rt=el.querySelector('.rot'), x=el.querySelector('.elem');
      const pt=eo(cl((t-a-0.12)/0.4)); set(tx,pt,'translateY('+(40*(1-pt)).toFixed(1)+'px)');
      const pr=eo(cl((t-a-0.05)/0.35)); set(rt,pr,'translateX('+(-30*(1-pr)).toFixed(1)+'px)');
      set(x,0.95,'rotate(-6deg) translateY('+(-60*cl((t-a)/1.4)).toFixed(1)+'px)');
    });
    // encerramento
    const f=$('fim'); if(t<D.duracao||D.total<=D.duracao){set(f,0)} else {
      const p=eio(cl((t-D.duracao)/0.4)); set(f,1,'','clip-path:circle('+(p*1500).toFixed(0)+'px at 540px 1100px)');
      const q=(d)=>eo(cl((t-D.duracao-d)/0.4));
      set(f.querySelector('.logo'),q(0.15),'translateY('+(30*(1-q(0.15))).toFixed(1)+'px)');
      set(f.querySelector('.frase'),q(0.3),'translateY('+(30*(1-q(0.3))).toFixed(1)+'px)');
      const sub=f.querySelector('.sub'); if(sub) set(sub,q(0.45));
      const pc=cl((t-D.duracao-0.6)/0.35); set(f.querySelector('.cta'),cl(pc*1.5),'scale('+(0.8+0.2*back(pc)).toFixed(3)+')','transform-origin:0 50%');
      const ar=f.querySelector('.arroba'); if(ar) set(ar,q(0.8));
      set(f.querySelector('.elem'),0.95*q(0),'rotate(8deg) translateY('+(-50*cl((t-D.duracao)/D.total)).toFixed(1)+'px)');
    }
    return sig.join('|');
  };
  // texto que não cabe na largura (palavra longa) diminui até caber
  // (só depois das fontes carregadas: medir com a fonte reserva dá largura errada)
  const fontes=['500 50px M','800 50px M','900 50px M','italic 800 50px M','italic 900 50px M'].map((f)=>document.fonts.load(f));
  Promise.all(fontes).then(()=>document.fonts.ready).then(()=>{
    document.querySelectorAll('.fit').forEach((el)=>{ let fs=parseFloat(getComputedStyle(el).fontSize); let n=0;
      const ws=el.querySelectorAll('.gw'); const largo=()=>Math.max(el.scrollWidth, ...[...ws].map((w)=>w.offsetLeft+w.offsetWidth));
      while(largo()>el.clientWidth+2 && fs>36 && n++<40){ fs-=3; el.style.fontSize=fs+'px'; } });
    window.__pronto=true;
  });
})();
</script></body></html>`;
  return { html, total, pb, cauda };
}

// Camada que fica ATRÁS da pessoa (entre o fundo e ela): o fundo escurece um pouco na cor da marca e a palavra-chave
// passa gigante em duas faixas (uma cheia, uma só contorno, em sentidos opostos) na altura da cabeça.
export function montarHtmlAtras({ plano, cfg, total }) {
  const c = cfg.cores;
  const itens = plano.atras || [];
  const r = plano.rosto;
  // as duas faixas cruzam a cabeça (da testa ao queixo), para a pessoa cobrir parte das letras
  const topo = r ? r.topo * 19.2 : 330, base = r ? r.base * 19.2 : 900;
  const y1 = Math.round(Math.max(60, Math.min(1000, topo + (base - topo) * 0.12))), y2 = y1 + 300;
  const fonte = (peso, estilo = 'normal') => `@font-face{font-family:'M';font-weight:${peso};font-style:${estilo};src:url('file://${FONTES}montserrat-latin-${peso}-${estilo}.woff2') format('woff2')}`;
  const faixa = (txt) => Array(6).fill(esc(txt)).join('<i>•</i>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fonte(900)}${fonte(900, 'italic')}
html,body{margin:0;padding:0;background:transparent;width:1080px;height:1920px;overflow:hidden}
#r{position:absolute;inset:0;font-family:'M',sans-serif;-webkit-font-smoothing:antialiased}
.x{position:absolute;opacity:0;will-change:transform,opacity}
.tinta{left:0;top:0;width:1080px;height:1920px;background:radial-gradient(80% 60% at 50% 40%, ${c.escuro}66 0%, ${c.escuro}b3 100%)}
.f{left:-1400px;white-space:nowrap;font-weight:900;font-style:italic;font-size:300px;line-height:1;letter-spacing:-.035em}
.f i{font-style:normal;font-size:.45em;vertical-align:.45em;margin:0 .35em;opacity:.8}
.f1{top:${y1}px;color:${c.destaque};text-shadow:0 14px 40px rgba(0,0,0,.35)}
.f2{top:${y2}px;color:transparent;-webkit-text-stroke:5px ${c.texto || '#fff'};opacity:.9}
</style></head><body><div id="r">
${itens.map((a, k) => `<div class="x tinta" id="t${k}"></div><div class="x f f1" id="a${k}">${faixa(a.texto)}</div><div class="x f f2" id="b${k}">${faixa(a.texto)}</div>`).join('\n')}
</div><script>
(function(){
  const D=${JSON.stringify({ total, itens: itens.map((a) => [a.t, a.fim]) })};
  const cl=(x)=>Math.max(0,Math.min(1,x)), eo=(p)=>1-Math.pow(1-p,3);
  const $=(id)=>document.getElementById(id); const sig=[];
  function set(el,o,tf){ o=Math.round(o*1000)/1000; const css=o<=0?'0':o+'|'+tf; if(el.__c!==css){el.__c=css; el.style.opacity=o; el.style.transform=o<=0?'':tf;} sig.push(css); }
  window.__seek=function(t){ sig.length=0;
    D.itens.forEach(([a,b],k)=>{ const dentro=t>=a&&t<b; const p=eo(cl((t-a)/0.22)), s=cl((b-t)/0.28), o=dentro?Math.min(p,s):0;
      const v=dentro?(t-a)/(b-a):0;
      set($('t'+k), o, 'none');
      set($('a'+k), o, 'translateX('+(-420*v).toFixed(1)+'px) scale('+(1.12-0.12*p).toFixed(3)+')');
      set($('b'+k), o*0.9, 'translateX('+(-700+420*v).toFixed(1)+'px) scale('+(1.12-0.12*p).toFixed(3)+')'); });
    return sig.join('|'); };
  Promise.all(['900 50px M','italic 900 50px M'].map((f)=>document.fonts.load(f))).then(()=>document.fonts.ready).then(()=>{window.__pronto=true});
})();
</script></body></html>`;
  return { html, total };
}

// máscara do cartão (PGM em escala de cinza, cantos arredondados com antisserrilhado) para o alphamerge do ffmpeg
export function mascaraCartao(arq, { w = CARTAO.w, h = CARTAO.h, raio = CARTAO.raio } = {}) {
  const px = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(0, raio - x - 0.5, x + 0.5 - (w - raio)), dy = Math.max(0, raio - y - 0.5, y + 0.5 - (h - raio));
    const d = Math.hypot(dx, dy) - raio;
    px[y * w + x] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - d)));
  }
  fs.writeFileSync(arq, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), px]));
  return arq;
}

// renderiza a camada (transparente) em .mov qtrle. Quadros iguais ao anterior não são capturados de novo.
export async function renderizarCamada(html, { total, saida, fps = 30, log = () => {} }) {
  const { default: puppeteer } = await import('puppeteer-core');
  const pagina = saida.replace(/\.\w+$/, '.html');
  fs.writeFileSync(pagina, html);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none', '--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage'],
  });
  const t0 = Date.now();
  let capturas = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.goto('file://' + pagina, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__pronto === true);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const ff = spawn(config.ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', saida], { stdio: ['pipe', 'ignore', 'pipe'] });
    let erro = ''; ff.stderr.on('data', (d) => { erro += d; });
    const fim = new Promise((ok, falha) => ff.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg da camada: ' + erro.slice(-300))))));
    const escrever = (buf) => new Promise((ok) => (ff.stdin.write(buf) ? ok() : ff.stdin.once('drain', ok)));
    const n = Math.ceil(total * fps);
    let ant = null, quadro = null;
    for (let i = 0; i < n; i++) {
      const s = await page.evaluate((t) => window.__seek(t), i / fps);
      if (s !== ant || !quadro) {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        quadro = Buffer.from(r.data, 'base64'); ant = s; capturas++;
      }
      await escrever(quadro);
    }
    ff.stdin.end();
    await fim;
  } finally { await browser.close().catch(() => null); }
  log(`camada: ${capturas} capturas em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return saida;
}

// quadros de conferência (PNG) em tempos escolhidos, para revisar o design sem renderizar tudo
export async function fotografar(html, tempos, dir) {
  const { default: puppeteer } = await import('puppeteer-core');
  const pagina = path.join(dir, 'camada-teste.html');
  fs.writeFileSync(pagina, html);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--force-color-profile=srgb'] });
  const saidas = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto('file://' + pagina, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__pronto === true);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const t of tempos) {
      await page.evaluate((x) => window.__seek(x), t);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const arq = path.join(dir, `q-${t.toFixed(2)}.png`); fs.writeFileSync(arq, Buffer.from(r.data, 'base64')); saidas.push(arq);
    }
  } finally { await browser.close(); }
  return saidas;
}
