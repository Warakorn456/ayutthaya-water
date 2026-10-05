// โค้ดที่ใช้ร่วมกันระหว่าง index.html (2D) และ 3d.html
const API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';
const REFRESH_MS = 10 * 60 * 1000;
const AYT = '14';
// อยุธยา + จังหวัดต้นน้ำเจ้าพระยา/ป่าสัก/ลพบุรี และท้ายน้ำใกล้เคียง
const NEAR = ['14','15','16','17','18','19','12','13','72','60'];
const CENTRAL = ['10','11','12','13','14','15','16','17','18','19','24','25','26','60','61','70','72','73','74','75'];

const $ = id => document.getElementById(id);
// fetch ที่มีเวลาจำกัด: เน็ตช้า/ค้างช่วงน้ำท่วม จะได้ไม่รอไม่รู้จบ
// ไม่ส่ง Referer: thaiwater ตอบ 429 ถ้ามี Referer จากเว็บอื่น (เช่น github.io)
// (ห้ามตั้งทั้งหน้าด้วย <meta name="referrer"> เพราะ tile ของ OpenStreetMap ต้องมี Referer ไม่งั้นโดน 403)
async function fetchT(url, ms, opts = {}){
  const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, {referrerPolicy: 'no-referrer', ...opts, signal: c.signal}); } finally { clearTimeout(tm); }
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function level(p){
  if (p == null || isNaN(p)) return {k:'lv0', t:'ไม่มีข้อมูล', bg:null};
  if (p > 100) return {k:'lv5', t:'ล้นตลิ่ง', bg:'lv5-bg'};
  if (p >= 90) return {k:'lv4', t:'วิกฤต', bg:'lv4-bg'};
  if (p >= 70) return {k:'lv3', t:'เฝ้าระวัง', bg:'lv3-bg'};
  if (p >= 30) return {k:'lv2', t:'ปกติ', bg:'ok-bg'};
  return {k:'lv1', t:'น้ำน้อย', bg:'ok-bg'};
}
const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function parse(json){
  return (json?.waterlevel_data?.data || []).map(d => {
    const s = d.station || {}, g = d.geocode || {};
    const msl = num(d.waterlevel_msl), prev = num(d.waterlevel_msl_previous), bank = num(s.min_bank);
    return {
      id: String(s.id ?? ''),
      name: s.tele_station_name?.th || s.tele_station_name?.en || '-',
      lat: num(s.tele_station_lat), lng: num(s.tele_station_long),
      prov: g.province_name?.th || '', provCode: String(g.province_code || ''),
      amphoe: g.amphoe_name?.th || '',
      msl, prev, bank, ground: num(s.ground_level),
      leftBank: num(s.left_bank), rightBank: num(s.right_bank),
      pct: num(d.storage_percent), sit: d.situation_level, q: num(d.discharge), qmax: num(s.qmax),
      toBank: (msl != null && bank != null) ? bank - msl : null,
      trend: (msl != null && prev != null) ? (msl - prev) * 100 : null,
      time: d.waterlevel_datetime || ''
    };
  }).filter(s => s.lat && s.lng);
}

// ดึงข้อมูลสด ถ้าไม่ได้ให้ใช้ cache ล่าสุด: {stations, fromCache, at} หรือ null
async function fetchStations(){
  let old = null;
  for (const url of [API, '/api/waterlevel']) {
    try {
      const r = await fetchT(url, 25000, {cache: 'no-store'});
      if (r.ok) {
        const json = await r.json();
        // ออฟไลน์: service worker ส่งข้อมูลเก่ามาให้ เก็บไว้สำรอง แล้วลองแหล่งถัดไปก่อน
        if (r.headers.get('X-From-Cache')) {
          const at = +r.headers.get('X-Cached-At') || 0;
          if (!old || at > old.at) old = {json, at};
          continue;
        }
        try { localStorage.setItem('wl-cache', JSON.stringify({at: Date.now(), json})); } catch (e) {}
        return {stations: parse(json), fromCache: false, at: Date.now()};
      }
    } catch (e) { /* ลองแหล่งถัดไป */ }
  }
  try {
    const c = JSON.parse(localStorage.getItem('wl-cache'));
    if (c && (!old || c.at > old.at)) old = c;
  } catch (e) {}
  return old ? {stations: parse(old.json), fromCache: true, at: old.at || Date.now()} : null;
}

