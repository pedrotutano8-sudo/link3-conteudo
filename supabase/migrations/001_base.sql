-- =========================================================
-- Link3 · Sistema de Conteúdo · 001 base
-- 10 tabelas do modelo de dados + convites. Tudo com org_id desde o início:
-- a Link3 usa uma organização só, mas a base serve a outras agências depois.
-- =========================================================


-- ---------- Organização e usuários ----------
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key,                                   -- = auth.users.id
  org_id uuid not null references orgs(id) on delete cascade,
  nome text,
  email text not null,
  papel text not null default 'editor' check (papel in ('admin', 'editor')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_idx on profiles (lower(email));

-- quem pode entrar: o admin cadastra o e-mail aqui e cria o login no Supabase Auth
create table if not exists convites (
  email text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  nome text,
  papel text not null default 'editor' check (papel in ('admin', 'editor')),
  created_at timestamptz not null default now()
);

create or replace function my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid() and ativo;
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and ativo and papel = 'admin');
$$;

-- login criado no Auth → vira perfil, se o e-mail tiver convite
create or replace function vincular_convite() returns trigger
language plpgsql security definer set search_path = public as $$
declare c convites%rowtype;
begin
  select * into c from convites where lower(email) = lower(new.email);
  if found then
    insert into profiles (id, org_id, nome, email, papel)
    values (new.id, c.org_id, c.nome, new.email, c.papel)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- ---------- Clientes finais e identidade ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  nome text not null,
  instagram text,
  pasta_brutos_id text,                 -- id da pasta no Google Drive
  pasta_finalizados_id text,
  tom_voz text,
  ctas text[] not null default '{}',
  regras text,                          -- o que nunca fazer
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists clients_org_idx on clients (org_id, nome);

create table if not exists brand_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  tipo text not null check (tipo in ('logo', 'logo_branca', 'simbolo', 'fonte', 'vinheta_abertura', 'vinheta_encerramento', 'musica', 'foto', 'manual', 'referencia', 'outro')),
  nome text not null,
  storage_path text not null,           -- bucket "marcas": {org_id}/{client_id}/{arquivo}
  mime text,
  tamanho bigint,
  created_at timestamptz not null default now()
);
create index if not exists brand_assets_client_idx on brand_assets (client_id, tipo);

create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null unique references clients(id) on delete cascade,
  versao integer not null default 1,
  cores jsonb not null default '{}',            -- {principal, secundaria, fundo, texto}
  fontes jsonb not null default '{}',           -- {titulo: asset_id|google font, corpo: ...}
  estilo_legenda jsonb not null default '{}',   -- {posicao, caixa, destaque, palavras_por_linha, maiusculas}
  logo_id uuid references brand_assets(id) on delete set null,
  vinheta_abertura_id uuid references brand_assets(id) on delete set null,
  vinheta_encerramento_id uuid references brand_assets(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- versão sobe a cada alteração: o roteiro guarda a versão do kit com que foi feito
create or replace function brand_kits_versao() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.cores, new.fontes, new.estilo_legenda, new.logo_id, new.vinheta_abertura_id, new.vinheta_encerramento_id)
     is distinct from (old.cores, old.fontes, old.estilo_legenda, old.logo_id, old.vinheta_abertura_id, old.vinheta_encerramento_id) then
    new.versao := old.versao + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists brand_kits_versao on brand_kits;
create trigger brand_kits_versao before update on brand_kits for each row execute function brand_kits_versao();

-- ---------- Biblioteca de cenas e lâminas ----------
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,   -- null = disponível para todas as organizações
  tipo text not null check (tipo in ('cena', 'transicao', 'lamina')),
  slug text not null,
  nome text not null,
  parametros jsonb not null default '{}',              -- JSON Schema dos parâmetros aceitos
  versao integer not null default 1,
  ativo boolean not null default true,
  unique (org_id, slug, versao)
);

