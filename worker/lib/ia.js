// IA do Módulo 1: transcrição palavra a palavra (OpenAI) e gancho + copy da legenda (Claude).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { rodar } from './midia.js';
import { parakeetDisponivel, transcreverParakeet } from './parakeet.js';

// chamada com nova tentativa quando a API está ocupada (429, 5xx, 529)
export async function comRetentativa(fetchImpl, url, opts, tentativas = 4) {
  for (let k = 1; ; k++) {
    const r = await fetchImpl(url, opts);
    if (r.ok || k >= tentativas || ![408, 409, 429, 500, 502, 503, 504, 529].includes(r.status)) return r;
    await new Promise((ok) => setTimeout(ok, 2000 * 2 ** (k - 1)));
  }
}

// áudio mono 16 kHz em mp3: ~0,35 MB por minuto (limite da API: 25 MB)
export async function extrairAudio(video, destino) {
  await rodar(config.ffmpeg, ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', destino]);
  return destino;
}

// termos-chave para o ASR: nomes próprios, siglas e palavras com maiúscula da dica (marca + roteiro)
export function termosChave(dica = '', limite = 50) {
  const vistos = new Map();
  const COMUNS = new Set('a o as os na no nas nos eu e é siga este esta isso aqui hoje então mas que para com da do de em um uma se quando onde como meu minha nosso nossa ele ela vamos vem'.split(' '));
  const add = (t) => {
    const ps = t.trim().split(/\s+/);
    while (ps.length && COMUNS.has(ps[0].toLowerCase())) ps.shift();   // "Na GNX" → "GNX"
    t = ps.join(' '); if (t.length >= 2 && t.length <= 40 && !vistos.has(t.toLowerCase())) vistos.set(t.toLowerCase(), t); };
  // sequências de palavras com inicial maiúscula ("GNX Group", "Trade Marketing") e siglas
  for (const m of String(dica).matchAll(/\b(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}0-9&]*)(?:\s+(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}0-9&]*))*/gu)) {
    const t = m[0];
    if (t.split(/\s+/).length === 1 && t.length < 4 && !/^[A-Z0-9]{2,}$/.test(t)) continue; // "Eu", "Na"
    add(t);
  }
  return [...vistos.values()].slice(0, limite);
}

