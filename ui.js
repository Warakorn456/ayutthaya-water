// ส่วนแสดงผลที่ใช้ร่วมกัน: กราฟย้อนหลัง + คาดการณ์ (ต้องโหลด data.js ก่อน)
(function injectStyles(){
  const st = document.createElement('style');
  st.textContent = `
  .hc{position:relative;display:grid;gap:6px}
  .hc svg{width:100%;height:auto;display:block;touch-action:pan-y}
  .hc text{font:500 11px "IBM Plex Sans Thai",Tahoma,sans-serif;fill:var(--muted)}
  .hc .grid{stroke:var(--line);stroke-width:1}
  .hc .area{fill:var(--water,var(--accent));opacity:.14}
  .hc .line{fill:none;stroke:var(--water,var(--accent));stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
  .hc .qline{fill:none;stroke:var(--muted);stroke-width:1.5;stroke-linejoin:round}
  .hc .bank{stroke:var(--lv5);stroke-width:1.5;stroke-dasharray:5 4}
  .hc .banklbl{fill:var(--lv5);font-family:"IBM Plex Sans Thai",Tahoma,sans-serif}
  .hc .end{fill:var(--water,var(--accent));stroke:var(--surface);stroke-width:2}
  .hc .xh{stroke:var(--ink);stroke-width:1;opacity:.35}
  .hc .xd{fill:var(--surface);stroke:var(--water,var(--accent));stroke-width:2}
  .hc .cap{font-size:.78rem;color:var(--muted);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .hc .tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--surface);border-radius:6px;padding:4px 8px;font-size:.78rem;line-height:1.35;white-space:nowrap;transform:translate(-50%,-110%)}
  .fc{border-radius:10px;padding:10px 12px;display:grid;gap:2px;border-left:6px solid var(--fc,var(--lv0));background:var(--fc-bg,var(--bg))}
  .fc strong{font-size:1rem}
  .fc small{color:var(--muted)}
  `;
  document.head.appendChild(st);
})();

