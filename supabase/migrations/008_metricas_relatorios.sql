-- =========================================================
-- 008 · Métricas das publicações (S10) e relatório interno de performance com sugestões da IA (S11).
-- Métricas: o worker lê do Instagram, a cada 6 h, o desempenho de cada post que o próprio sistema publicou
-- (últimos 30 dias) e grava em publicacoes.metricas.
-- Relatórios: a equipe pede no painel (cliente + período); o worker junta as métricas, pede as sugestões
-- ao Claude e grava o resultado. Uso interno da Link 3.
-- Rodar no Supabase da Link3 (SQL Editor). Conferência no fim.
-- =========================================================
alter table publicacoes add column if not exists metricas jsonb;
alter table publicacoes add column if not exists metricas_em timestamptz;
alter table publicacoes add column if not exists metricas_erro text;
create index if not exists publicacoes_metricas_idx on publicacoes (status, publicada_em);

create table if not exists relatorios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  de date not null,
  ate date not null,
  status text not null default 'pedido' check (status in ('pedido', 'gerando', 'pronto', 'erro')),
  dados jsonb,
  analise jsonb,
  erro text,
  custo_ia_usd numeric not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ate >= de)
);
create index if not exists relatorios_fila_idx on relatorios (status, created_at);

alter table relatorios enable row level security;
drop policy if exists org_le on relatorios;
create policy org_le on relatorios for select to authenticated using (org_id = my_org());
drop policy if exists org_cria on relatorios;
create policy org_cria on relatorios for insert to authenticated with check (org_id = my_org() and status = 'pedido');
drop policy if exists org_apaga on relatorios;
create policy org_apaga on relatorios for delete to authenticated using (org_id = my_org());
revoke all on relatorios from anon;
grant select, delete on relatorios to authenticated;
grant insert (client_id, de, ate) on relatorios to authenticated;

select 'ok 008' as metricas_relatorios,
  (select count(*) from information_schema.columns where table_name = 'publicacoes' and column_name in ('metricas', 'metricas_em', 'metricas_erro')) as colunas_novas;
