// Planejador do Módulo 1: transcreve, corta pausas, gera gancho + copy e devolve o roteiro.
// O render usa o roteiro (trechos + palavras + título); o painel mostra a copy.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { calcularCortes, repeticoes } from './cortes.js';
import * as iaPadrao from './ia.js';
import { detectarSilencios, audioEditado } from './midia.js';

export function criarPlanejadorM1({ ia = iaPadrao } = {}) {
  return async function planejarM1({ job, cliente, kit, info, ajuste, roteiroAnterior, bruto, pasta }) {
    const custo = { custo_ia_usd: 0, tokens_entrada: 0, tokens_saida: 0, segundos_audio: 0 };

    // transcrição: reaproveita a do roteiro anterior (ajuste não paga de novo)
    let transcricao = roteiroAnterior?.transcricao;
    if (!transcricao?.palavras?.length) {
      if (!info.temAudio) return { roteiro: { versao: 'base', duracao_final: info.duracao, motivo: 'vídeo sem áudio' }, custo: {} };
      const audio = await ia.extrairAudio(bruto, path.join(pasta, 'audio.mp3'));
      const dica = [cliente?.nome, job.comando].filter(Boolean).join('. ');
      const t = await ia.transcrever(audio, { dica });
      fs.rmSync(audio, { force: true });
      transcricao = { texto: t.texto, palavras: t.palavras };
      custo.segundos_audio = t.segundos || info.duracao;
      custo.custo_ia_usd += (custo.segundos_audio / 60) * (t.usdMinuto ?? 0.006);
      transcricao.motor = t.motor;
    }

    const g = await ia.gancoECopy({ texto: transcricao.texto, palavras: transcricao.palavras, cliente, comando: job.comando, ajuste, anterior: roteiroAnterior });
    // erros de gravação e takes repetidos saem antes do corte de pausas (viram silêncio e são cortados junto)
    const fora = new Set();
    for (const [a, b] of g.remover || []) for (let k = a; k <= b; k++) fora.add(k);
    const certas = transcricao.palavras.map((w, k) => ({ ...w }));
    for (const [k, txt] of g.corrigir || []) {
      // mantém a pontuação original grudada na palavra
      const pont = (certas[k].p.match(/[.,!?;:]+$/) || [''])[0];
      certas[k].p = txt.replace(/[.,!?;:]+$/, '') + pont;
    }
    // gagueira/repetição colada que a IA deixou passar
    // (roda sobre o que a IA manteve, para não cortar as duas cópias quando ela já tirou uma)
    const idx = certas.map((_, k) => k).filter((k) => !fora.has(k));
    const repet = [...repeticoes(idx.map((k) => certas[k]))].map((m) => idx[m]);
    for (const k of repet) fora.add(k);
    const mantidas = certas.filter((_, k) => !fora.has(k));
    const { silencios } = info.temAudio ? await detectarSilencios(bruto).catch(() => ({ silencios: [] })) : { silencios: [] };
    let cortes = calcularCortes(mantidas, { duracao: info.duracao, pausa: config.pausaMax, silencios });

    // revisão: transcreve a fala JÁ editada (pega gagueira que a 1ª transcrição "limpou") e o Claude marca o que ainda sobra
    let revisado = [];
    if (config.revisao && ia.revisarFala && cortes.trechos.length && cortes.duracaoFinal > 3) {
      try {
        const aud = await audioEditado(bruto, cortes.trechos, path.join(pasta, 'revisao.mp3'));
        const t2 = await ia.transcrever(aud, { dica: [cliente?.nome, job.comando].filter(Boolean).join('. ') });
        fs.rmSync(aud, { force: true });
        custo.segundos_audio += t2.segundos || cortes.duracaoFinal;
        custo.custo_ia_usd += ((t2.segundos || cortes.duracaoFinal) / 60) * (t2.usdMinuto ?? 0.006);
        const rv = await ia.revisarFala({ palavras: t2.palavras });
        custo.custo_ia_usd += rv.usd; custo.tokens_entrada += rv.tokens.entrada; custo.tokens_saida += rv.tokens.saida;
        // repetição colada que só apareceu na 2ª transcrição entra junto com o que o revisor marcou
        const jaMarcadas = new Set(rv.remover.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, m) => a + m)));
        rv.remover = [...rv.remover, ...[...repeticoes(t2.palavras)].filter((k) => !jaMarcadas.has(k)).map((k) => [k, k])];
        if (rv.remover.length) {
          // tempo da fala editada → tempo do bruto
          const inicios = []; let acc = 0;
          for (const [a, b] of cortes.trechos) { inicios.push(acc); acc += b - a; }
          const paraBruto = (t) => {
            for (let k = cortes.trechos.length - 1; k >= 0; k--) if (t >= inicios[k] - 1e-6) return cortes.trechos[k][0] + Math.min(t - inicios[k], cortes.trechos[k][1] - cortes.trechos[k][0]);
            return cortes.trechos[0][0];
          };
          const forcados = rv.remover.map(([a, b]) => [paraBruto(t2.palavras[a].i - 0.02), paraBruto(t2.palavras[b].f + 0.02)]);
          revisado = rv.remover.map(([a, b]) => t2.palavras.slice(a, b + 1).map((w) => w.p).join(' '));
          cortes = calcularCortes(mantidas, { duracao: info.duracao, pausa: config.pausaMax, silencios, cortesForcados: forcados });
        }
      } catch (e) { revisado = [`(revisão não rodou: ${e.message.slice(0, 80)})`]; }
    }
    // conferência: palavra repetida colada que sobrou (sinal de gagueira não cortada)
    const norm = (p) => p.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const repetidas = cortes.palavras.filter((w, k, a) => k > 0 && norm(w.p) && norm(w.p) === norm(a[k - 1].p)).map((w) => w.p);
    custo.custo_ia_usd += g.usd;
    custo.tokens_entrada += g.tokens.entrada;
    custo.tokens_saida += g.tokens.saida;

    return {
      roteiro: {
        versao: 'm1',
        titulo: g.titulo,
        copy: g.copy,
        trechos: cortes.trechos,
        palavras: cortes.palavras,
        duracao_bruto: info.duracao,
        duracao_final: cortes.duracaoFinal,
        segundos_cortados: cortes.cortado,
        removido: [...(g.remover || []).map(([a, b]) => transcricao.palavras.slice(a, b + 1).map((w) => w.p).join(' ')), ...repet.map((k) => `${transcricao.palavras[k].p} (repetição)`)],
        qa: { motor: transcricao.motor || 'whisper', silencios_cortados: silencios.length, repetidas_restantes: repetidas, revisao: revisado },
        transcricao,
        formato: '1080x1920',
        logo: Boolean(kit?.logo_id),
      },
      custo,
    };
  };
}
