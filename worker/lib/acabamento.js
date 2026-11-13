// Acabamento do reel: imagens de apoio (B-roll) da pasta da marca e trilha de fundo.
// B-roll: a pasta do Drive cadastrada no kit (acabamento.pasta_broll_id) é baixada uma vez, cada clipe ganha uma
// descrição (Claude olhando um quadro) e o catálogo fica em cache no servidor. No planejamento o Claude escolhe
// 2 ou 3 trechos da fala para cobrir com os clipes que combinam.
// Trilha: arquivo da pasta de trilhas do servidor (TRILHAS_DIR); o kit pode fixar uma (acabamento.trilha).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { medir, rodar } from './midia.js';

const VIDEO = /\.(mov|mp4|m4v)$/i;

export function criarAcabamento({ drive, ia, workDir, log = console.log }) {
  // catálogo da pasta de B-roll: [{id, nome, duracao, descricao, arquivo}]
  async function catalogo(pastaId) {
    const dir = path.join(workDir, '_broll', pastaId);
    fs.mkdirSync(dir, { recursive: true });
    const arqCat = path.join(dir, 'catalogo.json');
    let cat = [];
    try { cat = JSON.parse(fs.readFileSync(arqCat, 'utf8')); } catch { cat = []; }
    const arquivos = (await drive.listar(pastaId)).filter((f) => VIDEO.test(f.name) || /^video\//.test(f.mimeType || ''));
    const novos = [];
    for (const f of arquivos) {
      if (cat.some((c) => c.id === f.id && fs.existsSync(c.arquivo))) continue;
      const arquivo = path.join(dir, f.id + (path.extname(f.name) || '.mp4'));
      if (!fs.existsSync(arquivo)) await drive.baixar(f.id, arquivo);
      const info = await medir(arquivo).catch(() => null);
      if (!info?.largura || !(info.duracao > 1)) continue;
      const quadro = path.join(dir, f.id + '.jpg');
      await rodar(config.ffmpeg, ['-y', '-ss', String(info.duracao / 2), '-i', arquivo, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', quadro]);
      novos.push({ id: f.id, nome: f.name, duracao: info.duracao, arquivo, quadroB64: fs.readFileSync(quadro).toString('base64') });
    }
    let custo = { usd: 0, entrada: 0, saida: 0 };
    if (novos.length) {
      const d = await ia.descreverBroll(novos);
      custo = { usd: d.usd, entrada: d.tokens.entrada, saida: d.tokens.saida };
      novos.forEach((c, k) => { c.descricao = d.descricoes[k] || c.nome; delete c.quadroB64; });
      cat = [...cat.filter((c) => !novos.some((n) => n.id === c.id)), ...novos];
      fs.writeFileSync(arqCat, JSON.stringify(cat, null, 1));
      log(`B-roll ${pastaId}: ${novos.length} clipe(s) catalogado(s)`);
    }
    return { clipes: cat.filter((c) => arquivos.some((f) => f.id === c.id)), custo };
  }

  // onde entram os clipes (tempos do vídeo final, já cortado)
  async function planejarBroll({ kit, palavras, duracao }) {
    const pastaId = kit?.acabamento?.pasta_broll_id;
    if (!pastaId || !palavras?.length) return { broll: [], custo: { usd: 0, entrada: 0, saida: 0 } };
    const { clipes, custo } = await catalogo(pastaId);
    if (!clipes.length) return { broll: [], custo };
    const r = await ia.escolherBroll({ palavras, clipes });
    const usados = new Set();
    const broll = [];
    for (const e of r.escolhas) {
      const c = clipes[Number(e.clipe)], a = palavras[Number(e.de)], b = palavras[Number(e.ate)];
      if (!c || !a || !b || usados.has(c.id)) continue;
      let inicio = a.i, fim = Math.max(b.f, inicio + 2);
      fim = Math.min(fim, inicio + 3.5, inicio + c.duracao - 0.2, duracao - 2);
      if (inicio < 3 || fim - inicio < 1.5) continue;
      if (broll.some((x) => inicio < x.fim + 3 && fim > x.inicio - 3)) continue;
      usados.add(c.id);
      // usa o miolo do clipe (começo e fim de clipe costumam ter câmera tremendo)
      const offset = Math.max(0, (c.duracao - (fim - inicio)) / 2);
      broll.push({ id: c.id, nome: c.nome, inicio: +inicio.toFixed(2), fim: +fim.toFixed(2), offset: +offset.toFixed(2) });
    }
    broll.sort((x, y) => x.inicio - y.inicio);
    return { broll, custo: { usd: custo.usd + r.usd, entrada: custo.entrada + r.tokens.entrada, saida: custo.saida + r.tokens.saida } };
  }

  // arquivos locais dos clipes escolhidos (baixa de novo se o cache sumiu)
  async function arquivosBroll(kit, broll) {
    if (!broll?.length) return [];
    const pastaId = kit?.acabamento?.pasta_broll_id;
    const dir = path.join(workDir, '_broll', pastaId || 'sem-pasta');
    fs.mkdirSync(dir, { recursive: true });
    const saida = [];
    for (const b of broll) {
      let arquivo = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => path.basename(f).startsWith(b.id) && VIDEO.test(f));
      if (!arquivo) { arquivo = path.join(dir, b.id + (path.extname(b.nome || '') || '.mp4')); await drive.baixar(b.id, arquivo); }
      saida.push({ ...b, arquivo });
    }
    return saida;
  }

  return { planejarBroll, arquivosBroll };
}

// trilha: a fixada no kit (acabamento.trilha) ou a primeira da pasta de trilhas do servidor
export function escolherTrilha(kit) {
  const dir = config.trilhasDir;
  if (!dir || !fs.existsSync(dir)) return null;
  const lista = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f)).sort();
  if (!lista.length) return null;
  const fixa = kit?.acabamento?.trilha;
  if (fixa === 'nenhuma') return null;
  const nome = (fixa && lista.find((f) => f === fixa || f.startsWith(fixa))) || lista[0];
  return path.join(dir, nome);
}
