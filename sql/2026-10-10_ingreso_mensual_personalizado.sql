-- Modos de ingreso Mensual y Personalizado (ya aplicado en mi-plata)
alter table public.ajustes
  add column if not exists ingreso_mensual bigint not null default 0,
  add column if not exists dia_pago int not null default 30 check (dia_pago between 1 and 31),
  add column if not exists pago_monto bigint not null default 0,
  add column if not exists patron text not null default '[[2]]',
  add column if not exists patron_inicio date;
alter table public.ajustes drop constraint if exists ajustes_modo_ingreso_chk;
alter table public.ajustes add constraint ajustes_modo_ingreso_chk check (modo_ingreso in ('quincenal','mensual','diario','personalizado','base'));
