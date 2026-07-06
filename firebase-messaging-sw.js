// firebase-messaging-sw.js
// Service worker mínimo, solo para que la app cumpla los requisitos de instalación (PWA).
// Ya no maneja notificaciones push.

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
