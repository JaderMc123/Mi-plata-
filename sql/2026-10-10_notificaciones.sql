-- Mi plata · Notificaciones y frecuencia de aportes
alter table public.metas
  add column if not exists aporte_frec text not null default 'quincenal' check (aporte_frec in ('semanal','quincenal','mensual')),
  add column if not exists aporte_monto bigint;
alter table public.ajustes
  add column if not exists notif_activas boolean not null default false,
  add column if not exists notif_hora int not null default 19 check (notif_hora between 0 and 23),
  add column if not exists notif_tipos text not null default '{"registro":true,"deudas":true,"plantillas":true,"metas":true}';

create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null, p256dh text not null, auth text not null, agente text,
  creada timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subs enable row level security;
drop policy if exists push_subs_sel on public.push_subs;
drop policy if exists push_subs_ins on public.push_subs;
drop policy if exists push_subs_upd on public.push_subs;
drop policy if exists push_subs_del on public.push_subs;
create policy push_subs_sel on public.push_subs for select using ((select auth.uid()) = user_id);
create policy push_subs_ins on public.push_subs for insert with check ((select auth.uid()) = user_id);
create policy push_subs_upd on public.push_subs for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy push_subs_del on public.push_subs for delete using ((select auth.uid()) = user_id);
create index if not exists push_subs_user_idx on public.push_subs(user_id);

create table if not exists public.notif_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  clave text not null, dia date not null, enviada timestamptz not null default now(),
  primary key (user_id, clave, dia)
);
alter table public.notif_log enable row level security;

-- Llaves privadas del servidor de notificaciones (sin políticas: solo el servidor las lee)
create table if not exists public.app_config (clave text primary key, valor text not null);
alter table public.app_config enable row level security;
insert into public.app_config (clave, valor) values
  ('vapid_public', '<llave pública VAPID>'),
  ('vapid_private', '<llave privada VAPID — no subir al repo>'),
  ('cron_secret', '<secreto del cron>')
on conflict (clave) do update set valor = excluded.valor;

-- Revisión cada hora (cada usuario recibe su aviso a la hora que eligió)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'mi-plata-notificar';
select cron.schedule('mi-plata-notificar', '0 * * * *', $job$
  select net.http_post(
    url := 'https://zjhcrvkgwwqispbjcuwh.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<secreto del cron>'),
    body := '{}'::jsonb
  );
$job$);
