self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // şimdilik offline cache yok, sadece PWA kurulum şartını karşılıyor
