// Mi plata · recordatorios diarios por notificación push.
// Lo llama pg_cron cada hora; a cada usuario le escribe a la hora que eligió (hora de Colombia).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Llaves guardadas en la tabla privada app_config (solo la lee el servidor)
let CONF: Record<string, string> | null = null;
async function conf() {
  if (CONF) return CONF;
  const { data } = await db.from('app_config').select('clave,valor');
  CONF = Object.fromEntries((data || []).map((r) => [r.clave, r.valor]));
  webpush.setVapidDetails('mailto:soporte@mi-plata.app', CONF.vapid_public, CONF.vapid_private);
  return CONF;
}
const TZ = -5 * 3600e3; // Colombia, sin horario de verano
const fmt = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CO').replace(/,/g, '.');
const diaCo = (d: string | Date) => new Date(new Date(d).getTime() + TZ).toISOString().slice(0, 10);
const FREC: Record<string, number> = { diario: 1, semanal: 7, quincenal: 15 };

type Alerta = { clave: string; tipo: string; title: string; body: string; prio: number };

async function alertasDe(uid: string, hoyCo: string, ahora: Date): Promise<Alerta[]> {
  const [g, a, p, ab, m] = await Promise.all([
    db.from('gastos').select('id,nombre,monto,tipo,fecha').eq('user_id', uid),
    db.from('ahorros').select('id,monto,fecha,meta_id').eq('user_id', uid),
    db.from('prestamos').select('id,direccion,persona,monto,fecha_limite').eq('user_id', uid),
    db.from('prestamo_abonos').select('prestamo_id,monto').eq('user_id', uid),
    db.from('metas').select('id,nombre,monto,aporte,aporte_monto,aporte_frec,clase,plantilla,plantilla_frec,plantilla_inicio,creada').eq('user_id', uid),
  ]);
  const gastos = g.data || [], ahorros = a.data || [], prestamos = p.data || [], abonos = ab.data || [], metas = m.data || [];
  const out: Alerta[] = [];
  const hoy = new Date(hoyCo + 'T00:00:00Z');
  const dias = (d: string) => Math.round((new Date(d + 'T00:00:00Z').getTime() - hoy.getTime()) / 864e5);

  // 1. Días sin registrar
  const fechas = [...gastos.filter((x) => x.tipo !== 'fijo').map((x) => x.fecha), ...ahorros.map((x) => x.fecha)]
    .map((f) => new Date(f).getTime()).filter((t) => t <= ahora.getTime());
  if (fechas.length) {
    const n = Math.floor((ahora.getTime() - Math.max(...fechas)) / 864e5);
    if (n >= 2) out.push({ clave: 'registro', tipo: 'registro', prio: 3, title: `Llevas ${n} días sin registrar`, body: '¿Gastaste algo? Anótalo para que tus cuentas cuadren.' });
  }
  // 2. Deudas
  const pag: Record<string, number> = {};
  for (const x of abonos) pag[x.prestamo_id] = (pag[x.prestamo_id] || 0) + Number(x.monto);
  for (const l of prestamos) {
    const sal = Number(l.monto) - (pag[l.id] || 0);
    if (sal <= 0 || !l.fecha_limite) continue;
    const d = dias(l.fecha_limite);
    if (l.direccion === 'me_prestaron') {
      if (d < 0) out.push({ clave: 'deuda-' + l.id, tipo: 'deudas', prio: 1, title: `Deuda vencida con ${l.persona}`, body: `Debías pagar ${fmt(sal)} hace ${-d} día${d === -1 ? '' : 's'}.` });
      else if (d <= 3) out.push({ clave: 'deuda-' + l.id, tipo: 'deudas', prio: 1, title: `Tu deuda con ${l.persona} vence ${d === 0 ? 'hoy' : d === 1 ? 'mañana' : 'en ' + d + ' días'}`, body: `Te faltan ${fmt(sal)} por pagar.` });
    } else if (d < 0 && (-d) % 3 === 1) {
      out.push({ clave: 'cobro-' + l.id, tipo: 'deudas', prio: 4, title: `${l.persona} te debe ${fmt(sal)}`, body: `Se venció hace ${-d} día${d === -1 ? '' : 's'}. Recuérdale.` });
    }
  }
  // 3. Plantillas
  for (const mt of metas) {
    const cel = Array.isArray(mt.plantilla) ? mt.plantilla : null;
    if (!cel) continue;
    const ids = new Set(ahorros.map((x) => x.id));
    const on = cel.filter((c: { a?: string }) => c.a && ids.has(c.a)).length;
    if (on >= cel.length) continue;
    const fr = mt.plantilla_frec || 'diario';
    if (fr === 'diario') {
      const yaHoy = ahorros.some((x) => x.meta_id === mt.id && diaCo(x.fecha) === hoyCo);
      if (!yaHoy) out.push({ clave: 'plantilla-' + mt.id, tipo: 'plantillas', prio: 2, title: 'Hoy no has tachado tu casilla', body: `"${mt.nombre}": llevas ${on} de ${cel.length}. Tacha una aunque sea pequeña.` });
    } else {
      const ini = mt.plantilla_inicio ? new Date(mt.plantilla_inicio + 'T00:00:00Z') : hoy;
      const esp = Math.min(cel.length, Math.floor((hoy.getTime() - ini.getTime()) / 864e5 / FREC[fr]) + 1);
      if (on < esp) out.push({ clave: 'plantilla-' + mt.id, tipo: 'plantillas', prio: 2, title: `Vas atrasado en "${mt.nombre}"`, body: `Te faltan ${esp - on} casilla${esp - on > 1 ? 's' : ''} para ir al día.` });
    }
  }
  // 4. Aportes a metas
  for (const mt of metas) {
    if ((mt.clase || 'meta') !== 'meta' || !(Number(mt.aporte) > 0) || mt.plantilla) continue;
    const ah = ahorros.filter((x) => x.meta_id === mt.id).reduce((s, x) => s + Number(x.monto), 0);
    if (ah >= Number(mt.monto)) continue;
    const fr = mt.aporte_frec || 'quincenal';
    const ventana = fr === 'semanal' ? 7 : fr === 'quincenal' ? 15 : 31;
    if (mt.creada && (ahora.getTime() - new Date(mt.creada).getTime()) / 864e5 < Math.min(ventana, 7)) continue;
    let desde: number;
    if (fr === 'mensual') { if (Number(hoyCo.slice(8, 10)) < 20) continue; desde = new Date(hoyCo.slice(0, 8) + '01T05:00:00Z').getTime(); }
    else desde = ahora.getTime() - ventana * 864e5;
    if (!ahorros.some((x) => x.meta_id === mt.id && new Date(x.fecha).getTime() >= desde)) {
      const por = fr === 'semanal' ? 'por semana' : fr === 'quincenal' ? 'por quincena' : 'al mes';
      out.push({ clave: 'meta-' + mt.id, tipo: 'metas', prio: 2, title: `Te toca tu aporte para "${mt.nombre}"`, body: `${fmt(Number(mt.aporte_monto || mt.aporte))} ${por}. Guárdalo hoy y sigue sumando.` });
    }
  }
  return out.sort((x, y) => x.prio - y.prio);
}

