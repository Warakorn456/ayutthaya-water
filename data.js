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
