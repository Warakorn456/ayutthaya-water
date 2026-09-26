// พยากรณ์ระดับน้ำล่วงหน้า 3 วัน (ต้องโหลด data.js ก่อน)
//
// วิธี: เรียนรู้จากข้อมูลรายชั่วโมงย้อนหลัง 30 วันว่า "ระดับน้ำที่สถานีนี้จะเปลี่ยนไปเท่าไหร่ในอีก h ชั่วโมง"
// จากแนวโน้มของสถานีเอง + การเปลี่ยนแปลงของน้ำต้นทาง (เขื่อนเจ้าพระยา C.13, นครสวรรค์ C.2, ป่าสัก S.26)
// ใช้ ridge regression บนค่า "การเปลี่ยนแปลง" (ไม่ใช้ค่าสัมบูรณ์ เพราะน้ำท่วมครั้งนี้สูงเกินช่วงที่เคยเห็น)
// แล้วเฉลี่ยกับการต่อเส้นแนวโน้ม 24 ชม. ซึ่งทดสอบย้อนหลังแล้วแม่นและเสถียรที่สุด
// ช่วงความไม่แน่นอนมาจากความคลาดเคลื่อนจริงเมื่อทดสอบกับ 7 วันล่าสุด (percentile 10–90)
const FC_H = [6, 12, 24, 36, 48, 72];
const FC_DAYS = 30;
const FC_UP = [{id: '2744', key: 'q'}, {id: '2795', key: 'q'}, {id: '2624', key: 'v'}];
const fcCache = new Map();

// จัดข้อมูลเป็นรายชั่วโมง เติมช่องว่างสั้นๆ (ข้อมูลเก่าบางช่วงรายงานวันละครั้ง) และลากค่าล่าสุดต่อได้ไม่เกิน 6 ชม.
function hourly(points, key, k0, k1, maxGap = 26, carry = 6){
  const out = new Array(k1 - k0 + 1).fill(null);
  for (const p of points) {
    if (p[key] == null) continue;
    const k = Math.round(p.t / 36e5) - k0;
    if (k >= 0 && k < out.length) out[k] = p[key];
  }
  let last = -1;
  for (let i = 0; i < out.length; i++) if (out[i] != null) {
    if (last >= 0 && i - last > 1 && i - last <= maxGap + 1)
      for (let j = last + 1; j < i; j++) out[j] = out[last] + (out[i] - out[last]) * (j - last) / (i - last);
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < out.length && j - last <= carry; j++) out[j] = out[last];
  return out;
}

