-- =========================================================
-- 005 · Teste às cegas (S5): reels editados pelo sistema e por editor, misturados, sem dizer quem fez.
-- Cada pessoa da equipe avalia: postaria assim?, nota 1 a 5 e palpite de quem editou.
-- A origem (sistema/editor) fica escondida de quem vota: só o resumo do admin mostra.
-- Meta do projeto: 80% dos reels do sistema com "postaria assim".
-- Rodar no Supabase da Link3 (SQL Editor). Conferência no fim.
-- =========================================================
create table if not exists teste_reels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  rodada text not null default '1',
  client_id uuid references clients(id) on delete set null,
  drive_id text not null,
  origem text not null check (origem in ('sistema', 'editor')),
  job_id uuid references jobs(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists teste_reels_org_idx on teste_reels (org_id, rodada);

create table if not exists teste_votos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org() references orgs(id) on delete cascade,
  reel_id uuid not null references teste_reels(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  postaria text not null check (postaria in ('sim', 'ajuste', 'nao')),
  nota int not null check (nota between 1 and 5),
  palpite text check (palpite in ('sistema', 'editor')),
  comentario text,
  created_at timestamptz not null default now(),
  unique (reel_id, user_id)
);

alter table teste_reels enable row level security;
alter table teste_votos enable row level security;

-- reels: todos da org leem (sem a coluna origem), só admin inclui ou remove
drop policy if exists org_le on teste_reels;
create policy org_le on teste_reels for select to authenticated using (org_id = my_org());
drop policy if exists admin_altera on teste_reels;
create policy admin_altera on teste_reels for all to authenticated using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin());
revoke select on teste_reels from authenticated;
grant select (id, org_id, rodada, client_id, drive_id, job_id, created_at) on teste_reels to authenticated;
grant insert, delete on teste_reels to authenticated;

-- votos: cada um vê e altera só o seu
drop policy if exists proprio on teste_votos;
create policy proprio on teste_votos for all to authenticated using (user_id = auth.uid() and org_id = my_org()) with check (user_id = auth.uid() and org_id = my_org());

-- resumo (só admin): por origem, % "postaria", nota média e % de acerto do palpite (50% = ninguém distingue)
create or replace function resultado_teste(p_rodada text default '1')
returns table (origem text, reels bigint, votos bigint, postaria_pct numeric, ajuste_pct numeric, nota_media numeric, acerto_palpite_pct numeric)
language sql stable security definer set search_path = public as $$
  select r.origem,
         count(distinct r.id),
         count(v.id),
         round(100.0 * count(v.id) filter (where v.postaria = 'sim') / nullif(count(v.id), 0), 1),
         round(100.0 * count(v.id) filter (where v.postaria = 'ajuste') / nullif(count(v.id), 0), 1),
         round(avg(v.nota), 2),
         round(100.0 * count(v.id) filter (where v.palpite = r.origem) / nullif(count(v.id) filter (where v.palpite is not null), 0), 1)
  from teste_reels r left join teste_votos v on v.reel_id = r.id
  where r.org_id = my_org() and r.rodada = p_rodada and is_admin()
  group by r.origem order by r.origem;
$$;

-- admin vê a origem de cada reel (para conferir o cadastro), sem expor para quem vota
create or replace function teste_gabarito(p_rodada text default '1')
returns table (id uuid, origem text, votos bigint, postaria_pct numeric, nota_media numeric)
language sql stable security definer set search_path = public as $$
  select r.id, r.origem, count(v.id),
         round(100.0 * count(v.id) filter (where v.postaria = 'sim') / nullif(count(v.id), 0), 1),
         round(avg(v.nota), 2)
  from teste_reels r left join teste_votos v on v.reel_id = r.id
  where r.org_id = my_org() and r.rodada = p_rodada and is_admin()
  group by r.id, r.origem;
$$;

select 'ok 005' as teste_cegas,
       (select count(*) from information_schema.tables where table_name in ('teste_reels', 'teste_votos')) as tabelas;  -- deve voltar 2
