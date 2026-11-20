// Relatório interno de performance (S11): a equipe pede no painel (cliente + período); aqui o worker junta
// as publicações do período com as métricas (S10), calcula os números e pede ao Claude o que funcionou,
// o que não funcionou e as sugestões. Uso interno da Link 3: nada vai para o cliente automaticamente.
import { createClient } from '@supabase/supabase-js';

const NUM = ['alcance', 'views', 'curtidas', 'comentarios', 'salvos', 'compartilhamentos'];
const soma = (xs, k) => xs.reduce((s, x) => s + (Number(x.m?.[k]) || 0), 0);
const media = (xs, k) => { const v = xs.filter((x) => x.m?.[k] != null); return v.length ? Math.round(soma(v, k) / v.length) : null; };
const interacoes = (m) => (m ? (Number(m.curtidas) || 0) + (Number(m.comentarios) || 0) + (Number(m.salvos) || 0) + (Number(m.compartilhamentos) || 0) : 0);
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// números do período, sem IA (testável)
export function calcularRelatorio(posts) {
  const itens = posts.map((p) => {
    const quando = new Date(p.publicada_em);
    const hora = Number(quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
    const dia = DIAS[new Date(quando.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()];
    const m = p.metricas || null;
    const inter = interacoes(m);
    return {
      id: p.id, numero: p.job?.numero ?? null, tipo: p.job?.tipo || 'reel', titulo: p.titulo || '', conta: p.conta || '', permalink: p.permalink || null,
      publicada_em: p.publicada_em, dia, hora, m, interacoes: inter,
      taxa: m?.alcance ? Math.round((inter / m.alcance) * 1000) / 10 : null, // % de interação sobre o alcance
    };
  });
  const porTipo = {};
  for (const x of itens) (porTipo[x.tipo] ||= []).push(x);
  const resumoTipo = Object.fromEntries(Object.entries(porTipo).map(([t, xs]) => [t, {
    posts: xs.length, alcance_medio: media(xs, 'alcance'), views_medio: media(xs, 'views'),
    interacoes_medias: xs.length ? Math.round(xs.reduce((s, x) => s + x.interacoes, 0) / xs.length) : 0,
  }]));
  const comAlcance = itens.filter((x) => x.m?.alcance != null);
  const ordem = [...itens].sort((a, b) => (b.m?.alcance ?? b.interacoes) - (a.m?.alcance ?? a.interacoes) || b.interacoes - a.interacoes);
  return {
    posts: itens.length,
    parcial: itens.some((x) => !x.m || x.m.parcial),
    totais: Object.fromEntries(NUM.map((k) => [k, soma(itens, k)])),
    alcance_medio: media(itens, 'alcance'),
    taxa_media: comAlcance.length ? Math.round((comAlcance.reduce((s, x) => s + (x.taxa || 0), 0) / comAlcance.length) * 10) / 10 : null,
    por_tipo: resumoTipo,
    melhores: ordem.slice(0, 3).map((x) => x.id),
    piores: ordem.length > 3 ? ordem.slice(-3).reverse().map((x) => x.id) : [],
    itens,
  };
}

const PROMPT = `Você é analista de performance de Instagram numa agência de marketing. Recebe os números das publicações de UM cliente num período (só o que foi publicado pelo sistema da agência) e a ficha da marca.
Escreva para a equipe interna, em português, direto e com números. Regras:
- Use só os dados recebidos. Não invente benchmark, média de mercado nem número que não está aí.
- Com menos de 4 posts ou métricas parciais, diga isso no resumo e trate as conclusões como indícios, não como regra.
- Compare formatos (reel, carrossel, post), temas/ganchos (pelos títulos), dia e horário de publicação.
- Sugestões concretas e testáveis: o que repetir, o que mudar e um teste para a próxima semana (com o que medir).
Responda só com JSON: {"resumo": "2 a 3 frases", "funcionou": ["..."], "nao_funcionou": ["..."], "sugestoes": ["..."], "proximo_teste": "uma frase: o teste e a métrica que decide"}`;

export function criarRelatorios({ supabaseUrl, supabaseKey, claudeJson, log = console.log }) {
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  async function gerar(r) {
    const ate = new Date(r.ate + 'T23:59:59-03:00').toISOString(), de = new Date(r.de + 'T00:00:00-03:00').toISOString();
    let q = sb.from('publicacoes').select('id, job_id, client_id, conta_id, permalink, publicada_em, metricas, metricas_em').eq('org_id', r.org_id).eq('status', 'publicada').gte('publicada_em', de).lte('publicada_em', ate).order('publicada_em');
    if (r.client_id) q = q.eq('client_id', r.client_id);
    const pubs = ok(await q);
    const jobs = pubs.length ? ok(await sb.from('jobs').select('id, numero, tipo, origem_nome, roteiro').in('id', [...new Set(pubs.map((p) => p.job_id).filter(Boolean))])) : [];
    const contas = pubs.length ? ok(await sb.from('instagram_contas').select('id, username').in('id', [...new Set(pubs.map((p) => p.conta_id))])) : [];
    const posts = pubs.map((p) => {
      const j = jobs.find((x) => x.id === p.job_id);
      const titulo = j?.roteiro?.laminas?.[0]?.titulo || [j?.roteiro?.design?.gancho?.linha1, j?.roteiro?.design?.gancho?.linha2].filter(Boolean).join(' ') || j?.roteiro?.copy?.split('\n')[0] || j?.origem_nome || '';
      return { ...p, job: j, titulo: String(titulo).replace(/\*/g, '').slice(0, 120), conta: '@' + (contas.find((c) => c.id === p.conta_id)?.username || '?') };
    });
    const dados = calcularRelatorio(posts);
    let analise = null, usd = 0;
    if (dados.posts && claudeJson) {
      const [cliente, kit] = r.client_id ? await Promise.all([
        sb.from('clients').select('nome').eq('id', r.client_id).single().then(ok),
        sb.from('brand_kits').select('acabamento').eq('client_id', r.client_id).maybeSingle().then(ok),
      ]) : [{ nome: 'todos os clientes' }, null];
      const ficha = kit?.acabamento?.ficha || {};
      const enxuto = { periodo: `${r.de} a ${r.ate}`, cliente: cliente.nome, sobre: ficha.sobre || '', ...dados, itens: dados.itens.map(({ id, permalink, ...x }) => ({ ref: id.slice(0, 6), ...x })), melhores: dados.melhores.map((x) => x.slice(0, 6)), piores: dados.piores.map((x) => x.slice(0, 6)) };
      const ia = await claudeJson({ system: PROMPT, texto: JSON.stringify(enxuto), max: 1500 });
      analise = ia.saida; usd = ia.usd || 0;
    } else if (!dados.posts) {
      analise = { resumo: 'Nenhuma publicação feita pelo sistema nesse período.', funcionou: [], nao_funcionou: [], sugestoes: [], proximo_teste: '' };
    }
    return { dados, analise, usd };
  }

  let ultimo = 0;
  return {
    async ciclo() {
      if (Date.now() - ultimo < 15000) return;
      ultimo = Date.now();
      let fila;
      try { fila = ok(await sb.from('relatorios').select('*').eq('status', 'pedido').order('created_at').limit(1)); } catch (e) { return; } // migração 008 ainda não aplicada
      for (const r of fila) {
        const pegou = ok(await sb.from('relatorios').update({ status: 'gerando', updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'pedido').select('id'));
        if (!pegou.length) continue;
        try {
          const { dados, analise, usd } = await gerar(r);
          ok(await sb.from('relatorios').update({ status: 'pronto', dados, analise, custo_ia_usd: usd, erro: null, updated_at: new Date().toISOString() }).eq('id', r.id));
          log(`relatório ${r.id}: ${dados.posts} post(s)`);
        } catch (e) {
          await sb.from('relatorios').update({ status: 'erro', erro: e.message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', r.id);
          log(`relatório ${r.id} falhou: ${e.message}`);
        }
      }
    },
  };
}
