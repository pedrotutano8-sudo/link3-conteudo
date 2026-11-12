// Corte de pausas a partir da transcrição palavra a palavra.
// Entrada: palavras [{p, i, f}] (texto, início e fim em segundos no bruto).
// Saída: trechos mantidos [[ini, fim]] e as palavras com o tempo já no vídeo cortado.

// só hesitação: "e" e "é" sozinhos são palavras (conjunção e verbo) e ficam
const VICIO = /^(e{2,}h*|eh+|é{2,}|ã+|ah+|ahn+|hum+|hm+|uhm*)$/i;

export function ehVicio(p) {
  return VICIO.test(String(p || '').toLowerCase().replace(/[^\p{L} ]/gu, '').trim());
}

/**
 * @param {Array<{p:string,i:number,f:number}>} palavras
 * @param {object} o
 * @param {number} o.duracao      duração do bruto
 * @param {number} [o.pausa=0.45] silêncio maior que isso é cortado
 * @param {number} [o.respiro=0.12] folga mantida antes/depois da fala
 * @param {boolean} [o.tirarVicios=true] corta "éé", "ahn", "hum"
 */
export function calcularCortes(palavras, { duracao, pausa = 0.35, respiro = 0.1, tirarVicios = true, silencios = [], silencioMin = 0.3, folga = 0.08 } = {}) {
  const fala = (palavras || [])
    .filter((w) => Number.isFinite(w.i) && Number.isFinite(w.f) && w.f >= w.i)
    .filter((w) => !(tirarVicios && ehVicio(w.p)))
    .sort((a, b) => a.i - b.i);
  if (!fala.length) return { trechos: duracao ? [[0, duracao]] : [], palavras: [], duracaoFinal: duracao || 0, cortado: 0 };

  const lim = (t) => Math.max(0, duracao ? Math.min(duracao, t) : t);
  const trechos = [];
  let ini = lim(fala[0].i - respiro), fimAnt = fala[0].f;
  for (const w of fala.slice(1)) {
    if (w.i - fimAnt > pausa) {
      trechos.push([ini, lim(fimAnt + respiro)]);
      ini = lim(w.i - respiro);
    }
    fimAnt = Math.max(fimAnt, w.f);
  }
  trechos.push([ini, lim(fimAnt + respiro)]);

  // junta trechos que se encostaram por causa da folga
  const juntos = [];
  for (const t of trechos) {
    const u = juntos[juntos.length - 1];
    if (u && t[0] <= u[1] + 0.02) u[1] = Math.max(u[1], t[1]);
    else juntos.push([...t]);
  }
  // silêncio medido no áudio dentro da fala (a transcrição costuma "esticar" as palavras por cima das pausas)
  const semSilencio = [];
  for (const [a, b] of juntos) {
    let ini = a;
    for (const [s0, s1] of silencios.filter(([x, y]) => Math.min(y, duracao ?? y) - x >= silencioMin).sort((x, y) => x[0] - y[0])) {
      const c0 = Math.max(s0 + folga, ini), c1 = Math.min((Number.isFinite(s1) ? s1 : b) - folga, b);
      if (c1 - c0 < silencioMin - 2 * folga || c0 >= b || c1 <= ini) continue;
      if (c0 - ini > 0.05) semSilencio.push([ini, c0]);
      ini = c1;
    }
    if (b - ini > 0.05) semSilencio.push([ini, b]);
  }
  const arred = (x) => Math.round(x * 1000) / 1000;
  const final = semSilencio.map(([a, b]) => [arred(a), arred(b)]).filter(([a, b]) => b - a > 0.08);

  // tempo no vídeo cortado
  const inicioNoCorte = [];
  let acc = 0;
  for (const [a, b] of final) { inicioNoCorte.push(acc); acc += b - a; }
  // tempo no vídeo cortado; ponto que caiu num corte vai para a borda mais próxima do trecho mantido
  const mapear = (t, lado) => {
    for (let k = 0; k < final.length; k++) {
      const [a, b] = final[k];
      if (t >= a - 1e-6 && t <= b + 1e-6) return inicioNoCorte[k] + (t - a);
      if (t < a) {
        if (lado === 'inicio') return inicioNoCorte[k];
        return k > 0 ? inicioNoCorte[k] : null;
      }
    }
    return lado === 'fim' && final.length ? acc : null;
  };
  const novas = fala
    .map((w) => ({ p: w.p, i: mapear(w.i, 'inicio'), f: mapear(w.f, 'fim') }))
    .filter((w) => w.i !== null && w.f !== null && w.f - w.i > 0.02)
    .map((w) => ({ p: w.p, i: arred(w.i), f: arred(w.f) }));

  const duracaoFinal = arred(acc);
  return { trechos: final, palavras: novas, duracaoFinal, cortado: duracao ? arred(duracao - duracaoFinal) : 0 };
}
