// Ciclo de um pedido de carrossel ou post estático (Módulo 2).
// Entrada opcional no Drive: pasta com fotos e/ou documento de texto, uma foto ou um documento.
// na_fila → lê o Drive → IA escreve e diagrama → lâminas renderizadas → prévia (folha + lâminas) no painel.
// ajuste_pedido → a IA muda só o que foi pedido no plano anterior → nova prévia.
// aprovado → lâminas e legenda numa subpasta da pasta de finalizados do cliente.
import fs from 'node:fs';
import path from 'node:path';
import { planejarPeca, marcaDoKit, montarHtmlLamina, renderizarLaminas, folhaDeLaminas, tratarFoto, recortarFoto, medirFoto } from './carrossel.js';
import { fichaDoKit } from './estilos.js';
import { textoArquivo } from './documento.js';
import { rodar } from './midia.js';
import { config } from './config.js';
import { gerarImagens } from './imagens.js';

const EXT_FOTO = /\.(heic|heif|jpe?g|png|webp)$/i;
const ehFoto = (f) => EXT_FOTO.test(f.name || '') || /^image\//.test(f.mimeType || '');
const ehDoc = (f) => /google-apps\.document|wordprocessingml|pdf|text\/plain/.test(f.mimeType || '') || /\.(docx|pdf|txt|md)$/i.test(f.name || '');
const limpo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').replace(/[^\w.-]+/g, ' ').trim().slice(0, 60);
const MAX_FOTOS = 12;