// ---------- ประวัติย้อนหลังรายชั่วโมง ----------
const API_BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public';
const ymd = d => d.toLocaleDateString('sv-SE', {timeZone: 'Asia/Bangkok'});
const histCache = new Map();
// {points: [{t: ms, v: ม.รทก.|null, q: m³/s|null}], minBank}
function fetchHistory(id, days = 7){
  const key = id + '/' + days, hit = histCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
  const p = (async () => {
    const end = new Date(), start = new Date(Date.now() - days * 864e5);
    const r = await fetchT(`${API_BASE}/waterlevel_graph?station_type=tele_waterlevel&station_id=${encodeURIComponent(id)}&start_date=${ymd(start)}&end_date=${ymd(end)}`, 20000);
    if (!r.ok) throw new Error('history ' + r.status);
    const d = (await r.json())?.data || {};
    const points = (d.graph_data || []).map(g => ({
      t: Date.parse(String(g.datetime).replace(' ', 'T') + ':00+07:00'), v: num(g.value), q: num(g.discharge)
    })).filter(g => !isNaN(g.t) && (g.v != null || g.q != null));
    return {points, minBank: num(d.min_bank)};
  })();
  p.catch(() => histCache.delete(key));
  histCache.set(key, {at: Date.now(), p});
  return p;
}

// ความชัน (ม./ชม.) ของ key ในช่วง `hours` ล่าสุด ด้วย linear regression
function slope(points, hours, key = 'v'){
  const pts = points.filter(p => p[key] != null);
  if (pts.length < 3) return null;
  const tEnd = pts[pts.length - 1].t, sel = pts.filter(p => p.t >= tEnd - hours * 36e5);
  if (sel.length < 3) return null;
  const xs = sel.map(p => (p.t - tEnd) / 36e5), ys = sel.map(p => p[key]);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx ? sxy / sxx : null;
}
// ค่าที่ใกล้เวลา t ที่สุด (ภายใน 3 ชม.)
function valueAt(points, t, key = 'v'){
  let best = null;
  for (const p of points) if (p[key] != null && Math.abs(p.t - t) <= 3 * 36e5 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
  return best ? best[key] : null;
}

// คาดการณ์จากแนวโน้มล่าสุด
function forecast(points, bank){
  const pts = points.filter(p => p.v != null);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const r6 = slope(pts, 6), r24 = slope(pts, 24);
  const rate = r6 ?? r24;                        // ม./ชม.
  const cm = rate == null ? null : rate * 100;   // ซม./ชม.
  const v24 = valueAt(pts, last.t - 24 * 36e5);
  const uncertain = r6 != null && r24 != null &&
    ((Math.sign(r6) !== Math.sign(r24) && Math.abs(r6) * 100 > .3 && Math.abs(r24) * 100 > .3) || Math.abs(r6 - r24) * 100 > 1.5);
  const trend = cm == null ? 'unknown' : cm > .3 ? 'up' : cm < -.3 ? 'down' : 'steady';
  const gap = bank != null ? bank - last.v : null;
  const hoursToBank = trend === 'up' && gap != null && gap > 0 ? gap / rate : null;
  const peak = pts.reduce((m, p) => p.v > m.v ? p : m, pts[0]);
  return {v: last.v, t: last.t, cm, cm24: r24 == null ? null : r24 * 100, change24: v24 == null ? null : last.v - v24,
          trend, uncertain, bank, gap, over: gap != null && gap < 0 ? -gap : 0, hoursToBank, peak};
}

// ---------- น้ำจากต้นน้ำ ----------
// สถานีหลักตามลำน้ำ เรียงจากต้นน้ำลงมา (id ของ thaiwater)
const RIVERS = [
  {name: 'แม่น้ำเจ้าพระยา', stations: [
    {id: '2795', code: 'C.2', place: 'นครสวรรค์'},
    {id: '2744', code: 'C.13', place: 'ท้ายเขื่อนเจ้าพระยา ชัยนาท'},
    {id: '2723', code: 'C.3', place: 'บางพุทรา สิงห์บุรี'},
    {id: '2626', code: 'C.7A', place: 'บางแก้ว อ่างทอง'},
    {id: '2609', code: 'C.35', place: 'บ้านป้อม อยุธยา'}]},
  {name: 'แม่น้ำป่าสัก', stations: [
    {id: '2712', code: 'S.28', place: 'ท้ายเขื่อนป่าสักชลสิทธิ์'},
    {id: '2624', code: 'S.26', place: 'ท้ายเขื่อนพระรามหก อยุธยา'}]}
];
const DAMS = ['ภูมิพล', 'สิริกิติ์', 'แควน้อยบำรุงแดน', 'ป่าสักชลสิทธิ์'];

// ฝนสะสม 24 ชม. ทุกสถานี
async function fetchRain(){
  const r = await fetchT(API_BASE + '/rain_24h', 40000);
  if (!r.ok) throw new Error('rain ' + r.status);
  return ((await r.json())?.data || []).map(d => ({
    name: d.station?.tele_station_name?.th || '-', lat: num(d.station?.tele_station_lat), lng: num(d.station?.tele_station_long),
    prov: d.geocode?.province_name?.th || '', provCode: String(d.geocode?.province_code || ''), amphoe: d.geocode?.amphoe_name?.th || '',
    r24: num(d.rain_24h), r1: num(d.rain_1h), time: d.rainfall_datetime || ''
  })).filter(d => d.lat && d.lng && d.r24 != null && d.r24 > 0);
}
// ระดับฝนตามเกณฑ์กรมอุตุนิยมวิทยา (มม./24 ชม.)
function rainLevel(mm){
  if (mm > 90) return {k: 'r4', t: 'ฝนหนักมาก'};
  if (mm >= 35.1) return {k: 'r3', t: 'ฝนหนัก'};
  if (mm >= 10.1) return {k: 'r2', t: 'ฝนปานกลาง'};
  return {k: 'r1', t: 'ฝนเล็กน้อย'};
}

// เขื่อนหลัก + ภาพฝนคาดการณ์ (ไฟล์ใหญ่ เก็บ cache 1 ชม.)
async function fetchDams(){ return (await fetchMain()).dams; }
async function fetchMain(){
  try { const c = JSON.parse(localStorage.getItem('wl-main')); if (c && Date.now() - c.at < 36e5) return c; } catch (e) {}
  const r = await fetchT(API_BASE + '/thailand_main', 60000);
  if (!r.ok) throw new Error('dams ' + r.status);
  const main = await r.json();
  const all = main?.dam?.data?.data || [];
  const IMG = API_BASE.replace('/public', '/shared') + '/image?image=';
  const rainFc = (main?.pre_rain?.data?.data || []).slice(0, 3).map((d, i) => ({
    url: IMG + encodeURIComponent(d.media_path), label: ['วันนี้', 'พรุ่งนี้', 'มะรืนนี้'][i] || d.filename}));
  const dams = DAMS.map(n => all.find(d => d.dam?.dam_name?.th === n)).filter(Boolean).map(d => ({
    name: d.dam.dam_name.th, pct: num(d.dam_storage_percent), storage: num(d.dam_storage),
    inflow: num(d.dam_inflow), released: num(d.dam_released), date: d.dam_date
  }));
  const res = {at: Date.now(), dams, rainFc};
  try { localStorage.setItem('wl-main', JSON.stringify(res)); } catch (e) {}
  return res;
}

function updatedText(res){
  if (!res) return '<span class="err">โหลดข้อมูลไม่ได้ ตรวจอินเทอร์เน็ต แล้วกดรีเฟรช (หรือรัน python proxy.py)</span>';
  if (res.fromCache) return '<span class="err">ต่อเน็ตไม่ได้ แสดงข้อมูลเก่าจาก ' + new Date(res.at).toLocaleString('th-TH') + '</span>';
  return 'โหลดเมื่อ ' + new Date(res.at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}) + ' น.';
}