// ElevenLabs Scribe: transcrição literal (mantém "éé", gagueira e recomeços) com tempo por palavra
export async function transcreverScribe(audio, { fetchImpl = fetch, dica = '' } = {}) {
  const enviar = async (comTermos) => {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), path.basename(audio));
    fd.append('model_id', config.modeloScribe);
    fd.append('language_code', 'por');
    fd.append('timestamps_granularity', 'word');
    fd.append('tag_audio_events', 'false');
    if (comTermos) for (const t of termosChave(dica)) fd.append('keyterms', t);
    return comRetentativa(fetchImpl, 'https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': config.elevenlabsKey }, body: fd,
    });
  };
  let r = await enviar(true);
  // termos-chave são opcionais: se a API recusar o campo, tenta sem
  if (!r.ok && [400, 422].includes(r.status)) r = await enviar(false);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Scribe falhou (${r.status}): ${JSON.stringify(j.detail || j).slice(0, 160)}`);
  const palavras = (j.words || [])
    .filter((w) => (w.type || 'word') === 'word')
    .map((w) => ({ p: String(w.text).trim(), i: Number(w.start), f: Number(w.end) }))
    .filter((w) => w.p && Number.isFinite(w.i) && Number.isFinite(w.f));
  const segundos = palavras.length ? palavras[palavras.length - 1].f : 0;
  return { texto: palavras.map((w) => w.p).join(' ') || j.text || '', palavras, segundos, motor: 'scribe', usdMinuto: config.precoScribeMinuto };
}

// motor de transcrição (ASR=parakeet|scribe|whisper; padrão: Parakeet se o modelo estiver no servidor).
// Parakeet = o mesmo do kit Edição Sem Editor, local e sem custo. Se ele falhar, segue no Whisper para não travar.
export async function transcrever(audio, opts = {}) {
  const motor = config.asr || (parakeetDisponivel() ? 'parakeet' : config.elevenlabsKey ? 'scribe' : 'whisper');
  if (motor === 'parakeet') {
    try { return await transcreverParakeet(audio); }
    catch (e) { if (!config.openaiKey) throw e; console.warn(`[asr] Parakeet: ${e.message} → usando Whisper`); }
    return transcreverWhisper(audio, opts);
  }
  if (motor === 'scribe' && config.elevenlabsKey) {
    try { return await transcreverScribe(audio, opts); }
    catch (e) { if (!config.openaiKey) throw e; console.warn(`[asr] ${e.message} → usando Whisper`); }
  }
  return transcreverWhisper(audio, opts);
}

export async function transcreverWhisper(audio, { fetchImpl = fetch, dica = '' } = {}) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY não configurada no worker');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), path.basename(audio));
  fd.append('model', config.modeloTranscricao);
  fd.append('language', 'pt');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  // estilo literal (mantém "éé", repetições e frases recomeçadas, que precisam ser vistas para serem cortadas)
  // + nomes e termos da marca/roteiro (ex.: "GNX Group", não "gene X")
  const literal = 'Ééé... então, eu, eu acho que, hum, tipo assim, né, a gente... a gente vai começar. ';
  fd.append('prompt', (literal + (dica || '')).slice(0, 800));
  const r = await comRetentativa(fetchImpl, 'https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Transcrição falhou (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  // "ÔQue": o modelo às vezes gruda um "Ô" no começo da palavra (respiração no início do take)
  const limpar = (p) => String(p).trim().replace(/^Ô(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/, '');
  const palavras = (j.words || []).map((w) => ({ p: limpar(w.word), i: Number(w.start), f: Number(w.end) })).filter((w) => w.p);
  return { texto: palavras.map((w) => w.p).join(' ') || j.text || '', palavras, segundos: Number(j.duration) || 0, motor: 'whisper', usdMinuto: 0.006 };
}

const PROMPT = `Você edita reels para uma agência de marketing. Recebe a transcrição palavra a palavra (numerada) de um vídeo bruto gravado pelo cliente e devolve:
- "remover": trechos que não podem ir ao ar, como lista de pares [primeira, ultima] com os números das palavras. Edite como um editor profissional de reels, com cortes secos e fala corrida. Remova:
  · erros de gravação e comentários fora do roteiro ("ai, não ficou bom", "corta", "de novo", "espera") e conversa com quem está filmando;
  · takes repetidos: quando a pessoa repete a mesma frase, fica só a última versão completa e sem erro;
  · recomeços dentro da frase: "eu entrei, eu entrei aqui na GNX" → remova o primeiro "eu entrei";
  · palavras repetidas e gaguejadas: "a a gente", "que que", "na na";
  · hesitações e muletas que não fazem falta: "éé", "é..." de hesitação, "hum", "ahn", "tipo", "né", "aí", "tá?", "então" e "assim" soltos no meio da fala, "enfim" usado para ganhar tempo;
  · trechos em que a pessoa está claramente pensando no que dizer ou se perde e retoma.
  Nunca remova uma palavra que carrega sentido (substantivo, verbo principal, número, nome): a frase que fica tem que continuar correta e completa. Se não houver nada, devolva [].
