// Conferência de um pedido pronto: baixa a prévia, mede pausas que sobraram e transcreve o resultado.
// Uso: docker compose exec -T worker node scripts/qa.mjs 21 22 23
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config } from '../lib/config.js';
import { detectarSilencios, medir, medirVolume } from '../lib/midia.js';
import { repeticoes } from '../lib/cortes.js';
import { extrairAudio, transcrever } from '../lib/ia.js';

const sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } });
for (const numero of process.argv.slice(2).map(Number)) {
  const { data: j } = await sb.from('jobs').select('status, previa_path, roteiro, origem_nome').eq('numero', numero).single();
  if (!j?.previa_path) { console.log(`#${numero}: sem prévia (${j?.status})`); continue; }
  const { data: blob } = await sb.storage.from('previas').download(j.previa_path);
  const v = `/tmp/qa-${numero}.mp4`, a = `/tmp/qa-${numero}.mp3`;
  fs.writeFileSync(v, Buffer.from(await blob.arrayBuffer()));
  const info = await medir(v);
  const { silencios } = await detectarSilencios(v, { minimo: 0.35 });
  await extrairAudio(v, a);
  const t = await transcrever(a);
  const rep = [...repeticoes(t.palavras)].map((k) => t.palavras[k].p);
  const vol = await medirVolume(v);
  console.log(`\n#${numero} ${j.origem_nome || ''}`);
  console.log(`  ${Math.round(j.roteiro?.duracao_bruto || 0)} s → ${info.duracao.toFixed(1)} s · pausas > 0,35 s que sobraram: ${silencios.length} ${silencios.map(([x, y]) => `${x.toFixed(1)}-${(Number.isFinite(y) ? y : info.duracao).toFixed(1)}`).join(' ')}`);
  console.log(`  transcrição: ${j.roteiro?.qa?.motor || '?'} · volume: ${vol.I} LUFS, pico ${vol.TP} dB (meta -14 e abaixo de -1)`);
  console.log(`  repetição colada que sobrou: ${rep.length ? rep.join(', ') : 'nenhuma'}`);
  console.log(`  removido pela IA: ${(j.roteiro?.removido || []).map((r) => `"${r.slice(0, 50)}"`).join(' · ') || '-'}`);
  console.log(`  FALA FINAL: ${t.texto}`);
  fs.rmSync(v, { force: true }); fs.rmSync(a, { force: true });
}
