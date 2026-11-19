-- =========================================================
-- 006 · Incluir um take num pedido de reel (ex.: um take que ficou em outra pasta, "takes avulsos").
-- O take entra na posição escolhida (no começo ou depois de um take do pedido) e o reel é refeito do zero:
-- baixa e junta os takes na nova ordem, transcreve, corta e monta de novo. A prévia anterior fica no histórico.
-- Rodar no Supabase da Link3 (SQL Editor). Conferência no fim.
-- =========================================================
create or replace function adicionar_take(p_job uuid, p_drive_id text, p_nome text default null, p_depois int default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
  atual jsonb;
  novo jsonb;
  pos int;
begin
  select * into j from jobs where id = p_job and org_id = my_org() for update;
  if not found then raise exception 'pedido não encontrado'; end if;
  if j.tipo <> 'reel' then raise exception 'só dá para incluir take em pedido de reel'; end if;
  if j.status not in ('previa_pronta', 'erro') then raise exception 'só dá para incluir take com a prévia pronta (ou com erro)'; end if;
  if coalesce(trim(p_drive_id), '') = '' then raise exception 'cole o link do take no Drive'; end if;

  atual := case when jsonb_typeof(j.origens) = 'array' and jsonb_array_length(j.origens) > 0 then j.origens
                else jsonb_build_array(jsonb_build_object('id', j.origem_drive_id, 'nome', coalesce(j.origem_nome, 'vídeo principal'))) end;
  if atual @> jsonb_build_array(jsonb_build_object('id', p_drive_id)) then raise exception 'esse take já está no pedido'; end if;
  pos := greatest(0, least(coalesce(p_depois, jsonb_array_length(atual)), jsonb_array_length(atual)));
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into novo from (
    select e as x, (n - 1)::numeric as o from jsonb_array_elements(atual) with ordinality as t(e, n)
    union all
    select jsonb_build_object('id', p_drive_id, 'nome', coalesce(nullif(trim(p_nome), ''), 'take incluído'), 'incluido', true), pos - 0.5
  ) s;

  insert into job_revisions (org_id, job_id, comando, roteiro_antes, created_by)
  values (j.org_id, j.id, 'Take incluído (' || coalesce(nullif(trim(p_nome), ''), p_drive_id) || ', posição ' || pos || ')' || coalesce(': ' || nullif(trim(p_obs), ''), ''), j.roteiro, auth.uid());

  update jobs set origens = novo,
                  comando = coalesce(comando, '') || E'\n\nTake incluído: ' || coalesce(nullif(trim(p_nome), ''), 'take') || coalesce(' (' || nullif(trim(p_obs), '') || ')', '') || '. A fala desse take entra no ponto em que ele foi colocado: mantenha.',
                  roteiro = null, previa_path = null, status = 'na_fila', erro = null, etapa_erro = null, tentativas = 0, worker_id = null, travado_em = null
  where id = j.id;
end $$;
revoke execute on function adicionar_take(uuid, text, text, int, text) from public, anon;
grant execute on function adicionar_take(uuid, text, text, int, text) to authenticated;

select 'ok 006' as adicionar_take;