Deno.serve(async (req) => {
  const c = await conf();
  if (!c.cron_secret || req.headers.get('x-cron-secret') !== c.cron_secret) return new Response('no autorizado', { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ahora = new Date();
  const co = new Date(ahora.getTime() + TZ);
  const hora = co.getUTCHours(), hoyCo = co.toISOString().slice(0, 10);

  let q = db.from('ajustes').select('user_id,notif_hora,notif_tipos').eq('notif_activas', true);
  if (body.user_id) q = q.eq('user_id', body.user_id); else q = q.eq('notif_hora', hora);
  const { data: usuarios, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const res: Record<string, unknown>[] = [];
  for (const u of usuarios || []) {
    const { data: subs } = await db.from('push_subs').select('id,endpoint,p256dh,auth').eq('user_id', u.user_id);
    if (!subs?.length) continue;
    let tipos: Record<string, boolean> = { registro: true, deudas: true, plantillas: true, metas: true };
    try { tipos = { ...tipos, ...JSON.parse(u.notif_tipos || '{}') }; } catch (_) { /* usar valores por defecto */ }
    const todas = (await alertasDe(u.user_id, hoyCo, ahora)).filter((x) => tipos[x.tipo] !== false);
    const nuevas: Alerta[] = [];
    for (const al of todas) {
      if (body.prueba) { nuevas.push(al); continue; }
      const { error: e } = await db.from('notif_log').insert({ user_id: u.user_id, clave: al.clave, dia: hoyCo });
      if (!e) nuevas.push(al); // si ya existía, ya se avisó hoy
    }
    if (!nuevas.length) { res.push({ user: u.user_id, enviadas: 0 }); continue; }
    const mensajes = nuevas.slice(0, 3).map((al, i) => ({
      title: al.title,
      body: al.body + (i === 2 && nuevas.length > 3 ? ` (y ${nuevas.length - 3} más)` : ''),
      tag: al.clave, url: './#alertas',
    }));
    let ok = 0;
    for (const s of subs) {
      for (const msg of mensajes) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: 'normal' });
          ok++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { await db.from('push_subs').delete().eq('id', s.id); break; }
        }
      }
    }
    res.push({ user: u.user_id, alertas: nuevas.length, enviadas: ok });
  }
  return new Response(JSON.stringify({ hora, hoy: hoyCo, usuarios: (usuarios || []).length, res }), { headers: { 'Content-Type': 'application/json' } });
});
