import test from 'node:test';
import assert from 'node:assert/strict';
import { limparPlano, gruposLegenda, montarHtml, designDoKit } from '../lib/design.js';

const palavras = 'Oi eu sou a Luna da GNX e hoje vou te mostrar como a gente cuida de recrutamento folha treinamento e gestão para a sua empresa crescer sem dor de cabeça com mais de vinte e sete anos de mercado'.split(' ').map((p, k) => ({ p, i: 0.3 + k * 0.4, f: 0.6 + k * 0.4 }));
const duracao = 0.3 + palavras.length * 0.4 + 0.3;

test('plano descarta capítulo fora da janela e em cima do B-roll', () => {
  const p = limparPlano({ capitulos: [{ palavra: 1, rotulo: 'a', titulo: 'cedo' }, { palavra: 14, rotulo: 'diferencial', titulo: 'cuidamos de tudo' }, { palavra: 20, rotulo: 'x', titulo: 'em cima do broll' }], destaques: [6, 999] },
    { palavras, duracao, broll: [{ inicio: 8, fim: 10.5 }] });
  assert.deepEqual(p.capitulos.map((c) => c.titulo), ['cuidamos de tudo']);
  assert.equal(p.capitulos[0].rotulo, 'DIFERENCIAL');
  assert.deepEqual(p.destaques, [6]);
});

test('lista só entra com 3 itens ou mais', () => {
  assert.equal(limparPlano({ lista: [{ palavra: 15, texto: 'a' }, { palavra: 16, texto: 'b' }] }, { palavras, duracao }).lista.length, 0);
  assert.equal(limparPlano({ lista: [{ palavra: 15, texto: 'a' }, { palavra: 16, texto: 'b' }, { palavra: 17, texto: 'c' }] }, { palavras, duracao }).lista.length, 3);
});

test('legenda em grupos de até 3 palavras', () => {
  assert.ok(gruposLegenda(palavras).every((g) => g.length <= 3));
});

test('página da camada tem uma legenda por grupo e o encerramento', () => {
  const cfg = designDoKit({ acabamento: { design: { ativo: true, cta: 'Saiba mais' } } });
  const { html, total } = montarHtml({ plano: limparPlano({ gancho: { linha1: 'O que diferencia a', linha2: 'GNX Group?', destaque: 'GNX' } }, { palavras, duracao }), palavras, duracao, cfg });
  assert.equal((html.match(/class="x leg"/g) || []).length, gruposLegenda(palavras).length);
  assert.ok(html.includes('Saiba mais') && total > duracao);
  assert.ok(html.includes('data-d="1">GNX'));
});
