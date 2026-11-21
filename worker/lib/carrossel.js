// Módulo 2: carrossel e post estático na identidade da marca.
// A IA (Claude) escreve e diagrama: escolhe o layout de cada lâmina, os textos e as fotos (vendo as miniaturas).
// O visual é código fixo (HTML), com a identidade da marca (design.json ou kit): a IA só preenche.
// Cada lâmina vira um JPG 1080x1350 no Chromium do servidor. Fotos passam por tratamento (luz, cor, nitidez),
// enquadramento pelo ponto de interesse que a IA indica e, na capa, recorte da pessoa (mesmo modelo dos reels).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { MARCAS_DIR } from './design.js';

export const W = 1080, H = 1350;
const FONTES = fileURLToPath(new URL('../node_modules/@fontsource/montserrat/files/', import.meta.url));
export const LAYOUTS = ['capa', 'texto', 'lista', 'numero', 'citacao', 'foto', 'cta'];
const LAYOUTS_POST = ['capa', 'numero', 'citacao', 'foto'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// *palavra* no texto vira destaque (cor da marca)
const marcar = (s) => esc(s).replace(/\*([^*]{1,60})\*/g, '<em>$1</em>');
const semMarca = (s) => String(s ?? '').replace(/\*/g, '');
const palavras = (s) => semMarca(s).trim().split(/\s+/).filter(Boolean);
const corta = (s, n) => { const w = palavras(s); if (w.length <= n) return String(s ?? '').trim(); let r = String(s).trim().split(/\s+/).slice(0, n).join(' '); if ((r.match(/\*/g) || []).length % 2) r += '*'; return r.replace(/[,;:–-]+$/, '') + '…'; };
const dataUrl = (arq) => {
  if (!arq || !fs.existsSync(arq)) return '';
  const ext = path.extname(arq).slice(1).toLowerCase();
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(arq).toString('base64')}`;
};

// identidade para as lâminas: design.json da marca (se houver) ou cores do kit; funciona para qualquer cliente
export function marcaDoKit(kit, cliente = {}) {
  const d = kit?.acabamento?.design || {};
  const k = kit?.cores || {};
  const cores = {
    escuro: '#16207F', roxo: '#5F27E0', azul: '#0A33B0', verde: '#0E7A6A', destaque: '#F5C542', texto: '#FFFFFF', claro: '#F4F2FB',
    ...(d.ativo ? {} : { escuro: k.secundaria || k.fundo || '#1B1B2F', roxo: k.principal || '#5F27E0', azul: k.secundaria || '#2B2B5F', verde: k.principal || '#5F27E0', destaque: k.destaque || '#F5C542', claro: k.claro || '#F7F5F2' }),
    ...(d.ativo ? d.cores || {} : {}),
  };
  return {
    marca: d.marca || cliente.nome || '',
    arroba: d.arroba || kit?.arroba || cliente.instagram || '',
    cta: d.cta || 'Saiba mais',
    assinatura: d.assinatura || '',
    elemento: d.ativo && d.elemento ? path.join(MARCAS_DIR, d.elemento) : null,
    logo: d.ativo && d.logo ? path.join(MARCAS_DIR, d.logo) : null,
    cores,
  };
}

const PROMPT = `Você é designer e redator de carrosséis de Instagram para empresas, no nível de uma agência premium. Recebe o pedido, a ficha da marca, um texto-base (opcional) e fotos (opcionais, na ordem, numeradas a partir de 0). Escreva e diagrame a peça.
Layouts de lâmina:
- capa: gancho que faz parar o scroll. "rotulo" (1 ou 2 palavras em caixa alta, o tema), "titulo" (até 9 palavras), "subtitulo" (opcional, até 12 palavras). Pode usar foto.
- texto: "rotulo", "titulo" (até 8 palavras) e "texto" (até 40 palavras, frases curtas).
- lista: "titulo" (até 8 palavras) e "itens" (3 a 5, até 7 palavras cada).
- numero: um dado forte. "numero" (curto: "+27", "3x", "92%"), "titulo" (até 8 palavras) e "texto" (opcional, até 25 palavras). Só use número que veio do pedido, do texto-base ou da ficha; nunca invente dado.
- citacao: "texto" (frase marcante, até 22 palavras) e "autor" (opcional).
- foto: foto em destaque + "titulo" (até 8 palavras) e "texto" (opcional, até 25 palavras). Precisa de foto.
- cta: fechamento. "titulo" (convite, até 8 palavras) e "texto" (opcional, até 14 palavras). O botão e o @ da marca entram sozinhos.
Regras:
- Carrossel: de 5 a 10 lâminas (7 se o pedido não disser); a primeira é capa e a última é cta. Post estático: exatamente 1 lâmina (capa, numero, citacao ou foto), sem cta.
- Em cada título, marque 1 ou 2 palavras de destaque com asteriscos: "O que *ninguém* te conta". Nada de emoji nas lâminas. Português correto, tom da marca.
- Uma ideia por lâmina; a sequência tem começo, meio e fim. Varie os layouts; não repita o mesmo layout mais de 2 vezes seguidas.
- Fotos: use só as que combinam com a lâmina; cada foto no máximo uma vez; "foto" é o número dela (ou null). Em "focos", diga para cada foto usada o ponto de interesse (x e y em % da largura e da altura; normalmente o rosto). "recorte": true só na capa com foto de UMA pessoa em destaque (o sistema recorta a pessoa e põe sobre o fundo da marca).
- "copy": legenda do post no tom da marca (gancho na 1ª linha, 2 a 4 parágrafos curtos, chamada no fim, até 5 hashtags). "cta": a chamada em poucas palavras.
Responda só com JSON: {"laminas": [{"layout": "capa", "rotulo": "", "titulo": "", "subtitulo": "", "texto": "", "itens": [], "numero": "", "autor": "", "foto": null, "recorte": false}], "focos": {"0": {"x": 50, "y": 35}}, "copy": "", "cta": ""}`;

export async function planejarPeca({ tipo, comando = '', ficha = null, marca = '', texto = '', fotos = [], ajuste = '', anterior = null }, { claudeJson }) {
  const partes = [
    `TIPO: ${tipo === 'post' ? 'post estático (1 lâmina)' : 'carrossel'}`,
    `MARCA: ${marca}`,
    ficha?.sobre ? `SOBRE A EMPRESA: ${ficha.sobre}` : '',
    ficha?.briefing ? `BRIEFING DA MARCA (tom e preferências): ${ficha.briefing}` : '',
    ficha?.ajustes?.length ? `AJUSTES JÁ PEDIDOS PELA MARCA (manter quando fizer sentido): ${ficha.ajustes.map((x) => x.texto).join(' | ')}` : '',
    `PEDIDO: ${comando || '(sem comando)'}`,
    texto ? `TEXTO-BASE (do Drive):\n${texto.slice(0, 6000)}` : '',
    fotos.length ? `FOTOS: ${fotos.map((f, k) => `${k}: ${f.nome}`).join(' | ')} (as imagens vêm na mesma ordem)` : 'FOTOS: nenhuma',
    anterior ? `PLANO ANTERIOR (JSON):\n${JSON.stringify({ laminas: anterior.laminas, focos: anterior.focos, copy: anterior.copy, cta: anterior.cta })}\n\nAJUSTE PEDIDO (mude só o que foi pedido e mantenha o resto igual): ${ajuste}` : '',
  ].filter(Boolean).join('\n\n');
  const r = await claudeJson({ system: PROMPT, texto: partes, imagens: fotos.map((f) => f.b64).filter(Boolean), max: 4000 });
  if (!r.saida?.laminas) throw new Error('A IA não devolveu o plano das lâminas');
  return { plano: limparPeca(r.saida, { tipo, nFotos: fotos.length }), usd: r.usd, tokens: r.tokens };
}

// valida o que a IA devolveu: layouts conhecidos, limites de texto, fotos que existem, capa primeiro e cta no fim
export function limparPeca(p, { tipo = 'carrossel', nFotos = 0 } = {}) {
  let ls = (Array.isArray(p.laminas) ? p.laminas : []).filter((l) => l && LAYOUTS.includes(l.layout));
  const usadas = new Set();
  ls = ls.map((l) => {
    let foto = Number.isInteger(l.foto) && l.foto >= 0 && l.foto < nFotos && !usadas.has(l.foto) ? l.foto : null;
    if (foto != null) usadas.add(foto);
    const x = {
      layout: l.layout,
      rotulo: corta(semMarca(l.rotulo || ''), 3).toUpperCase(),
      titulo: corta(l.titulo || '', l.layout === 'capa' ? 11 : 10),
      subtitulo: corta(l.subtitulo || '', 14),
      texto: corta(l.texto || '', l.layout === 'texto' ? 45 : l.layout === 'citacao' ? 26 : 28),
      itens: (Array.isArray(l.itens) ? l.itens : []).map((i) => corta(String(i), 8)).filter(Boolean).slice(0, 5),
      numero: String(l.numero || '').trim().slice(0, 6),
      autor: corta(l.autor || '', 6),
      foto,
      recorte: Boolean(l.recorte && foto != null && l.layout === 'capa'),
    };
    if (x.layout === 'foto' && x.foto == null) x.layout = 'texto';
    if (x.layout === 'lista' && x.itens.length < 2) x.layout = 'texto';
    if (x.layout === 'numero' && !x.numero) x.layout = 'texto';
    return x;
  });
  if (tipo === 'post') {
    const l = ls.find((x) => LAYOUTS_POST.includes(x.layout)) || { ...(ls[0] || {}), layout: 'capa' };
    ls = [l];
  } else {
    if (!ls.length || ls[0].layout !== 'capa') ls.unshift({ ...(ls[0] || {}), layout: 'capa', titulo: ls[0]?.titulo || p.cta || '' });
    if (ls.length < 2 || ls[ls.length - 1].layout !== 'cta') ls.push({ layout: 'cta', rotulo: '', titulo: p.cta || 'Fale com a gente', subtitulo: '', texto: '', itens: [], numero: '', autor: '', foto: null, recorte: false });
    if (ls.length > 10) ls = [...ls.slice(0, 9), ls[ls.length - 1]];
  }
  const focos = {};
  for (const [k, v] of Object.entries(p.focos || {})) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 0 && n < nFotos && v) focos[n] = { x: Math.max(0, Math.min(100, Number(v.x) || 50)), y: Math.max(0, Math.min(100, Number(v.y) || 40)) };
  }
  return { laminas: ls, focos, copy: String(p.copy || '').trim(), cta: corta(p.cta || '', 8) };
}

// ---------- fotos: tratamento e recorte ----------
function ff(args) {
  return new Promise((ok, falha) => {
    const p = spawn(config.ffmpeg, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let e = ''; p.stderr.on('data', (d) => { e += d; });
    p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg (foto): ' + e.slice(-300)))));
  });
}

// luz (níveis automáticos suaves), cor levemente quente, saturação e nitidez; lado maior até 2000 px
export async function tratarFoto(entrada, saida) {
  const vf = "scale='if(gt(iw,ih),min(2000,iw),-2)':'if(gt(iw,ih),-2,min(2000,ih))',normalize=smoothing=40:independence=0:strength=0.35,eq=contrast=1.04:saturation=1.07:gamma=1.02,colorbalance=rs=0.015:gs=0.005:bs=-0.02:rm=0.01:bm=-0.01,unsharp=5:5:0.45";
  await ff(['-i', entrada, '-frames:v', '1', '-vf', vf, '-q:v', '2', saida]);
  return saida;
}

export async function medirFoto(arq) {
  const o = await new Promise((ok) => {
    const p = spawn(config.ffprobe || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', arq]);
    let t = ''; p.stdout.on('data', (d) => { t += d; }); p.on('close', () => ok(t.trim()));
  });
  const [w, h] = o.split(',').map(Number);
  return { w: w || 0, h: h || 0 };
}

// posição da foto (object-fit: cover) que põe o ponto de interesse no centro da caixa, sem sobrar borda
export function posicaoFoto(foto, bw, bh, alvoY = 0.5) {
  if (!foto?.w || !foto?.h) return foto?.foco ? `${foto.foco.x}% ${foto.foco.y}%` : '50% 35%';
  const f = foto.foco || { x: 50, y: 40 };
  const s = Math.max(bw / foto.w, bh / foto.h), dw = foto.w * s, dh = foto.h * s;
  const x = Math.min(0, Math.max(bw - dw, bw / 2 - (f.x / 100) * dw));
  const y = Math.min(0, Math.max(bh - dh, bh * alvoY - (f.y / 100) * dh));
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

// recorte da pessoa numa foto (PNG com transparência), com o modelo de recorte dos reels
export async function recortarFoto(entrada, saida, { modelo = process.env.RVM_MODELO || '/models/rvm/rvm_mobilenetv3_fp32.onnx' } = {}) {
  if (!fs.existsSync(modelo)) return null;
  const ort = (await import('onnxruntime-node')).default;
  const tmp = saida + '.rgb';
  // lado maior 1280 (múltiplo de 16) para o modelo
  const dim = await new Promise((ok) => {
    const p = spawn(config.ffprobe || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', entrada]);
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => ok(o.trim().split(',').map(Number)));
  });
  const esc16 = (v) => Math.max(16, Math.round(v / 16) * 16);
  const f = 1280 / Math.max(dim[0] || 1280, dim[1] || 1280);
  const w = esc16((dim[0] || 1280) * f), h = esc16((dim[1] || 1280) * f);
  await ff(['-i', entrada, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp]);
  const q = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  const n = w * h, src = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) { src[p] = q[p * 3] / 255; src[n + p] = q[p * 3 + 1] / 255; src[2 * n + p] = q[p * 3 + 2] / 255; }
  const sessao = await ort.InferenceSession.create(modelo, { intraOpNumThreads: Math.max(1, Number(process.env.RVM_THREADS) || 3) });
  const zeros = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]);
  let r = [zeros(), zeros(), zeros(), zeros()], o = null;
  const ds = new ort.Tensor('float32', new Float32Array([0.375]), [1]);
  // o modelo é recorrente: a mesma foto passa algumas vezes até a máscara assentar
  for (let k = 0; k < 6; k++) { o = await sessao.run({ src: new ort.Tensor('float32', src, [1, 3, h, w]), r1i: r[0], r2i: r[1], r3i: r[2], r4i: r[3], downsample_ratio: ds }); r = [o.r1o, o.r2o, o.r3o, o.r4o]; }
  await sessao.release?.().catch?.(() => null);
  const pha = o.pha.data, rgba = Buffer.allocUnsafe(n * 4);
  let cheio = 0;
  for (let p = 0; p < n; p++) { const a = pha[p] <= 0 ? 0 : pha[p] >= 1 ? 255 : Math.round(pha[p] * 255); if (a > 128) cheio++; rgba[p * 4] = q[p * 3]; rgba[p * 4 + 1] = q[p * 3 + 1]; rgba[p * 4 + 2] = q[p * 3 + 2]; rgba[p * 4 + 3] = a; }
  // sem pessoa (ou máscara quase vazia): não usa o recorte
  if (cheio / n < 0.04) return null;
  const raw = saida + '.rgba'; fs.writeFileSync(raw, rgba);
  // corta a área vazia em volta da pessoa e grava em PNG
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (rgba[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const cw = Math.max(16, x1 - x0 + 2), ch = Math.max(16, y1 - y0 + 2);
  await ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw, '-frames:v', '1', '-vf', `crop=${cw}:${ch}:${x0}:${y0}`, saida]);
  fs.rmSync(raw, { force: true });
  return { arquivo: saida, toca: { base: y1 >= h - 6, esquerda: x0 <= 4, direita: x1 >= w - 6 } };
}

// ---------- HTML das lâminas ----------
function fontes() {
  const f = (peso, estilo = 'normal') => `@font-face{font-family:'M';font-weight:${peso};font-style:${estilo};src:url('file://${FONTES}montserrat-latin-${peso}-${estilo}.woff2') format('woff2')}`;
  return [f(500), f(600), f(700), f(800), f(900), f(800, 'italic'), f(900, 'italic')].join('');
}

/**
 * @param {object} p  { lamina, k, n, tipo, marca, fotos: {indice: {arquivo, foco}}, recorte: {arquivo, toca} | null }
 */
export function montarHtmlLamina({ lamina: l, k, n, tipo = 'carrossel', marca, fotos = {}, recorte = null }) {
  const c = marca.cores;
  const claro = ['texto', 'lista', 'numero'].includes(l.layout) && k % 2 === 0 && tipo !== 'post';
  const tx = claro ? c.escuro : c.texto;
  const dest = claro ? c.roxo : c.destaque;
  const foto = l.foto != null ? fotos[l.foto] : null;
  const fotoUrl = foto ? dataUrl(foto.arquivo) : '';
  const posCheia = posicaoFoto(foto, W, H, 0.32);
  const posCartao = posicaoFoto(foto, W - 176, tipo === 'post' ? 640 : 660);
  const elem = dataUrl(marca.elemento);
  const logo = dataUrl(marca.logo);
  const carrossel = tipo !== 'post' && n > 1;
  const ultimo = k === n - 1;
  const fundoEscuro = `background:
    radial-gradient(60% 40% at 0% 0%, ${c.verde}cc 0%, transparent 70%),
    radial-gradient(60% 38% at 100% 100%, ${c.verde}aa 0%, transparent 70%),
    radial-gradient(70% 50% at 30% 60%, ${c.roxo} 0%, transparent 75%),
    linear-gradient(150deg, ${c.escuro} 0%, ${c.roxo} 50%, ${c.azul} 85%, ${c.escuro} 100%);`;
  const fundoClaro = `background:
    radial-gradient(45% 30% at 100% 0%, ${c.roxo}22 0%, transparent 70%),
    radial-gradient(45% 30% at 0% 100%, ${c.verde}1f 0%, transparent 70%), ${c.claro};`;
  const logoEl = logo ? `<div class="logo" style="${claro ? `background:${c.escuro};-webkit-mask:url('${logo}') right center/contain no-repeat` : `background:url('${logo}') right center/contain no-repeat`}"></div>` : `<div class="logo txt">${esc(marca.marca)}</div>`;
  const rotulo = l.rotulo ? `<div class="rot"><i></i>${esc(l.rotulo)}</div>` : '';
  const rodape = carrossel ? `<div class="rodape"><span>${esc(marca.arroba)}</span><span class="pag">${String(k + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}${ultimo ? '' : ' <b>→</b>'}</span></div><div class="prog"><div style="width:${((k + 1) / n) * 100}%"></div></div>`
    : `<div class="rodape"><span>${esc(marca.arroba)}</span><span></span></div>`;

  let corpo = '';
  if (l.layout === 'capa') {
    if (recorte) {
      corpo = `<div class="tela" style="${fundoEscuro}"></div>${elem ? `<div class="elem" style="right:-170px;top:250px;width:820px;height:840px;opacity:.55;transform:rotate(-8deg)"></div>` : ''}
        <div class="topo">${rotulo}${logoEl}</div>
        <div class="capa-t" style="top:210px" data-fit="430"><h1>${marcar(l.titulo)}</h1></div>
        <img class="pessoa" src="${dataUrl(recorte.arquivo)}">
        <div class="sombra-base"></div>
        ${l.subtitulo ? `<div class="sub" style="bottom:${carrossel ? 150 : 130}px">${marcar(l.subtitulo)}</div>` : ''}`;
    } else if (fotoUrl) {
      corpo = `<img class="cheia" src="${fotoUrl}" style="object-position:${posCheia}"><div class="vela"></div>
        <div class="topo">${rotulo}${logoEl}</div>
        <div class="pilha" style="bottom:${carrossel ? 150 : 130}px" data-fit="620"><h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub2">${marcar(l.subtitulo)}</div>` : ''}</div>`;
    } else {
      corpo = `<div class="tela" style="${fundoEscuro}"></div>${elem ? `<div class="elem" style="right:-210px;top:110px;width:900px;height:920px;opacity:.9;transform:rotate(-8deg)"></div>` : ''}<div class="grao"></div>
        <div class="topo">${rotulo}${logoEl}</div>
        <div class="pilha" style="bottom:${carrossel ? 160 : 130}px" data-fit="720"><h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub2">${marcar(l.subtitulo)}</div>` : ''}</div>`;
    }
    if (carrossel) corpo += `<div class="arraste">Arraste <b>→</b></div>`;
  } else if (l.layout === 'texto') {
    corpo = `<div class="tela" style="${claro ? fundoClaro : fundoEscuro}"></div>${elem ? `<div class="elem" style="right:-260px;bottom:-200px;width:620px;height:640px;opacity:${claro ? .14 : .35}"></div>` : ''}
      <div class="topo">${rotulo}${logoEl}</div>
      <div class="bloco" data-fit="auto"><div class="barra"></div><h2>${marcar(l.titulo)}</h2>${l.texto ? `<p>${marcar(l.texto)}</p>` : ''}</div>`;
  } else if (l.layout === 'lista') {
    corpo = `<div class="tela" style="${claro ? fundoClaro : fundoEscuro}"></div>${elem ? `<div class="elem" style="right:-280px;top:-240px;width:620px;height:640px;opacity:${claro ? .12 : .3}"></div>` : ''}
      <div class="topo">${rotulo}${logoEl}</div>
      <div class="bloco" data-fit="auto"><h2>${marcar(l.titulo)}</h2><ol>${l.itens.map((i, j) => `<li><span class="num">${String(j + 1).padStart(2, '0')}</span><span>${marcar(i)}</span></li>`).join('')}</ol></div>`;
  } else if (l.layout === 'numero') {
    corpo = `<div class="tela" style="${claro ? fundoClaro : fundoEscuro}"></div>${elem ? `<div class="elem" style="left:-240px;bottom:-220px;width:620px;height:640px;opacity:${claro ? .12 : .3}"></div>` : ''}
      <div class="topo">${rotulo}${logoEl}</div>
      <div class="bloco" data-fit="auto"><div class="grande" style="color:${dest}">${esc(l.numero)}</div><h2>${marcar(l.titulo)}</h2>${l.texto ? `<p>${marcar(l.texto)}</p>` : ''}</div>`;
  } else if (l.layout === 'citacao') {
    corpo = `<div class="tela" style="${fundoEscuro}"></div>${elem ? `<div class="elem" style="right:-230px;top:-200px;width:640px;height:660px;opacity:.4"></div>` : ''}<div class="grao"></div>
      <div class="topo">${rotulo}${logoEl}</div>
      <div class="bloco" data-fit="auto"><div class="aspas">“</div><blockquote>${marcar(l.texto || l.titulo)}</blockquote>${l.autor ? `<div class="autor">— ${esc(l.autor)}</div>` : ''}</div>`;
  } else if (l.layout === 'foto') {
    corpo = `<div class="tela" style="${fundoEscuro}"></div>
      <div class="topo">${rotulo}${logoEl}</div>
      <div class="cartao"><img src="${fotoUrl}" style="object-position:${posCartao}"></div>
      <div class="bloco-foto" data-fit="${tipo === 'post' ? 360 : 330}"><h2>${marcar(l.titulo)}</h2>${l.texto ? `<p>${marcar(l.texto)}</p>` : ''}</div>`;
  } else if (l.layout === 'cta') {
    corpo = `<div class="tela" style="${fundoEscuro}"></div>${elem ? `<div class="elem" style="left:50%;top:50%;width:1100px;height:1130px;margin:-565px 0 0 -550px;opacity:.16"></div>` : ''}<div class="grao"></div>
      <div class="cta">
        ${logo ? `<div class="logo-g" style="background:url('${logo}') center/contain no-repeat"></div>` : `<div class="marca-g">${esc(marca.marca)}</div>`}
        <div data-fit="420" class="cta-t"><h2>${marcar(l.titulo)}</h2>${l.texto ? `<p>${marcar(l.texto)}</p>` : ''}</div>
        <div class="botao">${esc(marca.cta)} <b>→</b></div>
        ${marca.arroba ? `<div class="arroba">${esc(marca.arroba)}</div>` : ''}
        ${marca.assinatura ? `<div class="assin">${esc(marca.assinatura)}</div>` : ''}
      </div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontes()}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${c.escuro}}