- "corrigir": palavras que a transcrição escreveu errado (nome da marca, de pessoas, termos técnicos, siglas), como lista de pares [número, "como escrever"]. Use as informações da marca e o roteiro como referência. Se estiver tudo certo, devolva [].
- "titulo": gancho curto para aparecer no topo nos primeiros segundos (máx. 6 palavras, sem emoji, sem aspas, sem promessa que o vídeo não cumpre). Use o assunto real da fala que fica no vídeo.
- "copy": legenda do post no Instagram no tom de voz da marca: 1ª linha que prende, 2 a 5 frases curtas, um CTA da lista da marca (se houver) e até 5 hashtags do assunto ou da marca do cliente.
Se o pedido trouxer um roteiro: o vídeo pode ter vários takes da mesma fala. Mantenha só um take de cada fala do roteiro (o último completo e sem erro) e remova os outros takes e tudo o que estiver fora do roteiro.
A copy é do cliente: nunca cite a agência, quem editou ou o pedido interno da equipe. Siga as regras da marca. Nunca invente preço, prazo, dado ou nome que não esteja na fala ou nas informações da marca.
Responda só com JSON: {"remover": [[0, 3]], "corrigir": [[5, "GNX"]], "titulo": "...", "copy": "..."}`;

export async function gancoECopy({ texto, palavras = null, cliente = {}, comando = '', ajuste = '', anterior = null }, { fetchImpl = fetch } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada no worker');
  const marca = [
    `Marca: ${cliente.nome || '-'}`,
    cliente.instagram && `Instagram: ${cliente.instagram}`,
    cliente.tom_voz && `Tom de voz: ${cliente.tom_voz}`,
    cliente.ctas?.length && `CTAs aceitos: ${cliente.ctas.join(' | ')}`,
    cliente.regras && `Nunca fazer: ${cliente.regras}`,
    cliente.observacoes && `Observações: ${cliente.observacoes}`,
  ].filter(Boolean).join('\n');
  const pedido = [
    comando && `Pedido da equipe: ${comando}`,
    anterior && `Versão anterior: ${JSON.stringify({ titulo: anterior.titulo, copy: anterior.copy })}`,
    ajuste && `Ajuste pedido agora (aplique só isso): ${ajuste}`,
  ].filter(Boolean).join('\n');
  const r = await comRetentativa(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.modeloClaude, max_tokens: 4000, system: PROMPT,
      messages: [{ role: 'user', content: `${marca}\n\n${pedido}\n\nTranscrição numerada:\n${palavras ? palavras.map((w, k) => `${k}:${w.p}`).join(' ') : texto}` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude falhou (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  const bruto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = bruto.match(/\{[\s\S]*\}/);
  let saida;
  try { saida = JSON.parse(m ? m[0] : bruto); } catch { throw new Error('Claude não devolveu JSON válido'); }
  const ent = j.usage?.input_tokens || 0, sai = j.usage?.output_tokens || 0;
  const n = palavras?.length || 0;
  const remover = (Array.isArray(saida.remover) ? saida.remover : [])
    .map((r) => (Array.isArray(r) ? [Number(r[0]), Number(r[1] ?? r[0])] : [Number(r), Number(r)]))
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b < n);
  const corrigir = (Array.isArray(saida.corrigir) ? saida.corrigir : [])
    .filter((c) => Array.isArray(c) && Number.isInteger(Number(c[0])) && Number(c[0]) >= 0 && Number(c[0]) < n && typeof c[1] === 'string' && c[1].trim())
    .map((c) => [Number(c[0]), c[1].trim()]);
  return {
    remover, corrigir,
    titulo: String(saida.titulo || '').trim(), copy: String(saida.copy || '').trim(),
    tokens: { entrada: ent, saida: sai },
    usd: (ent * config.precoClaudeEntrada + sai * config.precoClaudeSaida) / 1e6,
  };
}

const PROMPT_LOTE = `Você organiza a edição de reels de uma agência. Recebe o documento de roteiros do cliente e a lista de vídeos brutos de uma pasta (número, nome e a fala transcrita de cada um, na ordem em que foram gravados).
Para cada roteiro do documento, diga quais vídeos pertencem a ele, na ordem em que devem entrar no reel. Um vídeo pode ser um take repetido da mesma fala: inclua todos os takes daquela fala (a edição escolhe o melhor depois). Não use o mesmo vídeo em dois roteiros. Vídeos sem relação com nenhum roteiro (bastidores, testes, falas soltas) ficam em "sobras".
Para cada reel, devolva também o texto do roteiro correspondente, copiado do documento.
Se vídeos fora do documento formarem uma peça completa por conta própria (por exemplo um quadro ou programa com abertura, assunto e encerramento, gravado em vários takes), crie também um reel com "extra": true, título descritivo e, em "roteiro", um resumo do que a peça diz. Bastidores, testes e falas soltas continuam em "sobras".
Responda só com JSON: {"reels": [{"titulo": "nome curto do roteiro", "roteiro": "texto do roteiro", "videos": [3, 4, 5], "extra": false}], "sobras": [1, 2]}`;

export async function agruparPorRoteiro({ roteiros, videos, cliente = {}, comando = '' }, { fetchImpl = fetch } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada no worker');
  const lista = videos.map((v) => `#${v.n} ${v.nome} (${Math.round(v.duracao || 0)} s): ${v.fala ? v.fala : '[sem fala]'}`).join('\n');
  const r = await comRetentativa(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.modeloClaude, max_tokens: 8000, system: PROMPT_LOTE,
      messages: [{ role: 'user', content: `Marca: ${cliente.nome || '-'}\n${comando ? `Pedido da equipe: ${comando}\n` : ''}\nDOCUMENTO DE ROTEIROS:\n${roteiros}\n\nVÍDEOS DA PASTA:\n${lista}` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude falhou (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  const bruto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = bruto.match(/\{[\s\S]*\}/);
  let saida;
  try { saida = JSON.parse(m ? m[0] : bruto); } catch { throw new Error('Claude não devolveu JSON válido ao separar os roteiros'); }
  const validos = new Set(videos.map((v) => v.n)), usados = new Set();
  const reels = (saida.reels || []).map((x) => ({
    titulo: String(x.titulo || '').trim() || 'Roteiro',
    roteiro: String(x.roteiro || '').trim(),
    videos: (x.videos || []).map(Number).filter((n) => validos.has(n) && !usados.has(n) && usados.add(n)),
    extra: Boolean(x.extra),
  })).filter((x) => x.videos.length);
  const ent = j.usage?.input_tokens || 0, sai = j.usage?.output_tokens || 0;
  return {
    reels, sobras: videos.map((v) => v.n).filter((n) => !usados.has(n)),
    tokens: { entrada: ent, saida: sai }, usd: (ent * config.precoClaudeEntrada + sai * config.precoClaudeSaida) / 1e6,
  };
}

const PROMPT_REVISAO = `Você é o revisor final de um editor de reels. Recebe a fala JÁ EDITADA de um vídeo, palavra a palavra e numerada, exatamente como vai ao ar.
Marque o que ainda faz o vídeo parecer amador e deve sair: palavras repetidas ("pela, pela"), recomeços ("eu, eu", "a gente, eu atualmente"), hesitações ("é...", "éé", "hum", "ahn"), muletas soltas ("né", "aí", "tá?", "tipo", "então", "assim") e trechos em que a pessoa se perde.
Nunca marque uma palavra que carrega sentido: a frase que fica tem que continuar correta e completa. Na dúvida, não marque.
Responda só com JSON: {"remover": [[primeira, ultima]]}`;

export async function revisarFala({ palavras }, { fetchImpl = fetch } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada no worker');
  const r = await comRetentativa(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.modeloClaude, max_tokens: 2000, system: PROMPT_REVISAO,
      messages: [{ role: 'user', content: palavras.map((w, k) => `${k}:${w.p}`).join(' ') }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude falhou na revisão (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  const bruto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = bruto.match(/\{[\s\S]*\}/);
  let saida = {};
  try { saida = JSON.parse(m ? m[0] : bruto); } catch { saida = {}; }
  const n = palavras.length;
  const remover = (Array.isArray(saida.remover) ? saida.remover : [])
    .map((x) => (Array.isArray(x) ? [Number(x[0]), Number(x[1] ?? x[0])] : [Number(x), Number(x)]))
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b < n);
  const ent = j.usage?.input_tokens || 0, sai = j.usage?.output_tokens || 0;
  return { remover, tokens: { entrada: ent, saida: sai }, usd: (ent * config.precoClaudeEntrada + sai * config.precoClaudeSaida) / 1e6 };
}

// chamada simples ao Claude que devolve JSON (texto e, se vier, imagens em base64)
async function claudeJson({ system, texto, imagens = [], max = 4000 }, { fetchImpl = fetch } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada no worker');
  const content = [...imagens.map((b64) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } })), { type: 'text', text: texto }];
  const r = await comRetentativa(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.modeloClaude, max_tokens: max, system, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude falhou (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  const bruto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  // aceita JSON puro, em bloco ```json``` ou com texto em volta
  const tentativas = [bruto, (bruto.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], (bruto.match(/\{[\s\S]*\}/) || [])[0], (bruto.match(/\[[\s\S]*\]/) || [])[0]];
  let saida = null;
  for (const t of tentativas) { if (!t) continue; try { saida = JSON.parse(t); break; } catch { /* próxima */ } }
  if (saida === null && process.env.DEBUG_IA) console.warn('[claude] resposta sem JSON:', bruto.slice(0, 400));
  const ent = j.usage?.input_tokens || 0, sai = j.usage?.output_tokens || 0;
  return { saida, bruto, tokens: { entrada: ent, saida: sai }, usd: (ent * config.precoClaudeEntrada + sai * config.precoClaudeSaida) / 1e6 };
}

// descreve cada clipe de imagem de apoio (B-roll) a partir de um quadro do meio dele
export async function descreverBroll(clipes, opts) {
  const r = await claudeJson({
    system: 'Você cataloga imagens de apoio (B-roll) para um editor de vídeo. Para cada imagem, na ordem, escreva em português uma descrição curta e concreta do que aparece (lugar, pessoas, ação, objetos) em até 15 palavras. Responda só com JSON: ["descrição 1", "descrição 2", ...].',
    texto: `São ${clipes.length} imagens, uma por clipe, na ordem: ${clipes.map((c, k) => `${k}: ${c.nome}`).join(' · ')}`,
    imagens: clipes.map((c) => c.quadroB64), max: 4000,
  }, opts);
  const lista = Array.isArray(r.saida) ? r.saida : [];
  return { descricoes: clipes.map((_, k) => String(lista[k] || '')), tokens: r.tokens, usd: r.usd };
}

const PROMPT_BROLL = `Você é editor de reels de empresas. O vídeo é uma pessoa falando para a câmera. Escolha onde entram imagens de apoio (B-roll) por cima da fala, para dar ritmo e ilustrar o que é dito, como um editor profissional faria.
Regras:
- 2 ou 3 inserções no total, cada uma cobrindo de 2 a 3,5 segundos de fala.
- Só cubra frases em que a imagem combina com o que está sendo dito (empresa, estrutura, equipe, operação, escritório, trabalho). Se nenhum clipe combinar com nenhum trecho, devolva lista vazia.
- Nunca cubra os primeiros 3 segundos (o rosto segura o gancho), nem os últimos 2 segundos, nem o momento em que a pessoa diz o próprio nome ou cargo.
- Não repita o mesmo clipe e deixe pelo menos 3 segundos de rosto entre uma inserção e outra.
- Varie: misture vídeos e fotos ([foto]) e prefira o que ainda não foi usado em outro reel.
Responda só com JSON: {"broll": [{"clipe": número do clipe, "de": índice da primeira palavra, "ate": índice da última palavra}]}`;

// escolhe onde entram os clipes de apoio, em cima da fala já cortada (tempos do vídeo final)
export async function escolherBroll({ palavras, clipes }, opts) {
  const r = await claudeJson({
    system: PROMPT_BROLL,
    texto: `CLIPES DISPONÍVEIS:\n${clipes.map((c, k) => `${k}: ${c.descricao} (${c.duracao.toFixed(1)} s)`).join('\n')}\n\nFALA DO VÍDEO (índice:palavra@segundo):\n${palavras.map((w, k) => `${k}:${w.p}@${w.i.toFixed(1)}`).join(' ')}`,
    max: 4000,
  }, opts);
  const lista = Array.isArray(r.saida?.broll) ? r.saida.broll : [];
  return { escolhas: lista, bruto: r.bruto, tokens: r.tokens, usd: r.usd };
}
