// แอปบนมือถือ (service worker, ติดตั้ง) + แจ้งเตือนระดับน้ำ (ต้องโหลด data.js ก่อน)
const allStations = () => (typeof stations !== 'undefined' ? stations : []);
let swReg = null, installEvt = null;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; updateAlertUI(); }).catch(() => {});
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  updateInstallUI();
});
window.addEventListener('appinstalled', () => { installEvt = null; updateInstallUI(); });

function updateInstallUI(){
  const btn = document.getElementById('installBtn'), hint = document.getElementById('installHint');
  if (!btn) return;
  btn.hidden = !installEvt;
  if (isStandalone()) hint.textContent = 'ติดตั้งเป็นแอปแล้ว';
  else if (installEvt) hint.textContent = 'กดปุ่มเพื่อเพิ่มไอคอนบนหน้าจอ เปิดได้แม้เน็ตหลุด';
  else if (isIOS) hint.innerHTML = 'iPhone/iPad: เปิดใน Safari แล้วกด <b>แชร์</b> → <b>เพิ่มไปยังหน้าจอโฮม</b>';
  else hint.textContent = 'ถ้าไม่เห็นปุ่มติดตั้ง ให้เปิดเมนูของเบราว์เซอร์ (⋮) แล้วเลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"';
}

// ---------- ตั้งค่าแจ้งเตือน ----------
const ALERT_KEY = 'wl-alert';
function getAlertCfg(){
  try { return JSON.parse(localStorage.getItem(ALERT_KEY)) || null; } catch (e) { return null; }
}
async function saveAlertCfg(cfg){
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(cfg)); } catch (e) {}
  // ให้ service worker อ่านได้ด้วย (sw อ่าน localStorage ไม่ได้)
  try {
    const c = await caches.open('wl-config');
    await c.put('alert-config', new Response(JSON.stringify(cfg), {headers: {'Content-Type': 'application/json'}}));
  } catch (e) {}
}

async function notify(title, body, tag){
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = {body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag, renotify: true};
  try {
    const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    if (reg) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);
    return true;
  } catch (e) { return false; }
}

async function enableAlerts(){
  const cfg = readAlertForm();
  if (!('Notification' in window)) { setAlertStatus('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน' + (isIOS ? ' (iPhone ต้องติดตั้งลงหน้าจอโฮมก่อน)' : ''), true); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setAlertStatus('ไม่ได้รับอนุญาตให้แจ้งเตือน เปิดสิทธิ์ได้ที่การตั้งค่าเว็บไซต์ของเบราว์เซอร์', true); return; }
  cfg.on = true; cfg.firedPct = false; cfg.firedRate = false;
  await saveAlertCfg(cfg);
  // ตรวจเบื้องหลัง (Chrome บน Android ที่ติดตั้งแอปแล้วเท่านั้น)
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    if (reg.periodicSync) {
      const st = await navigator.permissions.query({name: 'periodic-background-sync'});
      if (st.state === 'granted') await reg.periodicSync.register('wl-check', {minInterval: 30 * 60 * 1000});
    }
  } catch (e) {}
  updateAlertUI();
  checkAlerts(allStations());
}
async function disableAlerts(){
  const cfg = getAlertCfg() || {};
  cfg.on = false;
  await saveAlertCfg(cfg);
  try { const reg = swReg || await navigator.serviceWorker.ready; await reg.periodicSync?.unregister('wl-check'); } catch (e) {}
  updateAlertUI();
}

function readAlertForm(){
  const old = getAlertCfg() || {};
  return {...old, sid: document.getElementById('alertStation').value,
    pct: +document.getElementById('alertPct').value || 100,
    rate: +document.getElementById('alertRate').value || 0};
}
function setAlertStatus(msg, err){
  const el = document.getElementById('alertStatus');
  if (el) { el.textContent = msg; el.className = err ? 'err' : 'hint'; }
}

function fillAlertStations(list, homeStationId){
  const sel = document.getElementById('alertStation');
  if (!sel) return;
  const cfg = getAlertCfg();
  const keep = sel.value || cfg?.sid || homeStationId || '2609';
  const opts = list.filter(s => NEAR.includes(s.provCode) && s.pct != null)
    .sort((a, b) => (b.provCode === AYT) - (a.provCode === AYT) || a.prov.localeCompare(b.prov, 'th') || a.name.localeCompare(b.name, 'th'));
  sel.innerHTML = opts.map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.prov)} (${s.pct.toFixed(0)}%)</option>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  if (cfg) {
    document.getElementById('alertPct').value = cfg.pct ?? 100;
    document.getElementById('alertRate').value = cfg.rate ?? 3;
  }
  updateAlertUI();
}

