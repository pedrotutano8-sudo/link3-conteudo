// FFmpeg: medir, montar 9:16 e aplicar o logo da marca.
import { spawn } from 'node:child_process';
import { config } from './config.js';

export function rodar(cmd, args, { comErro = false } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok(comErro ? err : out) : falha(new Error(`${cmd} saiu com código ${c}: ${err.split('\n').slice(-4).join(' ')}`))));
  });
}

// silêncios pelo ÁUDIO (não pelo texto): limiar relativo ao volume médio da fala
// Silêncios pelo nível do áudio, mesmo critério do kit Edição Sem Editor: energia a cada 10 ms, suavizada em 50 ms;
// o limite fica no meio do caminho entre o ruído de fundo (10% mais baixos) e a fala típica (mediana), então funciona
// em sala barulhenta também. Respiração e estalos curtos (até 120 ms) não quebram uma pausa.
export async function detectarSilencios(arquivo, { minimo = 0.25 } = {}) {
  const { spawn } = await import('node:child_process');
  const pcm = await new Promise((ok, falha) => {
    const p = spawn(config.ffmpeg, ['-v', 'error', '-i', arquivo, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']);
    const partes = []; let erro = '';
    p.stdout.on('data', (d) => partes.push(d));
    p.stderr.on('data', (d) => { erro += d; });
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok(Buffer.concat(partes)) : falha(new Error(`ffmpeg saiu com código ${c}: ${erro.slice(-200)}`))));
  });
  const a = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  const J = 160, db = [];
  for (let i = 0; i + J <= a.length; i += J) { let e = 0; for (let k = i; k < i + J; k++) e += a[k] * a[k]; db.push(10 * Math.log10(e / J + 1e-12)); }
  if (!db.length) return { silencios: [], limiar: null, media: null };
  const liso = db.map((_, i) => { let e = 0, n = 0; for (let k = Math.max(0, i - 2); k <= Math.min(db.length - 1, i + 2); k++) { e += 10 ** (db[k] / 10); n++; } return 10 * Math.log10(e / n); });
  const ordem = [...liso].sort((x, y) => x - y);
  const p10 = ordem[Math.floor(ordem.length * 0.1)], p50 = ordem[Math.floor(ordem.length * 0.5)];
  const limiar = p10 + 0.5 * (p50 - p10);
  const mudo = liso.map((v) => v < limiar);
  for (let i = 0, j; i < mudo.length; i = j) {
    j = i; while (j < mudo.length && mudo[j] === mudo[i]) j++;
    if (!mudo[i] && i > 0 && j < mudo.length && j - i <= 12) for (let k = i; k < j; k++) mudo[k] = true;
  }
  const silencios = [];
  for (let i = 0, j; i < mudo.length; i = j) {
    j = i; while (j < mudo.length && mudo[j] === mudo[i]) j++;
    if (mudo[i] && (j - i) / 100 >= minimo) silencios.push([i / 100, j >= mudo.length ? Infinity : j / 100]);
  }
  return { silencios, limiar: +limiar.toFixed(1), media: +p50.toFixed(1) };
}

export async function medir(arquivo) {
  const j = JSON.parse(await rodar(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo]));
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { duracao: Number(j.format.duration), largura: v?.width, altura: v?.height, temAudio: j.streams.some((s) => s.codec_type === 'audio') };
}

