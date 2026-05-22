const CACHE_NAME = 'yulha-connect-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker 설치됨');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker 활성화됨');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // GAS URL로의 요청은 그대로 통과
  event.respondWith(fetch(event.request));
});
