// Planejador do Módulo 1: transcreve, corta pausas, gera gancho + copy e devolve o roteiro.
// O render usa o roteiro (trechos + palavras + título); o painel mostra a copy.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { calcularCortes } from './cortes.js';
import * as iaPadrao from './ia.js';

export function criarPlanejadorM1({ ia = iaPadrao } = {}) {
  return async function planejarM1({ job, cliente, kit, info, ajuste, roteiroAnterior, bruto, pasta }) {
    const custo = { custo_ia_usd: 0, tokens_entrada: 0, tokens_saida: 0, segundos_audio: 0 };

    // transcrição: reaproveita a do roteiro anterior (ajuste não paga de novo)
    let transcricao = roteiroAnterior?.transcricao;
    if (!transcricao?.palavras?.length) {
      if (!info.temAudio) return { roteiro: { versao: 'base', duracao_final: info.duracao, motivo: 'vídeo sem áudio' }, custo: {} };
      const audio = await ia.extrairAudio(bruto, path.join(pasta, 'audio.mp3'));
      const t = await ia.transcrever(audio);
      fs.rmSync(audio, { force: true });
      transcricao = { texto: t.texto, palavras: t.palavras };
      custo.segundos_audio = t.segundos || info.duracao;
      custo.custo_ia_usd += (custo.segundos_audio / 60) * 0.006;
    }

    const cortes = calcularCortes(transcricao.palavras, { duracao: info.duracao, pausa: config.pausaMax });
    const g = await ia.gancoECopy({ texto: transcricao.texto, cliente, comando: job.comando, ajuste, anterior: roteiroAnterior });
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
        transcricao,
        formato: '1080x1920',
        logo: Boolean(kit?.logo_id),
      },
      custo,
    };
  };
}
