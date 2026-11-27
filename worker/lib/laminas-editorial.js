// Estilo "editorial" das lâminas (design.json com "estilo": "editorial"): visual sóbrio de escritório/consultoria.
// Fundo claro com arcos e fundo escuro com faixas diagonais, alternados; títulos fortes, destaque em caixa,
// negrito no corpo, traço curto e seta fina. Feito a partir dos carrosséis aprovados da Vidal & Lopes (Link 3).
import { W, H, esc, marcar, dataUrl, fontes } from './carrossel.js';

const paragrafos = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${marcar(x)}</p>`).join('');

export function montarEditorial({ lamina: l, k, n, tipo = 'carrossel', marca }) {
  const c = {
    escuro: '#21434C', escuro2: '#2F5560', claro: '#F3F4F6', tinta: '#26363C', corpo: '#3E4B50', arco: '#E2E6E9',
    caixa: '#2C4A53', caixaTexto: '#FFFFFF', linha: '#8FA6AC', ...(marca.cores || {}),
  };
  const post = tipo === 'post' || n === 1;
  const ultimo = k === n - 1;
  // capa e cta claros; miolo alterna (2ª escura, 3ª clara...); post estático escuro
  const escuro = post ? true : ['capa', 'cta'].includes(l.layout) ? false : k % 2 === 1;
  const tx = escuro ? '#FFFFFF' : c.tinta;
  const corpoCor = escuro ? 'rgba(255,255,255,.9)' : c.corpo;
  const caixa = escuro ? c.claro : c.caixa;
  const caixaTx = escuro ? c.escuro : c.caixaTexto;
  const logo = dataUrl(marca.logo);
  const logoEl = (w, h, extra = '') => (logo
    ? `<div class="logo" style="width:${w}px;height:${h}px;${extra};${escuro ? `background:url('${logo}') left center/contain no-repeat` : `background:${c.tinta};-webkit-mask:url('${logo}') left center/contain no-repeat`}"></div>`
    : `<div class="logo-txt" style="${extra}">${esc(marca.marca)}</div>`);

  const fundo = escuro
    ? `<div class="tela" style="background:linear-gradient(160deg, ${c.escuro2} 0%, ${c.escuro} 55%, ${c.escuro} 100%)"></div>
       <div class="faixas"><i></i><i></i><i></i></div>
       <div class="anel" style="right:-420px;bottom:-460px;width:980px;height:980px;border-width:120px;border-color:rgba(255,255,255,.04)"></div>`
    : `<div class="tela" style="background:${c.claro}"></div>
       <div class="anel" style="right:-360px;top:-380px;width:900px;height:900px;border-width:110px;border-color:${c.arco}"></div>
       <div class="anel" style="right:-160px;top:-180px;width:500px;height:500px;border-width:46px;border-color:${c.arco}"></div>
       <div class="anel" style="left:-380px;bottom:-420px;width:760px;height:760px;border-width:80px;border-color:${c.arco}"></div>`;

  const seta = `<div class="seta"><b></b><i></i></div>`;
  const chevron = `<svg class="chev" viewBox="0 0 40 30"><path d="M3 3l11 12-11 12M19 3l11 12-11 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const pag = !post && n > 1 ? `<div class="pag">${String(k + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</div>` : '';

  let corpo = '';
  if (post) {
    corpo = `${fundo}
      <div class="miolo" data-fit="auto" style="top:150px;bottom:330px">
        <h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub">${marcar(l.subtitulo)}</div>` : ''}<div class="traco"></div>
        <div class="txt">${paragrafos(l.texto)}</div>
      </div>
      ${logoEl(330, 190, 'position:absolute;left:96px;bottom:96px')}`;
  } else if (l.layout === 'capa') {
    corpo = `${fundo}
      ${logoEl(230, 132, 'position:absolute;left:96px;top:92px')}
      <div class="miolo capa" data-fit="auto" style="top:300px;bottom:190px">
        <h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub">${marcar(l.subtitulo)}</div>` : ''}<div class="traco"></div>
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
      </div>
      <div class="arraste">Arraste para o lado <b>→</b></div>`;
  } else if (l.layout === 'lista') {
    corpo = `${fundo}
      <div class="miolo" data-fit="auto">
        <h2>${escuro ? chevron : ''}${marcar(l.titulo)}</h2>${seta}
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
        <ol>${l.itens.map((i, j) => `<li><span class="num">${j + 1}</span><span class="it">${marcar(i.replace(/[;.]$/, ''))}</span></li>`).join('')}</ol>
      </div>`;
  } else if (l.layout === 'numero') {
    corpo = `${fundo}
      <div class="miolo" data-fit="auto">
        <div class="grande">${esc(l.numero)}</div><h2>${marcar(l.titulo)}</h2>${seta}
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
      </div>`;
  } else if (l.layout === 'citacao') {
    corpo = `${fundo}
      <div class="miolo" data-fit="auto">
        <div class="aspas">“</div><h2 class="cit">${marcar(l.texto || l.titulo)}</h2>${l.autor ? `<div class="autor">${esc(l.autor)}</div>` : ''}
      </div>`;
  } else if (l.layout === 'cta') {
    corpo = `${fundo}
      <div class="miolo" data-fit="auto" style="top:150px;bottom:400px">
        <h2>${marcar(l.titulo)}</h2><div class="traco"></div>
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
      </div>
      ${logoEl(300, 172, 'position:absolute;left:96px;bottom:150px')}
      ${marca.arroba ? `<div class="arroba">${esc(marca.arroba)}</div>` : ''}`;
  } else {
    // texto (e foto sem foto)
    corpo = `${fundo}
      <div class="miolo" data-fit="auto">
        <h2>${escuro ? chevron : ''}${marcar(l.titulo)}</h2>${seta}
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
      </div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontes()}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${escuro ? c.escuro : c.claro}}
