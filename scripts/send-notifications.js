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

function obtenerTokensDeUsuario(usuario) {
  const tokens = new Set();
  if (Array.isArray(usuario.fcmTokens)) {
    usuario.fcmTokens.forEach(t => t && tokens.add(t));
  }
  if (usuario.fcmToken) tokens.add(usuario.fcmToken); // compatibilidad con el campo viejo (un solo dispositivo)
  return Array.from(tokens);
}

async function enviarNotificacion(tokens, titulo, cuerpo) {
  const listaTokens = Array.isArray(tokens) ? tokens : [tokens];
  for (const token of listaTokens) {
    if (!token) continue;
    try {
      await messaging.send({
        token,
        notification: {
          title: titulo,
          body: cuerpo
        },
        webpush: {
          notification: {
            icon: 'https://manueldesigner32.github.io/dashboard-chankas/icon-192.png'
          }
        }
      });
      console.log(`Notificación enviada a un dispositivo: "${titulo}"`);
    } catch (err) {
      console.log(`No se pudo enviar a un dispositivo (token puede estar vencido): ${err.message}`);
    }
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

    if (!usuarioAsignado) continue;
    const tokens = obtenerTokensDeUsuario(usuarioAsignado);
    if (tokens.length === 0) continue;
    if (tarea.estado === 'completada') continue;

    const actualizaciones = {};

    // 1. Notificar nueva asignación (solo una vez)
    if (!tarea.notificadoAsignacion) {
      await enviarNotificacion(
        tokens,
        '📋 Nueva tarea asignada',
        `${tarea.titulo} — asignada por ${tarea.asignadoPorNombre || 'el equipo'}`
      );
      actualizaciones.notificadoAsignacion = true;
    }

    // 2. Recordatorios de vencimiento
    if (tarea.fechaLimite) {
      const dias = diasHastaVencer(tarea.fechaLimite);

      if (dias === 3 && !tarea.notificado3Dias) {
        await enviarNotificacion(tokens, '⏰ Tarea vence en 3 días', tarea.titulo);
        actualizaciones.notificado3Dias = true;
      }

      if (dias === 1 && !tarea.notificado1Dia) {
        await enviarNotificacion(tokens, '⏰ Tarea vence mañana', tarea.titulo);
        actualizaciones.notificado1Dia = true;
      }

      if (dias === 0 && !tarea.notificadoHoy) {
        await enviarNotificacion(tokens, '🔴 Tarea vence hoy', tarea.titulo);
        actualizaciones.notificadoHoy = true;
      }
    }

    if (Object.keys(actualizaciones).length > 0) {
      await docSnap.ref.update(actualizaciones);
    }
  }
}

// ===================== AVISOS DEL ADMIN =====================

async function procesarAvisos() {
  const snapUsuarios = await db.collection('usuarios').get();
  const usuarios = {};
  snapUsuarios.forEach(d => { usuarios[d.id] = { id: d.id, ...d.data() }; });

  const snapAvisos = await db.collection('avisos').where('enviado', '==', false).get();

  for (const docSnap of snapAvisos.docs) {
    const aviso = docSnap.data();
    let tokens = [];

    if (aviso.destinatarioId === 'todos') {
      Object.values(usuarios).forEach(u => {
        if (u.activo === false) return;
        tokens.push(...obtenerTokensDeUsuario(u));
      });
    } else {
      const usuario = usuarios[aviso.destinatarioId];
      if (usuario) tokens = obtenerTokensDeUsuario(usuario);
    }

    if (tokens.length > 0) {
      await enviarNotificacion(
        tokens,
        `📢 Aviso de ${aviso.creadoPorNombre || 'la directiva'}`,
        aviso.mensaje
      );
    }

    await docSnap.ref.update({ enviado: true });
  }
}

async function main() {
  await procesarNotificaciones();
  await procesarAvisos();
}

main()
  .then(() => {
    console.log('--- Notificaciones y avisos procesados ---');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error procesando notificaciones/avisos:', err);
    process.exit(1);
  });