const TH_WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const thDay = t => { const d = new Date(t + 7 * 36e5); return `${TH_WD[d.getUTCDay()]} ${d.getUTCDate()}`; };
const thTime = t => new Date(t).toLocaleString('th-TH', {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok'});

function niceTicks(lo, hi, n = 4){
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// วาดกราฟระดับน้ำ (+ กราฟอัตราการไหลแยกอีกอัน) ลงใน el พร้อม tooltip
function mountHistory(el, hist, s){
  const pts = hist.points.filter(p => p.v != null);
  const qpts = hist.points.filter(p => p.q != null);
  if (pts.length < 2) { el.innerHTML = '<p class="hint">ไม่มีข้อมูลย้อนหลังของสถานีนี้</p>'; return; }
  const bank = s.bank ?? hist.minBank;
  const W = Math.max(300, Math.round(el.clientWidth || 360)), H = 190, L = 8, R = 40, T = 10, B = 20;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map(p => p.v).concat(bank != null ? [bank] : []);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * .12, .15); lo -= pad; hi += pad;
  const X = t => L + (t - t0) / Math.max(t1 - t0, 1) * (W - L - R);
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = pts.map((p, i) => `${i && pts[i - 1] && p.t - pts[i - 1].t > 3 * 36e5 ? 'M' : (i ? 'L' : 'M')}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `M${X(pts[0].t)},${H - B}` + pts.map(p => `L${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('') + `L${X(t1)},${H - B}Z`;
  const days = [];
  const d0 = new Date(new Date(t0).toLocaleDateString('sv-SE', {timeZone: 'Asia/Bangkok'}) + 'T00:00:00+07:00').getTime();
  for (let d = d0 + 864e5; d < t1; d += 864e5) days.push(d);
  const dayStep = X(t0 + 864e5) - X(t0) < 44 ? 2 : 1;
  const last = pts[pts.length - 1];

  let qsvg = '';
  if (qpts.length > 5) {
    const QH = 64, qlo = Math.min(...qpts.map(p => p.q)) * .95, qhi = Math.max(...qpts.map(p => p.q)) * 1.05 || 1;
    const QY = q => 6 + (qhi - q) / Math.max(qhi - qlo, 1) * (QH - 14);
    const qp = qpts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${QY(p.q).toFixed(1)}`).join('');
    const ql = qpts[qpts.length - 1];
    qsvg = `<svg viewBox="0 0 ${W} ${QH}" role="img" aria-label="อัตราการไหลย้อนหลัง 7 วัน">
      ${days.map(d => `<line class="grid" x1="${X(d)}" x2="${X(d)}" y1="0" y2="${QH - 6}"/>`).join('')}
      <path class="qline" d="${qp}"/>
      <circle class="end" style="fill:var(--muted)" cx="${X(ql.t)}" cy="${QY(ql.q)}" r="4"/>
      <text x="${W - R + 4}" y="${QY(ql.q) + 4}">${Math.round(ql.q).toLocaleString()}</text>
    </svg>
    <div class="cap"><span>อัตราการไหล (ลบ.ม./วินาที)</span><span>ต่ำสุด ${Math.round(Math.min(...qpts.map(p => p.q))).toLocaleString()} · สูงสุด ${Math.round(Math.max(...qpts.map(p => p.q))).toLocaleString()}</span></div>`;
  }

  el.innerHTML = `<div class="hc">
    <div class="cap"><span>ระดับน้ำย้อนหลัง 7 วัน (ม.รทก.)</span><span>สูงสุด ${fmtM(forecastPeak(pts).v)} เมื่อ ${thTime(forecastPeak(pts).t)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟระดับน้ำย้อนหลัง 7 วัน ค่าล่าสุด ${fmtM(last.v)} เมตร">
      ${niceTicks(lo, hi).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${W - R + 4}" y="${Y(v) + 3.5}">${v}</text>`).join('')}
      ${days.map((d, i) => `<line class="grid" x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}"/>${i % dayStep ? '' : `<text x="${X(d) + 3}" y="${H - 6}">${thDay(d)}</text>`}`).join('')}
      <path class="area" d="${area}"/>
      ${bank != null ? `<line class="bank" x1="${L}" x2="${W - R}" y1="${Y(bank)}" y2="${Y(bank)}"/><text class="banklbl" x="${L + 2}" y="${Y(bank) - 4}">ตลิ่ง ${bank.toFixed(2)}</text>` : ''}
      <path class="line" d="${path}"/>
      <circle class="end" cx="${X(last.t)}" cy="${Y(last.v)}" r="4.5"/>
      <g class="hover" visibility="hidden"><line class="xh" y1="${T}" y2="${H - B}"/><circle class="xd" r="4.5"/></g>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
    </svg>
    ${qsvg}
    <div class="tip" hidden></div>
  </div>`;

  const svg = el.querySelector('svg'), hov = svg.querySelector('.hover'), tip = el.querySelector('.tip');
  const move = ev => {
    const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
    const t = t0 + (x - L) / (W - L - R) * (t1 - t0);
    let p = pts[0];
    for (const c of pts) if (Math.abs(c.t - t) < Math.abs(p.t - t)) p = c;
    const q = valueAt(hist.points, p.t, 'q');
    hov.setAttribute('visibility', 'visible');
    hov.querySelector('line').setAttribute('x1', X(p.t)); hov.querySelector('line').setAttribute('x2', X(p.t));
    hov.querySelector('circle').setAttribute('cx', X(p.t)); hov.querySelector('circle').setAttribute('cy', Y(p.v));
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(X(p.t) / W * r.width, 70), r.width - 70) + 'px';
    tip.style.top = (Y(p.v) / H * r.height + svg.offsetTop) + 'px';
    tip.innerHTML = `${thTime(p.t)}<br><b>${fmtM(p.v)} ม.</b>${bank != null ? ` · ${p.v > bank ? 'เกิน' : 'ต่ำกว่า'}ตลิ่ง ${Math.abs(p.v - bank).toFixed(2)}` : ''}${q != null ? `<br>ไหล ${Math.round(q).toLocaleString()} ลบ.ม./วิ` : ''}`;
  };
  const hide = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}
const forecastPeak = pts => pts.reduce((m, p) => p.v > m.v ? p : m, pts[0]);

function forecastHtml(f){
  if (!f) return '<p class="hint">ข้อมูลไม่พอสำหรับคาดการณ์</p>';
  const rate = f.cm == null ? '' : `${f.cm > 0 ? 'ขึ้น' : 'ลง'} ${Math.abs(f.cm).toFixed(1)} ซม./ชม.`;
  let head, k;
  if (f.over > 0) {
    head = `เกินตลิ่งแล้ว ${f.over.toFixed(2)} ม.` + (f.trend === 'up' ? ` และยังขึ้นอยู่ (${rate})` : f.trend === 'down' ? ` แต่เริ่มลดลง (${rate})` : ' ระดับทรงตัว');
    k = f.trend === 'down' ? 'lv4' : 'lv5';
  } else if (f.trend === 'up' && f.hoursToBank != null) {
    const h = f.hoursToBank;
    const when = h > 72 ? 'มากกว่า 3 วัน' : h < 1 ? 'ไม่ถึง 1 ชม.' : `ราว ${h < 10 ? h.toFixed(1) : Math.round(h)} ชม. (${thTime(f.t + h * 36e5)})`;
    head = `ถ้าขึ้นต่อในอัตรานี้ (${rate}) จะถึงตลิ่งใน${when}`;
    k = h < 24 ? 'lv5' : h < 72 ? 'lv4' : 'lv3';
  } else if (f.trend === 'down') {
    head = `น้ำกำลังลด (${rate}) ยังเหลืออีก ${f.gap?.toFixed(2) ?? '-'} ม. ถึงตลิ่ง`; k = 'lv2';
  } else if (f.trend === 'steady') {
    head = `ระดับน้ำทรงตัว เหลืออีก ${f.gap?.toFixed(2) ?? '-'} ม. ถึงตลิ่ง`; k = f.gap != null && f.gap < .3 ? 'lv4' : 'lv3';
  } else { head = 'ข้อมูลล่าสุดไม่พอคำนวณแนวโน้ม'; k = 'lv0'; }
  const bg = {lv5: 'lv5-bg', lv4: 'lv4-bg', lv3: 'lv3-bg', lv2: 'ok-bg'}[k];
  return `<div class="fc" style="--fc:var(--${k});--fc-bg:${bg ? 'var(--' + bg + ')' : 'var(--bg)'}">
    <strong>${head}</strong>
    <span>24 ชม. ที่ผ่านมา: ${f.change24 == null ? '-' : (f.change24 >= 0 ? '+' : '') + (f.change24 * 100).toFixed(0) + ' ซม.'}
      ${f.cm24 != null ? ` · เฉลี่ย ${f.cm24 >= 0 ? '+' : ''}${f.cm24.toFixed(1)} ซม./ชม.` : ''}</span>
    ${f.uncertain ? '<span class="err">แนวโน้ม 6 ชม. กับ 24 ชม. ไม่ตรงกัน ค่าคาดการณ์ไม่แน่นอน</span>' : ''}
    <small>คาดการณ์จากแนวโน้มล่าสุดเท่านั้น ไม่ได้คิดฝนที่จะตกหรือการปล่อยน้ำจากเขื่อน</small>
  </div>`;
}

// โหลดประวัติ + วาดกราฟ + คาดการณ์ของสถานี s ลงใน el
async function renderStationHistory(el, s){
  el.innerHTML = '<p class="hint">กำลังโหลดข้อมูลย้อนหลัง…</p>';
  el.dataset.sid = s.id;
  try {
    const hist = await fetchHistory(s.id);
    if (el.dataset.sid !== s.id) return;
    el.innerHTML = forecastHtml(forecast(hist.points, s.bank ?? hist.minBank)) + '<div class="hc-box"></div>';
    mountHistory(el.querySelector('.hc-box'), hist, s);
  } catch (e) {
    if (el.dataset.sid === s.id) el.innerHTML = '<p class="err">โหลดข้อมูลย้อนหลังไม่ได้ ลองกดรีเฟรช</p>';
  }
}
