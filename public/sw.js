/* Keep private campaign records and photos out of persistent browser caches. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>인터넷 연결 확인</title><body style="font-family:sans-serif;background:#edf4e6;color:#36533d;padding:3rem;line-height:1.8"><h1>잠깐, 연결을 확인해 주세요</h1><p>사진과 실천 기록을 안전하게 저장하려면 인터넷 연결이 필요해요.</p><button onclick="location.reload()" style="padding:12px 20px;font-size:16px">다시 열기</button></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 })));
});
