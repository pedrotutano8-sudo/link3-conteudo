// Pedidos visuais escritos no campo "Ajuste" (ou no comando do pedido), no modelo que a equipe recebe:
//   RITMO: deixa as transições mais rápidas e dinâmicas.
//   PALAVRAS-CHAVE: coloca as palavras "resultado", "equipe" e "27 anos" passando por trás dele.
// Esses pedidos não vão para a IA de cortes (ela só mexe na fala); viram opções da camada de design
// e ficam guardados no roteiro, valendo nos próximos ajustes até alguém pedir o contrário.

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ROTULO_RITMO = /^\s*(ritmo|transi[cç](ao|oes|ão|ões))\s*:/i;
const ROTULO_ATRAS = /^\s*(palavras?[\s-]*chaves?|texto atr[aá]s)\s*:/i;

// devolve só o que foi pedido: { ritmo?: 'dinamico'|'normal', atras?: string[]|'auto'|false }
// soRotulo: só linhas que começam com RITMO: / PALAVRAS-CHAVE: (o comando do pedido pode trazer o roteiro inteiro,
// e um roteiro que fala de "transição" não é pedido de ritmo)
export function lerPedidoVisual(texto, { soRotulo = false } = {}) {
  const out = {};
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const l = sem(linha);
    if (!l.trim()) continue;
    const ehRitmo = ROTULO_RITMO.test(linha) || (!soRotulo && /(transic|ritmo)/.test(l));
    if (ehRitmo) {
      if (/(calm|lent|menos dinam|tira.{0,20}(dinam|efeito)|sem efeito|normal|tranquil)/.test(l)) out.ritmo = 'normal';
      else if (/(dinam|rapid|acelera|energi|agil|mais efeito|ritmo)/.test(l)) out.ritmo = 'dinamico';
    }
    const ehAtras = ROTULO_ATRAS.test(linha) || (!soRotulo && /(atras d|por tras|passando atras|atras da pessoa|(texto|palavra)s?.{0,15}(atras|de tras))/.test(l));
    if (ehAtras) {
      if (/^\s*(palavras?[\s-]*chaves?|texto atras)\s*:\s*(sem|nenhuma|tira|remove|desliga)/.test(l) || /(sem|tira|remove|nao quero).{0,25}(palavra|texto).{0,25}(atras|tras)/.test(l)) { out.atras = false; continue; }
      const aspas = [...String(linha).matchAll(/["“”']([^"“”']{1,40})["“”']/g)].map((m) => m[1].trim()).filter((p) => p && !/^\[.*\]$/.test(p) && !/^palavra \d$/i.test(p));
      out.atras = aspas.length ? [...new Set(aspas)].slice(0, 4) : 'auto';
    }
  }
  return out;
}

// tira do ajuste as linhas que são só visuais (a IA de cortes não deve tentar aplicá-las na fala)
export function semLinhasVisuais(texto, { soRotulo = false } = {}) {
  return String(texto || '').split(/\r?\n/).filter((linha) => {
    if (ROTULO_RITMO.test(linha) || ROTULO_ATRAS.test(linha)) return false;
    if (soRotulo) return true;
    const p = lerPedidoVisual(linha);
    return !('ritmo' in p) && !('atras' in p);
  }).join('\n').trim();
}

// o novo pedido vale por cima do que já estava guardado
export function mesclarVisual(...partes) {
  const v = {};
  for (const p of partes) if (p && typeof p === 'object') Object.assign(v, p);
  return v;
}

// opções efetivas para a edição: ficha da marca (padrão) + pedido do reel (manda)
export function opcoesVisuais(el = {}, visual = {}) {
  const ritmo = visual.ritmo ? visual.ritmo === 'dinamico' : Boolean(el.ritmo);
  let atras = null;
  if (Array.isArray(visual.atras) && visual.atras.length) atras = visual.atras;
  else if (visual.atras === 'auto' || (visual.atras !== false && el.atras)) atras = 'auto';
  return { ritmo, atras };
}
