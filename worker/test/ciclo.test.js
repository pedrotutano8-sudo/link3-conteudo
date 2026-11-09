import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rodar, medir } from '../lib/midia.js';
import { criarEtapas } from '../lib/etapas.js';
import { criarDrive } from '../lib/drive.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l3-'));
const bruto = path.join(tmp, 'gravacao.mov'), logo = path.join(tmp, 'logo.png');
await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', bruto]);
await rodar('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0xF0C41D:size=300x120', '-frames:v', '1', logo]);

function fakes() {
  const eventos = [], drivePasta = path.join(tmp, 'drive-finalizados'); fs.mkdirSync(drivePasta, { recursive: true });
  const previas = path.join(tmp, 'previas'); fs.mkdirSync(previas, { recursive: true });
  const db = {
    atualizar: async (id, status, campos = {}, msg) => eventos.push({ status, campos, msg }),
    perguntar: async (id, p) => eventos.push({ status: 'aguardando_resposta', p }),
    cliente: async () => ({ nome: 'Clínica Sorriso', pasta_finalizados_id: 'pastaFin' }),
    kit: async () => ({ versao: 3, logo_id: 'a1' }),
    asset: async () => ({ nome: 'logo.png', mime: 'image/png', storage_path: 'org/c1/logo.png' }),
    baixarAsset: async (p, d) => fs.copyFileSync(logo, d),
    enviarPrevia: async (p, arq) => { fs.copyFileSync(arq, path.join(previas, path.basename(p))); return p; },
    respostas: async () => [], ultimoAjuste: async () => 'tira o começo',
  };
  const drive = {
    meta: async () => ({ id: 'b1', name: 'Gravação Maria.mov', mimeType: 'video/quicktime' }),
    baixar: async (id, d) => fs.copyFileSync(bruto, d),
    enviar: async (arq, { nome, pastaId }) => { fs.copyFileSync(arq, path.join(drivePasta, nome)); return { id: 'fin1', name: nome, pastaId }; },
  };
  return { db, drive, eventos, drivePasta, previas };
}

test('pedido de teste: Drive → logo → prévia → aprovado → Drive', async () => {
  const f = fakes();
  const { processar } = criarEtapas({ db: f.db, drive: f.drive, workDir: path.join(tmp, 'work'), log: () => {} });
  const job = { id: 'j1', org_id: 'org', client_id: 'c1', numero: 14, tipo: 'reel', origem_drive_id: 'b1', status: 'na_fila' };
  assert.equal(await processar(job), 'previa_pronta');
  assert.deepEqual(f.eventos.map((e) => e.status), ['baixando', 'preparando', 'planejando', 'renderizando', 'previa_pronta']);
  const pv = fs.readdirSync(f.previas)[0]; const mp = await medir(path.join(f.previas, pv));
  assert.equal(`${mp.largura}x${mp.altura}`, '540x960'); assert.ok(mp.temAudio);
  assert.equal(f.eventos[3].campos.kit_versao, 3);

  assert.equal(await processar({ ...job, status: 'ajuste_pedido' }), 'previa_pronta');   // reaproveita o bruto, não baixa de novo
  assert.equal(f.eventos.filter((e) => e.status === 'baixando').length, 1);

  assert.equal(await processar({ ...job, status: 'aprovado' }), 'entregue');
  const fin = fs.readdirSync(f.drivePasta); assert.deepEqual(fin, ['Clinica Sorriso - 14 - Gravacao Maria.mp4']);
  const mf = await medir(path.join(f.drivePasta, fin[0]));
  assert.equal(`${mf.largura}x${mf.altura}`, '1080x1920'); assert.ok(Math.abs(mf.duracao - 4) < 0.2);
  assert.ok(!fs.existsSync(path.join(tmp, 'work', 'j1')), 'limpa a pasta de trabalho');
  // tira um quadro do final para conferir o logo no canto
  await rodar('ffmpeg', ['-y', '-ss', '1', '-i', path.join(f.drivePasta, fin[0]), '-frames:v', '1', '-vf', 'scale=270:480', path.join(tmp, 'quadro.png')]);
  console.log('quadro:', path.join(tmp, 'quadro.png'));
});

test('erros claros: pasta no lugar do vídeo e carrossel antes do Módulo 2', async () => {
  const f = fakes(); f.drive.meta = async () => ({ name: 'Pasta', mimeType: 'application/vnd.google-apps.folder' });
  const { processar } = criarEtapas({ db: f.db, drive: f.drive, workDir: path.join(tmp, 'work2'), log: () => {} });
  await assert.rejects(processar({ id: 'j2', tipo: 'reel', origem_drive_id: 'x', status: 'na_fila' }), /pasta/);
  await assert.rejects(processar({ id: 'j3', tipo: 'carrossel', status: 'na_fila' }), /Módulo 2/);
});

test('Drive: mensagens de 404/403 e upload resumível', async () => {
  const chamadas = [];
  const fetchFn = async (url, o) => { chamadas.push([o?.method || 'GET', url.split('?')[0]]);
    if (url.includes('nao-existe')) return new Response('{}', { status: 404 });
    if (url.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { location: 'https://up/sessao' } });
    if (url === 'https://up/sessao') return Response.json({ id: 'novo', name: 'x.mp4' });
    return Response.json({ id: 'b1', name: 'a.mp4', mimeType: 'video/mp4' }); };
  const d = criarDrive({ token: 't', fetchFn });
  await assert.rejects(d.meta('nao-existe'), /não encontrado/);
  const r = await d.enviar(bruto, { nome: 'x.mp4', pastaId: 'p' });
  assert.equal(r.id, 'novo'); assert.deepEqual(chamadas.slice(-2).map((c) => c[0]), ['POST', 'PUT']);
});
