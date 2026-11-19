import test from 'node:test';
import assert from 'node:assert/strict';
import { lerPedidoVisual, semLinhasVisuais, mesclarVisual, opcoesVisuais } from '../lib/visual.js';
import { limparPlano, acharFala } from '../lib/design.js';

const MODELO = `TAKES: use só a parte em que ele fala "começo" até "fim".
TIRAR: corta o trecho em que ele fala "ééé".
PALAVRAS-CHAVE: coloca as palavras "resultado", "equipe" e "27 anos" passando por trás dele.
RITMO: deixa as transições mais rápidas e dinâmicas.`;

test('lê o modelo do ajuste', () => {
  assert.deepEqual(lerPedidoVisual(MODELO), { atras: ['resultado', 'equipe', '27 anos'], ritmo: 'dinamico' });
});

test('colchetes não preenchidos viram escolha automática', () => {
  assert.deepEqual(lerPedidoVisual('PALAVRAS-CHAVE: coloca as palavras "[palavra 1]", "[palavra 2]" passando por trás dele.'), { atras: 'auto' });
});

test('texto livre também vale no ajuste', () => {
  assert.equal(lerPedidoVisual('quero umas palavras passando atrás dela').atras, 'auto');
  assert.equal(lerPedidoVisual('deixa o ritmo mais calmo').ritmo, 'normal');
  assert.equal(lerPedidoVisual('tira as palavras de trás, sem texto atrás').atras, false);
});

test('no comando do pedido só vale com rótulo (roteiro pode falar de transição)', () => {
  assert.deepEqual(lerPedidoVisual('Siga este roteiro: a transição energética é rápida e dinâmica', { soRotulo: true }), {});
  assert.equal(lerPedidoVisual('RITMO: dinâmico', { soRotulo: true }).ritmo, 'dinamico');
});

test('linhas visuais não vão para a IA de cortes', () => {
  assert.equal(semLinhasVisuais(MODELO), 'TAKES: use só a parte em que ele fala "começo" até "fim".\nTIRAR: corta o trecho em que ele fala "ééé".');
  assert.equal(semLinhasVisuais('RITMO: mais rápido'), '');
});

test('pedido novo vale por cima e ficha é o padrão', () => {
  assert.deepEqual(mesclarVisual({ ritmo: 'dinamico', atras: ['a'] }, { ritmo: 'normal' }), { ritmo: 'normal', atras: ['a'] });
  assert.deepEqual(opcoesVisuais({ ritmo: true, atras: false }, {}), { ritmo: true, atras: null });
  assert.deepEqual(opcoesVisuais({ ritmo: true, atras: true }, { ritmo: 'normal', atras: false }), { ritmo: false, atras: null });
  assert.deepEqual(opcoesVisuais({}, { atras: ['x'] }), { ritmo: false, atras: ['x'] });
});

const fala = 'a nossa equipe entrega resultado em 27 anos de mercado com equipe própria e resultado garantido para todos os nossos clientes do brasil inteiro desde o primeiro dia'.split(' ');
const palavras = fala.map((p, k) => ({ p, i: k * 0.7, f: k * 0.7 + 0.5 }));

test('acha palavra e expressão na fala, com variação simples', () => {
  assert.deepEqual(acharFala(palavras, 'equipe'), [2, 11]);
  assert.deepEqual(acharFala(palavras, '27 anos'), [6]);
  assert.deepEqual(acharFala(palavras, 'Resultados'), [4, 14]);
});

test('janelas das palavras atrás: fora do gancho, sem encostar uma na outra', () => {
  const p = limparPlano({ gancho: { linha1: 'a', linha2: 'b' } }, { palavras, duracao: palavras.at(-1).f, atras: ['equipe', 'brasil', 'nada disso'] });
  assert.equal(p.atras.length, 2);
  assert.ok(p.atras.every((a) => a.t >= p.ganchoFim + 0.2));
  assert.ok(p.atras[1].t - p.atras[0].t >= 3);
  assert.deepEqual(p.atrasFaltou, ['nada disso']);
  assert.equal(p.atras[0].texto, 'EQUIPE');
});
