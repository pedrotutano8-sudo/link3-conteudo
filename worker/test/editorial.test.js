import test from 'node:test';
import assert from 'node:assert/strict';
import { ehDescritivo, fidelidade, limparPeca, marcaDoKit, montarHtmlLamina } from '../lib/carrossel.js';

const DESC = `**SLIDE 1 — CAPA**\n\nQUEM ADOTA UMA CRIANÇA TEM DIREITO À LICENÇA-MATERNIDADE?\n\nConheça o que diz a legislação trabalhista.\n\n**SLIDE 2 — O DIREITO À LICENÇA**\n\nSim! A legislação trabalhista também assegura licença-maternidade à empregada que adota uma criança ou adolescente.\n\n**SLIDE 3 — ENCERRAMENTO**\n\nFicou com dúvidas? Entre em contato com a Vidal e Lopes Advocacia.`;

test('descritivo com SLIDE n liga o modo fiel; texto comum não', () => {
  assert.equal(ehDescritivo(DESC), true);
  assert.equal(ehDescritivo('Slide 1 (capa): "Mitos"\n\nSlide 2: Mito: x'), true);
  assert.equal(ehDescritivo('**FELIZ NATAL!**\n\nQue esta data...'), true);
  assert.equal(ehDescritivo('Faça um carrossel sobre férias com 6 lâminas'), false);
});

test('modo fiel: não corta texto longo, mantém parágrafos e quantidade de lâminas', () => {
  const longo = 'palavra '.repeat(80).trim();
  const p = limparPeca({ laminas: [
    { layout: 'texto', titulo: 'QUEM ADOTA UMA CRIANÇA TEM DIREITO À *LICENÇA-MATERNIDADE?* SIM OU NÃO', subtitulo: 'Conheça' },
    { layout: 'texto', titulo: 'O DIREITO', texto: `${longo}\n\nSegundo parágrafo.` },
    { layout: 'texto', titulo: 'Ficou com dúvidas?', texto: 'Entre em contato.' },
  ] }, { fiel: true });
  assert.equal(p.laminas.length, 3);
  assert.deepEqual(p.laminas.map((l) => l.layout), ['capa', 'texto', 'cta']);
  assert.ok(!p.laminas[0].titulo.endsWith('…'));
  assert.ok(p.laminas[1].texto.includes('\n\nSegundo parágrafo.'));
  assert.ok(!p.laminas[1].texto.includes('…'));
  // sem modo fiel continua cortando
  assert.ok(limparPeca({ laminas: [{ layout: 'texto', titulo: 'x', texto: longo }] }).laminas[1].texto.endsWith('…'));
});

test('fidelidade: 1 quando todo o texto do descritivo está nas lâminas, menor quando a IA resume', () => {
  const inteiro = { laminas: [
    { titulo: 'QUEM ADOTA UMA CRIANÇA TEM DIREITO À *LICENÇA-MATERNIDADE?*', subtitulo: 'Conheça o que diz a legislação trabalhista.' },
    { titulo: 'O DIREITO À LICENÇA', texto: 'Sim! A legislação trabalhista também assegura **licença-maternidade à empregada que adota** uma criança ou adolescente.' },
    { titulo: '', texto: 'Ficou com dúvidas? Entre em contato com a Vidal e Lopes Advocacia.' },
  ] };
  assert.equal(fidelidade(DESC, inteiro), 1);
  const resumido = { laminas: [{ titulo: 'Licença-maternidade na adoção' }, { texto: 'Você tem direito.' }, { texto: 'Fale com a gente.' }] };
  assert.ok(fidelidade(DESC, resumido) < 0.3);
});

test('estilo editorial: caixa de destaque, negrito, logo e paginação', () => {
  const marca = marcaDoKit({ acabamento: { design: { ativo: true, estilo: 'editorial', marca: 'Vidal & Lopes', cores: { escuro: '#21434C' } } } });
  assert.equal(marca.estilo, 'editorial');
  const html = montarHtmlLamina({ lamina: { layout: 'texto', titulo: 'O *DIREITO*', texto: 'Um **dois** três\n\nQuatro', itens: [] }, k: 1, n: 5, marca });
  assert.ok(html.includes('<em>DIREITO</em>') && html.includes('<strong>dois</strong>'));
  assert.equal((html.match(/<p>/g) || []).length, 2);
  assert.ok(html.includes('02 / 05'));
  assert.ok(html.includes('box-decoration-break'));
});