function updateAlertUI(){
  updateInstallUI();
  const onBtn = document.getElementById('alertOn');
  if (!onBtn) return;
  const cfg = getAlertCfg(), on = !!cfg?.on && 'Notification' in window && Notification.permission === 'granted';
  onBtn.textContent = on ? 'บันทึกการตั้งค่า' : 'เปิดแจ้งเตือน';
  document.getElementById('alertOff').hidden = !on;
  document.getElementById('alertTest').hidden = !on;
  if (on) {
    const s = allStations().find(x => x.id === cfg.sid);
    setAlertStatus(`เปิดอยู่: ${s ? s.name : 'สถานีที่เลือก'} เมื่อถึง ${cfg.pct}% ของตลิ่ง` + (cfg.rate ? ` หรือขึ้นเร็วกว่า ${cfg.rate} ซม./ชม.` : '')
      + ' · แจ้งเตือนแน่นอนเฉพาะตอนเปิดหน้านี้ค้างไว้' + (isIOS && !isStandalone() ? ' (iPhone ต้องติดตั้งลงหน้าจอโฮมก่อน)' : ''));
  } else setAlertStatus('ยังไม่ได้เปิดแจ้งเตือน');
}

// เรียกหลังโหลดข้อมูลใหม่ทุกครั้ง
async function checkAlerts(list){
  const cfg = getAlertCfg();
  if (!cfg?.on || !list.length) return;
  const s = list.find(x => x.id === cfg.sid);
  if (!s || s.pct == null) return;
  let changed = false;
  const hitPct = s.pct >= cfg.pct;
  if (hitPct && !cfg.firedPct) await notify('ระดับน้ำถึงเกณฑ์ที่ตั้งไว้', `${s.name}: ${s.pct.toFixed(0)}% ของตลิ่ง (น้ำ ${fmtM(s.msl)} ม. ตลิ่ง ${fmtM(s.bank)} ม.)`, 'wl-pct');
  if (hitPct !== !!cfg.firedPct) { cfg.firedPct = hitPct; changed = true; }
  if (cfg.rate > 0) {
    try {
      const f = forecast((await fetchHistory(s.id)).points, s.bank);
      const hitRate = f?.cm != null && f.cm >= cfg.rate;
      if (hitRate && !cfg.firedRate) await notify('น้ำขึ้นเร็ว', `${s.name}: ขึ้น ${f.cm.toFixed(1)} ซม./ชม. (6 ชม. ล่าสุด)`, 'wl-rate');
      if (hitRate !== !!cfg.firedRate) { cfg.firedRate = hitRate; changed = true; }
    } catch (e) {}
  }
  // เตือนล่วงหน้าจากพยากรณ์: เร็วสุดอาจถึงตลิ่งภายใน 12 ชม.
  if (typeof forecastModel === 'function' && s.pct < 100) {
    try {
      const fc = await forecastModel(s);
      const soon = fc?.earliest != null && fc.earliest - Date.now() <= 12 * 36e5;
      if (soon && !cfg.firedFc) await notify('พยากรณ์: น้ำอาจถึงตลิ่งเร็วๆ นี้',
        `${s.name}: เร็วสุดอาจถึงตลิ่ง ${fcWhen(fc.earliest)} ควรเตรียมพร้อมอพยพ`, 'wl-fc');
      if (soon !== !!cfg.firedFc) { cfg.firedFc = soon; changed = true; }
    } catch (e) {}
  }
  if (changed) await saveAlertCfg(cfg);
}

function initAlertPanel(){
  const onBtn = document.getElementById('alertOn');
  if (!onBtn) return;
  onBtn.addEventListener('click', enableAlerts);
  document.getElementById('alertOff').addEventListener('click', disableAlerts);
  document.getElementById('alertTest').addEventListener('click', async () => {
    const ok = await notify('ทดสอบแจ้งเตือน', 'ถ้าเห็นข้อความนี้ การแจ้งเตือนระดับน้ำใช้งานได้', 'wl-test');
    setAlertStatus(ok ? 'ส่งแจ้งเตือนทดสอบแล้ว' : 'ส่งแจ้งเตือนไม่ได้ ตรวจสิทธิ์การแจ้งเตือนของเบราว์เซอร์', !ok);
  });
  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null; updateInstallUI();
  });
  updateAlertUI();
}
document.addEventListener('DOMContentLoaded', initAlertPanel);
