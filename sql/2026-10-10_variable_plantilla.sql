-- Personalizado (pagos fijos por semana / ingreso variable) y plantilla de ahorro (ya aplicado en mi-plata)
alter table public.ajustes
  add column if not exists pers_tipo text not null default 'fijo' check (pers_tipo in ('fijo','variable')),
  add column if not exists pagos_montos text not null default '[]',
  add column if not exists var_min bigint not null default 0,
  add column if not exists var_max bigint not null default 0,
  add column if not exists var_base text not null default 'floja' check (var_base in ('floja','promedio'));
alter table public.metas
  add column if not exists plantilla jsonb,
  add column if not exists plantilla_frec text check (plantilla_frec in ('diario','semanal','quincenal')),
  add column if not exists plantilla_inicio date;