function trendHtml(s){
  if (s.trend == null) return '-';
  if (Math.abs(s.trend) < 0.5) return '<span class="num">คงที่</span>';
  return s.trend > 0 ? `<span class="num up">▲ ${s.trend.toFixed(0)} ซม.</span>` : `<span class="num down">▼ ${(-s.trend).toFixed(0)} ซม.</span>`;
}

// พื้นดินที่สถานีใช้ได้หรือไม่ (บางสถานีเป็น 0 หรือสูงกว่าตลิ่ง ซึ่งผิด)
const validGround = s => s.ground != null && s.ground !== 0 && (s.bank == null || s.ground < s.bank);

const fmtM = v => v == null ? '-' : v.toFixed(2);

// ระยะทาง (กม.) และทิศ
function dist(a, b, c, d){
  const R = 6371, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b, c, d){
  const r = x => x * Math.PI / 180;
  const y = Math.sin(r(d - b)) * Math.cos(r(c));
  const x = Math.cos(r(a)) * Math.sin(r(c)) - Math.sin(r(a)) * Math.cos(r(c)) * Math.cos(r(d - b));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['เหนือ','ตะวันออกเฉียงเหนือ','ตะวันออก','ตะวันออกเฉียงใต้','ใต้','ตะวันตกเฉียงใต้','ตะวันตก','ตะวันตกเฉียงเหนือ'][Math.round(deg / 45) % 8];
}
