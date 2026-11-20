import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRelatorio } from '../lib/relatorios.js';

test('relatório: totais, médias por formato, taxa de interação, melhores e piores', () => {
  const p = (id, tipo, publicada_em, m) => ({ id, job: { numero: Number(id.slice(1)), tipo }, publicada_em, metricas: m, titulo: 't' + id });
  const r = calcularRelatorio([
    p('p1', 'reel', '2026-11-17T15:00:00Z', { alcance: 1000, views: 1800, curtidas: 40, comentarios: 5, salvos: 10, compartilhamentos: 5 }),
    p('p2', 'carrossel', '2026-11-18T15:00:00Z', { alcance: 400, views: 600, curtidas: 20, comentarios: 2, salvos: 15, compartilhamentos: 3 }),
    p('p3', 'reel', '2026-11-19T22:30:00Z', { alcance: 200, views: 300, curtidas: 4, comentarios: 0, salvos: 0, compartilhamentos: 0 }),
    p('p4', 'post', '2026-11-20T12:00:00Z', { parcial: true, curtidas: 7, comentarios: 1 }),
  ]);
  assert.equal(r.posts, 4);
  assert.equal(r.parcial, true);
  assert.equal(r.totais.alcance, 1600); assert.equal(r.totais.curtidas, 71);
  assert.equal(r.por_tipo.reel.posts, 2); assert.equal(r.por_tipo.reel.alcance_medio, 600);
  assert.equal(r.itens[0].taxa, 6); // (40+5+10+5)/1000
  assert.equal(r.itens[1].taxa, 10);
  assert.equal(r.itens[0].hora, 12); assert.equal(r.itens[0].dia, 'terça'); // 15:00 UTC = 12:00 em São Paulo
  assert.equal(r.itens[2].dia, 'quinta'); assert.equal(r.itens[2].hora, 19);
  assert.deepEqual(r.melhores, ['p1', 'p2', 'p3']);
  assert.equal(r.piores[0], 'p4');
  assert.equal(calcularRelatorio([]).posts, 0);
});
