// Recorte da pessoa (máscara) para o texto passar atrás dela.
// Modelo: Robust Video Matting (MobileNetV3, ONNX, licença GPL-3.0), rodando na CPU do servidor.
// Só os quadros das janelas do texto passam pelo modelo (mais 0,4 s antes, para a memória do modelo assentar);
// o resto da máscara é preto. A máscara sai em 540x960, a 30 quadros/s, sobre a MESMA cadeia de cortes da edição.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { cadeiaVideo } from './midia.js';
import { config } from './config.js';

export const MODELO_RECORTE = process.env.RVM_MODELO || '/models/rvm/rvm_mobilenetv3_fp32.onnx';
const W = 540, H = 960, FPS = 30, AQUECE = 0.4;

export const recorteDisponivel = () => fs.existsSync(MODELO_RECORTE);

/**
 * @param {string} entrada  bruto
 * @param {Array<[number, number]>} trechos  cortes do roteiro
 * @param {Array<[number, number]>} janelas  tempos (vídeo cortado) em que o texto aparece
 * @param {string} saida  .mkv (ffv1, cinza)
 */
export async function mascaraPessoa(entrada, { trechos, janelas, saida, ritmo = false, zoom = 1.1, log = () => {} }) {
  const ort = (await import('onnxruntime-node')).default;
  const sessao = await ort.InferenceSession.create(MODELO_RECORTE, { intraOpNumThreads: Math.max(1, Number(process.env.RVM_THREADS) || 3) });
  const t0 = Date.now();
  const cv = cadeiaVideo(trechos, { w: 1080, h: 1920, zoom, ritmo });
  const filtro = [...cv.partes, `${cv.rotulos.join('')}concat=n=${cv.rotulos.length}:v=1:a=0,fps=${FPS},scale=${W}:${H},format=rgb24[o]`].join(';');
  const dec = spawn(config.ffmpeg, ['-v', 'error', '-i', entrada, '-filter_complex', filtro, '-map', '[o]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const enc = spawn(config.ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', '-', '-c:v', 'ffv1', saida], { stdio: ['pipe', 'ignore', 'pipe'] });
  let erroDec = '', erroEnc = '';
  dec.stderr.on('data', (d) => { erroDec += d; });
  enc.stderr.on('data', (d) => { erroEnc += d; });
  const fimEnc = new Promise((ok, falha) => enc.on('close', (c) => (c === 0 ? ok() : falha(new Error('máscara (gravar): ' + erroEnc.slice(-300))))));
  const fimDec = new Promise((ok, falha) => dec.on('close', (c) => (c === 0 ? ok() : falha(new Error('máscara (ler): ' + erroDec.slice(-300))))));
  const escrever = (buf) => new Promise((ok) => (enc.stdin.write(buf) ? ok() : enc.stdin.once('drain', ok)));

  const precisa = (t) => janelas.some(([a, b]) => t >= a - AQUECE && t <= b + 0.1);
  const zeros = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]);
  const ds = new ort.Tensor('float32', new Float32Array([0.375]), [1]);
  const src = new Float32Array(3 * W * H);
  const preto = Buffer.alloc(W * H);
  const tam = W * H * 3;
  let r = null, i = 0, rodados = 0, sobra = Buffer.alloc(0);
  for await (const pedaco of dec.stdout) {
    sobra = sobra.length ? Buffer.concat([sobra, pedaco]) : pedaco;
    while (sobra.length >= tam) {
      const q = sobra.subarray(0, tam); sobra = sobra.subarray(tam);
      const t = i / FPS; i++;
      if (!precisa(t)) { r = null; await escrever(preto); continue; }
      if (!r) r = [zeros(), zeros(), zeros(), zeros()];        // janela nova: memória do modelo zerada
      for (let p = 0, n = W * H; p < n; p++) { src[p] = q[p * 3] / 255; src[n + p] = q[p * 3 + 1] / 255; src[2 * n + p] = q[p * 3 + 2] / 255; }
      const o = await sessao.run({ src: new ort.Tensor('float32', src, [1, 3, H, W]), r1i: r[0], r2i: r[1], r3i: r[2], r4i: r[3], downsample_ratio: ds });
      r = [o.r1o, o.r2o, o.r3o, o.r4o];
      const pha = o.pha.data, g = Buffer.allocUnsafe(W * H);
      for (let p = 0; p < W * H; p++) g[p] = pha[p] <= 0 ? 0 : pha[p] >= 1 ? 255 : Math.round(pha[p] * 255);
      await escrever(g); rodados++;
    }
  }
  enc.stdin.end();
  await Promise.all([fimDec, fimEnc]);
  await sessao.release?.().catch?.(() => null);
  log(`recorte da pessoa: ${rodados} quadros em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return saida;
}