function solveLin(A, b){
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c && M[c][c]) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[i] ? r[n] / r[i] : 0);
}
function ridgeFit(X, y, lam = 5){
  const n = X.length, d = X[0].length;
  const mu = [...Array(d)].map((_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const sd = [...Array(d)].map((_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mu[j]) ** 2, 0) / n) || 1);
  const Z = X.map(r => r.map((v, j) => (v - mu[j]) / sd[j]));
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const A = [...Array(d)].map((_, a) => [...Array(d)].map((_, b) => Z.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? lam : 0)));
  const w = solveLin(A, [...Array(d)].map((_, a) => Z.reduce((s, r, i) => s + r[a] * (y[i] - ym), 0)));
  return f => ym + f.reduce((s, v, j) => s + w[j] * (v - mu[j]) / sd[j], 0);
}
function quantile(arr, q){
  const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// ผลลัพธ์: {t, v, bank, horizons: [{h, t, mean, lo, hi, mae, maeNoChange}], cross, earliest, peak}
function forecastModel(s){
  const hit = fcCache.get(s.id);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.p;
  const p = buildForecast(s);
  p.catch(() => fcCache.delete(s.id));
  fcCache.set(s.id, {at: Date.now(), p});
  return p;
}

async function buildForecast(s){
  const [tgt, ...ups] = await Promise.all([fetchHistory(s.id, FC_DAYS),
    ...FC_UP.map(u => fetchHistory(u.id, FC_DAYS).catch(() => null))]);
  const pts = tgt.points.filter(p => p.v != null);
  if (pts.length < 72) return null;
  const k0 = Math.round(tgt.points[0].t / 36e5), k1 = Math.round(pts[pts.length - 1].t / 36e5);
  const L = hourly(tgt.points, 'v', k0, k1, 26, 0);
  const U = FC_UP.map((u, j) => ups[j] ? hourly(ups[j].points, u.key, k0, k1) : null);
  const feats = i => {
    if (i < 24 || L[i] == null || L[i - 6] == null || L[i - 24] == null) return null;
    const f = [L[i] - L[i - 6], L[i] - L[i - 24]];
    for (const u of U) {
      if (!u) { f.push(0); continue; }
      const a = u[i], b = u[i - 24];
      if (a == null || b == null) return null;
      f.push((a - b) / (Math.abs(b) + 1));
    }
    return f;
  };
  const now = L.length - 1, fNow = feats(now), testStart = now - 7 * 24;
  if (!fNow) return null;
  const bank = s.bank ?? tgt.minBank;
  const out = {t: k1 * 36e5, v: L[now], bank, horizons: []};
  for (const h of FC_H) {
    const rows = [];
    for (let i = 24; i + h <= now; i++) {
      const f = feats(i);
      if (f && L[i + h] != null) rows.push({i, f, y: L[i + h] - L[i]});
    }
    const trend = f => f[1] * h / 24;
    const tr = rows.filter(r => r.i + h <= testStart), te = rows.filter(r => r.i >= testStart);
    let pred, resid;
    if (tr.length >= 150) {
      const m = ridgeFit(tr.map(r => r.f), tr.map(r => r.y));
      resid = te.map(r => r.y - (m(r.f) + trend(r.f)) / 2);
      const mAll = ridgeFit(rows.map(r => r.f), rows.map(r => r.y));
      pred = (mAll(fNow) + trend(fNow)) / 2;
    } else {
      resid = te.map(r => r.y - trend(r.f));
      pred = trend(fNow);
    }
    let lo, hi, mae = null, maeNoChange = null;
    if (resid.length >= 10) {
      lo = pred + Math.min(quantile(resid, .1), -.03);
      hi = pred + Math.max(quantile(resid, .9), .03);
      mae = resid.reduce((a, r) => a + Math.abs(r), 0) / resid.length;
      maeNoChange = te.reduce((a, r) => a + Math.abs(r.y), 0) / te.length;
    } else {
      const w = Math.max(.05, Math.abs(pred) * .6);
      lo = pred - w; hi = pred + w;
    }
    out.horizons.push({h, t: out.t + h * 36e5, mean: out.v + pred, lo: out.v + lo, hi: out.v + hi, mae, maeNoChange});
  }
  // เวลาที่เส้นพยากรณ์ (และขอบบน) ข้ามระดับตลิ่ง
  const crossAt = key => {
    if (bank == null) return null;
    let pt = {t: out.t, v: out.v};
    if (pt.v >= bank) return out.t;
    for (const h of out.horizons) {
      const v = h[key];
      if (v >= bank) return pt.t + (bank - pt.v) / (v - pt.v) * (h.t - pt.t);
      pt = {t: h.t, v};
    }
    return null;
  };
  out.cross = crossAt('mean');
  out.earliest = crossAt('hi');
  out.peak = out.horizons.reduce((m, h) => h.mean > m.mean ? h : m, out.horizons[0]);
  return out;
}

// ---------- แสดงผล ----------
const fcWhen = t => {
  const d = new Date(t + 7 * 36e5), today = new Date(Date.now() + 7 * 36e5);
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 864e5);
  const day = days === 0 ? 'วันนี้' : days === 1 ? 'พรุ่งนี้' : days === 2 ? 'มะรืนนี้' : new Date(t).toLocaleDateString('th-TH', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok'});
  return `${day} ${String(d.getUTCHours()).padStart(2, '0')}:00 น.`;
};
const fcIn = t => { const h = (t - Date.now()) / 36e5; return h <= 1 ? 'ภายใน 1 ชม.' : h < 48 ? `อีกราว ${Math.round(h)} ชม.` : `อีกราว ${(h / 24).toFixed(1)} วัน`; };
const cm = v => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)} ซม.`;

// ข้อสรุปหลัก ใช้ทั้งการ์ดบ้านและรายละเอียดสถานี: {k, head, sub, readyBy}
function fcSummary(f){
  if (!f || !f.horizons.length) return null;
  const h24 = f.horizons.find(h => h.h === 24), h72 = f.horizons[f.horizons.length - 1];
  if (f.bank != null && f.v >= f.bank) {
    const rising = h24 && h24.mean > f.v + .02;
    return {k: rising ? 'lv5' : 'lv4',
      head: rising ? `ล้นตลิ่งแล้ว และคาดว่าจะสูงขึ้นอีกราว ${Math.round((h24.mean - f.v) * 100)} ซม. ใน 24 ชม.` : `ล้นตลิ่งแล้ว คาดว่าใน 24 ชม. จะ${h24 && h24.mean < f.v - .02 ? 'เริ่มลดลง' : 'ทรงตัว'}`,
      sub: h24 ? `ช่วงที่เป็นไปได้ใน 24 ชม.: ${cm(h24.lo - f.v)} ถึง ${cm(h24.hi - f.v)} · สูงสุดใน 3 วันคาดราว ${f.peak.mean.toFixed(2)} ม. (${fcWhen(f.peak.t)})` : '',
      readyBy: rising ? Date.now() : null};
  }
  if (f.earliest) {
    const readyBy = Math.max(Date.now(), f.earliest - 6 * 36e5);
    const soon = f.earliest - Date.now() < 24 * 36e5;
    return {k: f.cross && f.cross - Date.now() < 24 * 36e5 ? 'lv5' : soon ? 'lv4' : 'lv3',
      head: f.cross ? `คาดว่าน้ำจะถึงตลิ่ง ${fcWhen(f.cross)} (${fcIn(f.cross)})` : `มีโอกาสที่น้ำจะถึงตลิ่งภายใน 3 วัน`,
      sub: `เร็วสุดอาจถึงตลิ่ง ${fcWhen(f.earliest)}`, readyBy};
  }
  return {k: h72.mean > f.v + .05 ? 'lv3' : 'lv2',
    head: `ใน 3 วันข้างหน้า ยังไม่น่าจะถึงตลิ่ง`,
    sub: `คาดว่าระดับน้ำจะ${h72.mean > f.v + .02 ? 'สูงขึ้น' : h72.mean < f.v - .02 ? 'ลดลง' : 'ใกล้เคียงเดิม'} ${cm(h72.mean - f.v)} ภายใน 3 วัน ยังต่ำกว่าตลิ่ง ${(f.bank - h72.hi).toFixed(2)} ม. ขึ้นไป`,
    readyBy: null};
}

function fcBoxHtml(f){
  const S = fcSummary(f);
  if (!S) return '';
  const bg = {lv5: 'lv5-bg', lv4: 'lv4-bg', lv3: 'lv3-bg', lv2: 'ok-bg'}[S.k];
  const acc = f.horizons.filter(h => h.mae != null);
  const a24 = acc.find(h => h.h === 24), a72 = acc.find(h => h.h === 72);
  return `<div class="fc" style="--fc:var(--${S.k});--fc-bg:var(--${bg})">
    <strong>${S.head}</strong>
    ${S.sub ? `<span>${S.sub}</span>` : ''}
    ${S.readyBy ? `<span class="fc-ready">${S.readyBy - Date.now() < 36e5 ? 'ควรพร้อมอพยพตั้งแต่ตอนนี้' : 'ควรพร้อมอพยพก่อน ' + fcWhen(S.readyBy)}</span>` : ''}
  </div>
  <div class="fc-table"><table>
    <thead><tr><th>อีก</th><th>เวลา</th><th class="r">คาดการณ์</th>${f.bank != null ? '<th class="r">เทียบตลิ่ง</th>' : ''}</tr></thead>
    <tbody>${f.horizons.filter(h => h.h !== 36).map(h => `<tr><td>${h.h} ชม.</td><td>${fcWhen(h.t).replace(' น.', '')}</td>
      <td class="r"><b class="num">${h.mean.toFixed(2)}</b><br><small class="num" style="color:var(--muted)">${h.lo.toFixed(2)}–${h.hi.toFixed(2)}</small></td>
      ${f.bank != null ? `<td class="r num ${h.mean >= f.bank ? 'up' : ''}">${h.mean >= f.bank ? 'เกิน ' : 'ต่ำกว่า '}${Math.abs(h.mean - f.bank).toFixed(2)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>
  <small class="fc-note">พยากรณ์จากแนวโน้มของสถานีนี้และน้ำที่ไหลมาจากเขื่อนเจ้าพระยา นครสวรรค์ และแม่น้ำป่าสัก
    ${a24 ? `ทดสอบย้อนหลัง 7 วัน คลาดเคลื่อนเฉลี่ย ±${(a24.mae * 100).toFixed(0)} ซม. ที่ 24 ชม.` : ''}${a72 ? ` และ ±${(a72.mae * 100).toFixed(0)} ซม. ที่ 3 วัน` : ''}
    ไม่ได้รวมฝนที่จะตกใหม่ การปล่อยน้ำเขื่อนที่เปลี่ยนกะทันหัน หรือคันกั้นน้ำแตก ให้ติดตามประกาศทางการประกอบ</small>`;
}
