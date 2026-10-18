-- Mi plata del mes · Gastos fijos con ciclo propio (día de corte o al recibir ingreso)
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.gastos
  add column if not exists ciclo text,            -- null o 'mes' = cada mes (día 1) · 'corte' = día de corte · 'ingreso' = al registrar un ingreso
  add column if not exists dia_corte smallint,    -- día del mes del corte (1 a 31), solo con ciclo 'corte'
  add column if not exists ajuste_ciclo text;     -- periodo al que aplica el ajuste manual de "lo que te queda"

do $$ begin
  alter table public.gastos add constraint gastos_ciclo_chk check (ciclo is null or ciclo in ('mes','corte','ingreso'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.gastos add constraint gastos_dia_corte_chk check (dia_corte is null or dia_corte between 1 and 31);
exception when duplicate_object then null; end $$;
