// Teste do carrossel sem banco e sem IA: renderiza um plano (JSON) com fotos locais.
// Uso: node scripts/teste-carrossel.mjs <plano.json> <saida-dir> [marca=gnx] [foto0.jpg foto1.jpg ...]
// O plano tem o formato que a IA devolve ({laminas, focos, copy, cta}); "tipo" opcional ("post").
import fs from 'node:fs';
import path from 'node:path';
import { limparPeca, marcaDoKit, montarHtmlLamina, renderizarLaminas, folhaDeLaminas, tratarFoto, recortarFoto, medirFoto } from '../lib/carrossel.js';
import { MARCAS_DIR } from '../lib/design.js';

const [planoArq, dir, marcaNome = 'gnx', ...fotosIn] = process.argv.slice(2);
if (!planoArq || !dir) { console.error('uso: node scripts/teste-carrossel.mjs <plano.json> <saida-dir> [marca] [fotos...]'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const bruto = JSON.parse(fs.readFileSync(planoArq, 'utf8'));
const tipo = bruto.tipo || 'carrossel';
const plano = limparPeca(bruto, { tipo, nFotos: fotosIn.length, fiel: Boolean(bruto.fiel ?? true) });
const design = JSON.parse(fs.readFileSync(path.join(MARCAS_DIR, marcaNome, 'design.json'), 'utf8'));
const marca = marcaDoKit({ acabamento: { design } });
const fotos = {};
for (const [k, f] of fotosIn.entries()) {
  if (!plano.laminas.some((l) => l.foto === k)) continue;
  const arquivo = await tratarFoto(f, path.join(dir, `foto-${k}.jpg`));
  fotos[k] = { arquivo, foco: plano.focos[k], ...(await medirFoto(arquivo)) };
}
// imagens geradas (teste): "arquivos": {"0": {"arquivo": "capa.jpg", "tipo": "cena"}} no plano
const imagens = {};
for (const [k, v] of Object.entries(bruto.arquivos || {})) imagens[k] = { arquivo: path.resolve(path.dirname(planoArq), v.arquivo), tipo: v.tipo };
const t0 = Date.now();
const htmls = [];
for (const [k, l] of plano.laminas.entries()) {
  const recorte = l.recorte ? await recortarFoto(fotos[l.foto].arquivo, path.join(dir, `recorte-${k}.png`)) : null;
  htmls.push(montarHtmlLamina({ lamina: l, k, n: plano.laminas.length, tipo, marca, fotos, recorte, imagens }));
}
const jpgs = await renderizarLaminas(htmls, dir, { log: console.log });
await folhaDeLaminas(jpgs, path.join(dir, 'folha.jpg'));
console.log(`ok em ${((Date.now() - t0) / 1000).toFixed(1)} s · ${jpgs.length} lâminas · ${path.join(dir, 'folha.jpg')}`);
