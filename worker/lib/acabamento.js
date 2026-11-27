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
import { fichaDoKit, contextoFicha } from './estilos.js';
import { gerarImagens } from './imagens.js';

const EXT_VIDEO = /\.(mov|mp4|m4v)$/i;
const EXT_FOTO = /\.(heic|heif|jpe?g|png|webp)$/i;
const tipoDe = (f) => (EXT_VIDEO.test(f.name) || /^video\//.test(f.mimeType || '') ? 'video'
  : EXT_FOTO.test(f.name) || /^image\//.test(f.mimeType || '') ? 'foto' : null);
const LOTE_DESCRICAO = 20;
// mesma mídia em pastas diferentes tem o mesmo nome de arquivo: o uso é contado pelo nome
const chave = (c) => String(c.nome || c.id).toLowerCase();

export const pastasBroll = (kit) => {
  const a = kit?.acabamento || {};
  return [...new Set([...(Array.isArray(a.pastas_broll) ? a.pastas_broll : []), a.pasta_broll_id].filter(Boolean))];
};

// B-roll gerado por IA quando a marca não tem pasta de imagens: precisa da chave da OpenAI e do B-roll ligado na ficha.
// acabamento.broll_ia = false desliga; = true liga mesmo com pastas (completa quando o catálogo não combina).
export const usaBrollIA = (kit, chave = config.openaiKey) => {
  const a = kit?.acabamento || {};
  if (!chave || a.broll_ia === false) return false;
  return fichaDoKit(kit).elementos?.cartoes !== false;
};

export function criarAcabamento({ drive, ia, workDir, log = console.log, gerar = gerarImagens }) {
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
    // o mesmo arquivo pode estar em mais de uma pasta (mesmo nome): entra uma vez só
    const vistos = new Set();
    const clipes = cat.filter((c) => vivos.has(c.id) && c.descricao).filter((c) => { const k = chave(c); if (vistos.has(k)) return false; vistos.add(k); return true; });
    return { clipes, custo };
  }

  // onde entram os clipes (tempos do vídeo final, já cortado), evitando o que outros reels da marca já usaram
  // fotos geradas por IA no lugar do B-roll da marca: Claude escolhe o trecho e descreve, a OpenAI gera, o resto do
  // caminho é o mesmo das fotos do Drive (zoom lento, cartão). Ficam em _broll/<cliente>/ia-<job>-<n>.foto.jpg
  async function brollIA({ kit, job, palavras, duracao, custo }) {
    if (!ia.imaginarBroll) return { broll: [], custo };
    const r = await ia.imaginarBroll({ palavras, contexto: contextoFicha(fichaDoKit(kit)) });
    custo = { usd: custo.usd + r.usd, entrada: custo.entrada + r.tokens.entrada, saida: custo.saida + r.tokens.saida };
    const trechos = [];
    for (const e of r.escolhas) {
      const a = palavras[Number(e.de)], b = palavras[Number(e.ate)];
      if (!a || !b || !String(e.descricao || '').trim()) continue;
      const inicio = a.i;
      const fim = Math.min(Math.max(b.f, inicio + 2), inicio + 3.5, duracao - 2);
      if (inicio < 3 || fim - inicio < 1.5) continue;
      if (trechos.some((x) => inicio < x.fim + 3 && fim > x.inicio - 3)) continue;
      trechos.push({ inicio: +inicio.toFixed(2), fim: +fim.toFixed(2), descricao: String(e.descricao).trim() });
      if (trechos.length === 3) break;
    }
    if (!trechos.length) return { broll: [], custo };
    const dir = dirMarca(kit);
    const tag = String(job?.numero || job?.id || Date.now()).replace(/[^\w-]/g, '');
    // foto vertical de tela cheia (o cartão recorta ao centro)
    const g = await gerar(trechos.map((t) => ({ layout: 'texto', imagem: { tipo: 'cena', descricao: t.descricao } })), path.join(dir, `ia-${tag}`), { log, tipo: 'reel' });
    custo = { ...custo, usd: custo.usd + g.usd };
    const broll = [];
    trechos.forEach((t, k) => {
      const im = g.imagens[k];
      if (!im) return;
      const id = `ia-${tag}-${k + 1}`;
      fs.copyFileSync(im.arquivo, path.join(dir, `${id}.foto.jpg`));
      broll.push({ id, nome: `${id}.jpg`, tipo: 'foto', ia: true, descricao: t.descricao, inicio: t.inicio, fim: t.fim, offset: 0 });
    });
    if (broll.length) log(`job ${job?.id}: ${broll.length} foto(s) de B-roll geradas por IA`);
    return { broll, custo };
  }

  async function planejarBroll({ kit, job, palavras, duracao }) {
    const zero = { usd: 0, entrada: 0, saida: 0 };
    if (!palavras?.length) return { broll: [], custo: zero };
    if (!pastasBroll(kit).length) return usaBrollIA(kit) ? brollIA({ kit, job, palavras, duracao, custo: zero }) : { broll: [], custo: zero };
    const { clipes, custo } = await catalogo(kit);
    if (!clipes.length) return usaBrollIA(kit) ? brollIA({ kit, job, palavras, duracao, custo }) : { broll: [], custo };
    const arqUsos = path.join(dirMarca(kit), 'usos-por-nome.json');
    const usos = lerJson(arqUsos, {});
    for (const k of Object.keys(usos)) usos[k] = (usos[k] || []).filter((j) => j !== job?.id);   // replanejar não conta como uso
    const usadoPorOutro = (c) => (usos[chave(c)] || []).length > 0;
    const livres = clipes.filter((c) => !usadoPorOutro(c));
    // com material livre suficiente, o Claude só vê o que ainda não foi usado; senão vê tudo, menos usados primeiro
    const oferta = livres.length >= 8 ? livres : [...clipes].sort((a, b) => (usos[chave(a)]?.length || 0) - (usos[chave(b)]?.length || 0));
    const r = await ia.escolherBroll({ palavras, contexto: contextoFicha(fichaDoKit(kit)), clipes: oferta.map((c) => ({ ...c, descricao: `${c.tipo === 'foto' ? '[foto] ' : ''}${c.descricao}${usadoPorOutro(c) ? ' (já usado em outro reel)' : ''}` })) });
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
    if (job?.id) { for (const b of broll) usos[chave(b)] = [...(usos[chave(b)] || []), job.id]; fs.writeFileSync(arqUsos, JSON.stringify(usos)); }
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
        if (!fs.existsSync(jpg) && b.ia) throw new Error(`foto gerada ${b.id} não está mais no servidor`);
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