export function criarPecas({ db, drive, workDir, claudeJson, log = console.log, gerar = gerarImagens }) {
  const pasta = (job) => { const d = path.join(workDir, job.id); fs.mkdirSync(d, { recursive: true }); return d; };
  const estadoArq = (job) => path.join(pasta(job), 'estado.json');
  const ler = (job) => { try { return JSON.parse(fs.readFileSync(estadoArq(job), 'utf8')); } catch { return {}; } };
  const gravar = (job, e) => fs.writeFileSync(estadoArq(job), JSON.stringify({ ...ler(job), ...e }));

  // material do Drive: fotos (baixadas e tratadas) e texto-base. Fica em cache na pasta do pedido.
  async function garantirMaterial(job) {
    const e = ler(job);
    if (e.material && e.material.fotos.every((f) => fs.existsSync(f.arquivo))) return e.material;
    const material = { fotos: [], texto: '' };
    if (job.origem_drive_id) {
      await db.atualizar(job.id, 'baixando');
      const meta = await drive.meta(job.origem_drive_id);
      const itens = meta.mimeType === 'application/vnd.google-apps.folder'
        ? (await drive.listarMidia(job.origem_drive_id)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt', { numeric: true }))
        : [meta];
      const textos = [];
      for (const f of itens.filter(ehDoc).slice(0, 3)) {
        try {
          if (/google-apps\.document/.test(f.mimeType)) textos.push(await drive.exportarTexto(f.id));
          else { const arq = path.join(pasta(job), `doc-${f.id}${path.extname(f.name || '') || '.txt'}`); await drive.baixar(f.id, arq); textos.push(await textoArquivo(arq, f.mimeType)); fs.rmSync(arq, { force: true }); }
        } catch (err) { log(`job ${job.id}: não li o documento ${f.name} (${err.message})`); }
      }
      material.texto = textos.join('\n\n').trim();
      for (const [k, f] of itens.filter(ehFoto).slice(0, MAX_FOTOS).entries()) {
        const bruto = path.join(pasta(job), `bruto-${k}.jpg`);
        // a miniatura grande do Drive já vem em JPG (inclusive de HEIC); sem ela, baixa o arquivo
        let ok = await drive.miniatura(f, bruto, 1600).catch(() => null);
        if (!ok && /\.(jpe?g|png|webp)$/i.test(f.name || '')) { const orig = path.join(pasta(job), `orig-${k}${path.extname(f.name)}`); await drive.baixar(f.id, orig); await rodar(config.ffmpeg, ['-y', '-v', 'error', '-i', orig, '-frames:v', '1', '-q:v', '2', bruto]); fs.rmSync(orig, { force: true }); ok = true; }
        if (!ok || !fs.existsSync(bruto)) continue;
        const arquivo = await tratarFoto(bruto, path.join(pasta(job), `foto-${k}.jpg`));
        fs.rmSync(bruto, { force: true });
        material.fotos.push({ id: f.id, nome: f.name, arquivo, ...(await medirFoto(arquivo)) });
      }
      await db.atualizar(job.id, 'preparando', {}, `Do Drive: ${material.fotos.length} foto(s)${material.texto ? ' e texto-base' : ''}`);
    }
    gravar(job, { material });
    return material;
  }

  async function miniaturaB64(arq) {
    const mini = arq.replace(/\.jpg$/, '.mini.jpg');
    if (!fs.existsSync(mini)) await rodar(config.ffmpeg, ['-y', '-v', 'error', '-i', arq, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease', '-q:v', '5', mini]);
    return fs.readFileSync(mini).toString('base64');
  }

  // lâminas em JPG a partir do plano (determinístico: o mesmo plano gera as mesmas lâminas)
  // imagens geradas do plano: ficam no storage (roteiro.imagens) e em cache na pasta do pedido
  async function imagensLocais(job, roteiro) {
    const out = {};
    for (const [k, im] of Object.entries(roteiro.imagens || {})) {
      const arquivo = path.join(pasta(job), 'imagens', path.basename(im.path));
      if (!fs.existsSync(arquivo)) {
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        try { await db.baixarPrevia(im.path, arquivo); } catch (err) { log(`job ${job.id}: imagem ${im.path} indisponível (${err.message})`); continue; }
      }
      out[k] = { arquivo, tipo: im.tipo, prompt: im.prompt };
    }
    return out;
  }

  async function renderizar(job, roteiro, kit, cliente, material, dir) {
    const marca = marcaDoKit(kit, cliente);
    const imagens = await imagensLocais(job, roteiro);
    const fotos = {};
    for (const [k, f] of material.fotos.entries()) fotos[k] = { ...f, foco: roteiro.focos?.[k] };
    const htmls = [];
    for (const [k, l] of roteiro.laminas.entries()) {
      let recorte = null;
      if (l.recorte && fotos[l.foto]) recorte = await recortarFoto(fotos[l.foto].arquivo, path.join(pasta(job), `recorte-${l.foto}.png`)).catch((err) => { log(`job ${job.id}: recorte falhou (${err.message})`); return null; });
      htmls.push(montarHtmlLamina({ lamina: l, k, n: roteiro.laminas.length, tipo: job.tipo, marca, fotos, recorte, imagens }));
    }
    return renderizarLaminas(htmls, dir, { log: (m) => log(`job ${job.id}: ${m}`) });
  }

  async function planejarERenderizar(job, { ajuste = null } = {}) {
    const [kit, cliente] = await Promise.all([db.kit(job.client_id), db.cliente(job.client_id)]);
    const material = await garantirMaterial(job);
    await db.atualizar(job.id, 'planejando');
    const ficha = fichaDoKit(kit);
    const anterior = ajuste && job.roteiro?.laminas ? job.roteiro : null;
    const fotos = [];
    for (const f of material.fotos) fotos.push({ nome: f.nome, b64: await miniaturaB64(f.arquivo) });
    const marca = marcaDoKit(kit, cliente);
    const comImagens = marca.imagens === 'gerar';
    const r = await planejarPeca({ tipo: job.tipo, comando: job.comando, ficha, marca: cliente.nome, texto: material.texto, fotos, ajuste: ajuste || '', anterior, imagens: comImagens }, { claudeJson });
    let usdImagens = 0;
    let imagensPlano = {};
    if (comImagens && r.plano.laminas.some((l) => l.imagem)) {
      await db.atualizar(job.id, 'planejando', {}, 'Gerando as imagens das lâminas');
      // ajuste: a imagem com a mesma descrição é reaproveitada (não gera de novo)
      const anteriores = anterior ? await imagensLocais(job, anterior) : {};
      const porPrompt = Object.values(anteriores);
      const reaproveitar = {};
      r.plano.laminas.forEach((l, k) => { if (!l.imagem) return; const p = porPrompt.find((a) => a.prompt && a.prompt.startsWith(l.imagem.descricao)); if (p) reaproveitar[k] = p; });
      const g = await gerar(r.plano.laminas, path.join(pasta(job), 'imagens'), { log: (m) => log(`job ${job.id}: ${m}`), anteriores: reaproveitar, tipo: job.tipo });
      usdImagens = g.usd;
      for (const [k, im] of Object.entries(g.imagens)) {
        const destino = `${job.org_id}/${job.id}/imagens/${path.basename(im.arquivo)}`;
        if (!reaproveitar[k] || reaproveitar[k].arquivo !== im.arquivo) await db.enviarPrevia(destino, im.arquivo, im.tipo === 'objeto' ? 'image/png' : 'image/jpeg');
        imagensPlano[k] = { path: destino, tipo: im.tipo, prompt: im.prompt };
      }
    }
    const custo = { custo_ia_usd: (Number(job.custo_ia_usd) || 0) + r.usd + usdImagens, tokens_entrada: (job.tokens_entrada || 0) + r.tokens.entrada, tokens_saida: (job.tokens_saida || 0) + r.tokens.saida };
    const roteiro = { versao: 'peca', tipo: job.tipo, ...r.plano, imagens: imagensPlano, fotos: material.fotos.map((f) => ({ id: f.id, nome: f.nome })), ficha: { estilo: ficha.estilo, nome: ficha.nome, versao: ficha.versao } };
    await db.atualizar(job.id, 'renderizando', { roteiro, kit_versao: kit?.versao ?? null, ...custo });
    const dir = path.join(pasta(job), `previa-${Date.now()}`);
    const jpgs = await renderizar(job, roteiro, kit, cliente, material, dir);
    const folha = await folhaDeLaminas(jpgs, path.join(dir, 'folha.jpg'));
    const base = `${job.org_id}/${job.id}/${path.basename(dir)}`;
    const previas = [];
    for (const [k, j] of jpgs.entries()) previas.push(await db.enviarPrevia(`${base}-${String(k + 1).padStart(2, '0')}.jpg`, j, 'image/jpeg'));
    const destino = await db.enviarPrevia(`${base}-folha.jpg`, folha, 'image/jpeg');
    fs.rmSync(dir, { recursive: true, force: true });
    await db.atualizar(job.id, 'previa_pronta', { previa_path: destino, roteiro: { ...roteiro, previas } });
    return 'previa_pronta';
  }

  async function entregar(job) {
    await db.atualizar(job.id, 'entregando');
    const [kit, cliente] = await Promise.all([db.kit(job.client_id), db.cliente(job.client_id)]);
    const material = await garantirMaterial(job);
    let destinoPasta = cliente.pasta_finalizados_id;
    if (!destinoPasta) {
      if (!cliente.pasta_brutos_id) throw new Error('Cliente sem pasta no Drive cadastrada');
      destinoPasta = await drive.pastaFilha(cliente.pasta_brutos_id, 'Finalizados (sistema)');
    }
    const titulo = limpo(job.roteiro.laminas?.[0]?.titulo || job.origem_nome || (job.tipo === 'post' ? 'post' : 'carrossel'));
    const nomePasta = `${limpo(cliente.nome)} - ${job.numero} - ${job.tipo === 'post' ? 'Post' : 'Carrossel'} - ${titulo}`;
    const sub = await drive.pastaFilha(destinoPasta, nomePasta);
    const jpgs = await renderizar(job, job.roteiro, kit, cliente, material, path.join(pasta(job), 'final'));
    for (const [k, j] of jpgs.entries()) await drive.enviar(j, { nome: `${String(k + 1).padStart(2, '0')}.jpg`, pastaId: sub, mime: 'image/jpeg' });
    if (job.roteiro.copy) {
      const txt = path.join(pasta(job), 'legenda.txt');
      fs.writeFileSync(txt, job.roteiro.copy + '\n');
      await drive.enviar(txt, { nome: 'legenda.txt', pastaId: sub, mime: 'text/plain' });
    }
    await db.atualizar(job.id, 'entregue', { final_drive_id: sub }, `No Drive: ${nomePasta} (${jpgs.length} lâmina${jpgs.length > 1 ? 's' : ''})`);
    fs.rmSync(pasta(job), { recursive: true, force: true });
    return 'entregue';
  }

  async function processar(job) {
    switch (job.status) {
      case 'na_fila': case 'planejando': case 'baixando': case 'preparando': case 'renderizando': return planejarERenderizar(job);
      case 'ajuste_pedido': return planejarERenderizar(job, { ajuste: await db.ultimoAjuste(job.id) });
      case 'aprovado': case 'entregando': return entregar(job);
      default: throw new Error(`status inesperado na fila: ${job.status}`);
    }
  }
  return { processar };
}
