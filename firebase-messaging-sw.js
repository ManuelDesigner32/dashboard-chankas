// firebase-messaging-sw.js
// Este archivo debe estar en la RAÍZ del repositorio (mismo nivel que index.html).
// Permite que lleguen notificaciones push aunque el dashboard esté cerrado.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDvuGHpBaaPvhg877pVBcYggEF1bYfCiXU",
  authDomain: "dashboard-chankas.firebaseapp.com",
  projectId: "dashboard-chankas",
  storageBucket: "dashboard-chankas.firebasestorage.app",
  messagingSenderId: "204388822073",
  appId: "1:204388822073:web:7d3ede3539e638f9d871e8"
});

const messaging = firebase.messaging();

// Se ejecuta cuando llega una notificación y el dashboard NO está abierto/en foco
messaging.onBackgroundMessage((payload) => {
  const titulo = payload.notification?.title || 'Dashboard Chankas';
  const opciones = {
    body: payload.notification?.body || '',
    icon: payload.notification?.icon || undefined,
    badge: payload.notification?.icon || undefined
  };
  self.registration.showNotification(titulo, opciones);
});
