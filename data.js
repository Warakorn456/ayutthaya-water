// โค้ดที่ใช้ร่วมกันระหว่าง index.html (2D) และ 3d.html
const API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';
const REFRESH_MS = 10 * 60 * 1000;
const AYT = '14';
// อยุธยา + จังหวัดต้นน้ำเจ้าพระยา/ป่าสัก/ลพบุรี และท้ายน้ำใกล้เคียง
const NEAR = ['14','15','16','17','18','19','12','13','72','60'];
const CENTRAL = ['10','11','12','13','14','15','16','17','18','19','24','25','26','60','61','70','72','73','74','75'];

const $ = id => document.getElementById(id);
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
      pct: num(d.storage_percent), sit: d.situation_level,
      toBank: (msl != null && bank != null) ? bank - msl : null,
      trend: (msl != null && prev != null) ? (msl - prev) * 100 : null,
      time: d.waterlevel_datetime || ''
    };
  }).filter(s => s.lat && s.lng);
}

// ดึงข้อมูลสด ถ้าไม่ได้ให้ใช้ cache ล่าสุด: {stations, fromCache, at} หรือ null
async function fetchStations(){
  for (const url of [API, '/api/waterlevel']) {
    try {
      const r = await fetch(url, {cache:'no-store'});
      if (r.ok) {
        const json = await r.json();
        try { localStorage.setItem('wl-cache', JSON.stringify({at: Date.now(), json})); } catch (e) {}
        return {stations: parse(json), fromCache: false, at: Date.now()};
      }
    } catch (e) { /* ลองแหล่งถัดไป */ }
  }
  try {
    const c = JSON.parse(localStorage.getItem('wl-cache'));
    if (c) return {stations: parse(c.json), fromCache: true, at: c.at};
  } catch (e) {}
  return null;
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
    const r = await fetch(`${API_BASE}/waterlevel_graph?station_type=tele_waterlevel&station_id=${encodeURIComponent(id)}&start_date=${ymd(start)}&end_date=${ymd(end)}`);
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
