-- Mi plata del mes · Apariencia guardada en el perfil (modo y colores)
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.ajustes
  add column if not exists tema text,  -- null = aún no lo ha elegido
  add column if not exists color_card text,  -- '' = original, null = aún no lo ha elegido
  add column if not exists color_sec text;

do $$ begin
  alter table public.ajustes add constraint ajustes_tema_chk check (tema is null or tema in ('sistema','light','dark'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ajustes add constraint ajustes_colores_chk check (
    (color_card is null or color_card in ('','amarillo','rosa','menta','celeste','lavanda','durazno','coral')) and
    (color_sec  is null or color_sec  in ('','amarillo','rosa','menta','celeste','lavanda','durazno','coral')));
exception when duplicate_object then null; end $$;
