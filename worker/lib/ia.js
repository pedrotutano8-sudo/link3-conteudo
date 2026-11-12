// IA do Módulo 1: transcrição palavra a palavra (OpenAI) e gancho + copy da legenda (Claude).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { rodar } from './midia.js';

// áudio mono 16 kHz em mp3: ~0,35 MB por minuto (limite da API: 25 MB)
export async function extrairAudio(video, destino) {
  await rodar(config.ffmpeg, ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', destino]);
  return destino;
}

export async function transcrever(audio, { fetchImpl = fetch } = {}) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY não configurada no worker');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), path.basename(audio));
  fd.append('model', config.modeloTranscricao);
  fd.append('language', 'pt');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Transcrição falhou (${r.status}): ${j.error?.message || 'sem detalhe'}`);
  const palavras = (j.words || []).map((w) => ({ p: String(w.word).trim(), i: Number(w.start), f: Number(w.end) })).filter((w) => w.p);
  return { texto: j.text || palavras.map((w) => w.p).join(' '), palavras, segundos: Number(j.duration) || 0 };
}

const PROMPT = `Você edita reels para uma agência de marketing. Recebe a transcrição palavra a palavra (numerada) de um vídeo bruto gravado pelo cliente e devolve:
- "remover": trechos que não podem ir ao ar, como lista de pares [primeira, ultima] com os números das palavras. Remova: erros de gravação e comentários fora do roteiro ("ai, não ficou bom", "corta", "de novo", "espera"), frases começadas e abandonadas que são repetidas logo depois (fica só a última versão completa) e conversa com quem está filmando. Não remova conteúdo bom. Se não houver nada, devolva [].
- "titulo": gancho curto para aparecer no topo nos primeiros segundos (máx. 6 palavras, sem emoji, sem aspas, sem promessa que o vídeo não cumpre). Use o assunto real da fala que fica no vídeo.
- "copy": legenda do post no Instagram no tom de voz da marca: 1ª linha que prende, 2 a 5 frases curtas, um CTA da lista da marca (se houver) e até 5 hashtags do assunto ou da marca do cliente.
A copy é do cliente: nunca cite a agência, quem editou ou o pedido interno da equipe. Siga as regras da marca. Nunca invente preço, prazo, dado ou nome que não esteja na fala ou nas informações da marca.
Responda só com JSON: {"remover": [[0, 3]], "titulo": "...", "copy": "..."}`;

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
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.modeloClaude, max_tokens: 1200, system: PROMPT,
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
  return {
    remover,
    titulo: String(saida.titulo || '').trim(), copy: String(saida.copy || '').trim(),
    tokens: { entrada: ent, saida: sai },
    usd: (ent * config.precoClaudeEntrada + sai * config.precoClaudeSaida) / 1e6,
  };
}