-- ---------- Pedidos ----------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  numero bigint generated always as identity,
  tipo text not null check (tipo in ('reel', 'carrossel', 'post')),
  origem_drive_id text,                 -- arquivo bruto no Drive
  origem_nome text,
  comando text not null default '',
  status text not null default 'na_fila' check (status in (
    'na_fila', 'baixando', 'preparando', 'planejando', 'aguardando_resposta', 'renderizando',
    'previa_pronta', 'ajuste_pedido', 'aprovado', 'entregando', 'entregue', 'erro', 'cancelado')),
  etapa_erro text,                      -- em qual status o erro aconteceu
  erro text,
  tentativas integer not null default 0,
  roteiro jsonb,
  kit_versao integer,
  previa_path text,                     -- bucket "previas"
  final_drive_id text,
  custo_ia_usd numeric(10,4) not null default 0,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  segundos_audio numeric(10,1) not null default 0,
  worker_id text,
  travado_em timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entregue_em timestamptz
);
create index if not exists jobs_org_idx on jobs (org_id, created_at desc);
create index if not exists jobs_fila_idx on jobs (status, created_at) where status in ('na_fila', 'aprovado', 'ajuste_pedido');

create table if not exists job_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  status text not null,
  mensagem text,
  criado_em timestamptz not null default now()
);
create index if not exists job_events_job_idx on job_events (job_id, id);

create table if not exists job_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  comando text not null,
  roteiro_antes jsonb,
  roteiro_depois jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  pergunta text not null,
  opcoes text[],
  resposta text,
  respondida_por uuid,
  respondida_em timestamptz,
  created_at timestamptz not null default now()
);

-- histórico automático: toda mudança de status vira um evento
create or replace function jobs_historico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    insert into job_events (org_id, job_id, status, mensagem) values (new.org_id, new.id, new.status, 'Pedido criado');
  elsif new.status is distinct from old.status then
    insert into job_events (org_id, job_id, status, mensagem)
    values (new.org_id, new.id, new.status, case when new.status = 'erro' then new.erro end);
    if new.status = 'entregue' then new.entregue_em := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_historico_ins on jobs;
create trigger jobs_historico_ins after insert on jobs for each row execute function jobs_historico();
drop trigger if exists jobs_historico_upd on jobs;
create trigger jobs_historico_upd before update on jobs for each row execute function jobs_historico();

-- ---------- Ações do painel ----------
-- org e autor sempre vêm do usuário logado (o painel não escolhe)
create or replace function preencher_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.org_id := my_org();
    if new.org_id is null then raise exception 'usuário sem organização'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['clients', 'brand_kits', 'brand_assets', 'jobs', 'job_revisions'] loop
    execute format('drop trigger if exists %1$s_org on %1$s', t);
    execute format('create trigger %1$s_org before insert on %1$s for each row execute function preencher_org()', t);
  end loop;
end $$;

create or replace function responder_pergunta(p_pergunta uuid, p_resposta text) returns void
language plpgsql security definer set search_path = public as $$
declare q questions%rowtype;
begin
  select * into q from questions where id = p_pergunta and org_id = my_org();
  if not found then raise exception 'pergunta não encontrada'; end if;
  update questions set resposta = p_resposta, respondida_por = auth.uid(), respondida_em = now() where id = q.id;
  if not exists (select 1 from questions where job_id = q.job_id and resposta is null) then
    update jobs set status = 'planejando', worker_id = null, travado_em = null where id = q.job_id and status = 'aguardando_resposta';
  end if;
end $$;

create or replace function pedir_ajuste(p_job uuid, p_comando text) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs%rowtype;
begin
  select * into j from jobs where id = p_job and org_id = my_org() for update;
  if not found then raise exception 'pedido não encontrado'; end if;
  if j.status not in ('previa_pronta', 'erro') then raise exception 'só dá para pedir ajuste com a prévia pronta'; end if;
  insert into job_revisions (org_id, job_id, comando, roteiro_antes, created_by) values (j.org_id, j.id, p_comando, j.roteiro, auth.uid());
  update jobs set status = 'ajuste_pedido', erro = null, tentativas = 0, worker_id = null, travado_em = null where id = j.id;
end $$;

