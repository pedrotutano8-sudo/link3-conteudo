// Ciclo de um pedido. Cada etapa avança o status no banco (o painel acompanha ao vivo).
// Etapa 0 (Base): baixa o bruto do Drive, aplica o logo da marca e devolve na pasta de finalizados.
// Módulo 1 (planejarM1): transcrição, corte de pausas, legenda dinâmica, gancho e copy.
import fs from 'node:fs';
import path from 'node:path';
import { medir, montarComLogo, montarEdicao, rodar, juntarBrutos } from './midia.js';
import { gerarAss } from './legenda.js';

const extensao = (nome, mime) => path.extname(nome || '') || ({ 'video/quicktime': '.mov', 'video/mp4': '.mp4' }[mime] || '.mp4');
const limpo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, ' ').trim();

// planejador da Base: sem IA, só registra o que vai ser feito
export async function planejarBase({ info, kit }) {
  return { roteiro: { versao: 'base', duracao_final: info.duracao, logo: Boolean(kit?.logo_id), formato: '1080x1920' }, custo: {} };
}

export function criarEtapas({ db, drive, workDir, planejar = planejarBase, lote = null, log = console.log }) {
  const pasta = (job) => { const d = path.join(workDir, job.id); fs.mkdirSync(d, { recursive: true }); return d; };
  const estadoArq = (job) => path.join(pasta(job), 'estado.json');
  const ler = (job) => { try { return JSON.parse(fs.readFileSync(estadoArq(job), 'utf8')); } catch { return {}; } };
  const gravar = (job, e) => fs.writeFileSync(estadoArq(job), JSON.stringify({ ...ler(job), ...e }));

  async function garantirBruto(job) {
    const e = ler(job);
    if (e.bruto && fs.existsSync(e.bruto)) return e;
    // reel com vários takes (veio de um lote): baixa todos e junta na ordem
    if (Array.isArray(job.origens) && job.origens.length > 1) {
      await db.atualizar(job.id, 'baixando');
      const locais = [];
      for (const [k, o] of job.origens.entries()) {
        const meta = await drive.meta(o.id);
        const dest = path.join(pasta(job), `take-${String(k).padStart(2, '0')}${extensao(meta.name, meta.mimeType)}`);
        await drive.baixar(o.id, dest);
        locais.push(dest);
      }
      const bruto = path.join(pasta(job), 'bruto.mp4');
      await juntarBrutos(locais, bruto);
      locais.forEach((l) => fs.rmSync(l, { force: true }));
      await db.atualizar(job.id, 'preparando', {}, `Baixados e juntados ${locais.length} takes`);
      const info = await medir(bruto);
      gravar(job, { bruto, nome: job.origem_nome || 'roteiro', info });
      return ler(job);
    }
    if (!job.origem_drive_id) throw new Error('Pedido sem arquivo do Drive');
    await db.atualizar(job.id, 'baixando');
    const meta = await drive.meta(job.origem_drive_id);
    if (meta.mimeType === 'application/vnd.google-apps.folder') throw new Error('O link é de uma pasta: para reel, cole o link do vídeo');
    const bruto = path.join(pasta(job), 'bruto' + extensao(meta.name, meta.mimeType));
    await drive.baixar(job.origem_drive_id, bruto);
    await db.atualizar(job.id, 'preparando', {}, `Baixado: ${meta.name}`);
    const info = await medir(bruto);
    if (!info.largura) throw new Error('O arquivo não tem vídeo');
    gravar(job, { bruto, nome: meta.name, info });
    return ler(job);
  }

  async function logoLocal(job, kit) {
    if (!kit?.logo_id) return null;
    const a = await db.asset(kit.logo_id);
    if (/svg/i.test(a.mime || a.nome)) { log(`job ${job.id}: logo em SVG ainda não suportado na Base, usando sem logo`); return null; }
    const destino = path.join(pasta(job), 'logo' + (path.extname(a.nome) || '.png'));
    if (!fs.existsSync(destino)) await db.baixarAsset(a.storage_path, destino);
    return destino;
  }

  // fonte da marca: asset enviado (ttf/otf) → pasta do pedido; nome da família lido com fc-scan
  async function fonteLocal(job, kit) {
    const ref = kit?.fontes?.corpo || kit?.fontes?.titulo;
    if (!ref) return {};
    if (!/^[0-9a-f-]{36}$/i.test(ref)) return { familia: ref };
    try {
      const a = await db.asset(ref);
      const dir = path.join(pasta(job), 'fontes'); fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, path.basename(a.nome || 'fonte.ttf'));
      if (!fs.existsSync(arq)) await db.baixarAsset(a.storage_path, arq);
      const familia = (await rodar('fc-scan', ['--format', '%{family[0]}', arq])).trim();
      return familia ? { fontsDir: dir, familia } : {};
    } catch (err) { log(`job ${job.id}: fonte da marca não carregou (${err.message}), usando a padrão`); return {}; }
  }

  async function renderizar(job, e, roteiro, kit, saida, { previa = false } = {}) {
    const logo = await logoLocal(job, kit);
    if (roteiro?.versao !== 'm1') return montarComLogo(e.bruto, saida, { logo, previa });
    const f = await fonteLocal(job, kit);
    const ass = path.join(pasta(job), 'legenda.ass');
    fs.writeFileSync(ass, gerarAss({ palavras: roteiro.palavras, duracao: roteiro.duracao_final, kit: kit || {}, titulo: roteiro.titulo, ...(f.familia ? { fonte: f.familia } : {}) }));
    return montarEdicao(e.bruto, saida, { trechos: roteiro.trechos, ass, fontsDir: f.fontsDir, logo, previa, temAudio: e.info.temAudio });
  }

  async function planejarERenderizar(job, { ajuste } = {}) {
    const e = await garantirBruto(job);
    const kit = await db.kit(job.client_id);
    if (job.status !== 'planejando') await db.atualizar(job.id, 'planejando');
    const cliente = await db.cliente(job.client_id);
    const r = await planejar({ job, cliente, kit, info: e.info, ajuste, respostas: await db.respostas(job.id), roteiroAnterior: job.roteiro, bruto: e.bruto, pasta: pasta(job) });
    if (r.pergunta) { await db.perguntar(job.id, r.pergunta, r.opcoes); return 'aguardando_resposta'; }
    await db.atualizar(job.id, 'renderizando', { roteiro: r.roteiro, kit_versao: kit?.versao ?? null, ...r.custo });
    const previa = path.join(pasta(job), `previa-${Date.now()}.mp4`);
    await renderizar(job, e, r.roteiro, kit, previa, { previa: true });
    const destino = await db.enviarPrevia(`${job.org_id}/${job.id}/${path.basename(previa)}`, previa);
    fs.rmSync(previa, { force: true });
    await db.atualizar(job.id, 'previa_pronta', { previa_path: destino });
    return 'previa_pronta';
  }

  async function entregar(job) {
    const e = await garantirBruto(job);
    await db.atualizar(job.id, 'entregando');
    const [cliente, kit] = await Promise.all([db.cliente(job.client_id), db.kit(job.client_id)]);
    // sem pasta de finalizados cadastrada: cria "Finalizados (sistema)" dentro da pasta do cliente
    let destinoPasta = cliente.pasta_finalizados_id;
    if (!destinoPasta) {
      if (!cliente.pasta_brutos_id) throw new Error('Cliente sem pasta no Drive cadastrada');
      destinoPasta = await drive.pastaFilha(cliente.pasta_brutos_id, 'Finalizados (sistema)');
    }
    const final = path.join(pasta(job), 'final.mp4');
    await renderizar(job, e, job.roteiro, kit, final);
    const nome = `${limpo(cliente.nome)} - ${job.numero} - ${limpo(path.parse(e.nome || job.origem_nome || 'reel').name)}.mp4`;
    const arq = await drive.enviar(final, { nome, pastaId: destinoPasta });
    await db.atualizar(job.id, 'entregue', { final_drive_id: arq.id }, `No Drive: ${nome}`);
    fs.rmSync(pasta(job), { recursive: true, force: true });
    return 'entregue';
  }

  async function processar(job) {
    if (job.tipo === 'lote') {
      if (!lote) throw new Error('Pedido em lote precisa do Módulo 1 ligado (chaves de IA no servidor)');
      return lote(job);
    }
    if (job.tipo !== 'reel') throw new Error('Carrossel e post entram no Módulo 2 (a partir de 01/12)');
    switch (job.status) {
      case 'na_fila': case 'planejando': return planejarERenderizar(job);
      case 'ajuste_pedido': return planejarERenderizar(job, { ajuste: await db.ultimoAjuste(job.id) });
      case 'aprovado': return entregar(job);
      default: throw new Error(`status inesperado na fila: ${job.status}`);
    }
  }
  return { processar };
}
