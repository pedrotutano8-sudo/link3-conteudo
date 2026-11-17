import test from 'node:test';
import assert from 'node:assert/strict';
import { fichaDoKit, conflitos, contextoFicha } from '../lib/estilos.js';
import { designDoKit, montarHtml, limparPlano, temposDesign } from '../lib/design.js';

const palavras = 'Oi eu sou a Luna da GNX e hoje vou te mostrar como a gente cuida de recrutamento folha treinamento e gestão'.split(' ').map((p, k) => ({ p, i: 0.3 + k * 0.4, f: 0.6 + k * 0.4 }));
const duracao = 9;

test('ficha padrão: com identidade é institucional, sem identidade é simples', () => {
  assert.equal(fichaDoKit({ acabamento: { design: { ativo: true } } }).estilo, 'institucional');
  assert.equal(fichaDoKit({}).estilo, 'simples');
  assert.equal(designDoKit({ acabamento: { design: { ativo: true }, ficha: { estilo: 'simples' } } }), null);
});

test('elemento marcado no painel vence o padrão do estilo', () => {
  const f = fichaDoKit({ acabamento: { ficha: { estilo: 'institucional', elementos: { pb: false } } } });
  assert.equal(f.elementos.pb, false);
  assert.equal(f.elementos.capitulos, true);
});

test('briefing que contradiz o estilo vira aviso', () => {
  const f = fichaDoKit({ acabamento: { ficha: { estilo: 'institucional', briefing: 'Sem música, a marca prefere só a voz. Também não quer preto e branco.' } } });
  const c = conflitos(f);
  assert.equal(c.length, 2);
  assert.match(contextoFicha(f), /BRIEFING/);
});

test('estilo criador: sem moldura de cartão, sem encerramento e sem P&B', () => {
  const cfg = designDoKit({ acabamento: { design: { ativo: true }, ficha: { estilo: 'criador' } } });
  assert.deepEqual(temposDesign(cfg), { pb: 0, cauda: 0 });
  const plano = limparPlano({ capitulos: [{ palavra: 14, rotulo: 'x', titulo: 'y' }], gancho: { linha1: 'a', linha2: 'b c' } }, { palavras, duracao, el: cfg.el });
  assert.equal(plano.capitulos.length, 0);
  const { html, total } = montarHtml({ plano, palavras, duracao, cfg, broll: [{ inicio: 4, fim: 6.5 }] });
  assert.equal(total, duracao);
  assert.ok(!html.includes('class="x moldura"'));
});