create or replace function aprovar_job(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update jobs set status = 'aprovado', worker_id = null, travado_em = null
  where id = p_job and org_id = my_org() and status = 'previa_pronta';
  if not found then raise exception 'pedido não está com a prévia pronta'; end if;
end $$;

create or replace function reenviar_job(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update jobs set status = case when etapa_erro in ('entregando') then 'aprovado' when roteiro is not null and etapa_erro = 'renderizando' then 'ajuste_pedido' else 'na_fila' end,
                  erro = null, tentativas = 0, worker_id = null, travado_em = null
  where id = p_job and org_id = my_org() and status = 'erro';
  if not found then raise exception 'pedido não está com erro'; end if;
end $$;

-- ---------- Worker (só service_role) ----------
-- pega o próximo pedido da fila sem disputa entre workers
create or replace function pegar_job(p_worker text) returns setof jobs
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  -- pedido travado há mais de 20 min (worker caiu) volta para a fila
  update jobs set worker_id = null, travado_em = null,
         status = case status when 'baixando' then 'na_fila' when 'preparando' then 'na_fila' when 'entregando' then 'aprovado' else status end
  where worker_id is not null and travado_em < now() - interval '20 minutes'
    and status in ('baixando', 'preparando', 'planejando', 'renderizando', 'entregando');

  select id into v_id from jobs
  where worker_id is null and status in ('na_fila', 'planejando', 'ajuste_pedido', 'aprovado')
  order by case status when 'aprovado' then 0 when 'ajuste_pedido' then 1 else 2 end, created_at
  for update skip locked limit 1;
  if v_id is null then return; end if;

  return query update jobs set worker_id = p_worker, travado_em = now() where id = v_id returning *;
end $$;

-- avança o status (e grava campos do resultado); quem chama é o worker
create or replace function atualizar_job(p_job uuid, p_status text, p_campos jsonb default '{}', p_mensagem text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs%rowtype;
begin
  select * into j from jobs where id = p_job for update;
  if not found then raise exception 'pedido % não existe', p_job; end if;
  update jobs set
    status = p_status,
    roteiro = coalesce(p_campos -> 'roteiro', roteiro),
    kit_versao = coalesce((p_campos ->> 'kit_versao')::int, kit_versao),
    previa_path = coalesce(p_campos ->> 'previa_path', previa_path),
    final_drive_id = coalesce(p_campos ->> 'final_drive_id', final_drive_id),
    custo_ia_usd = custo_ia_usd + coalesce((p_campos ->> 'custo_ia_usd')::numeric, 0),
    tokens_entrada = tokens_entrada + coalesce((p_campos ->> 'tokens_entrada')::int, 0),
    tokens_saida = tokens_saida + coalesce((p_campos ->> 'tokens_saida')::int, 0),
    segundos_audio = segundos_audio + coalesce((p_campos ->> 'segundos_audio')::numeric, 0),
    erro = case when p_status = 'erro' then coalesce(p_mensagem, 'erro sem mensagem') else null end,
    etapa_erro = case when p_status = 'erro' then j.status else null end,
    tentativas = case when p_status = j.status then tentativas else 0 end,
    worker_id = case when p_status in ('aguardando_resposta', 'previa_pronta', 'entregue', 'erro', 'cancelado') then null else worker_id end,
    travado_em = case when p_status in ('aguardando_resposta', 'previa_pronta', 'entregue', 'erro', 'cancelado') then null else now() end
  where id = p_job;
  if p_mensagem is not null and p_status <> 'erro' then
    insert into job_events (org_id, job_id, status, mensagem) values (j.org_id, j.id, p_status, p_mensagem);
  end if;
  if p_campos ? 'roteiro' and j.status = 'ajuste_pedido' then
    update job_revisions set roteiro_depois = p_campos -> 'roteiro'
    where id = (select id from job_revisions where job_id = j.id and roteiro_depois is null order by created_at desc limit 1);
  end if;
end $$;

-- falha numa etapa: até 2 novas tentativas, depois vai para "erro"
create or replace function falhar_job(p_job uuid, p_mensagem text) returns text
language plpgsql security definer set search_path = public as $$
declare j jobs%rowtype;
begin
  select * into j from jobs where id = p_job for update;
  if j.tentativas < 2 then
    update jobs set tentativas = tentativas + 1, worker_id = null, travado_em = null,
           status = case status when 'baixando' then 'na_fila' when 'preparando' then 'na_fila' when 'renderizando' then 'ajuste_pedido' when 'entregando' then 'aprovado' else status end
    where id = p_job;
    insert into job_events (org_id, job_id, status, mensagem) values (j.org_id, j.id, j.status, 'Nova tentativa: ' || p_mensagem);
    return 'nova_tentativa';
  end if;
  perform atualizar_job(p_job, 'erro', '{}', p_mensagem);
  return 'erro';
end $$;

create or replace function perguntar(p_job uuid, p_pergunta text, p_opcoes text[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  insert into questions (org_id, job_id, pergunta, opcoes) select org_id, id, p_pergunta, p_opcoes from jobs where id = p_job returning id into v;
  perform atualizar_job(p_job, 'aguardando_resposta', '{}', 'A IA fez uma pergunta');
  return v;
end $$;

-- ---------- RLS ----------
alter table orgs enable row level security;
alter table profiles enable row level security;
alter table convites enable row level security;
alter table clients enable row level security;
alter table brand_kits enable row level security;
alter table brand_assets enable row level security;
alter table templates enable row level security;
alter table jobs enable row level security;
alter table job_events enable row level security;
alter table job_revisions enable row level security;
alter table questions enable row level security;

drop policy if exists le_propria on orgs;
create policy le_propria on orgs for select to authenticated using (id = my_org());

drop policy if exists le_org on profiles;
create policy le_org on profiles for select to authenticated using (org_id = my_org());
drop policy if exists admin_altera on profiles;
create policy admin_altera on profiles for update to authenticated using (org_id = my_org() and is_admin()) with check (org_id = my_org());

drop policy if exists admin_tudo on convites;
create policy admin_tudo on convites for all to authenticated using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin());

do $$ declare t text; begin
  foreach t in array array['clients', 'brand_kits', 'brand_assets'] loop
    execute format('drop policy if exists org_tudo on %I', t);
    execute format('create policy org_tudo on %I for all to authenticated using (org_id = my_org()) with check (org_id = my_org())', t);
  end loop;
  foreach t in array array['jobs'] loop
    execute format('drop policy if exists org_le on %I', t);
    execute format('create policy org_le on %I for select to authenticated using (org_id = my_org())', t);
    execute format('drop policy if exists org_cria on %I', t);
    execute format('create policy org_cria on %I for insert to authenticated with check (org_id = my_org() and status = ''na_fila'')', t);
    execute format('drop policy if exists org_cancela on %I', t);
    execute format('create policy org_cancela on %I for update to authenticated using (org_id = my_org()) with check (org_id = my_org() and status = ''cancelado'')', t);
  end loop;
  foreach t in array array['job_events', 'job_revisions', 'questions'] loop
    execute format('drop policy if exists org_le on %I', t);
    execute format('create policy org_le on %I for select to authenticated using (org_id = my_org())', t);
  end loop;
end $$;

drop policy if exists le_templates on templates;
create policy le_templates on templates for select to authenticated using (org_id is null or org_id = my_org());
drop policy if exists admin_templates on templates;
create policy admin_templates on templates for all to authenticated using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin());

-- funções do worker: só service_role
revoke execute on function pegar_job(text), atualizar_job(uuid, text, jsonb, text), falhar_job(uuid, text), perguntar(uuid, text, text[]) from public, anon, authenticated;
grant execute on function pegar_job(text), atualizar_job(uuid, text, jsonb, text), falhar_job(uuid, text), perguntar(uuid, text, text[]) to service_role;
revoke execute on function responder_pergunta(uuid, text), pedir_ajuste(uuid, text), aprovar_job(uuid), reenviar_job(uuid) from public, anon;
grant execute on function responder_pergunta(uuid, text), pedir_ajuste(uuid, text), aprovar_job(uuid), reenviar_job(uuid) to authenticated;

-- ---------- Dados iniciais ----------
insert into orgs (id, nome) values ('00000000-0000-0000-0000-00000000a003', 'Link3') on conflict (id) do nothing;
insert into convites (email, org_id, nome, papel) values
  ('pedro@lideratedigital.com.br', '00000000-0000-0000-0000-00000000a003', 'Pedro (Liderate)', 'admin'),
  ('lideratedigital@gmail.com', '00000000-0000-0000-0000-00000000a003', 'Liderate', 'admin')
on conflict (email) do nothing;

select 'ok 001' as base;
