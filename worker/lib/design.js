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

const FONTES = fileURLToPath(new URL('../node_modules/@fontsource/montserrat/files/', import.meta.url));
export const MARCAS_DIR = process.env.MARCAS_DIR || '/marcas';

// geometria do cartão de B-roll (o ffmpeg põe o vídeo, a camada desenha borda e sombra no mesmo lugar)
export const CARTAO = { x: 70, y: 250, w: 940, h: 1100, raio: 44, sobe: 70, entra: 0.4, sai: 0.22 };
export const CAUDA = 2.4;      // segundos de encerramento depois da última fala
export const PB = 1.0;         // abertura em preto e branco até aqui

export function designDoKit(kit) {
  const d = kit?.acabamento?.design;
  if (!d?.ativo) return null;
  return { fonte: 'Montserrat', cta: 'Saiba mais', arroba: '', assinatura: '', ...d, cores: { escuro: '#16207F', roxo: '#5F27E0', azul: '#0A33B0', verde: '#0E7A6A', destaque: '#F5C542', texto: '#FFFFFF', ...(d.cores || {}) } };
}

const PROMPT = `Você é diretor de arte de reels de empresas. O vídeo é uma pessoa falando para a câmera; por cima dela vai uma camada de design com a identidade da marca. Escolha o que entra e onde, como um editor premium faria — com critério, sem poluir.
Elementos:
- gancho: título da abertura (primeiros 3 s), em duas linhas: linha1 curta de contexto (até 5 palavras) e linha2 forte (até 4 palavras). "destaque" é UMA palavra da linha2 que vai na cor de destaque. Baseie-se no título sugerido e na fala; português correto, sem emoji.
- destaques: índices das palavras-chave da legenda (substantivo, número, benefício, nome da marca). No máximo uma a cada 3 ou 4 palavras faladas; nunca artigo, preposição ou palavra de ligação.
- capitulos: 0 a 2 cartões de tela cheia quando a fala MUDA de assunto (ex.: começa a explicar um serviço, um diferencial, um resultado). "palavra" é o índice da palavra em que o cartão entra (ele fica 1,4 s). "rotulo" 1 ou 2 palavras em caixa alta (ex.: DIFERENCIAL), "titulo" até 5 palavras. Só entre 5 s e o fim menos 4 s.
- impactos: 0 a 2 palavras isoladas muito fortes (número, resultado, adjetivo central) mostradas grandes; "palavra" é o índice, "texto" a palavra (pode ser o número escrito com algarismos).
- lista: só se a pessoa enumerar 3 ou 4 itens (serviços, etapas, benefícios); cada item com "palavra" (índice em que o item é dito) e "texto" (até 4 palavras). Senão, lista vazia.
- apresentacao: se a pessoa disser o próprio nome e/ou cargo, uma tarja com "nome" (como ela se apresenta) e "cargo" (curto, até 4 palavras; se não disser o cargo, deixe vazio), e "palavra" = índice em que ela diz o nome. Senão, null.
- encerramento: "frase" de até 7 palavras para o cartão final (pode ser a ideia central do vídeo ou um convite).
- rosto: nas imagens (quadros do vídeo), onde fica a cabeça da pessoa, em porcentagem da altura do quadro: "topo" (topo do cabelo) e "base" (queixo). Se houver mais de um quadro, use a faixa que cobre todos.
Responda só com JSON: {"gancho": {"linha1": "", "linha2": "", "destaque": ""}, "destaques": [], "capitulos": [{"palavra": 0, "rotulo": "", "titulo": ""}], "impactos": [{"palavra": 0, "texto": ""}], "lista": [{"palavra": 0, "texto": ""}], "apresentacao": {"palavra": 0, "nome": "", "cargo": ""}, "encerramento": {"frase": ""}, "rosto": {"topo": 0, "base": 0}}`;

export async function planejarDesign({ palavras, duracao, titulo = '', broll = [], marca = '', quadros = [] }, { claudeJson }) {
  const texto = `MARCA: ${marca}\nTÍTULO SUGERIDO: ${titulo}\nDURAÇÃO: ${duracao.toFixed(1)} s\nB-ROLL JÁ PLANEJADO (não ponha capítulo nem impacto nesses intervalos): ${broll.map((b) => `${b.inicio.toFixed(1)}-${b.fim.toFixed(1)} s`).join(', ') || 'nenhum'}\n\nFALA (índice:palavra@segundo):\n${palavras.map((w, k) => `${k}:${w.p}@${w.i.toFixed(1)}`).join(' ')}`;
  const r = await claudeJson({ system: PROMPT, texto, imagens: quadros, max: 4000 });
  return { plano: limparPlano(r.saida || {}, { palavras, duracao, broll }), usd: r.usd || 0, tokens: r.tokens || { entrada: 0, saida: 0 } };
}

