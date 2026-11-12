-- 003 · Pedido em lote por roteiro e reel com vários brutos
-- Pode rodar de novo sem quebrar nada.

-- reel com vários brutos: [{ "id": "<drive id>", "nome": "IMG_5212.mov" }, ...] na ordem de gravação
alter table jobs add column if not exists origens jsonb;
-- pedidos criados por um lote apontam para ele
alter table jobs add column if not exists lote_id uuid references jobs(id) on delete set null;
create index if not exists jobs_lote_idx on jobs (lote_id) where lote_id is not null;

-- novo tipo: "lote" (pasta do Drive + roteiro → 1 reel por roteiro)
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%' loop
    execute format('alter table jobs drop constraint %I', c);
  end loop;
end $$;
alter table jobs add constraint jobs_tipo_check check (tipo in ('reel', 'carrossel', 'post', 'lote'));
