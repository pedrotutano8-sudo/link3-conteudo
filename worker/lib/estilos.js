// Ficha de edição da marca: estilo base (regras fixas) + o que a marca escreveu (sobre, briefing, ajustes).
// Fica em brand_kits.acabamento.ficha. O estilo decide o que entra; o texto livre só refina, nunca derruba o estilo.
// O painel tem uma cópia de ESTILOS, ELEMENTOS e conflitos(): mudou aqui, mudar lá também (painel/index.html).

export const ELEMENTOS = {
  gancho: 'Título de abertura (gancho)',
  pb: 'Abertura em preto e branco',
  cartoes: 'B-roll em cartão flutuante (senão, tela cheia)',
  capitulos: 'Cartão de capítulo',
  impactos: 'Palavra de impacto',
  lista: 'Lista animada',
  tarja: 'Tarja de nome e cargo',
  encerramento: 'Encerramento com logo e chamada',
  trilha: 'Trilha de fundo',
  grade: 'Cor levemente quente',
};

const tudo = (v) => Object.fromEntries(Object.keys(ELEMENTOS).map((k) => [k, v]));

export const ESTILOS = {
  institucional: {
    nome: 'Institucional premium',
    descricao: 'Empresa, marca empregadora, serviço B2B. Abertura em P&B, B-roll em cartão, capítulos, tarja de nome e encerramento com logo. Ritmo calmo e acabamento de marca.',
    design: true,
    elementos: tudo(true),
  },
  criador: {
    nome: 'Criador / opinião',
    descricao: 'Pessoa falando de um assunto (notícia, opinião, dica). Corte seco, legenda grande com destaque, palavra de impacto e lista; B-roll em tela cheia. Sem P&B, capítulo, tarja ou encerramento com logo.',
    design: true,
    elementos: { ...tudo(false), gancho: true, impactos: true, lista: true, trilha: true },
  },
  promocional: {
    nome: 'Promocional / varejo',
    descricao: 'Oferta, produto, evento. Gancho forte, palavra de impacto e lista de benefícios, B-roll em cartão e encerramento com chamada. Sem P&B e sem capítulo.',
    design: true,
    elementos: { ...tudo(true), pb: false, capitulos: false, tarja: false },
  },
  simples: {
    nome: 'Simples (só legenda)',
    descricao: 'Cortes, legenda da marca, trilha e B-roll em tela cheia, sem camada de motion. Para quem quer o vídeo limpo.',
    design: false,
    elementos: { ...tudo(false), trilha: true },
  },
};

// ficha efetiva do kit: estilo base + elementos marcados no painel + textos
export function fichaDoKit(kit) {
  const ac = kit?.acabamento || {};
  const f = ac.ficha || {};
  const estilo = ESTILOS[f.estilo] ? f.estilo : ac.design?.ativo ? 'institucional' : 'simples';
  const base = ESTILOS[estilo];
  const elementos = { ...base.elementos };
  for (const k of Object.keys(ELEMENTOS)) if (typeof f.elementos?.[k] === 'boolean') elementos[k] = f.elementos[k];
  return {
    estilo, nome: base.nome, descricao: base.descricao, design: base.design, elementos,
    sobre: String(f.sobre || '').trim(), briefing: String(f.briefing || '').trim(),
    referencias: (f.referencias || []).filter(Boolean),
    ajustes: (f.ajustes || []).filter((a) => a && a.texto).slice(-15),
    versao: f.versao || 0,
  };
}

// texto para os prompts da IA (corte, gancho/copy, B-roll e design)
export function contextoFicha(ficha) {
  if (!ficha) return '';
  const lig = Object.entries(ficha.elementos).filter(([, v]) => v).map(([k]) => ELEMENTOS[k]);
  const des = Object.entries(ficha.elementos).filter(([, v]) => !v).map(([k]) => ELEMENTOS[k]);
  return [
    `ESTILO DE EDIÇÃO DA MARCA: ${ficha.nome}. ${ficha.descricao}`,
    lig.length && `Elementos ligados: ${lig.join('; ')}.`,
    des.length && `Elementos desligados (não usar): ${des.join('; ')}.`,
    ficha.sobre && `SOBRE A EMPRESA: ${ficha.sobre}`,
    ficha.briefing && `BRIEFING DE EDIÇÃO DA MARCA (refina o estilo; se contradizer o estilo, o estilo vale): ${ficha.briefing}`,
    ficha.ajustes.length && `AJUSTES JÁ PEDIDOS PELA MARCA (manter): ${ficha.ajustes.map((a) => a.texto).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

// briefing que contradiz o que está ligado (aviso no painel; no render o estilo vale)
const REGRAS = [
  [/sem (m[uú]sica|trilha)|n[aã]o (quer|coloc\w*|usa\w*) (m[uú]sica|trilha)/i, 'trilha', 'O briefing pede sem música, mas a trilha está ligada.'],
  [/(sem|n[aã]o)\b[^.]{0,30}(preto e branco|p&b|pb\b)/i, 'pb', 'O briefing não quer preto e branco, mas a abertura em P&B está ligada.'],
  [/sem (logo|encerramento|cart[aã]o final|vinheta final)/i, 'encerramento', 'O briefing não quer encerramento com logo, mas ele está ligado.'],
  [/sem cap[ií]tulo/i, 'capitulos', 'O briefing não quer capítulo, mas ele está ligado.'],
  [/sem (tarja|nome na tela)/i, 'tarja', 'O briefing não quer tarja de nome, mas ela está ligada.'],
  [/sem (b-?roll|imagem de apoio)/i, 'cartoes', 'O briefing não quer B-roll em cartão, mas ele está ligado.'],
];
export function conflitos(ficha) {
  const out = [];
  const txt = `${ficha.briefing || ''} ${(ficha.ajustes || []).map((a) => a.texto).join(' ')}`;
  for (const [re, el, msg] of REGRAS) if (re.test(txt) && ficha.elementos?.[el]) out.push(msg);
  if (/sem (anima[cç][aã]o|motion|efeito)/i.test(txt) && ESTILOS[ficha.estilo]?.design) out.push('O briefing não quer animação, mas o estilo escolhido tem camada de motion. Use o estilo "Simples".');
  return out;
}
