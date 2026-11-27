// Estilo "editorial" das lâminas (design.json com "estilo": "editorial"): visual sóbrio de escritório/consultoria,
// no padrão dos carrosséis aprovados da Vidal & Lopes (Link 3):
// - fundo claro com arcos e fundo escuro petróleo com faixas diagonais, alternados;
// - imagem gerada por IA em quase toda lâmina: cena (foto) que se funde no fundo ou objeto recortado (Têmis, dinheiro…);
// - destaque em caixa (*texto*), negrito no corpo (**texto**), traço curto, seta fina, lista com ícones ligados por linha;
// - logo no topo das lâminas claras e no fim.
import { W, H, esc, marcar, dataUrl, fontes } from './carrossel.js';

const paragrafos = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${marcar(x)}</p>`).join('');

// ícones de linha (24x24) para itens de lista; a IA escolhe pelo nome
export const ICONES = {
  documento: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 12h6M10 16h6"/>',
  contrato: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 9h7M9 13h7M9 17h3"/>',
  casa: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',
  dinheiro: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  balanca: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 6c0 1.7 1.3 3 3 3s3-1.3 3-3zM19 7l-3 6c0 1.7 1.3 3 3 3s3-1.3 3-3z"/>',
  escudo: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  familia: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M2 20c0-3.6 2.7-6 6-6s6 2.4 6 6M13 20c.2-2.8 1.8-4.6 4-4.6s3.8 1.8 4 4.6"/>',
  presente: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9zM12 9c2-4 6-4 6-1.5S14 9 12 9z"/>',
  alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  chave: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  maleta: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
  cartao: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  grafico: '<path d="M4 20V10M10 20V5M16 20v-8M22 20H2"/>',
  pergunta: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5"/>',
};

const icone = (nome, cor) => `<svg viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome] || ICONES.check}</svg>`;

// lâmina escura ou clara (a mesma regra decide o formato da imagem gerada: foto de fundo inteira na escura, faixa larga na clara)
export function laminaEscura(l, k, n, tipo, temCena) {
  const post = tipo === 'post' || n === 1;
  return post ? Boolean(temCena) : ['capa', 'cta'].includes(l.layout) ? false : k % 2 === 1;
}

export function montarEditorial({ lamina: l, k, n, tipo = 'carrossel', marca, imagens = {} }) {
  const c = {
    escuro: '#21434C', escuro2: '#2F5560', claro: '#F3F4F6', tinta: '#26363C', corpo: '#3E4B50', arco: '#E2E6E9',
    caixa: '#2C4A53', caixaTexto: '#FFFFFF', linha: '#8FA6AC', ...(marca.cores || {}),
  };
  const post = tipo === 'post' || n === 1;
  const ultimo = k === n - 1;
  const img = imagens[k] ? { ...imagens[k], url: dataUrl(imagens[k].arquivo) } : null;
  const cena = img?.url && img.tipo === 'cena' ? img : null;
  const objeto = img?.url && img.tipo === 'objeto' ? img : null;
  // capa e cta claros; miolo alterna (2ª escura, 3ª clara...); post: escuro com foto, claro sem
  const escuro = laminaEscura(l, k, n, tipo, cena);
  const tx = escuro ? '#FFFFFF' : c.tinta;
  const corpoCor = escuro ? 'rgba(255,255,255,.92)' : c.corpo;
  const caixa = escuro ? c.claro : c.caixa;
  const caixaTx = escuro ? c.escuro : c.caixaTexto;
  const logo = dataUrl(marca.logo);
  const logoEl = (w, h, extra = '') => (logo
    ? `<div class="logo" style="width:${w}px;height:${h}px;${extra};${escuro ? `background:url('${logo}') left center/contain no-repeat` : `background:${c.tinta};-webkit-mask:url('${logo}') left center/contain no-repeat`}"></div>`
    : `<div class="logo-txt" style="${extra}">${esc(marca.marca)}</div>`);

  // fundos
  const arcos = `<div class="anel" style="right:-360px;top:-380px;width:900px;height:900px;border-width:110px;border-color:${c.arco}"></div>
       <div class="anel" style="right:-160px;top:-180px;width:500px;height:500px;border-width:46px;border-color:${c.arco}"></div>
       <div class="anel" style="left:-380px;bottom:-420px;width:760px;height:760px;border-width:80px;border-color:${c.arco}"></div>`;
  const faixas = `<div class="faixas"><i></i><i></i><i></i></div>`;
  let fundo;
  if (escuro) {
    fundo = cena
      ? `<img class="cheia" src="${cena.url}"><div class="tela" style="background:linear-gradient(180deg, ${c.escuro}eb 0%, ${c.escuro}d6 50%, ${c.escuro2}bf 100%)"></div>${faixas}`
      : `<div class="tela" style="background:linear-gradient(160deg, ${c.escuro2} 0%, ${c.escuro} 55%, ${c.escuro} 100%)"></div>${faixas}
         <div class="anel" style="right:-420px;bottom:-460px;width:980px;height:980px;border-width:120px;border-color:rgba(255,255,255,.04)"></div>`;
  } else {
    fundo = `<div class="tela" style="background:${c.claro}"></div>${arcos}`;
  }
  // imagem sobre fundo claro: cena embaixo, fundindo no fundo; objeto à direita (com fita da marca na capa)
  const cenaClara = (alt) => (cena && !escuro
    ? `<div class="cena-baixo" style="height:${alt}px"><img src="${cena.url}"><div class="funde" style="background:linear-gradient(180deg, ${c.claro} 0%, ${c.claro}cc 12%, ${c.claro}00 45%)"></div></div>` : '');
  const fita = `<svg class="fita" viewBox="0 0 1080 1350" preserveAspectRatio="none"><path d="M800 -60 C 560 200, 1000 420, 760 700 S 560 1150, 820 1420" fill="none" stroke="${c.escuro}" stroke-width="150" stroke-linecap="round"/><path d="M980 -60 C 800 160, 1140 380, 940 640" fill="none" stroke="${c.arco}" stroke-width="64" stroke-linecap="round"/></svg>`;
  const objetoEl = (altura, extra = '') => (objeto ? `<img class="objeto" src="${objeto.url}" style="height:${altura}px;${extra};${escuro ? '' : 'mix-blend-mode:multiply'}">` : '');

  const seta = `<div class="seta"><b></b></div>`;
  const chevron = `<svg class="chev" viewBox="0 0 40 30"><path d="M3 3l11 12-11 12M19 3l11 12-11 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const comCenaClara = Boolean(cena && !escuro);
  const pag = !post && n > 1 && l.layout !== 'capa' && !ultimo && !comCenaClara ? `<div class="pag">${String(k + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</div>` : '';
  // com objeto à direita o texto fica na coluna da esquerda
  const coluna = objeto ? 'right:440px' : '';

  let corpo = '';
  if (post) {
    corpo = `${fundo}${objetoEl(820, 'right:-40px;bottom:0')}
      <div class="miolo" data-fit="auto" style="top:150px;bottom:330px;${coluna}">
        <h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub">${marcar(l.subtitulo)}</div>` : ''}<div class="traco"></div>
        <div class="txt">${paragrafos(l.texto)}</div>
      </div>
      ${logoEl(330, 190, 'position:absolute;left:96px;bottom:96px;z-index:5')}`;
  } else if (l.layout === 'capa') {
    if (cena) {
      corpo = `${fundo}${cenaClara(660)}
        ${logoEl(230, 132, 'position:absolute;left:96px;top:84px;z-index:5')}
        <div class="miolo capa" data-fit="auto" style="top:270px;bottom:600px;justify-content:flex-start">
          <h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub">${marcar(l.subtitulo)}</div>` : ''}<div class="traco"></div>
        </div>`;
    } else {
      corpo = `${fundo}${objeto ? fita : ''}${objetoEl(960, 'right:-60px;bottom:40px')}
        ${logoEl(230, 132, 'position:absolute;left:96px;top:84px;z-index:5')}
        <div class="miolo capa" data-fit="auto" style="top:300px;bottom:190px;${coluna}">
          <h1>${marcar(l.titulo)}</h1>${l.subtitulo ? `<div class="sub">${marcar(l.subtitulo)}</div>` : ''}<div class="traco"></div>
          ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
        </div>`;
    }
    corpo += `<div class="arraste" style="${cena ? 'color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)' : ''}">Arraste para o lado <b>→</b></div>`;
  } else if (l.layout === 'cta') {
    corpo = `${fundo}${cenaClara(560)}${objetoEl(1080, 'right:-80px;bottom:0')}
      <div class="miolo" data-fit="auto" style="top:${cena ? 300 : 150}px;bottom:${cena ? 580 : 400}px;${coluna}">
        <h2>${marcar(l.titulo)}</h2><div class="traco"></div>
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
      </div>
      ${logoEl(cena ? 230 : 300, cena ? 132 : 172, `position:absolute;left:96px;${cena ? 'top:84px' : 'bottom:150px'};z-index:5`)}
      ${marca.arroba && !cena ? `<div class="arroba">${esc(marca.arroba)}</div>` : ''}`;
  } else {
    let miolo;
    if (l.layout === 'lista') {
      const icones = Array.isArray(l.icones) ? l.icones : [];
      miolo = `<h2>${escuro ? chevron : ''}${marcar(l.titulo)}</h2>${seta}
        ${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}
        <ol>${l.itens.map((i, j) => `<li><span class="num">${icones[j] ? icone(icones[j], tx) : `<b>${j + 1}</b>`}</span><span class="it">${marcar(i.replace(/[;.]$/, ''))}</span></li>`).join('')}</ol>`;
    } else if (l.layout === 'numero') {
      miolo = `<div class="grande">${esc(l.numero)}</div><h2>${marcar(l.titulo)}</h2>${seta}${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}`;
    } else if (l.layout === 'citacao') {
      miolo = `<div class="aspas">“</div><h2 class="cit">${marcar(l.texto || l.titulo)}</h2>${l.autor ? `<div class="autor">${esc(l.autor)}</div>` : ''}`;
    } else {
      miolo = `<h2>${escuro ? chevron : ''}${marcar(l.titulo)}</h2>${seta}${l.texto ? `<div class="txt">${paragrafos(l.texto)}</div>` : ''}`;
    }
    corpo = `${fundo}${cenaClara(600)}${objetoEl(escuro ? 640 : 700, 'right:-50px;bottom:0')}
      ${!escuro ? logoEl(190, 108, 'position:absolute;left:96px;top:84px;z-index:5') : ''}
      <div class="miolo" data-fit="auto" style="top:${escuro ? 150 : 250}px;bottom:${comCenaClara ? 580 : 150}px;${coluna}">${miolo}</div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontes()}
