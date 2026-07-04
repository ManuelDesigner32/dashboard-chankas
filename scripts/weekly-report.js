// weekly-report.js
// Envía cada lunes un resumen personalizado a cada usuario con sus tareas pendientes y vencidas.
// Corre vía GitHub Actions, en un workflow separado (solo los lunes).

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

function timestampADate(valor) {
  if (!valor) return null;
  if (valor._seconds !== undefined) return new Date(valor._seconds * 1000);
  if (valor.toDate) return valor.toDate();
  return new Date(valor);
}

function diasHastaVencer(fechaLimite) {
  const f = timestampADate(fechaLimite);
  if (!f) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  f.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / (1000 * 60 * 60 * 24));
}

function obtenerTokensDeUsuario(usuario) {
  const tokens = new Set();
  if (Array.isArray(usuario.fcmTokens)) {
    usuario.fcmTokens.forEach(t => t && tokens.add(t));
  }
  if (usuario.fcmToken) tokens.add(usuario.fcmToken);
  return Array.from(tokens);
}

async function enviarNotificacion(tokens, titulo, cuerpo) {
  const listaTokens = Array.isArray(tokens) ? tokens : [tokens];
  for (const token of listaTokens) {
    if (!token) continue;
    try {
      await messaging.send({
        token,
        notification: { title: titulo, body: cuerpo }
      });
      console.log(`Reporte enviado a un dispositivo: "${titulo}" -> ${cuerpo}`);
    } catch (err) {
      console.log(`No se pudo enviar a un dispositivo (token puede estar vencido): ${err.message}`);
    }
  }
}

async function generarReporteSemanal() {
  const snapUsuarios = await db.collection('usuarios').get();
  const snapTareas = await db.collection('tareas').get();

  const tareasPorUsuario = {}; // uid -> { pendientes, vencidas }

  snapTareas.forEach(docSnap => {
    const t = docSnap.data();
    if (t.estado === 'completada' || !t.asignadoA) return;

    if (!tareasPorUsuario[t.asignadoA]) {
      tareasPorUsuario[t.asignadoA] = { pendientes: 0, vencidas: 0 };
    }
    tareasPorUsuario[t.asignadoA].pendientes++;

    const dias = diasHastaVencer(t.fechaLimite);
    if (dias !== null && dias < 0) {
      tareasPorUsuario[t.asignadoA].vencidas++;
    }
  });

  for (const docSnap of snapUsuarios.docs) {
    const usuario = docSnap.data();
    if (usuario.activo === false) continue;

    const tokens = obtenerTokensDeUsuario(usuario);
    if (tokens.length === 0) continue;

    const stats = tareasPorUsuario[docSnap.id] || { pendientes: 0, vencidas: 0 };

    if (stats.pendientes === 0) {
      await enviarNotificacion(
        tokens,
        '📅 Resumen semanal - Marketing Chankas',
        '¡Vas al día! No tienes tareas pendientes esta semana.'
      );
    } else {
      const partes = [`${stats.pendientes} tarea${stats.pendientes === 1 ? '' : 's'} pendiente${stats.pendientes === 1 ? '' : 's'}`];
      if (stats.vencidas > 0) {
        partes.push(`${stats.vencidas} vencida${stats.vencidas === 1 ? '' : 's'} ⚠️`);
      }
      await enviarNotificacion(
        tokens,
        '📅 Resumen semanal - Marketing Chankas',
        `Tienes ${partes.join(' y ')}. ¡Buena semana!`
      );
    }
  }
}

generarReporteSemanal()
  .then(() => {
    console.log('--- Reporte semanal enviado ---');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error generando el reporte semanal:', err);
    process.exit(1);
  });