// confere o que a IA devolveu: índices válidos, sem sobreposição com B-roll, abertura ou fim
export function limparPlano(p, { palavras, duracao, broll = [] }) {
  const n = palavras.length;
  const ok = (k) => Number.isInteger(k) && k >= 0 && k < n;
  const ocupado = broll.map((b) => [b.inicio - 0.6, b.fim + 0.6]);
  const livre = (a, b) => !ocupado.some(([x, y]) => a < y && b > x);
  const reservar = (a, b) => ocupado.push([a - 0.8, b + 0.8]);
  const corta = (s, max) => String(s || '').trim().split(/\s+/).slice(0, max).join(' ');
  const g = p.gancho || {};
  const plano = {
    gancho: { linha1: corta(g.linha1, 6), linha2: corta(g.linha2, 5), destaque: String(g.destaque || '').trim() },
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
  const ap = p.apresentacao;
  if (ap && ok(ap.palavra) && String(ap.nome || '').trim()) {
    const t = Math.max(palavras[ap.palavra].i - 0.1, plano.ganchoFim + 0.15);
    if (t + 2.6 < duracao - 1.5 && livre(t, t + 2.6)) { plano.apresentacao = { t: +t.toFixed(2), nome: corta(ap.nome, 4), cargo: corta(ap.cargo, 5) }; reservar(t, t + 2.6); }
  }
  for (const c of (p.capitulos || []).filter((c) => ok(c.palavra)).slice(0, 2)) {
    const t = palavras[c.palavra].i - 0.05;
    if (t < 5 || t + 1.4 > duracao - 3.5 || !livre(t, t + 1.4)) continue;
    plano.capitulos.push({ t: +t.toFixed(2), rotulo: corta(c.rotulo, 2).toUpperCase(), titulo: corta(c.titulo, 6) });
    reservar(t, t + 1.4);
  }
  const lista = (p.lista || []).filter((x) => ok(x.palavra)).sort((a, b) => a.palavra - b.palavra).slice(0, 4);
  if (lista.length >= 3) {
    const a = palavras[lista[0].palavra].i - 0.1, b = Math.min(duracao - 2.5, palavras[lista[lista.length - 1].palavra].f + 1.6);
    if (a > 3 && b > a && livre(a, b)) { plano.lista = lista.map((x) => ({ t: +(palavras[x.palavra].i - 0.1).toFixed(2), texto: corta(x.texto, 5) })); plano.listaFim = +b.toFixed(2); reservar(a, b); }
  }
  for (const m of (p.impactos || []).filter((x) => ok(x.palavra)).slice(0, 2)) {
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
export function montarHtml({ plano, palavras, duracao, cfg, logo = null, broll = [] }) {
  const c = cfg.cores;
  const total = duracao + CAUDA;
  const elemento = dataUrl(cfg.elemento ? path.join(MARCAS_DIR, cfg.elemento) : '');
  const logoUrl = dataUrl(logo);
  const destaques = new Set(plano.destaques || []);
  const grupos = gruposLegenda(palavras);
  // janelas sem legenda: capítulos, lista (a lista ocupa o lugar dela) e encerramento
  const semLegenda = [...(plano.capitulos || []).map((x) => [x.t, x.t + 1.4]), ...(plano.lista?.length ? [[plano.lista[0].t, plano.listaFim]] : []), [duracao, total]];
  const fonte = (peso, estilo = 'normal') => `@font-face{font-family:'M';font-weight:${peso};font-style:${estilo};src:url('file://${FONTES}montserrat-latin-${peso}-${estilo}.woff2') format('woff2')}`;
  const g = plano.gancho || {};
  const b0 = broll.length ? Math.min(...broll.map((b) => b.inicio)) : Infinity;
  const ganchoFim = Math.max(1.6, Math.min(3.2, b0 - 0.15, duracao - 1));
  // gancho no alto quando a cabeça começa abaixo de 28% da altura; senão vai para baixo do queixo e a legenda espera ele sair
  const rosto = plano.rosto;
  const ganchoEmBaixo = Boolean(rosto && rosto.topo < 28);
  const gTopo = ganchoEmBaixo ? Math.round(Math.min(1000, Math.max(700, rosto.base * 19.2 + 50))) : 250;
  if (ganchoEmBaixo) semLegenda.push([0, ganchoFim + 0.1]);
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
/* impacto */
.imp{left:50px;width:980px;top:200px;text-align:center;font-weight:900;font-style:italic;font-size:170px;line-height:1;letter-spacing:-.03em;color:${c.destaque};text-shadow:0 12px 50px rgba(0,0,0,.55)}
/* lista */
.lista{left:70px;width:940px;top:1110px}
.item{position:absolute;left:0;width:940px;height:104px;display:flex;align-items:center;gap:24px;padding:0 30px;border-radius:26px;background:${c.escuro}e0;border:2px solid rgba(255,255,255,.16);box-shadow:0 18px 44px rgba(0,0,0,.45);font-weight:800;font-size:46px;opacity:0}
.item em{font-style:normal;flex:none;display:grid;place-items:center;width:62px;height:62px;border-radius:50%;background:${c.destaque};color:${c.escuro};font-weight:900;font-size:34px}
/* moldura do B-roll */
.moldura{left:${CARTAO.x}px;top:${CARTAO.y}px;width:${CARTAO.w}px;height:${CARTAO.h}px;border-radius:${CARTAO.raio}px;border:5px solid rgba(255,255,255,.92);box-shadow:0 40px 90px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.2)}
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
${broll.map((b, k) => `<div class="x moldura" id="m${k}"></div>`).join('\n')}
${grupos.map((gr, k) => `<div class="x leg" id="l${k}">${gr.map((w) => `<span id="w${w.k}"${destaques.has(w.k) ? ' class="d"' : ''}>${esc(w.p.replace(/[.,;:!?…]+$/, ''))}</span>`).join('')}</div>`).join('\n')}
${plano.apresentacao ? `<div class="x" id="tarja"><div class="barra"></div><div class="txt"><b>${esc(plano.apresentacao.nome)}</b>${plano.apresentacao.cargo ? `<span>${esc(plano.apresentacao.cargo)}</span>` : ''}</div></div>` : ''}
${(plano.impactos || []).map((m, k) => `<div class="x imp fit" id="i${k}">${esc(m.texto)}</div>`).join('\n')}
${plano.lista?.length ? `<div class="x lista" id="lista" style="opacity:1">${plano.lista.map((it, k) => `<div class="item" id="it${k}" style="top:${k * 122}px"><em>${k + 1}</em>${esc(it.texto)}</div>`).join('')}</div>` : ''}
${(plano.capitulos || []).map((x, k) => `<div class="x cap" id="c${k}"><div class="tela"><div class="grao"></div><div class="elem"></div><div class="rot"><i></i>${esc(x.rotulo)}</div><div class="tit fit">${esc(x.titulo)}</div><div class="marca"></div></div></div>`).join('\n')}
<div class="x" id="fim" style="left:0;top:0;width:1080px;height:1920px"><div class="tela"><div class="grao"></div><div class="elem"></div><div class="col"><div class="logo"></div><div class="frase fit" style="width:900px">${esc(plano.encerramento?.frase || '')}</div>${cfg.assinatura ? `<div class="sub">${esc(cfg.assinatura)}</div>` : ''}<div class="cta">${esc(cfg.cta)} <span>→</span></div>${cfg.arroba ? `<div class="arroba">${esc(cfg.arroba)}</div>` : ''}</div></div></div>
<div class="x" id="flash"></div>
</div>
<script>
(function(){
  // grão com semente (igual em todo quadro)
  const cv=document.createElement('canvas');cv.width=cv.height=256;const cx=cv.getContext('2d');const im=cx.createImageData(256,256);
  let s=7;const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff};
  for(let i=0;i<im.data.length;i+=4){const v=(r()*255)|0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}
  cx.putImageData(im,0,0);document.documentElement.style.setProperty('--grao','url('+cv.toDataURL()+')');

  const D=${JSON.stringify({ duracao, total, pb: PB, cartao: CARTAO, broll: broll.map((b) => [b.inicio, b.fim]), grupos: grupos.map((gr) => gr.map((w) => [w.k, +w.i.toFixed(3), +w.f.toFixed(3)])), sem: semLegenda, caps: (plano.capitulos || []).map((x) => x.t), imps: (plano.impactos || []).map((x) => x.t), lista: (plano.lista || []).map((x) => x.t), listaFim: plano.listaFim || 0, ganchoFim, tarja: plano.apresentacao ? plano.apresentacao.t : -1 })};
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
    const pf=(t-D.pb)/0.18; set($('flash'), pf>=0&&pf<1?0.32*(1-pf):0);
    // gancho
    const gf=D.ganchoFim, saiG=cl((t-gf)/0.3);
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
      gr.forEach(([w,wi])=>{const p=cl((t-wi+0.08)/0.16); set($('w'+w),cl(p*1.4),'translateY('+(26*(1-eo(p))).toFixed(1)+'px) scale('+(0.92+0.08*eo(p)).toFixed(3)+')','filter:blur('+(7*(1-eo(p))).toFixed(1)+'px)')});
    });
    // tarja de apresentação: desliza da esquerda, fica 2,6 s
    if(D.tarja>=0){const a=D.tarja, b=a+2.6, el=$('tarja'); if(t<a||t>=b) set(el,0); else { const p=eo(cl((t-a)/0.4)), s=cl((b-t)/0.3);
      set(el,Math.min(cl(p*1.4),s),'translateX('+(-120*(1-p)-40*(1-s)).toFixed(1)+'px)','clip-path:inset(0 '+(100*(1-p)).toFixed(1)+'% 0 0 round 22px)')}}
    // impacto
    D.imps.forEach((a,k)=>{const el=$('i'+k); if(t<a||t>=a+1.1){set(el,0);return}
      const p=cl((t-a)/0.28), s=cl((a+1.1-t)/0.22); set(el,Math.min(cl(p*1.5),s),'scale('+(1.35-0.35*back(p)).toFixed(3)+') translateY('+(-30*(1-s)).toFixed(1)+'px)','filter:blur('+(10*(1-eo(p))+6*(1-s)).toFixed(1)+'px)')});
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
    const f=$('fim'); if(t<D.duracao){set(f,0)} else {
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
