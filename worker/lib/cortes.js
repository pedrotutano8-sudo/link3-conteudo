// Corte de pausas a partir da transcrição palavra a palavra.
// Entrada: palavras [{p, i, f}] (texto, início e fim em segundos no bruto).
// Saída: trechos mantidos [[ini, fim]] e as palavras com o tempo já no vídeo cortado.

// só hesitação: "e" e "é" sozinhos são palavras (conjunção e verbo) e ficam
const VICIO = /^(e{2,}h*|eh+|é{2,}|ã+|ah+|ahn+|hum+|hm+|uhm*)$/i;

export function ehVicio(p) {
  return VICIO.test(String(p || '').toLowerCase().replace(/[^\p{L} ]/gu, '').trim());
}

// repetição que o editor sempre corta, sem depender da IA:
// · palavra/expressão repetida colada ("pela pela", "a gente a gente", "que eu que eu") → sai a 1ª
// · palavra interrompida ("tra-", "conec—") → sai
// Repetição enfática fica ("muito, muito", "não, não"), e nada atravessa fim de frase.
const ENFASE = new Set(['muito', 'bem', 'sim', 'não', 'já', 'mais', 'cada', 'pouco', 'bom']);
const normal = (p) => String(p || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); // acento conta: "e é" não é repetição
export function repeticoes(palavras) {
  const fora = new Set();
  const n = palavras.length;
  const fimFrase = (k) => /[.!?…]$/.test(String(palavras[k]?.p || '').trim());
  for (let k = 0; k < n; k++) if (/[-—–]$/.test(String(palavras[k].p).trim()) && normal(palavras[k].p)) fora.add(k);
  for (let tam = 4; tam >= 1; tam--) {
    for (let k = 0; k + 2 * tam <= n; k++) {
      let igual = true;
      for (let m = 0; m < tam && igual; m++) {
        const a = normal(palavras[k + m].p), b = normal(palavras[k + tam + m].p);
        if (!a || a !== b) igual = false;
      }
      if (!igual) continue;
      if (fimFrase(k + tam - 1)) continue;                                  // "...isso. Isso é..." não é gagueira
      if (tam === 1 && ENFASE.has(normal(palavras[k].p))) continue;
      if (palavras[k + tam].i - palavras[k + tam - 1].f > 1.5) continue;    // longe demais: é outro take (fica com a IA)
      for (let m = 0; m < tam; m++) fora.add(k + m);
    }
  }
  return fora;
}

/**
 * @param {Array<{p:string,i:number,f:number}>} palavras
 * @param {object} o
 * @param {number} o.duracao      duração do bruto
 * @param {number} [o.pausa=0.45] silêncio maior que isso é cortado
 * @param {number} [o.respiro=0.12] folga mantida antes/depois da fala
 * @param {boolean} [o.tirarVicios=true] corta "éé", "ahn", "hum"
 */
// núcleo da palavra (a transcrição acerta o início e costuma esticar o fim): silêncio do áudio nunca corta aqui
const nucleo = (w) => [w.i, w.i + Math.min(w.f - w.i, Math.max(0.22, 0.07 * String(w.p).length + 0.1))];

function subtrair(trechos, cortes, { minimo = 0, folga = 0 } = {}) {
  const saida = [];
  const lista = cortes.filter(([a, b]) => b - a >= minimo).map(([a, b]) => [a + folga, b - folga]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  for (const [a, b] of trechos) {
    let ini = a;
    for (const [c0, c1] of lista) {
      if (c1 <= ini || c0 >= b) continue;
      if (c0 - ini > 0.05) saida.push([ini, c0]);
      ini = Math.max(ini, c1);
    }
    if (b - ini > 0.05) saida.push([ini, b]);
  }
  return saida;
}

// silêncios do áudio que podem sair: o tempo das palavras da transcrição é impreciso (o Parakeet chega a marcar a
// palavra 0,5 s antes de ela ser dita, dentro da pausa — medido no vídeo da Fernanda), então vale o áudio.
// O detector já ignora estalos de até 120 ms e usa limite adaptado ao ruído da sala, então fala baixa não vira pausa.
// Margens: 0,12 s depois da fala e 0,08 s antes (sobra 0,2 s no meio da frase); em fim de frase 0,22 + 0,13 (sobra 0,35 s).
function silenciosLivres(silencios, fala, duracao, { minimo = 0.3, depois = 0.12, antes = 0.08 } = {}) {
  return silencios
    .map(([a, b]) => [a, Number.isFinite(b) ? b : duracao ?? a + 1000])
    .filter(([a, b]) => b - a >= minimo)
    .map(([a, b]) => {
      // fim de frase (ponto) ganha respiro maior, como num corte de editor; no meio da frase o corte é curto
      const ant = [...fala].reverse().find((w) => w.i < a);
      const fimFrase = ant && /[.!?…]$/.test(String(ant.p).trim());
      const d = fimFrase ? depois + 0.1 : depois, x = fimFrase ? antes + 0.05 : antes;
      return [a === 0 ? 0 : a + d, duracao && b >= duracao - 0.01 ? b : b - x];
    })
    .filter(([a, b]) => b - a > 0.05);
}

// borda de trecho que caiu perto de uma pausa real do áudio é puxada para a pausa (a transcrição erra a borda da palavra)
function alinharNoAudio(trechos, silencios, { raio = 0.3, depois = 0.15, antes = 0.1 } = {}) {
  if (!silencios.length) return trechos;
  return trechos.map(([ini, fim]) => {
    const fimFala = silencios.map(([a]) => a).filter((a) => Math.abs(a - fim) <= raio && a > ini).sort((x, y) => Math.abs(x - fim) - Math.abs(y - fim))[0];
    const iniFala = silencios.map(([, b]) => b).filter((b) => Number.isFinite(b) && Math.abs(b - ini) <= raio && b < fim).sort((x, y) => Math.abs(x - ini) - Math.abs(y - ini))[0];
    return [iniFala !== undefined ? Math.max(0, iniFala - antes) : ini, fimFala !== undefined ? fimFala + depois : fim];
  }).filter(([a, b]) => b - a > 0.08);
}

export function calcularCortes(palavras, { duracao, pausa = 0.35, respiro = 0.1, tirarVicios = true, silencios = [], silencioMin = 0.3, cortesForcados = [] } = {}) {
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
  const alinhados = alinharNoAudio(juntos, silencios.filter(([a, b]) => (Number.isFinite(b) ? b : Infinity) - a >= 0.15));
  const semSilencio = subtrair(alinhados, silenciosLivres(silencios, fala, duracao, { minimo: silencioMin }));
  // trechos que a revisão mandou tirar (repetição, muleta, recomeço) saem sem folga
  const semForcados = subtrair(semSilencio, cortesForcados);
  const arred = (x) => Math.round(x * 1000) / 1000;
  // pedaço sem nenhuma palavra dentro (sobra de borda ou de outro take) sai: vira um "piscar" sem sentido no vídeo
  const temFala = ([a, b]) => fala.some((w) => (w.i + w.f) / 2 >= a && (w.i + w.f) / 2 <= b);
  const final = semForcados.map(([a, b]) => [arred(a), arred(b)]).filter(([a, b]) => b - a > 0.08).filter((t) => temFala(t));

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
