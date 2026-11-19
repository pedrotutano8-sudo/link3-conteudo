-- =========================================================
-- 007 · Instagram: conectar a conta do cliente (login unificado da Meta) e publicar o reel aprovado.
-- Fluxo: painel abre o login da Meta → volta em /instagram/retorno com o "code" → o painel grava em
-- instagram_conexoes → o worker troca o code pelo token (com a chave secreta do app, só no servidor)
-- e grava a conta em instagram_contas. O token NUNCA é lido pelo painel (sem grant na coluna).
-- Publicar: o painel cria uma linha em publicacoes → o worker baixa o vídeo final do Drive,
-- sobe no Instagram e publica.
-- Rodar no Supabase da Link3 (SQL Editor). Conferência no fim.
-- =========================================================
create table if not exists instagram_contas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  ig_user_id text not null,
  username text,
  foto text,
  host text not null default 'graph.facebook.com',
  token text,
  token_expira timestamptz,
  ativo boolean not null default true,
  conectado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, ig_user_id)
);

create table if not exists instagram_conexoes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  code text not null,
  status text not null default 'pendente' check (status in ('pendente', 'ok', 'erro')),
  erro text,
  contas jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists publicacoes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  conta_id uuid not null references instagram_contas(id) on delete cascade,
  legenda text,
  status text not null default 'na_fila' check (status in ('na_fila', 'publicando', 'publicada', 'erro', 'cancelada')),
  agendada_para timestamptz not null default now(),
  container_id text,
  media_id text,
  permalink text,
  erro text,
  tentativas int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  publicada_em timestamptz
);
create index if not exists publicacoes_fila_idx on publicacoes (status, agendada_para);
create index if not exists publicacoes_job_idx on publicacoes (job_id);

alter table instagram_contas enable row level security;
alter table instagram_conexoes enable row level security;
alter table publicacoes enable row level security;

-- contas: a equipe vê (sem o token) e pode desligar ou trocar o cliente; quem cria é o worker
drop policy if exists org_le on instagram_contas;
create policy org_le on instagram_contas for select to authenticated using (org_id = my_org());
drop policy if exists org_altera on instagram_contas;
create policy org_altera on instagram_contas for update to authenticated using (org_id = my_org()) with check (org_id = my_org());
revoke all on instagram_contas from authenticated, anon;
grant select (id, org_id, client_id, ig_user_id, username, foto, token_expira, ativo, created_at, updated_at) on instagram_contas to authenticated;
grant update (client_id, ativo) on instagram_contas to authenticated;

-- conexões: a equipe registra o code e acompanha o resultado
drop policy if exists org_cria on instagram_conexoes;
drop policy if exists org_le on instagram_conexoes;
create policy org_cria on instagram_conexoes for insert to authenticated with check (org_id = my_org() and status = 'pendente');
create policy org_le on instagram_conexoes for select to authenticated using (org_id = my_org());
revoke all on instagram_conexoes from authenticated, anon;
grant select (id, org_id, client_id, status, erro, contas, created_at) on instagram_conexoes to authenticated;
grant insert (client_id, code) on instagram_conexoes to authenticated;

-- publicações: a equipe cria, acompanha e cancela enquanto está na fila
drop policy if exists org_le on publicacoes;
create policy org_le on publicacoes for select to authenticated using (org_id = my_org());
drop policy if exists org_cria on publicacoes;
create policy org_cria on publicacoes for insert to authenticated with check (org_id = my_org() and status = 'na_fila');
drop policy if exists org_cancela on publicacoes;
create policy org_cancela on publicacoes for update to authenticated using (org_id = my_org() and status in ('na_fila', 'erro')) with check (org_id = my_org() and status in ('cancelada', 'na_fila'));
revoke all on publicacoes from anon;
grant select, insert on publicacoes to authenticated;
grant update (status, agendada_para, legenda) on publicacoes to authenticated;

select 'ok 007' as instagram;
