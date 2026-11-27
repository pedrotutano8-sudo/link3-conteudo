import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarAcabamento, usaBrollIA } from '../lib/acabamento.js';

const palavras = Array.from({ length: 60 }, (_, k) => ({ p: `p${k}`, i: k * 0.5, f: k * 0.5 + 0.4 }));

test('B-roll por IA: sem pasta de imagens, gera fotos nos trechos escolhidos e respeita as regras de tempo', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'brollia-'));
  const ia = { imaginarBroll: async () => ({ usd: 0.01, tokens: { entrada: 1, saida: 1 }, escolhas: [
    { de: 2, ate: 6, descricao: 'nos 3 primeiros segundos: não pode' },
    { de: 10, ate: 15, descricao: 'mão segurando dentadura' },
    { de: 12, ate: 16, descricao: 'colado no anterior: não pode' },
    { de: 30, ate: 35, descricao: 'pessoa sorrindo' },
  ] }) };
  const pedidos = [];
  const gerar = async (laminas, dir) => {
    fs.mkdirSync(dir, { recursive: true });
    pedidos.push(...laminas.map((l) => l.imagem.descricao));
    const imagens = {};
    laminas.forEach((l, k) => { const a = path.join(dir, `img-${k}.jpg`); fs.writeFileSync(a, 'x'); imagens[k] = { arquivo: a, tipo: 'cena' }; });
    return { imagens, usd: 0.12 };
  };
  const ac = criarAcabamento({ drive: {}, ia, workDir: work, log: () => {}, gerar });
  const kit = { client_id: 'vita', acabamento: { ficha: { estilo: 'institucional' } } };
  const prev = process.env.OPENAI_API_KEY;
  const { config } = await import('../lib/config.js');
  const chaveAntes = config.openaiKey; config.openaiKey = 'sk-teste';
  try {
    const r = await ac.planejarBroll({ kit, job: { id: 'j1' }, palavras, duracao: 30 });
    assert.deepEqual(pedidos, ['mão segurando dentadura', 'pessoa sorrindo']);
    assert.equal(r.broll.length, 2);
    assert.ok(r.broll.every((b) => b.tipo === 'foto' && b.ia && b.inicio >= 3));
    assert.ok(fs.existsSync(path.join(work, '_broll', 'vita', `${r.broll[0].id}.foto.jpg`)));
    assert.ok(Math.abs(r.custo.usd - 0.13) < 1e-9);
    // desligado no kit
    assert.equal(usaBrollIA({ acabamento: { broll_ia: false } }, 'sk'), false);
    // sem chave
    assert.equal(usaBrollIA(kit, ''), false);
  } finally { config.openaiKey = chaveAntes; if (prev === undefined) delete process.env.OPENAI_API_KEY; }
});
