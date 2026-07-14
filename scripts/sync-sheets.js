// sync-sheets.js
// Sincroniza los links de fotos (colección 'linksFotos' en Firestore) hacia un Google Sheets.
// - Links nuevos: se agregan como fila nueva al final.
// - Links que cambiaron de estado (ej. marcados "usado"): se actualiza su fila existente.

const admin = require('firebase-admin');
const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID_FOTOS;
const NOMBRE_PESTANA = 'Hoja 1';

// ===================== INICIALIZAR FIREBASE =====================

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// ===================== INICIALIZAR GOOGLE SHEETS =====================

const serviceAccountCredenciales = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const authSheets = new google.auth.GoogleAuth({
  credentials: serviceAccountCredenciales,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth: authSheets });

// ===================== UTILIDADES =====================

function timestampADate(valor) {
  if (!valor) return null;
  if (valor._seconds !== undefined) return new Date(valor._seconds * 1000);
  if (valor.toDate) return valor.toDate();
  return new Date(valor);
}

function formatearFechaSheet(date) {
  // Mismo formato que ya usa la hoja: "14 julio"
  const dia = date.getDate();
  const mes = date.toLocaleDateString('es-PE', { month: 'long' });
  return `${dia} ${mes}`;
}

// ===================== SINCRONIZAR LINKS DE FOTOS =====================

async function sincronizarLinksFotos() {
  console.log('--- Sincronizando links de fotos con Google Sheets ---');
  const snap = await db.collection('linksFotos').get();

  for (const docSnap of snap.docs) {
    const link = docSnap.data();
    if (!link.fecha || !link.link) continue;

    const fecha = timestampADate(link.fecha);
    const estadoTexto = link.estado === 'usado' ? 'USADO' : '';

    if (!link.filaSheet) {
      // No existe aún en el Sheets: lo agregamos como fila nueva
      try {
        const respuesta = await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${NOMBRE_PESTANA}!A:E`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [[
              formatearFechaSheet(fecha),
              link.descripcion || '',
              link.link,
              estadoTexto,
              link.creadoPorNombre || ''
            ]]
          }
        });

        // Extraemos el número de fila donde quedó (ej. "Hoja 1!A15:E15" -> 15)
        const rangoActualizado = respuesta.data.updates.updatedRange;
        const coincidencia = rangoActualizado.match(/![A-Z]+(\d+):/);
        const numeroFila = coincidencia ? parseInt(coincidencia[1], 10) : null;

        if (numeroFila) {
          await docSnap.ref.update({ filaSheet: numeroFila });
        }
        console.log(`Fila agregada al Sheets para: ${link.descripcion || link.link}`);
      } catch (err) {
        console.error(`Error agregando "${link.descripcion || link.link}" al Sheets:`, err.message);
      }
    } else {
      // Ya existe: solo actualizamos Estado (columna D) por si cambió
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${NOMBRE_PESTANA}!D${link.filaSheet}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[estadoTexto]]
          }
        });
      } catch (err) {
        console.error(`Error actualizando estado de "${link.descripcion || link.link}":`, err.message);
      }
    }
  }
}

sincronizarLinksFotos()
  .then(() => {
    console.log('--- Sincronización con Sheets completa ---');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error general sincronizando con Sheets:', err);
    process.exit(1);
  });
