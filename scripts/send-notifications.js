// send-notifications.js
// Revisa tareas nuevas/por vencer y envía notificaciones push a los usuarios.
// Corre junto con sync-calendar.js vía GitHub Actions, cada 15 minutos.

const admin = require('firebase-admin');

// ===================== INICIALIZAR FIREBASE (reutiliza la misma cuenta de servicio) =====================

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

// ===================== UTILIDADES =====================

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

async function enviarNotificacion(token, titulo, cuerpo) {
  if (!token) return;
  try {
    await messaging.send({
      token,
      notification: {
        title: titulo,
        body: cuerpo,
        icon: 'https://manueldesigner32.github.io/dashboard-chankas/favicon.png'
      }
    });
    console.log(`Notificación enviada: "${titulo}"`);
  } catch (err) {
    console.log(`No se pudo enviar notificación (token puede estar vencido): ${err.message}`);
  }
}

// ===================== LÓGICA PRINCIPAL =====================

async function procesarNotificaciones() {
  const snapUsuarios = await db.collection('usuarios').get();
  const usuarios = {};
  snapUsuarios.forEach(d => { usuarios[d.id] = { id: d.id, ...d.data() }; });

  const snapTareas = await db.collection('tareas').get();

  for (const docSnap of snapTareas.docs) {
    const tarea = docSnap.data();
    const tareaId = docSnap.id;
    const usuarioAsignado = usuarios[tarea.asignadoA];

    if (!usuarioAsignado || !usuarioAsignado.fcmToken) continue;
    if (tarea.estado === 'completada') continue;

    const actualizaciones = {};

    // 1. Notificar nueva asignación (solo una vez)
    if (!tarea.notificadoAsignacion) {
      await enviarNotificacion(
        usuarioAsignado.fcmToken,
        '📋 Nueva tarea asignada',
        `${tarea.titulo} — asignada por ${tarea.asignadoPorNombre || 'el equipo'}`
      );
      actualizaciones.notificadoAsignacion = true;
    }

    // 2. Recordatorios de vencimiento
    if (tarea.fechaLimite) {
      const dias = diasHastaVencer(tarea.fechaLimite);

      if (dias === 3 && !tarea.notificado3Dias) {
        await enviarNotificacion(
          usuarioAsignado.fcmToken,
          '⏰ Tarea vence en 3 días',
          tarea.titulo
        );
        actualizaciones.notificado3Dias = true;
      }

      if (dias === 1 && !tarea.notificado1Dia) {
        await enviarNotificacion(
          usuarioAsignado.fcmToken,
          '⏰ Tarea vence mañana',
          tarea.titulo
        );
        actualizaciones.notificado1Dia = true;
      }

      if (dias === 0 && !tarea.notificadoHoy) {
        await enviarNotificacion(
          usuarioAsignado.fcmToken,
          '🔴 Tarea vence hoy',
          tarea.titulo
        );
        actualizaciones.notificadoHoy = true;
      }
    }

    if (Object.keys(actualizaciones).length > 0) {
      await docSnap.ref.update(actualizaciones);
    }
  }
}

procesarNotificaciones()
  .then(() => {
    console.log('--- Notificaciones procesadas ---');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error procesando notificaciones:', err);
    process.exit(1);
  });