// vídeo em 1080x1920 (preenche e corta o excesso), logo no canto superior direito
export async function montarComLogo(entrada, saida, { logo, previa = false, larguraLogo = 160, margem = 48 } = {}) {
  const [w, h] = previa ? [540, 960] : [1080, 1920];
  const lw = Math.round(larguraLogo * (w / 1080)), m = Math.round(margem * (w / 1080));
  const base = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[v]`;
  const args = ['-y', '-i', entrada];
  let filtro = base, mapa = '[v]';
  if (logo) { args.push('-i', logo); filtro += `;[1:v]scale=${lw}:-1[l];[v][l]overlay=W-w-${m}:${m}[o]`; mapa = '[o]'; }
  args.push('-filter_complex', filtro, '-map', mapa, '-map', '0:a?', '-c:v', 'libx264', '-preset', previa ? 'veryfast' : 'medium', '-crf', previa ? '28' : '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', saida);
  await rodar(config.ffmpeg, args);
  return saida;
}

export const VOZ = 'highpass=f=80,afftdn=nf=-30,equalizer=f=3000:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=2.5:attack=15:release=150:makeup=2,loudnorm=I=-14.5:TP=-1.5:LRA=7,aformat=sample_rates=48000:channel_layouts=stereo';

// volume do arquivo final (EBU R128): loudness integrado (LUFS) e pico verdadeiro (dBTP)
export async function medirVolume(arquivo) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(config.ffmpeg, ['-hide_banner', '-nostats', '-i', arquivo, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const txt = String(r.stderr || '');
  const resumo = txt.slice(txt.lastIndexOf('Summary:'));
  const num = (re) => { const m = resumo.match(re); return m ? Number(m[1]) : NaN; };
  return { I: num(/I:\s*(-?[\d.]+)\s*LUFS/), TP: num(/Peak:\s*(-?[\d.]+)\s*dBFS/) };
}

// meta do kit: -14 LUFS (tolerância 0,5) e pico abaixo de -1 dBTP; fora disso regrava só o áudio
export async function acertarVolume(arquivo, { meta = -14, tolerancia = 0.5 } = {}) {
  const antes = await medirVolume(arquivo);
  if (!Number.isFinite(antes.I) || (Math.abs(antes.I - meta) <= tolerancia && !(antes.TP > -1))) return { ...antes, ganho: 0 };
  const ganho = meta - antes.I;
  const tmp = arquivo.replace(/(\.\w+)$/, '.vol$1');
  await rodar(config.ffmpeg, ['-y', '-i', arquivo, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af',
    `volume=${ganho.toFixed(2)}dB,alimiter=limit=0.794:attack=5:release=50:level=false,aformat=sample_rates=48000:channel_layouts=stereo`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
  const fs = await import('node:fs');
  fs.renameSync(tmp, arquivo);
  return { ...(await medirVolume(arquivo)), ganho };
}

// Módulo 1: corta as pausas (trechos), monta 9:16, aplica logo e queima a legenda (.ass) num passo só.
// Acabamento de cada corte: microtransição no áudio (sem estalo) e zoom alternado na imagem (o corte vira "punch-in").
export async function montarEdicao(entrada, saida, { trechos, ass, fontsDir, logo, previa = false, larguraLogo = 160, margem = 48, temAudio = true, zoom = 1.1, tratarVoz = true, broll = [] } = {}) {
  const [w, h] = previa ? [540, 960] : [1080, 1920];
  const lw = Math.round(larguraLogo * (w / 1080)), m = Math.round(margem * (w / 1080));
  const partes = [], rotulos = [];
  const lista = trechos?.length ? trechos : [[0, null]];
  const fade = 0.015;
  lista.forEach(([a, b], k) => {
    const fim = b == null ? '' : `:end=${b}`;
    const dur = b == null ? null : b - a;
    // trechos ímpares entram mais próximos (punch-in), com o rosto mais perto do terço de cima
    const z = lista.length > 1 && k % 2 === 1 && (dur == null || dur > 0.7) ? zoom : 1;
    const enquadrar = z === 1
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${Math.round(w * z)}:${Math.round(h * z)}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*0.35`;
    partes.push(`[0:v]trim=start=${a}${fim},setpts=PTS-STARTPTS,${enquadrar},setsar=1[v${k}]`);
    if (temAudio) {
      const fades = dur && dur > 4 * fade ? `,afade=t=in:d=${fade},afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade}` : '';
      partes.push(`[0:a]atrim=start=${a}${fim},asetpts=PTS-STARTPTS${fades}[a${k}]`);
    }
    rotulos.push(temAudio ? `[v${k}][a${k}]` : `[v${k}]`);
  });
  const n = rotulos.length;
  partes.push(`${rotulos.join('')}concat=n=${n}:v=1:a=${temAudio ? 1 : 0}[v]${temAudio ? '[ac]' : ''}`);
  const args = ['-y', '-i', entrada];
  let atual = '[v]', entradas = 1;
  // imagens de apoio por cima da fala (o áudio continua o da pessoa); entram antes da logo e da legenda
  for (const [k, b] of (broll || []).entries()) {
    const dur = Math.max(0.5, b.fim - b.inicio);
    args.push('-ss', String(b.offset || 0), '-t', dur.toFixed(2), '-i', b.arquivo);
    const ix = entradas++;
    partes.push(`[${ix}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS+${b.inicio}/TB[b${k}]`);
    partes.push(`${atual}[b${k}]overlay=enable='between(t,${b.inicio},${b.fim})':eof_action=pass[vb${k}]`);
    atual = `[vb${k}]`;
  }
  if (logo) { args.push('-i', logo); const ix = entradas++; partes.push(`[${ix}:v]scale=${lw}:-1[l];${atual}[l]overlay=W-w-${m}:${m}[vl]`); atual = '[vl]'; }
  if (ass) {
    const esc = (s) => s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    partes.push(`${atual}ass=filename='${esc(ass)}'${fontsDir ? `:fontsdir='${esc(fontsDir)}'` : ''}[vs]`);
    atual = '[vs]';
  }
  args.push('-filter_complex', partes.join(';'), '-map', atual);
  if (temAudio) args.push('-map', '[ac]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  args.push('-c:v', 'libx264', '-preset', previa ? 'veryfast' : 'medium', '-crf', previa ? '28' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida);
  await rodar(config.ffmpeg, args);
  // voz tratada, igual ao kit Edição Sem Editor: corta grave, reduz ruído, dá presença, comprime leve e normaliza.
  // Passo separado só no áudio (o ffmpeg 5.1 do servidor recusa esse filtro dentro do filter_complex com a logo).
  if (temAudio && tratarVoz) {
    const tmp = saida.replace(/(\.\w+)$/, '.voz$1');
    await rodar(config.ffmpeg, ['-y', '-i', saida, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af', VOZ, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
    (await import('node:fs')).renameSync(tmp, saida);
  }
  return saida;
}

// trilha de fundo: entra baixa (cerca de 9 dB abaixo da voz), abaixa mais quando a pessoa fala (ducking),
// entra com fade de 0,6 s e sai com fade de 1,5 s no fim do vídeo
export async function misturarTrilha(arquivo, trilha, { nivel = Number(process.env.TRILHA_NIVEL || -23) } = {}) {
  const info = await medir(arquivo);
  const dur = info.duracao;
  const m = await medirVolume(trilha);
  const ganho = Number.isFinite(m.I) ? nivel - m.I : -18;
  const tmp = arquivo.replace(/(\.\w+)$/, '.trilha$1');
  const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const filtro = [
    `[1:a]${fmt},volume=${ganho.toFixed(2)}dB,afade=t=in:d=0.6,afade=t=out:st=${Math.max(0, dur - 1.5).toFixed(2)}:d=1.5[m]`,
    `[0:a]${fmt},asplit=2[voz][sc]`,
    `[m][sc]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=400:makeup=1[md]`,
    `[voz][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${fmt}[a]`,
  ].join(';');
  await rodar(config.ffmpeg, ['-y', '-i', arquivo, '-stream_loop', '-1', '-i', trilha, '-filter_complex', filtro,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', dur.toFixed(3), '-movflags', '+faststart', tmp]);
  (await import('node:fs')).renameSync(tmp, arquivo);
  return { ganho };
}

// junta vários brutos (takes) num só, já em 9:16 e no mesmo formato, na ordem recebida
export async function juntarBrutos(arquivos, saida) {
  const infos = [];
  for (const a of arquivos) infos.push(await medir(a));
  const args = ['-y'];
  arquivos.forEach((a) => args.push('-i', a));
  const partes = [], rotulos = [];
  infos.forEach((info, k) => {
    partes.push(`[${k}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${k}]`);
    partes.push(info.temAudio
      ? `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${info.duracao}[a${k}]`);
    rotulos.push(`[v${k}][a${k}]`);
  });
  partes.push(`${rotulos.join('')}concat=n=${arquivos.length}:v=1:a=1[v][a]`);
  args.push('-filter_complex', partes.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', saida);
  await rodar(config.ffmpeg, args);
  return saida;
}

// só o áudio da edição (rápido): usado na revisão da fala antes do render
export async function audioEditado(entrada, trechos, saida) {
  const partes = trechos.map(([a, b], k) => `[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${k}]`);
  partes.push(`${trechos.map((_, k) => `[a${k}]`).join('')}concat=n=${trechos.length}:v=0:a=1,aresample=16000,pan=mono|c0=c0[s]`);
  await rodar(config.ffmpeg, ['-y', '-i', entrada, '-filter_complex', partes.join(';'), '-map', '[s]', '-b:a', '48k', saida]);
  return saida;
}
