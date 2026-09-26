// Service worker: เปิดได้แม้เน็ตหลุด + ตรวจระดับน้ำเบื้องหลัง (เฉพาะเครื่องที่รองรับ)
const SHELL = 'wl-shell-v1';
const DATA = 'wl-data-v1';
const CONFIG = 'wl-config';
const SHELL_FILES = ['./', 'index.html', '3d.html', 'data.js', 'ui.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => ![SHELL, DATA, CONFIG].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // ข้อมูลน้ำ/ฝน: ลองเน็ตก่อน ไม่ได้ค่อยใช้ของเก่า
  if (url.hostname === 'api-v3.thaiwater.net') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) {
        // เก็บพร้อมเวลาที่โหลด เพื่อให้หน้าเว็บบอกได้ว่าข้อมูลเก่าแค่ไหนตอนออฟไลน์
        res.clone().blob().then(b => caches.open(DATA).then(c => c.put(req, new Response(b, {
          headers: {'Content-Type': 'application/json', 'X-Cached-At': String(Date.now())}}))));
      }
      return res;
    }).catch(async () => {
      const hit = await caches.match(req);
      if (!hit) return Response.error();
      const h = new Headers(hit.headers);
      h.set('X-From-Cache', '1');
      return new Response(await hit.blob(), {status: 200, headers: h});
    }));
    return;
  }
  // ไลบรารีและฟอนต์จาก CDN: ใช้ของใน cache ก่อน
  if (['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // ไฟล์ของเว็บเอง: ลองเน็ตก่อน (ได้เวอร์ชันล่าสุดเสมอ) เน็ตหลุดค่อยใช้ cache
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(c => fetch(req)
      .then(res => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(async () => (await c.match(req, {ignoreSearch: true})) || Response.error())));
  }
});

// ---------- แจ้งเตือน ----------
async function readConfig(){
  const r = await (await caches.open(CONFIG)).match('alert-config');
  return r ? r.json() : null;
}
async function writeConfig(cfg){
  await (await caches.open(CONFIG)).put('alert-config', new Response(JSON.stringify(cfg), {headers: {'Content-Type': 'application/json'}}));
}

async function backgroundCheck(){
  const cfg = await readConfig();
  if (!cfg || !cfg.on || !cfg.sid) return;
  const res = await fetch(API);
  if (!res.ok) return;
  const d = (await res.json())?.waterlevel_data?.data || [];
  const row = d.find(x => String(x.station?.id) === cfg.sid);
  const pct = row ? +row.storage_percent : NaN;
  if (isNaN(pct)) return;
  const hit = pct >= cfg.pct;
  if (hit && !cfg.firedPct) {
    await self.registration.showNotification('ระดับน้ำถึงเกณฑ์ที่ตั้งไว้', {
      body: `${row.station.tele_station_name.th}: ${pct.toFixed(0)}% ของตลิ่ง (น้ำ ${row.waterlevel_msl} ม.)`,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'wl-pct', renotify: true
    });
  }
  cfg.firedPct = hit;
  await writeConfig(cfg);
}

self.addEventListener('periodicsync', e => { if (e.tag === 'wl-check') e.waitUntil(backgroundCheck()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
