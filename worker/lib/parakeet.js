// Transcrição local com o Parakeet (NVIDIA, licença CC-BY-4.0), o mesmo modelo do kit Edição Sem Editor.
// Roda no próprio servidor (sherpa-onnx, CPU): sem custo por vídeo e sem chave de API.
// Saída no mesmo formato do Whisper: palavras [{p, i, f}] com início e fim em segundos.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { rodar } from './midia.js';

let reconhecedor = null;
let sherpa = null;

export const parakeetDisponivel = () => Boolean(config.parakeetDir && fs.existsSync(path.join(config.parakeetDir, 'tokens.txt')));

async function carregar() {
  if (reconhecedor) return reconhecedor;
  sherpa = (await import('sherpa-onnx-node')).default;
  const M = config.parakeetDir;
  reconhecedor = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: path.join(M, 'encoder.int8.onnx'), decoder: path.join(M, 'decoder.int8.onnx'), joiner: path.join(M, 'joiner.int8.onnx') },
      tokens: path.join(M, 'tokens.txt'), numThreads: config.parakeetThreads, provider: 'cpu', modelType: 'nemo_transducer',
    },
  });
  return reconhecedor;
}

// pedaços de até 12 s, cortados no trecho mais silencioso entre 6 e 12 s: em pedaço longo o Parakeet
// pula fala repetida (testado: 25 s perdeu 16% das palavras, 12 s não perdeu nenhuma)
export function pontosDeCorte(amostras, sr = 16000, { min = 6, max = 12 } = {}) {
  const jan = Math.round(0.3 * sr), passo = Math.round(0.05 * sr);
  const cortes = [0];
  let ini = 0;
  while (amostras.length - ini > max * sr) {
    let melhor = ini + max * sr, menor = Infinity;
    for (let k = ini + min * sr; k + jan <= ini + max * sr; k += passo) {
      let e = 0;
      for (let j = k; j < k + jan; j += 4) e += amostras[j] * amostras[j];
      if (e < menor) { menor = e; melhor = k + Math.round(jan / 2); }
    }
    cortes.push(melhor);
    ini = melhor;
  }
  cortes.push(amostras.length);
  return cortes;
}

// tokens do Parakeet → palavras: token que começa com espaço abre palavra nova; pontuação gruda na anterior
export function tokensParaPalavras(r, deslocamento = 0) {
  const palavras = [];
  (r.tokens || []).forEach((tok, k) => {
    const ini = deslocamento + Number(r.timestamps[k]);
    // a duração do último token antes de uma pausa costuma engolir o silêncio: limita a 0,4 s
    const fim = ini + Math.min(0.4, Number(r.durations?.[k] ?? 0.08));
    const txt = tok.replace(/^\s+/, '');
    // número grudado na palavra anterior ("tinha34") vira palavra própria
    const ant = palavras[palavras.length - 1]?.p || '';
    const novo = /^\s/.test(tok) || !palavras.length || (/^\d/.test(txt) && /\p{L}$/u.test(ant));
    if (!txt) return;
    if (novo && !/^[.,!?;:…]+$/.test(txt)) palavras.push({ p: txt, i: ini, f: fim });
    else { const u = palavras[palavras.length - 1]; if (u) { u.p += txt; u.f = Math.max(u.f, fim); } }
  });
  return palavras.map((w) => ({ p: w.p, i: +w.i.toFixed(3), f: +Math.max(w.f, w.i + 0.05).toFixed(3) }));
}

export async function transcreverParakeet(audio) {
  const rec = await carregar();
  const wav = audio.replace(/\.\w+$/, '') + '.16k.wav';
  await rodar(config.ffmpeg, ['-y', '-i', audio, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const onda = sherpa.readWave(wav);
  fs.rmSync(wav, { force: true });
  const sr = onda.sampleRate, s = onda.samples;
  const cortes = pontosDeCorte(s, sr);
  const palavras = [];
  for (let k = 0; k + 1 < cortes.length; k++) {
    const st = rec.createStream();
    st.acceptWaveform({ sampleRate: sr, samples: s.subarray(cortes[k], cortes[k + 1]) });
    rec.decode(st);
    palavras.push(...tokensParaPalavras(rec.getResult(st), cortes[k] / sr));
  }
  return { texto: palavras.map((w) => w.p).join(' '), palavras, segundos: s.length / sr, motor: 'parakeet', usdMinuto: 0 };
}
