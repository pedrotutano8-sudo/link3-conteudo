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
