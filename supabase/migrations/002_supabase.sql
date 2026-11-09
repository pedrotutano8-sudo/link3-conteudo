-- =========================================================
-- Link3 · 002 · ligações com o Supabase (Auth, Storage, Realtime)
-- Separado da 001 porque usa schemas que só existem no Supabase.
-- =========================================================

-- login criado no Auth → perfil (se o e-mail tiver convite)
drop trigger if exists vincular_convite on auth.users;
create trigger vincular_convite after insert on auth.users for each row execute function public.vincular_convite();

-- convite criado para quem já tem login: o perfil sai na hora
create or replace function public.convite_com_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, org_id, nome, email, papel)
  select u.id, new.org_id, new.nome, u.email, new.papel from auth.users u where lower(u.email) = lower(new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists convite_com_login on public.convites;
create trigger convite_com_login after insert on public.convites for each row execute function public.convite_com_login();

-- quem já tinha login antes desta migração também ganha o perfil
insert into public.profiles (id, org_id, nome, email, papel)
select u.id, c.org_id, c.nome, u.email, c.papel
from auth.users u join public.convites c on lower(c.email) = lower(u.email)
on conflict (id) do nothing;

-- ---------- Storage ----------
-- marcas: logos, fontes, vinhetas, músicas (até 200 MB por arquivo)
-- previas: vídeos e artes de prévia gerados pelo worker
insert into storage.buckets (id, name, public, file_size_limit)
values ('marcas', 'marcas', false, 209715200), ('previas', 'previas', false, 524288000)
on conflict (id) do nothing;

-- caminho sempre começa pelo org_id: {org_id}/{client_id}/{arquivo}
drop policy if exists "marcas da org" on storage.objects;
create policy "marcas da org" on storage.objects for all to authenticated
  using (bucket_id = 'marcas' and (storage.foldername(name))[1] = public.my_org()::text)
  with check (bucket_id = 'marcas' and (storage.foldername(name))[1] = public.my_org()::text);

drop policy if exists "previas da org" on storage.objects;
create policy "previas da org" on storage.objects for select to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] = public.my_org()::text);

-- ---------- Realtime: painel atualiza o status sozinho ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.jobs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.questions; exception when duplicate_object then null; end;
  end if;
end $$;

select 'ok 002' as supabase;
