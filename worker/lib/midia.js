// FFmpeg: medir, montar 9:16 e aplicar o logo da marca.
import { spawn } from 'node:child_process';
import { config } from './config.js';

export function rodar(cmd, args) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', falha);
    p.on('close', (c) => (c === 0 ? ok(out) : falha(new Error(`${cmd} saiu com código ${c}: ${err.split('\n').slice(-4).join(' ')}`))));
  });
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

// Módulo 1: corta as pausas (trechos), monta 9:16, aplica logo e queima a legenda (.ass) num passo só
export async function montarEdicao(entrada, saida, { trechos, ass, fontsDir, logo, previa = false, larguraLogo = 160, margem = 48, temAudio = true } = {}) {
  const [w, h] = previa ? [540, 960] : [1080, 1920];
  const lw = Math.round(larguraLogo * (w / 1080)), m = Math.round(margem * (w / 1080));
  const partes = [], rotulos = [];
  (trechos?.length ? trechos : [[0, null]]).forEach(([a, b], k) => {
    const fim = b == null ? '' : `:end=${b}`;
    partes.push(`[0:v]trim=start=${a}${fim},setpts=PTS-STARTPTS[v${k}]`);
    if (temAudio) partes.push(`[0:a]atrim=start=${a}${fim},asetpts=PTS-STARTPTS[a${k}]`);
    rotulos.push(temAudio ? `[v${k}][a${k}]` : `[v${k}]`);
  });
  const n = rotulos.length;
  partes.push(`${rotulos.join('')}concat=n=${n}:v=1:a=${temAudio ? 1 : 0}[vc]${temAudio ? '[ac]' : ''}`);
  partes.push(`[vc]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[v]`);
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
