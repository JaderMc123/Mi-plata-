-- Mi plata del mes · Cartera (modos de ingreso, base fija) e Inversiones
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

-- 1) Forma de ingreso y base fija
alter table public.ajustes
  add column if not exists modo_ingreso text not null default 'quincenal',
  add column if not exists ingreso_diario bigint not null default 0,
  add column if not exists dias_trabajo text not null default '1,2,3,4,5',
  add column if not exists base_monto bigint not null default 0,
  add column if not exists base_cuenta uuid references public.cuentas(id) on delete set null,
  add column if not exists inversion_capital bigint not null default 0;

do $$ begin
  alter table public.ajustes add constraint ajustes_modo_ingreso_chk check (modo_ingreso in ('quincenal','diario','base'));
exception when duplicate_object then null; end $$;

-- 2) Cuentas: permitir el tipo 'base'
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.cuentas'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%nequi%' loop
    execute format('alter table public.cuentas drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.cuentas add constraint cuentas_tipo_chk check (tipo in ('nequi','efectivo','banco','otro','base'));

-- 3) Inversiones
create table if not exists public.inversiones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  tipo text not null default 'negocio' check (tipo in ('negocio','prestamo','otro')),
  monto bigint not null check (monto > 0),
  tasa numeric(6,2) not null default 0,
  esperado bigint not null default 0,
  persona text,
  fecha_limite date,
  nota text,
  estado text not null default 'activa' check (estado in ('activa','cerrada')),
  fecha timestamptz not null default now()
);
create table if not exists public.inversion_movs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  inversion_id uuid not null references public.inversiones(id) on delete cascade,
  monto bigint not null check (monto > 0),
  nota text,
  fecha timestamptz not null default now()
);
create index if not exists inversiones_user_idx on public.inversiones(user_id);
create index if not exists inversion_movs_user_idx on public.inversion_movs(user_id);
create index if not exists inversion_movs_inv_idx on public.inversion_movs(inversion_id);

alter table public.inversiones enable row level security;
alter table public.inversion_movs enable row level security;

do $$ declare t text; begin
  foreach t in array array['inversiones','inversion_movs'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using ((select auth.uid()) = user_id)', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check ((select auth.uid()) = user_id)', t);
    execute format('create policy %1$s_upd on public.%1$s for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy %1$s_del on public.%1$s for delete using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- un retorno solo se puede registrar en una inversión propia
drop policy if exists inversion_movs_ins on public.inversion_movs;
create policy inversion_movs_ins on public.inversion_movs for insert
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.inversiones i where i.id = inversion_id and i.user_id = (select auth.uid())));
