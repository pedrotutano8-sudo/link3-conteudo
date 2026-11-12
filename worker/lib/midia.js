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
export async function detectarSilencios(arquivo, { minimo = 0.25, abaixo = 16 } = {}) {
  const vol = await rodar(config.ffmpeg, ['-hide_banner', '-i', arquivo, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { comErro: true });
  const media = Number((vol.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
  const limiar = Math.max(-50, Math.min(-26, (Number.isFinite(media) ? media : -30) - abaixo));
  const log = await rodar(config.ffmpeg, ['-hide_banner', '-i', arquivo, '-vn', '-af', `silencedetect=noise=${limiar.toFixed(1)}dB:d=${minimo}`, '-f', 'null', '-'], { comErro: true });
  const silencios = [];
  let ini = null;
  for (const linha of log.split('\n')) {
    const a = linha.match(/silence_start:\s*(-?[\d.]+)/), b = linha.match(/silence_end:\s*(-?[\d.]+)/);
    if (a) ini = Math.max(0, Number(a[1]));
    if (b && ini !== null) { silencios.push([ini, Number(b[1])]); ini = null; }
  }
  if (ini !== null) silencios.push([ini, Infinity]);
  return { silencios, limiar, media };
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

// Módulo 1: corta as pausas (trechos), monta 9:16, aplica logo e queima a legenda (.ass) num passo só.
// Acabamento de cada corte: microtransição no áudio (sem estalo) e zoom alternado na imagem (o corte vira "punch-in").
export async function montarEdicao(entrada, saida, { trechos, ass, fontsDir, logo, previa = false, larguraLogo = 160, margem = 48, temAudio = true, zoom = 1.1 } = {}) {
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
  let atual = '[v]';
  if (logo) { args.push('-i', logo); partes.push(`[1:v]scale=${lw}:-1[l];${atual}[l]overlay=W-w-${m}:${m}[vl]`); atual = '[vl]'; }
  if (ass) {
    const esc = (s) => s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    partes.push(`${atual}ass=filename='${esc(ass)}'${fontsDir ? `:fontsdir='${esc(fontsDir)}'` : ''}[vs]`);
    atual = '[vs]';
  }
  args.push('-filter_complex', partes.join(';'), '-map', atual);
  if (temAudio) args.push('-map', '[ac]', '-c:a', 'aac', '-b:a', '160k');
  args.push('-c:v', 'libx264', '-preset', previa ? 'veryfast' : 'medium', '-crf', previa ? '28' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida);
  await rodar(config.ffmpeg, args);
  return saida;
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
