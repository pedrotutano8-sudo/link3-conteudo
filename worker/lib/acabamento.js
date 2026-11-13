// Acabamento do reel: imagens de apoio (B-roll) das pastas da marca e trilha de fundo.
// B-roll: as pastas do Drive cadastradas no kit (acabamento.pastas_broll, ou acabamento.pasta_broll_id) viram um
// catálogo: cada vídeo ou foto ganha uma descrição (Claude olhando a miniatura que o próprio Drive gera, sem
// baixar o arquivo). No planejamento o Claude escolhe 2 ou 3 trechos da fala para cobrir, e o sistema registra
// o que cada reel usou para os próximos reels da marca não repetirem as mesmas imagens.
// Foto entra com um zoom lento (efeito Ken Burns). Vídeo entra pelo miolo do clipe.
// Trilha: arquivo da pasta de trilhas do servidor (TRILHAS_DIR); o kit pode fixar uma (acabamento.trilha).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { rodar } from './midia.js';

const EXT_VIDEO = /\.(mov|mp4|m4v)$/i;
const EXT_FOTO = /\.(heic|heif|jpe?g|png|webp)$/i;
const tipoDe = (f) => (EXT_VIDEO.test(f.name) || /^video\//.test(f.mimeType || '') ? 'video'
  : EXT_FOTO.test(f.name) || /^image\//.test(f.mimeType || '') ? 'foto' : null);
const LOTE_DESCRICAO = 20;

export const pastasBroll = (kit) => {
  const a = kit?.acabamento || {};
  return [...new Set([...(Array.isArray(a.pastas_broll) ? a.pastas_broll : []), a.pasta_broll_id].filter(Boolean))];
};

export function criarAcabamento({ drive, ia, workDir, log = console.log }) {
  const dirMarca = (kit) => { const d = path.join(workDir, '_broll', String(kit?.client_id || 'marca')); fs.mkdirSync(d, { recursive: true }); return d; };
  const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };

  // catálogo de todas as pastas de B-roll da marca: [{id, nome, tipo, duracao, descricao, pasta}]
  async function catalogo(kit) {
    const dir = dirMarca(kit);
    const arqCat = path.join(dir, 'catalogo.json');
    let cat = lerJson(arqCat, []);
    const arquivos = [];
    for (const pasta of pastasBroll(kit)) {
      for (const f of await drive.listarMidia(pasta)) { const tipo = tipoDe(f); if (tipo) arquivos.push({ ...f, tipo, pasta }); }
    }
    const novos = arquivos.filter((f) => !cat.some((c) => c.id === f.id));
    const custo = { usd: 0, entrada: 0, saida: 0 };
    for (let k = 0; k < novos.length; k += LOTE_DESCRICAO) {
      const lote = [];
      for (const f of novos.slice(k, k + LOTE_DESCRICAO)) {
        const mini = path.join(dir, `${f.id}.mini.jpg`);
        const ok = fs.existsSync(mini) || await drive.miniatura(f, mini, 640).catch(() => null);
        if (!ok) continue;
        const vm = f.videoMediaMetadata || {}, im = f.imageMediaMetadata || {};
        lote.push({
          id: f.id, nome: f.name, tipo: f.tipo, pasta: f.pasta,
          duracao: f.tipo === 'foto' ? 4 : Math.max(1, Number(vm.durationMillis || 5000) / 1000),
          vertical: Number(vm.height || im.height || 0) > Number(vm.width || im.width || 0),
          quadroB64: fs.readFileSync(mini).toString('base64'),
        });
      }
      if (!lote.length) continue;
      const d = await ia.descreverBroll(lote);
      custo.usd += d.usd; custo.entrada += d.tokens.entrada; custo.saida += d.tokens.saida;
      lote.forEach((c, j) => { c.descricao = d.descricoes[j] || c.nome; delete c.quadroB64; });
      cat = [...cat.filter((c) => !lote.some((n) => n.id === c.id)), ...lote];
      fs.writeFileSync(arqCat, JSON.stringify(cat, null, 1));
    }
    if (novos.length) log(`B-roll da marca: ${cat.length} itens no catálogo (${novos.length} novos)`);
    const vivos = new Set(arquivos.map((f) => f.id));
    return { clipes: cat.filter((c) => vivos.has(c.id) && c.descricao), custo };
  }

  // onde entram os clipes (tempos do vídeo final, já cortado), evitando o que outros reels da marca já usaram
  async function planejarBroll({ kit, job, palavras, duracao }) {
    const zero = { usd: 0, entrada: 0, saida: 0 };
    if (!pastasBroll(kit).length || !palavras?.length) return { broll: [], custo: zero };
    const { clipes, custo } = await catalogo(kit);
    if (!clipes.length) return { broll: [], custo };
    const arqUsos = path.join(dirMarca(kit), 'usos.json');
    const usos = lerJson(arqUsos, {});
    for (const id of Object.keys(usos)) usos[id] = (usos[id] || []).filter((j) => j !== job?.id);   // replanejar não conta como uso
    const usadoPorOutro = (c) => (usos[c.id] || []).length > 0;
    const livres = clipes.filter((c) => !usadoPorOutro(c));
    // com material livre suficiente, o Claude só vê o que ainda não foi usado; senão vê tudo, menos usados primeiro
    const oferta = livres.length >= 8 ? livres : [...clipes].sort((a, b) => (usos[a.id]?.length || 0) - (usos[b.id]?.length || 0));
    const r = await ia.escolherBroll({ palavras, clipes: oferta.map((c) => ({ ...c, descricao: `${c.tipo === 'foto' ? '[foto] ' : ''}${c.descricao}${usadoPorOutro(c) ? ' (já usado em outro reel)' : ''}` })) });
    const usados = new Set();
    const broll = [];
    for (const e of r.escolhas) {
      const c = oferta[Number(e.clipe)], a = palavras[Number(e.de)], b = palavras[Number(e.ate)];
      if (!c || !a || !b || usados.has(c.id)) continue;
      const inicio = a.i;
      const fim = Math.min(Math.max(b.f, inicio + 2), inicio + 3.5, c.tipo === 'foto' ? inicio + 3.5 : inicio + c.duracao - 0.2, duracao - 2);
      if (inicio < 3 || fim - inicio < 1.5) continue;
      if (broll.some((x) => inicio < x.fim + 3 && fim > x.inicio - 3)) continue;
      usados.add(c.id);
      // vídeo: usa o miolo do clipe (começo e fim costumam ter câmera tremendo)
      const offset = c.tipo === 'foto' ? 0 : Math.max(0, (c.duracao - (fim - inicio)) / 2);
      broll.push({ id: c.id, nome: c.nome, tipo: c.tipo, inicio: +inicio.toFixed(2), fim: +fim.toFixed(2), offset: +offset.toFixed(2) });
    }
    broll.sort((x, y) => x.inicio - y.inicio);
    if (job?.id) { for (const b of broll) usos[b.id] = [...(usos[b.id] || []), job.id]; fs.writeFileSync(arqUsos, JSON.stringify(usos)); }
    return { broll, custo: { usd: custo.usd + r.usd, entrada: custo.entrada + r.tokens.entrada, saida: custo.saida + r.tokens.saida } };
  }

  // arquivos locais dos clipes escolhidos: vídeo é baixado; foto vira um clipe curto com zoom lento
  async function arquivosBroll(kit, broll, { previa = false } = {}) {
    if (!broll?.length) return [];
    const dir = dirMarca(kit);
    const [w, h] = previa ? [540, 960] : [1080, 1920];
    const saida = [];
    for (const b of broll) {
      if (b.tipo === 'foto') {
        const jpg = path.join(dir, `${b.id}.foto.jpg`);
        if (!fs.existsSync(jpg)) {
          // o Drive entrega a foto (inclusive HEIC do iPhone) já em JPEG pela miniatura grande
          const meta = await drive.meta(b.id);
          const ok = meta.thumbnailLink ? await drive.miniatura(meta, jpg, 2000).catch(() => null) : null;
          if (!ok) { if (/\.heic|\.heif/i.test(b.nome)) throw new Error(`foto ${b.nome} sem miniatura no Drive`); await drive.baixar(b.id, jpg); }
        }
        const dur = Math.max(1, b.fim - b.inicio) + 0.2, frames = Math.round(dur * 30);
        const clipe = path.join(dir, `${b.id}.kb-${w}-${frames}.mp4`);
        if (!fs.existsSync(clipe)) {
          await rodar(config.ffmpeg, ['-y', '-loop', '1', '-i', jpg, '-vf',
            `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='1+0.08*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30,format=yuv420p`,
            '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', clipe]);
        }
        saida.push({ ...b, arquivo: clipe, offset: 0 });
        continue;
      }
      let arquivo = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => path.basename(f).startsWith(b.id) && EXT_VIDEO.test(f) && !/\.kb-/.test(f));
      if (!arquivo) { arquivo = path.join(dir, b.id + (path.extname(b.nome || '') || '.mp4')); await drive.baixar(b.id, arquivo); }
      saida.push({ ...b, arquivo });
    }
    return saida;
  }

  return { planejarBroll, arquivosBroll, catalogo };
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
