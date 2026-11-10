-- Recambios GDP · estructura en Supabase (pegar entero en SQL Editor y pulsar Run)
create sequence if not exists public.docs_seq;
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (col, id)
);
create index if not exists docs_seq_idx on public.docs (seq);

create or replace function public.docs_touch() returns trigger language plpgsql as $$
begin
  new.seq := nextval('public.docs_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then new.version := old.version + 1; else new.version := 1; end if;
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.docs_touch();

alter table public.docs enable row level security;
drop policy if exists docs_rw on public.docs;
create policy docs_rw on public.docs for all to authenticated using (true) with check (true);

create or replace function public.doc_merge(p_col text, p_id text, p_data jsonb, p_create boolean default true)
returns void language plpgsql security invoker as $$
begin
  update public.docs set data = case when deleted then p_data else data || p_data end, deleted = false
   where col = p_col and id = p_id;
  if not found then
    if p_create then insert into public.docs (col, id, data) values (p_col, p_id, p_data);
    else raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
end $$;

create table if not exists public.people (
  id uuid primary key default auth.uid(),
  name text,
  email text
);
alter table public.people enable row level security;
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (true);
drop policy if exists people_write on public.people;
create policy people_write on public.people for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

insert into storage.buckets (id, name, public) values ('adjuntos', 'adjuntos', false) on conflict (id) do nothing;
drop policy if exists adjuntos_rw on storage.objects;
create policy adjuntos_rw on storage.objects for all to authenticated using (bucket_id = 'adjuntos') with check (bucket_id = 'adjuntos');

create table if not exists public.admins (email text primary key);
alter table public.admins enable row level security;
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated using (true);
