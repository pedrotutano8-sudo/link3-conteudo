// Imagens geradas por IA para as lâminas (marcas com "imagens": "gerar" no design.json, como a Vidal).
// A IA do plano descreve cada imagem; aqui ela vira foto (cena) ou objeto recortado (PNG com fundo transparente)
// na API de imagens da OpenAI. Sem chave (ou se a geração falhar), a lâmina sai só com tipografia.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { laminaEscura } from './laminas-editorial.js';

export const ESTILO_FOTO = 'Fotografia realista de banco de imagens premium, estilo editorial: pessoas brasileiras comuns com expressões e mãos naturais, '
  + 'luz natural suave, tons neutros acinzentados com toques de verde-petróleo, profundidade de campo rasa, composição limpa com espaço livre na parte de cima. '
  + 'Sem nenhum texto, letra, número legível, logotipo ou marca d\'água.';
export const ESTILO_OBJETO = 'Foto realista de estúdio de um único objeto, inteiro e centralizado, isolado em fundo transparente, '
  + 'luz suave lateral, sombras naturais. Sem texto, logotipo ou marca d\'água.';

// preço aproximado (US$) por imagem 1024x1536 por qualidade, para a conta de custo do pedido
const PRECO = { low: 0.016, medium: 0.063, high: 0.25 };

export function promptImagem(img) {
  const d = String(img?.descricao || '').trim();
  return img?.tipo === 'objeto' ? `${d}. ${ESTILO_OBJETO}` : `${d}. ${ESTILO_FOTO}`;
}

/**
 * Gera as imagens pedidas no plano. Devolve { [indiceDaLamina]: {arquivo, tipo} } e o custo.
 * @param {Array} laminas  lâminas do plano (cada uma pode ter imagem: {tipo, descricao})
 */
export async function gerarImagens(laminas, dir, { fetchImpl = fetch, log = () => {}, chave = config.openaiKey, anteriores = {}, tipo = 'carrossel' } = {}) {
  const saida = {};
  let usd = 0;
  if (!chave) { if (laminas.some((l) => l.imagem)) log('imagens: sem OPENAI_API_KEY, lâminas sem imagem'); return { imagens: saida, usd }; }
  // o mesmo gerador do ChatGPT primeiro; se a conta não tiver o modelo, tenta o próximo
  const modelos = [...new Set([process.env.IMAGEM_MODELO, 'chatgpt-image-latest', 'gpt-image-2.6-flare', 'gpt-image-1.5', 'gpt-image-1'].filter(Boolean))];
  const qualidade = process.env.IMAGEM_QUALIDADE || 'medium';
  fs.mkdirSync(dir, { recursive: true });
  const tarefas = laminas.map(async (l, k) => {
    if (!l.imagem?.descricao) return;
    // cena em lâmina clara vira faixa larga embaixo do texto: horizontal, para não cortar as pessoas; o resto, vertical
    const tamanho = tipo !== 'reel' && l.imagem.tipo !== 'objeto' && !laminaEscura(l, k, laminas.length, tipo, true) ? '1536x1024' : '1024x1536';
    const prompt = `${promptImagem(l.imagem)}${tamanho === '1536x1024' ? ' Enquadramento horizontal, pessoas inteiras no quadro com a cabeça no terço de cima.' : ''}|${tamanho}`;
    // ajuste: a mesma descrição reaproveita a imagem já gerada
    const ant = anteriores[k];
    if (ant && (ant.prompt === prompt || `${ant.prompt}|1024x1536` === prompt) && fs.existsSync(ant.arquivo)) { saida[k] = ant; return; }
    try {
      let b64 = null;
      let erro = '';
      for (const modelo of modelos) {
        const r = await fetchImpl('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelo, prompt: prompt.split('|')[0], size: tamanho, quality: qualidade, n: 1, ...(l.imagem.tipo === 'objeto' ? { background: 'transparent', output_format: 'png' } : { output_format: 'jpeg' }) }),
        });
        const j = await r.json().catch(() => ({}));
        b64 = j?.data?.[0]?.b64_json;
        if (r.ok && b64) break;
        erro = j?.error?.message || `HTTP ${r.status}`;
        if (!/does not exist|not found|model/i.test(erro)) break;
      }
      if (!b64) throw new Error(erro);
      const arquivo = path.join(dir, `img-${String(k + 1).padStart(2, '0')}-${Date.now().toString(36)}.${l.imagem.tipo === 'objeto' ? 'png' : 'jpg'}`);
      fs.writeFileSync(arquivo, Buffer.from(b64, 'base64'));
      saida[k] = { arquivo, tipo: l.imagem.tipo === 'objeto' ? 'objeto' : 'cena', prompt };
      usd += PRECO[qualidade] ?? PRECO.medium;
    } catch (e) {
      log(`imagem da lâmina ${k + 1} falhou: ${e.message}`);
    }
  });
  await Promise.all(tarefas);
  log(`imagens: ${Object.keys(saida).length} gerada(s)`);
  return { imagens: saida, usd };
}
