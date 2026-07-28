-- BRASIL STYLE DENÚNCIAS - CONFIGURAÇÃO DO SUPABASE
-- Execute todo este arquivo no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'admin' check (role in ('founder','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  player_id text not null,
  accused_name text not null,
  accused_id text not null,
  event_date date not null,
  category text not null,
  reason text not null,
  video_link text,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'Nova' check (status in ('Nova','Aceita','Recusada')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  responsible_id uuid references public.profiles(id) on delete set null,
  responsible_name text
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reports_player_lookup on public.reports (lower(player_name), player_id);
create index if not exists reports_accused_lookup on public.reports (lower(accused_name), accused_id);
create index if not exists reports_created_at on public.reports (created_at desc);

create or replace function public.handle_new_staff_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'admin'),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_staff_user();

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true and p.role in ('founder','admin')); $$;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true and p.role='founder'); $$;

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "staff read own profile" on public.profiles;
create policy "staff read own profile" on public.profiles for select to authenticated using (id=auth.uid() or public.is_founder());

drop policy if exists "public submit reports" on public.reports;
create policy "public submit reports" on public.reports for insert to anon, authenticated with check (
  length(player_name) between 1 and 40 and player_id ~ '^[0-9]+$' and
  length(accused_name) between 1 and 40 and accused_id ~ '^[0-9]+$' and
  length(reason) between 1 and 5000
);

drop policy if exists "staff read reports" on public.reports;
create policy "staff read reports" on public.reports for select to authenticated using (public.is_active_staff());

drop policy if exists "staff resolve reports" on public.reports;
create policy "staff resolve reports" on public.reports for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists "staff insert logs" on public.audit_logs;
create policy "staff insert logs" on public.audit_logs for insert to authenticated with check (public.is_active_staff() and actor_id=auth.uid());

drop policy if exists "founder read logs" on public.audit_logs;
create policy "founder read logs" on public.audit_logs for select to authenticated using (public.is_founder());

-- Consultas públicas retornam somente os dados permitidos.
create or replace function public.search_my_reports(search_name text default null, search_id text default null)
returns table(accused_name text, accused_id text, reason text, category text, status text, rejection_reason text, created_at timestamptz)
language sql security definer set search_path=public
as $$
  select r.accused_name,r.accused_id,r.reason,r.category,r.status,r.rejection_reason,r.created_at
  from public.reports r
  where (nullif(trim(search_id),'') is not null and r.player_id=trim(search_id))
     or (nullif(trim(search_name),'') is not null and lower(r.player_name)=lower(trim(search_name)))
  order by r.created_at desc limit 100;
$$;

create or replace function public.search_against_reports(search_name text default null, search_id text default null)
returns table(reason text, status text, created_at timestamptz)
language sql security definer set search_path=public
as $$
  select r.reason,r.status,r.created_at
  from public.reports r
  where (nullif(trim(search_id),'') is not null and r.accused_id=trim(search_id))
     or (nullif(trim(search_name),'') is not null and lower(r.accused_name)=lower(trim(search_name)))
  order by r.created_at desc limit 100;
$$;

grant execute on function public.search_my_reports(text,text) to anon, authenticated;
grant execute on function public.search_against_reports(text,text) to anon, authenticated;

-- Bucket privado para prints e vídeos.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('report-evidence','report-evidence',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public=false,file_size_limit=104857600;

drop policy if exists "public upload report evidence" on storage.objects;
create policy "public upload report evidence" on storage.objects for insert to anon,authenticated
with check (bucket_id='report-evidence');

drop policy if exists "staff read report evidence" on storage.objects;
create policy "staff read report evidence" on storage.objects for select to authenticated
using (bucket_id='report-evidence' and public.is_active_staff());
