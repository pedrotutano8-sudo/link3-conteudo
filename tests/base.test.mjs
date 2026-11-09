import { PGlite } from '@electric-sql/pglite'; import fs from 'fs'; import assert from 'assert';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;`);
const sql = (f) => fs.readFileSync('supabase/migrations/' + f, 'utf8');
await db.exec(sql('001_base.sql')); await db.exec(sql('002_supabase.sql'));
await db.exec(sql('001_base.sql')); await db.exec(sql('002_supabase.sql'));   // idempotente
await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;`);

const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333';
await db.exec(`insert into public.orgs (id, nome) values ('00000000-0000-0000-0000-0000000000b0', 'Outra');
insert into public.convites (email, org_id, papel) values ('editor@link3.com', '00000000-0000-0000-0000-00000000a003', 'editor'), ('x@outra.com', '00000000-0000-0000-0000-0000000000b0', 'admin');
insert into auth.users values ('${U1}', 'Pedro@lideratedigital.com.br'), ('${U2}', 'editor@link3.com'), ('${U3}', 'x@outra.com'), ('44444444-4444-4444-4444-444444444444', 'intruso@x.com');`);
const p = await db.query(`select email, papel from profiles order by email`);
assert.equal(p.rows.length, 3, 'só quem tem convite vira perfil'); console.log('perfis', p.rows.map(r => r.email + ':' + r.papel).join(', '));

const como = async (uid, q, params) => { await db.exec(`set role authenticated; select set_config('t.uid', '${uid}', false);`); try { return await db.query(q, params); } finally { await db.exec(`reset role; select set_config('t.uid', '', false);`); } };

// editor cria cliente, kit e pedido sem informar org
const c = await como(U2, `insert into clients (nome, instagram, ctas) values ('Clínica Sorriso', '@sorriso', '{"Chama no WhatsApp"}') returning id, org_id`);
const cid = c.rows[0].id; assert.equal(c.rows[0].org_id, '00000000-0000-0000-0000-00000000a003');
await como(U2, `insert into brand_kits (client_id, cores) values ($1, '{"principal":"#F0C41D"}')`, [cid]);
await como(U2, `update brand_kits set cores = '{"principal":"#000000"}' where client_id = $1`, [cid]);
const k = await db.query(`select versao from brand_kits`); assert.equal(k.rows[0].versao, 2, 'versão do kit sobe');
const j = await como(U2, `insert into jobs (client_id, tipo, origem_drive_id, comando) values ($1, 'reel', 'drive123', 'corta as pausas') returning id, status`, [cid]);
const jid = j.rows[0].id;

// outra org não vê nada
const ver = await como(U3, `select (select count(*) from clients) c, (select count(*) from jobs) j, (select count(*) from job_events) e`);
assert.deepEqual([ver.rows[0].c, ver.rows[0].j, ver.rows[0].e].map(Number), [0, 0, 0], 'isolamento entre orgs');
// editor não consegue pular status nem chamar função do worker
let bloq = 0; try { await como(U2, `update jobs set status = 'entregue' where id = $1`, [jid]); } catch { bloq++; }
const st = await db.query(`select status from jobs`); assert.equal(st.rows[0].status, 'na_fila', 'editor não muda status direto');
try { await como(U2, `select * from pegar_job('w1')`); } catch { bloq++; }
assert.equal(bloq, 2, 'editor não muda status e não chama função do worker');

// ciclo do worker (service_role = superuser aqui)
const pego = await db.query(`select id, status from pegar_job('w1')`); assert.equal(pego.rows[0].id, jid);
assert.equal((await db.query(`select count(*) n from pegar_job('w2')`)).rows[0].n, 0, 'segundo worker não pega o mesmo');
for (const s of ['baixando', 'preparando', 'planejando']) await db.query(`select atualizar_job($1, $2)`, [jid, s]);
await db.query(`select perguntar($1, 'O CTA final é WhatsApp ou link na bio?', '{WhatsApp,"Link na bio"}')`, [jid]);
const q = await como(U2, `select id from questions where job_id = $1`, [jid]);
await como(U2, `select responder_pergunta($1, 'WhatsApp')`, [q.rows[0].id]);
assert.equal((await db.query(`select status from jobs`)).rows[0].status, 'planejando', 'resposta devolve para planejando');
await db.query(`select * from pegar_job('w1')`);
await db.query(`select atualizar_job($1, 'renderizando', '{"roteiro":{"cortes":[1]},"kit_versao":2,"custo_ia_usd":0.03,"tokens_entrada":9000}')`, [jid]);
await db.query(`select atualizar_job($1, 'previa_pronta', '{"previa_path":"a003/x.mp4"}')`, [jid]);
await como(U2, `select pedir_ajuste($1, 'tira o segundo corte')`, [jid]);
const r1 = await db.query(`select status, (select count(*) from job_revisions) rev from jobs`); assert.equal(r1.rows[0].status, 'ajuste_pedido');
await db.query(`select * from pegar_job('w1')`);
await db.query(`select atualizar_job($1, 'renderizando', '{"roteiro":{"cortes":[]},"custo_ia_usd":0.01}')`, [jid]);
// falha 3x no render → erro
for (let i = 0; i < 3; i++) { await db.query(`update jobs set status='renderizando', worker_id='w1' where id=$1`, [jid]); console.log('falha', i + 1, (await db.query(`select falhar_job($1, 'ffmpeg caiu') r`, [jid])).rows[0].r); }
await como(U2, `select reenviar_job($1)`, [jid]);
await db.query(`select atualizar_job($1, 'previa_pronta')`, [jid]);
await como(U2, `select aprovar_job($1)`, [jid]);
await db.query(`select * from pegar_job('w1')`);
await db.query(`select atualizar_job($1, 'entregando')`, [jid]); await db.query(`select atualizar_job($1, 'entregue', '{"final_drive_id":"fin1"}')`, [jid]);
const fim = await db.query(`select status, round(custo_ia_usd, 2) custo, entregue_em is not null entregue, (select roteiro_depois from job_revisions) depois from jobs`);
const ev = await como(U2, `select string_agg(status, ' > ' order by id) h from job_events`);
console.log(JSON.stringify(fim.rows[0])); console.log('histórico:', ev.rows[0].h);
assert.equal(fim.rows[0].status, 'entregue'); assert.equal(fim.rows[0].custo, '0.04');
console.log('OK');
await db.exec(`insert into auth.users values ('55555555-5555-5555-5555-555555555555', 'novo@link3.com')`);
await db.exec(`insert into convites (email, org_id, papel) values ('NOVO@link3.com', '00000000-0000-0000-0000-00000000a003', 'editor')`);
assert.equal((await db.query(`select count(*) n from profiles where email = 'novo@link3.com'`)).rows[0].n, 1, 'convite depois do login cria perfil');
console.log('OK convite');
