// Texto de documentos de roteiro: .docx (zip lido na mão), .pdf (pdftotext), .txt e Google Docs (exportado pelo Drive).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { rodar } from './midia.js';

// lê um arquivo de dentro de um zip pelo diretório central (sem dependência externa)
export function lerDoZip(buf, nome) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo .docx inválido');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), tamComp = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const n = buf.toString('utf8', p + 46, p + 46 + nLen);
    if (n === nome) {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(ini, ini + tamComp);
      return metodo === 0 ? dados : zlib.inflateRawSync(dados);
    }
    p += 46 + nLen + xLen + cLen;
  }
  throw new Error(`${nome} não encontrado no .docx`);
}

const entidades = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export function textoDocx(buf) {
  const xml = lerDoZip(buf, 'word/document.xml').toString('utf8');
  return xml
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => entidades[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function textoArquivo(arquivo, mime = '') {
  if (/wordprocessingml|\.docx$/i.test(mime + arquivo)) return textoDocx(fs.readFileSync(arquivo));
  if (/pdf/i.test(mime) || /\.pdf$/i.test(arquivo)) return (await rodar('pdftotext', ['-layout', arquivo, '-'])).trim();
  return fs.readFileSync(arquivo, 'utf8').trim();
}