*{box-sizing:border-box}
#r{position:absolute;inset:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'M',sans-serif;color:${tx};-webkit-font-smoothing:antialiased}
.tela{position:absolute;inset:0}
.elem{position:absolute;background:url('${elem}') center/contain no-repeat}
.grao{position:absolute;inset:0;opacity:.06;background-image:repeating-radial-gradient(circle at 17% 32%, #fff 0 1px, transparent 1px 3px);mix-blend-mode:overlay}
.topo{position:absolute;left:88px;right:88px;top:80px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px;z-index:5}
.rot{display:flex;align-items:center;gap:14px;font-weight:800;font-size:26px;letter-spacing:.2em;color:${dest};white-space:nowrap}
.rot i{display:block;width:12px;height:12px;border-radius:50%;background:${dest};box-shadow:0 0 12px ${dest}}
.logo{width:190px;height:64px;margin-left:auto}
.logo.txt{width:auto;height:auto;font-weight:800;font-size:28px;letter-spacing:.06em;color:${tx}}
em{font-style:italic;color:${dest};font-weight:900}
h1{margin:0;font-weight:900;font-size:108px;line-height:1.0;letter-spacing:-.03em;text-wrap:balance}
h2{margin:0;font-weight:800;font-size:92px;line-height:1.04;letter-spacing:-.025em;text-wrap:balance}
p{margin:40px 0 0;font-weight:500;font-size:46px;line-height:1.38;opacity:.92;text-wrap:pretty}
.capa-t{position:absolute;left:88px;right:88px;z-index:3;color:${c.texto};text-shadow:0 6px 30px rgba(0,0,0,.35)}
.pilha{position:absolute;left:88px;right:88px;z-index:3;color:${c.texto};text-shadow:0 6px 30px rgba(0,0,0,.35)}
.sub2{margin-top:30px;font-weight:600;font-size:40px;line-height:1.3;opacity:.95}
.sub{position:absolute;left:88px;right:88px;z-index:4;font-weight:600;font-size:38px;line-height:1.3;color:${c.texto};opacity:.95;text-shadow:0 3px 16px rgba(0,0,0,.4)}
.cheia{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.vela{position:absolute;inset:0;background:linear-gradient(to bottom, ${c.escuro}b3 0%, ${c.escuro}00 22%, ${c.escuro}00 38%, ${c.escuro}d9 72%, ${c.escuro}f2 100%)}
.pessoa{position:absolute;z-index:4;bottom:0;${recorte?.toca?.esquerda && !recorte?.toca?.direita ? 'left:0' : recorte?.toca?.direita && !recorte?.toca?.esquerda ? 'right:0' : 'left:50%;transform:translateX(-50%)'};max-width:1000px;height:${recorte?.toca?.base === false ? 640 : 700}px;object-fit:contain;object-position:bottom;filter:drop-shadow(0 20px 40px rgba(0,0,0,.35))}
.sombra-base{position:absolute;left:0;right:0;bottom:0;height:420px;z-index:4;background:linear-gradient(to bottom, ${c.escuro}00 0%, ${c.escuro}cc 70%, ${c.escuro}f0 100%)}
.arraste{position:absolute;right:88px;bottom:${carrossel ? 92 : 70}px;z-index:6;font-weight:700;font-size:26px;letter-spacing:.08em;color:${c.texto};opacity:.85}
.arraste b{color:${c.destaque}}
.bloco{position:absolute;left:88px;right:88px;top:190px;bottom:150px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.barra{width:110px;height:10px;border-radius:5px;background:${claro ? c.destaque : c.destaque};margin-bottom:44px}
ol{list-style:none;margin:56px 0 0;padding:0;display:flex;flex-direction:column;gap:34px}
li{display:flex;align-items:center;gap:32px;font-weight:600;font-size:50px;line-height:1.22}
li .num{flex:0 0 88px;height:88px;border-radius:24px;display:flex;align-items:center;justify-content:center;background:${claro ? c.escuro : c.destaque};color:${claro ? c.destaque : c.escuro};font-weight:900;font-size:38px}
.grande{font-weight:900;font-size:340px;line-height:.9;letter-spacing:-.05em;margin:0 0 40px}
.aspas{font-weight:900;font-size:300px;line-height:.6;height:150px;color:${c.destaque}}
blockquote{margin:30px 0 0;font-weight:800;font-style:italic;font-size:84px;line-height:1.12;letter-spacing:-.02em;text-wrap:balance}
.autor{margin-top:44px;font-weight:600;font-size:34px;opacity:.85}
.cartao{position:absolute;left:88px;right:88px;top:184px;height:${tipo === 'post' ? 640 : 660}px;border-radius:40px;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.35);border:3px solid rgba(255,255,255,.18)}
.cartao img{width:100%;height:100%;object-fit:cover}
.bloco-foto{position:absolute;left:88px;right:88px;top:${tipo === 'post' ? 870 : 890}px}
.bloco-foto h2{font-size:64px}.bloco-foto p{font-size:36px;margin-top:22px}
.cta{position:absolute;left:88px;right:88px;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0}
.logo-g{width:420px;height:170px;margin-bottom:70px}
.marca-g{font-weight:900;font-size:64px;letter-spacing:.04em;margin-bottom:60px}
.cta-t h2{font-size:84px}.cta-t p{margin-top:26px}
.botao{margin-top:64px;padding:30px 64px;border-radius:999px;background:${c.destaque};color:${c.escuro};font-weight:900;font-size:40px;letter-spacing:.02em;box-shadow:0 18px 40px rgba(0,0,0,.3)}
.arroba{margin-top:40px;font-weight:700;font-size:34px;opacity:.95}
.assin{margin-top:18px;font-weight:500;font-size:28px;opacity:.75}
.rodape{position:absolute;left:88px;right:88px;bottom:64px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:26px;letter-spacing:.04em;color:${tx};opacity:.8;z-index:6}
.rodape b{color:${dest}}
.prog{position:absolute;left:0;right:0;bottom:0;height:8px;background:${claro ? c.escuro + '1a' : 'rgba(255,255,255,.12)'};z-index:6}
.prog div{height:100%;background:${c.destaque}}
</style></head><body><div id="r">${corpo}${l.layout === 'capa' && carrossel ? '' : rodape}${l.layout === 'capa' && carrossel ? `<div class="prog"><div style="width:${(1 / n) * 100}%"></div></div><div class="rodape"><span>${esc(marca.arroba)}</span><span></span></div>` : ''}</div>
<script>
// ajusta o tamanho do texto para caber na altura reservada (data-fit, em px)
(async () => {
  await document.fonts.ready;
  for (const el of document.querySelectorAll('[data-fit]')) {
    const auto = el.dataset.fit === 'auto';
    const max = auto ? el.clientHeight : Number(el.dataset.fit);
    const alvos = [...el.querySelectorAll('h1,h2,p,li,blockquote,.grande,.sub2')];
    for (let i = 0; i < 40 && (auto ? el.scrollHeight > el.clientHeight + 1 : el.scrollHeight > max); i++) alvos.forEach((a) => { a.style.fontSize = (parseFloat(getComputedStyle(a).fontSize) * 0.95) + 'px'; });
  }
  window.__pronto = true;
})();
</script></body></html>`;
}

// renderiza as lâminas (HTML) em JPG 1080x1350
export async function renderizarLaminas(htmls, dir, { prefixo = 'lamina', log = () => {} } = {}) {
  const { default: puppeteer } = await import('puppeteer-core');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none', '--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage'],
  });
  const saidas = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (const [k, html] of htmls.entries()) {
      const arqHtml = path.join(dir, `${prefixo}-${String(k + 1).padStart(2, '0')}.html`);
      fs.writeFileSync(arqHtml, html);
      await page.goto('file://' + arqHtml, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__pronto === true, { timeout: 20000 });
      const jpg = arqHtml.replace(/\.html$/, '.jpg');
      await page.screenshot({ path: jpg, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
      fs.rmSync(arqHtml, { force: true });
      saidas.push(jpg);
    }
  } finally { await browser.close().catch(() => null); }
  log(`${saidas.length} lâmina(s) renderizada(s)`);
  return saidas;
}

// folha de prévia: todas as lâminas lado a lado (até 5 por linha)
export async function folhaDeLaminas(jpgs, saida) {
  const n = jpgs.length, col = Math.min(5, n), lin = Math.ceil(n / col);
  const tw = 432, th = 540, gap = 16;
  const ins = jpgs.flatMap((j) => ['-i', j]);
  const esc = jpgs.map((_, k) => `[${k}:v]scale=${tw}:${th}[s${k}]`);
  const lay = jpgs.map((_, k) => `${(k % col) * (tw + gap)}_${Math.floor(k / col) * (th + gap)}`).join('|');
  const filtro = n === 1 ? `[0:v]scale=${tw}:${th}[o]` : `${esc.join(';')};${jpgs.map((_, k) => `[s${k}]`).join('')}xstack=inputs=${n}:layout=${lay}:fill=0xEEECE6[o]`;
  await ff([...ins, '-filter_complex', filtro, '-map', '[o]', '-frames:v', '1', '-q:v', '3', saida]);
  return saida;
}