*{box-sizing:border-box}
#r{position:absolute;inset:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'M',sans-serif;color:${tx};-webkit-font-smoothing:antialiased}
.tela{position:absolute;inset:0}
.anel{position:absolute;border-radius:50%;border-style:solid}
.faixas{position:absolute;right:-60px;top:-80px;width:520px;height:520px;transform:rotate(35deg);display:flex;gap:46px;justify-content:flex-end}
.faixas i{display:block;width:34px;height:760px;background:rgba(255,255,255,.07)}
.faixas i:nth-child(2){background:rgba(255,255,255,.05)}.faixas i:nth-child(3){background:rgba(255,255,255,.035)}
.logo-txt{font-weight:800;font-size:34px;letter-spacing:.08em;color:${tx}}
.miolo{position:absolute;left:96px;right:110px;top:150px;bottom:150px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;z-index:3}
h1{margin:0;font-weight:800;font-size:96px;line-height:1.1;letter-spacing:-.02em;color:${tx};text-wrap:balance}
h2{margin:0;font-weight:800;font-size:76px;line-height:1.14;letter-spacing:-.015em;color:${tx};text-wrap:balance}
h2 .chev{display:inline-block;width:52px;height:40px;margin:0 22px 6px 0;vertical-align:middle;color:${tx}}
em{font-style:normal;font-weight:inherit;background:${caixa};color:${caixaTx};padding:.02em .2em .06em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
strong{font-weight:700;color:${escuro ? '#FFFFFF' : c.tinta}}
.sub{margin-top:36px;font-weight:600;font-size:48px;line-height:1.32;color:${tx}}
.sub em{font-weight:700}
.traco{width:90px;height:5px;background:${escuro ? 'rgba(255,255,255,.75)' : c.tinta};margin-top:44px;flex:0 0 auto}
.seta{position:relative;width:250px;height:2px;background:${escuro ? 'rgba(255,255,255,.8)' : c.linha};margin-top:40px;flex:0 0 auto}
.seta b{position:absolute;right:-2px;top:-7px;width:16px;height:16px;border-top:2px solid ${escuro ? 'rgba(255,255,255,.8)' : c.linha};border-right:2px solid ${escuro ? 'rgba(255,255,255,.8)' : c.linha};transform:rotate(45deg)}
.txt{margin-top:46px}
p{margin:0 0 34px;font-weight:500;font-size:44px;line-height:1.42;color:${corpoCor};text-wrap:pretty}
p:last-child{margin-bottom:0}
p em{font-weight:700}
ol{list-style:none;margin:48px 0 0;padding:0;display:flex;flex-direction:column;gap:30px;position:relative}
ol:before{content:'';position:absolute;left:41px;top:40px;bottom:40px;width:2px;background:${escuro ? 'rgba(255,255,255,.25)' : c.arco}}
li{display:flex;align-items:center;gap:34px;font-weight:600;font-size:46px;line-height:1.28;color:${tx};position:relative}
li .num{flex:0 0 84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${escuro ? '#355A64' : '#E4E8EB'};border:2px solid ${escuro ? 'rgba(255,255,255,.35)' : '#D3D9DD'};color:${tx};font-weight:800;font-size:36px}
.grande{font-weight:800;font-size:260px;line-height:.9;letter-spacing:-.04em;margin:0 0 30px;color:${escuro ? '#FFFFFF' : c.caixa}}
.aspas{font-weight:800;font-size:260px;line-height:.6;height:120px;color:${escuro ? 'rgba(255,255,255,.5)' : c.linha}}
h2.cit{font-weight:700;font-size:68px;line-height:1.24}
.autor{margin-top:36px;font-weight:600;font-size:34px;color:${corpoCor}}
.arraste{position:absolute;right:96px;bottom:84px;font-weight:600;font-size:28px;letter-spacing:.03em;color:${c.tinta};opacity:.75;z-index:4}
.arraste b{font-weight:800}
.pag{position:absolute;right:96px;bottom:70px;font-weight:600;font-size:26px;letter-spacing:.08em;color:${escuro ? 'rgba(255,255,255,.6)' : c.linha};z-index:4}
.arroba{position:absolute;left:96px;bottom:96px;font-weight:600;font-size:30px;color:${c.tinta};opacity:.8;z-index:4}
</style></head><body><div id="r">${corpo}${l.layout === 'capa' || ultimo ? '' : pag}</div>
<script>
(async () => {
  await document.fonts.ready;
  for (const el of document.querySelectorAll('[data-fit]')) {
    const alvos = [...el.querySelectorAll('h1,h2,p,li,.sub,.grande')];
    for (let i = 0; i < 40 && el.scrollHeight > el.clientHeight + 1; i++) alvos.forEach((a) => { a.style.fontSize = (parseFloat(getComputedStyle(a).fontSize) * 0.95) + 'px'; });
  }
  window.__pronto = true;
})();
</script></body></html>`;
}

