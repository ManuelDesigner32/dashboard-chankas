// sync-calendar.js
// Sincroniza tareas y fechas importantes de Firestore con Google Calendar.
// Se ejecuta automáticamente vía GitHub Actions cada cierto tiempo.

const admin = require('firebase-admin');
const { google } = require('googleapis');

// ===================== CONFIGURACIÓN =====================

const CALENDAR_ID_TAREAS = process.env.CALENDAR_ID_TAREAS;
const CALENDAR_ID_FECHAS = process.env.CALENDAR_ID_FECHAS;
const DIAS_ANTES_DE_BORRAR_COMPLETADA = 3;

// ===================== INICIALIZAR FIREBASE =====================

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ===================== INICIALIZAR GOOGLE CALENDAR =====================

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// ===================== COLORES POR PRIORIDAD =====================
const COLOR_POR_PRIORIDAD = {
  alta: '11',
  media: '5',
  baja: '8'
};

// ===================== UTILIDADES =====================

function timestampADate(valor) {
  if (!valor) return null;
  if (valor._seconds !== undefined) return new Date(valor._seconds * 1000);
  if (valor.toDate) return valor.toDate();
  return new Date(valor);
}

function formatearFechaGoogle(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sumarDias(date, dias) {
  const nueva = new Date(date);
  nueva.setDate(nueva.getDate() + dias);
  return nueva;
}

// ===================== SINCRONIZAR TAREAS =====================

async function sincronizarTareas() {
  console.log('--- Sincronizando tareas ---');
  const snap = await db.collection('tareas').get();

  for (const docSnap of snap.docs) {
    const tarea = docSnap.data();
    const tareaId = docSnap.id;

    if (tarea.estado === 'completada' && tarea.fechaCompletada && !tarea.eliminadaDeCalendario) {
      const fechaCompletada = timestampADate(tarea.fechaCompletada);
      const limiteBorrado = sumarDias(fechaCompletada, DIAS_ANTES_DE_BORRAR_COMPLETADA);

      if (new Date() >= limiteBorrado) {
        if (tarea.eventoCalendarId) {
          try {
            await calendar.events.delete({
              calendarId: CALENDAR_ID_TAREAS,
              eventId: tarea.eventoCalendarId
            });
            console.log(`Evento borrado (tarea completada hace +${DIAS_ANTES_DE_BORRAR_COMPLETADA} días): ${tarea.titulo}`);
          } catch (err) {
            console.log(`No se pudo borrar el evento de "${tarea.titulo}" (puede que ya no exista):`, err.message);
          }
        }
        await docSnap.ref.update({ eliminadaDeCalendario: true });
        continue;
      }
    }

    if (!tarea.fechaLimite) continue;

    const fechaLimite = timestampADate(tarea.fechaLimite);
    const descripcionEvento = [
      tarea.descripcion || '',
      '',
      `Asignado a: ${tarea.asignadoANombre || tarea.asignadoA || 'Sin asignar'}`,
      `Prioridad: ${tarea.prioridad || 'media'}`,
      `Estado: ${tarea.estado || 'pendiente'}`
    ].join('\n');

    const recursoEvento = {
      summary: `📋 ${tarea.titulo}`,
      description: descripcionEvento,
      start: { date: formatearFechaGoogle(fechaLimite) },
      end: { date: formatearFechaGoogle(sumarDias(fechaLimite, 1)) },
      colorId: COLOR_POR_PRIORIDAD[tarea.prioridad] || COLOR_POR_PRIORIDAD.media
    };

    try {
      if (tarea.eventoCalendarId) {
        await calendar.events.update({
          calendarId: CALENDAR_ID_TAREAS,
          eventId: tarea.eventoCalendarId,
          requestBody: recursoEvento
        });
        console.log(`Evento actualizado: ${tarea.titulo}`);
      } else {
        const respuesta = await calendar.events.insert({
          calendarId: CALENDAR_ID_TAREAS,
          requestBody: recursoEvento
        });
        await docSnap.ref.update({ eventoCalendarId: respuesta.data.id });
        console.log(`Evento creado: ${tarea.titulo}`);
      }
    } catch (err) {
      console.error(`Error sincronizando "${tarea.titulo}":`, err.message);
    }
  }
}

// ===================== SINCRONIZAR FECHAS IMPORTANTES =====================

async function sincronizarFechasImportantes() {
  console.log('--- Sincronizando fechas importantes ---');
  const snap = await db.collection('fechasImportantes').get();

  for (const docSnap of snap.docs) {
    const evento = docSnap.data();

    if (evento.eventoCalendarId) continue;
    if (!evento.fecha) continue;

    const fecha = timestampADate(evento.fecha);

    const recursoEvento = {
      summary: `🎉 ${evento.titulo}`,
      description: evento.descripcion || '',
      start: { date: formatearFechaGoogle(fecha) },
      end: { date: formatearFechaGoogle(sumarDias(fecha, 1)) },
      colorId: '10',
      recurrence: evento.recurrenteAnual ? ['RRULE:FREQ=YEARLY'] : undefined
    };

    try {
      const respuesta = await calendar.events.insert({
        calendarId: CALENDAR_ID_FECHAS,
        requestBody: recursoEvento
      });
      await docSnap.ref.update({ eventoCalendarId: respuesta.data.id });
      console.log(`Fecha importante creada: ${evento.titulo}`);
    } catch (err) {
      console.error(`Error creando "${evento.titulo}":`, err.message);
    }
  }
}

// ===================== EJECUCIÓN =====================

async function main() {
  try {
    await sincronizarTareas();
    await sincronizarFechasImportantes();
    console.log('--- Sincronización completa ---');
  } catch (err) {
    console.error('Error general en la sincronización:', err);
    process.exit(1);
  }
}

main();
