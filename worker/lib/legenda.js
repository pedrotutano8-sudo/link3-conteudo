// Legenda dinâmica (ASS/libass) no estilo da marca + título de gancho no topo.
// A palavra falada no momento fica destacada na cor principal da marca.

const PADRAO = { posicao: 'baixo', caixa: false, palavras_por_linha: 3, maiusculas: true };

// "#F0C41D" → "&H001DC4F0" (ASS usa AABBGGRR)
export function corAss(hex, alfa = 0) {
  const h = String(hex || '').replace('#', '').trim();
  const ok = /^[0-9a-f]{6}$/i.test(h) ? h : 'FFFFFF';
  const a = Math.round(alfa * 255).toString(16).padStart(2, '0');
  return `&H${a}${ok.slice(4, 6)}${ok.slice(2, 4)}${ok.slice(0, 2)}`.toUpperCase();
}

// cor para troca dentro do texto: {\c&HBBGGRR&}
const corTexto = (hex) => corAss(hex).replace(/^&H00/, '&H') + '&';

const tempo = (s) => {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), seg = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${seg}`;
};
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');

// agrupa palavras em blocos curtos; quebra antes se houver pausa ou pontuação forte
export function agrupar(palavras, porLinha = 3) {
  const grupos = [];
  let atual = [];
  for (const w of palavras) {
    const ant = atual[atual.length - 1];
    if (atual.length && (atual.length >= porLinha || w.i - ant.f > 0.35 || /[.!?]$/.test(ant.p))) { grupos.push(atual); atual = []; }
    atual.push(w);
  }
  if (atual.length) grupos.push(atual);
  return grupos;
}

/**
 * @param {object} o
 * @param {Array<{p,i,f}>} o.palavras  já no tempo do vídeo cortado
 * @param {number} o.duracao
 * @param {object} [o.kit] brand_kit: {cores, estilo_legenda}
 * @param {string} [o.fonte] família da fonte (default DejaVu Sans)
 * @param {string} [o.titulo] título de gancho (mostrado nos primeiros segundos)
 */
export function gerarAss({ palavras = [], duracao, kit = {}, fonte = 'DejaVu Sans', titulo = '', segundosTitulo = 3.5 }) {
  const est = { ...PADRAO, ...(kit.estilo_legenda || {}) };
  const cores = kit.cores || {};
  const texto = corAss(cores.texto || '#FFFFFF');
  const destaque = corTexto(est.destaque || cores.principal || '#F0C41D');
  const textoOv = corTexto(cores.texto || '#FFFFFF');
  const fundoCaixa = corAss(cores.fundo || '#000000', 0.35);
  const fundoTitulo = corAss(cores.principal || '#F0C41D');
  const textoTitulo = corAss(cores.fundo || '#111111');
  const caixa = est.caixa ? 3 : 1; // 3 = caixa atrás do texto, 1 = contorno
  const alinhamento = { baixo: 2, meio: 5, cima: 8 }[est.posicao] || 2;
  const margemV = est.posicao === 'baixo' ? 420 : est.posicao === 'cima' ? 360 : 0;

  const linhas = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Legenda,${fonte},86,${texto},${texto},&H00000000,${fundoCaixa},-1,0,0,0,100,100,0,0,${caixa},${caixa === 3 ? 18 : 7},0,${alinhamento},80,80,${margemV},1`,
    `Style: Titulo,${fonte},72,${textoTitulo},${textoTitulo},${fundoTitulo},${fundoTitulo},-1,0,0,0,100,100,0,0,3,22,0,8,90,90,230,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  if (titulo) {
    const t = est.maiusculas ? titulo.toLocaleUpperCase('pt-BR') : titulo;
    linhas.push(`Dialogue: 1,${tempo(0)},${tempo(Math.min(segundosTitulo, duracao || segundosTitulo))},Titulo,,0,0,0,,{\\fad(0,250)}${esc(t)}`);
  }

  const grupos = agrupar(palavras, Number(est.palavras_por_linha) || 3);
  grupos.forEach((g, gi) => {
    const fimGrupo = Math.min(gi + 1 < grupos.length ? grupos[gi + 1][0].i : g[g.length - 1].f + 0.4, duracao ?? Infinity);
    g.forEach((w, wi) => {
      const ini = wi === 0 ? g[0].i : w.i;
      const fim = wi + 1 < g.length ? g[wi + 1].i : fimGrupo;
      if (fim - ini < 0.02) return;
      const txt = g.map((x, k) => {
        const p = esc(est.maiusculas ? x.p.toLocaleUpperCase('pt-BR') : x.p);
        return k === wi ? `{\\c${destaque}}${p}{\\c${textoOv}}` : p;
      }).join(' ');
      linhas.push(`Dialogue: 0,${tempo(ini)},${tempo(fim)},Legenda,,0,0,0,,${txt}`);
    });
  });
  return linhas.join('\n') + '\n';
}
