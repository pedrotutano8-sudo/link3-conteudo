// Pedido em lote: pasta do Drive com os brutos + documento de roteiros → 1 pedido de reel por roteiro.
// Transcreve cada bruto, o Claude separa os takes por roteiro e o lote cria os pedidos (que seguem a fila normal).
import fs from 'node:fs';
import path from 'node:path';
import * as iaPadrao from './ia.js';
import { medir } from './midia.js';
import { textoArquivo } from './documento.js';

const PASTA = 'application/vnd.google-apps.folder';
const DOC_GOOGLE = 'application/vnd.google-apps.document';
const ehDoc = (f) => [DOC_GOOGLE, 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.mimeType) || /\.(docx|pdf|txt)$/i.test(f.name);
const ehVideo = (f) => /^video\//.test(f.mimeType || '') || /\.(mov|mp4|m4v)$/i.test(f.name);

async function emParalelo(itens, n, fn) {
  const saida = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; saida[k] = await fn(itens[k], k); }
  }));
  return saida;
}

export function criarLote({ db, drive, workDir, ia = iaPadrao, log = console.log }) {
  return async function processarLote(job) {
    // pasta própria por tentativa: uma tentativa anterior que falhou não apaga arquivos desta
    const dir = path.join(workDir, job.id, String(Date.now())); fs.mkdirSync(dir, { recursive: true });
    if (!job.origem_drive_id) throw new Error('Lote sem pasta do Drive');
    await db.atualizar(job.id, 'baixando');
    const meta = await drive.meta(job.origem_drive_id);
    if (meta.mimeType !== PASTA) throw new Error('Para lote, cole o link da PASTA com os vídeos e o roteiro');
    const arquivos = await drive.listar(job.origem_drive_id);
    const docs = arquivos.filter(ehDoc);
    const roteiroDocs = docs.filter((f) => /roteiro/i.test(f.name)).length ? docs.filter((f) => /roteiro/i.test(f.name)) : docs;
    if (!roteiroDocs.length) throw new Error('Não achei o documento de roteiros na pasta (.docx, .pdf, .txt ou Google Docs)');
    const videos = arquivos.filter(ehVideo).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    if (!videos.length) throw new Error('A pasta não tem vídeos');

    // roteiros em texto
    const textos = [];
    for (const d of roteiroDocs) {
      if (d.mimeType === DOC_GOOGLE) { textos.push(await drive.exportarTexto(d.id)); continue; }
      const local = path.join(dir, `roteiro-${textos.length}${path.extname(d.name) || ''}`);
      await drive.baixar(d.id, local);
      textos.push(await textoArquivo(local, d.mimeType));
    }
    const roteiros = textos.join('\n\n---\n\n');
    await db.atualizar(job.id, 'preparando', {}, `Roteiro: ${roteiroDocs.map((d) => d.name).join(', ')} · ${videos.length} vídeos para transcrever`);

    const clienteNome = (await db.cliente(job.client_id))?.nome || '';
    // transcrição de cada bruto
    const custo = { custo_ia_usd: 0, tokens_entrada: 0, tokens_saida: 0, segundos_audio: 0 };
    let feitos = 0;
    const falhas = [];
    const lista = await emParalelo(videos, 3, async (v, k) => {
      const local = path.join(dir, `v${k}${path.extname(v.name) || '.mov'}`), audio = path.join(dir, `v${k}.mp3`);
      try {
        await drive.baixar(v.id, local);
        const info = await medir(local);
        let fala = '';
        if (info.temAudio) {
          await ia.extrairAudio(local, audio);
          const t = await ia.transcrever(audio, { dica: `${clienteNome}. ${roteiros}` });
          fala = t.texto; custo.segundos_audio += t.segundos || info.duracao;
        }
        return { n: k + 1, id: v.id, nome: v.name, duracao: info.duracao, fala };
      } catch (e) {
        // um vídeo com problema não derruba o lote: entra sem fala e fica registrado
        falhas.push(`${v.name}: ${e.message.slice(0, 80)}`);
        return { n: k + 1, id: v.id, nome: v.name, duracao: 0, fala: '', erro: true };
      } finally {
        fs.rmSync(local, { force: true }); fs.rmSync(audio, { force: true });
        if (++feitos % 5 === 0 || feitos === videos.length) await db.atualizar(job.id, 'preparando', {}, `Transcritos ${feitos} de ${videos.length}`).catch(() => {});
      }
    });
    custo.custo_ia_usd += (custo.segundos_audio / 60) * 0.006;
    if (falhas.length === videos.length) throw new Error(`Nenhum vídeo foi transcrito (${falhas[0]})`);
    if (falhas.length) await db.atualizar(job.id, 'preparando', {}, `${falhas.length} vídeo(s) sem transcrição: ${falhas.slice(0, 3).join(' · ')}`);

    await db.atualizar(job.id, 'planejando');
    const cliente = await db.cliente(job.client_id);
    const g = await ia.agruparPorRoteiro({ roteiros, videos: lista, cliente, comando: job.comando });
    custo.custo_ia_usd += g.usd; custo.tokens_entrada += g.tokens.entrada; custo.tokens_saida += g.tokens.saida;
    if (!g.reels.length) throw new Error('O Claude não conseguiu ligar nenhum vídeo aos roteiros');

    const porN = new Map(lista.map((v) => [v.n, v]));
    const novos = g.reels.map((r, k) => {
      const takes = r.videos.map((n) => porN.get(n));
      return {
        org_id: job.org_id, client_id: job.client_id, tipo: 'reel', lote_id: job.id, created_by: job.created_by ?? null,
        origem_drive_id: takes[0].id, origem_nome: `${r.extra ? 'Extra' : `Roteiro ${k + 1}`}: ${r.titulo}`.slice(0, 200),
        origens: takes.map((t) => ({ id: t.id, nome: t.nome })),
        comando: [r.extra
          ? `Peça fora do documento de roteiros (${r.titulo}). Resumo: ${r.roteiro}. Monte a peça completa, com um take bom de cada parte, na ordem.`
          : `Siga este roteiro:\n${r.roteiro || r.titulo}`, job.comando].filter(Boolean).join('\n\n'),
      };
    });
    const criados = await db.criarJobs(novos);
    const resumo = {
      versao: 'lote',
      roteiro_arquivo: roteiroDocs.map((d) => d.name),
      reels: g.reels.map((r, k) => ({ numero: criados[k]?.numero, titulo: r.titulo, extra: r.extra || undefined, takes: r.videos.map((n) => porN.get(n).nome) })),
      sobras: g.sobras.map((n) => porN.get(n).nome),
      videos: lista.map((v) => ({ nome: v.nome, duracao: Math.round(v.duracao || 0), fala: (v.fala || '').slice(0, 400) })),
    };
    await db.atualizar(job.id, 'entregue', { roteiro: resumo, ...custo }, `${criados.length} pedidos de reel criados (#${criados.map((c) => c.numero).join(', #')})`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    log(`lote #${job.numero}: ${criados.length} reels, ${g.sobras.length} vídeos sem roteiro`);
    return 'entregue';
  };
}