html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${escuro ? c.escuro : c.claro}}
*{box-sizing:border-box}
#r{position:absolute;inset:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'M',sans-serif;color:${tx};-webkit-font-smoothing:antialiased}
.tela{position:absolute;inset:0}
.cheia{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(.7)}
.anel{position:absolute;border-radius:50%;border-style:solid}
.faixas{position:absolute;right:-60px;top:-80px;width:520px;height:520px;transform:rotate(35deg);display:flex;gap:46px;justify-content:flex-end}
.faixas i{display:block;width:34px;height:760px;background:rgba(255,255,255,.07)}
.faixas i:nth-child(2){background:rgba(255,255,255,.05)}.faixas i:nth-child(3){background:rgba(255,255,255,.035)}
.cena-baixo{position:absolute;left:0;right:0;bottom:0;z-index:1}
.cena-baixo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 40%}
.funde{position:absolute;inset:0}
.fita{position:absolute;inset:0;width:100%;height:100%;z-index:1}
.objeto{position:absolute;z-index:2;width:auto;max-width:660px;object-fit:contain;object-position:bottom right;filter:drop-shadow(0 24px 40px rgba(0,0,0,.18))}
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
ol:before{content:'';position:absolute;left:47px;top:48px;bottom:48px;width:2px;background:${escuro ? 'rgba(255,255,255,.3)' : '#D3D9DD'}}
li{display:flex;align-items:center;gap:34px;font-weight:600;font-size:46px;line-height:1.28;color:${tx};position:relative}
li .num{flex:0 0 96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${escuro ? '#355A64' : '#E4E8EB'};border:2px solid ${escuro ? 'rgba(255,255,255,.35)' : '#D3D9DD'};color:${tx};font-weight:800;font-size:36px;position:relative;z-index:1}
li .num svg{width:52px;height:52px}
.grande{white-space:nowrap;font-weight:800;font-size:230px;line-height:.9;letter-spacing:-.04em;margin:0 0 30px;color:${escuro ? '#FFFFFF' : c.caixa}}
.aspas{font-weight:800;font-size:260px;line-height:.6;height:120px;color:${escuro ? 'rgba(255,255,255,.5)' : c.linha}}
h2.cit{font-weight:700;font-size:68px;line-height:1.24}
.autor{margin-top:36px;font-weight:600;font-size:34px;color:${corpoCor}}
.arraste{position:absolute;right:96px;bottom:84px;font-weight:600;font-size:28px;letter-spacing:.03em;color:${c.tinta};opacity:.9;z-index:6}
.arraste b{font-weight:800}
.pag{position:absolute;right:96px;bottom:70px;font-weight:600;font-size:26px;letter-spacing:.08em;color:${escuro ? 'rgba(255,255,255,.6)' : c.linha};z-index:6}
.arroba{position:absolute;left:96px;bottom:96px;font-weight:600;font-size:30px;color:${c.tinta};opacity:.8;z-index:5}
</style></head><body><div id="r">${corpo}${pag}</div>
<script>
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((ok) => { i.onload = i.onerror = ok; }))));
  for (const g of document.querySelectorAll('.grande')) {
    for (let i = 0; i < 40 && g.scrollWidth > g.parentElement.clientWidth + 1; i++) g.style.fontSize = (parseFloat(getComputedStyle(g).fontSize) * 0.94) + 'px';
  }
  for (const el of document.querySelectorAll('[data-fit]')) {
    const alvos = [...el.querySelectorAll('h1,h2,p,li,.sub,.grande')];
    for (let i = 0; i < 40 && el.scrollHeight > el.clientHeight + 1; i++) alvos.forEach((a) => { a.style.fontSize = (parseFloat(getComputedStyle(a).fontSize) * 0.95) + 'px'; });
  }
  window.__pronto = true;
})();
</script></body></html>`;
}
