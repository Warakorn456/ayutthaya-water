// ปริมาณน้ำเทียบความจุลำน้ำ (ต้องโหลด data.js ก่อน)
//
// qmax ของแต่ละสถานี = ปริมาณน้ำที่ลำน้ำรับได้ตอนน้ำเต็มตลิ่ง (ลบ.ม./วินาที) จากกรมชลประทาน
// ในอยุธยา แม่น้ำเจ้าพระยาจากอ่างทอง (C.7A) แยกเป็น 3 สาย: C.35 บ้านป้อม, C.36 บางหลวงโดด, C.37 บางบาล
// (ผลรวม 3 สายใกล้เคียง C.7A) แล้วแม่น้ำป่าสัก (S.26) มาบรรจบที่เกาะเมือง
const FLOW_NET = {
  main: [
    {id: '2795', code: 'C.2', place: 'นครสวรรค์'},
    {id: '2744', code: 'C.13', place: 'ท้ายเขื่อนเจ้าพระยา ชัยนาท'},
    {id: '2723', code: 'C.3', place: 'บางพุทรา สิงห์บุรี'},
    {id: '2626', code: 'C.7A', place: 'บางแก้ว อ่างทอง', entry: true}],
  branches: [
    {id: '2609', code: 'C.35', place: 'บ้านป้อม (เจ้าพระยา)'},
    {id: '2611', code: 'C.36', place: 'บางหลวงโดด'},
    {id: '2608', code: 'C.37', place: 'บางบาล'}],
  pasak: [
    {id: '2712', code: 'S.28', place: 'ท้ายเขื่อนป่าสักชลสิทธิ์'},
    {id: '2624', code: 'S.26', place: 'ท้ายเขื่อนพระรามหก', entry: true}]
};
const FLOW_IDS = [...FLOW_NET.main, ...FLOW_NET.branches, ...FLOW_NET.pasak].map(n => n.id);
const M3S_TO_MCM_DAY = 86400 / 1e6;   // ลบ.ม./วินาที → ล้าน ลบ.ม./วัน

// q: {id: m³/s} ; cap: {id: qmax}
function flowBalance(q, cap){
  const sum = ids => ids.reduce((a, id) => a + (q[id] ?? 0), 0);
  const branchIds = FLOW_NET.branches.map(b => b.id);
  const inAyt = sum(branchIds);                          // น้ำเจ้าพระยาที่ไหลผ่านอยุธยา (3 สาย)
  const pasak = q['2624'] ?? null;
  const capAyt = branchIds.reduce((a, id) => a + (cap[id] ?? 0), 0);
  // ส่วนที่เกินคิดทีละสาย เพราะสายที่ยังว่างรับน้ำแทนสายที่ล้นไม่ได้
  const over = [...branchIds, '2624'].map(id => ({id, x: q[id] != null && cap[id] ? Math.max(0, q[id] - cap[id]) : 0}));
  const excess = over.reduce((a, o) => a + o.x, 0);
  return {inAyt, pasak, total: inAyt + (pasak ?? 0), capAyt, capPasak: cap['2624'] ?? null, excess,
    excessMcm: excess * M3S_TO_MCM_DAY, over: over.filter(o => o.x > 0), entry: q['2626'] ?? null};
}

const pctClass = p => p == null ? 'lv0' : p > 100 ? 'lv5' : p >= 90 ? 'lv4' : p >= 70 ? 'lv3' : 'lv2';

// การ์ดสรุป (ใช้ในแท็บปริมาณน้ำ)
function balanceHtml(now, before){
  if (!now || !now.inAyt) return '<p class="hint">ไม่มีข้อมูลอัตราการไหลล่าสุด</p>';
  const k = now.excess > 0 ? 'lv5' : now.inAyt > now.capAyt * .9 ? 'lv4' : 'lv2';
  const bg = {lv5: 'lv5-bg', lv4: 'lv4-bg', lv2: 'ok-bg'}[k];
  const d = before ? now.excess - before.excess : null;
  const trend = d == null ? '' : Math.abs(d) < 10 ? 'ปริมาณน้ำที่ล้นใกล้เคียงเมื่อวาน'
    : d > 0 ? `<b class="up">น้ำที่ล้นเพิ่มขึ้น ${Math.round(d).toLocaleString()} ลบ.ม./วิ จากเมื่อวาน</b>`
    : `<b class="down">น้ำที่ล้นลดลง ${Math.round(-d).toLocaleString()} ลบ.ม./วิ จากเมื่อวาน</b>`;
  const n = x => Math.round(x).toLocaleString();
  return `<div class="bal" style="--st:var(--${k});--st-bg:var(--${bg})">
    <div class="bal-row">
      <div><span class="eyebrow">น้ำเจ้าพระยาไหลผ่านอยุธยา</span><b class="num">${n(now.inAyt)}</b><span class="meta">ลบ.ม./วินาที</span></div>
      <div><span class="eyebrow">ลำน้ำรับได้ (เต็มตลิ่ง)</span><b class="num">${n(now.capAyt)}</b><span class="meta">ลบ.ม./วินาที</span></div>
      <div class="bal-x"><span class="eyebrow">ล้นตลิ่งออกไป</span><b class="num">${n(now.excess)}</b><span class="meta">ลบ.ม./วินาที</span></div>
    </div>
    ${now.excess > 0 ? `<p class="big">น้ำล้นตลิ่งราว <b>${now.excessMcm.toFixed(1)} ล้าน ลบ.ม. ต่อวัน</b>
      <span class="meta">(เท่ากับน้ำท่วมสูง 1 เมตร บนพื้นที่ ${now.excessMcm.toFixed(0)} ตร.กม. ทุกวัน)</span></p>`
      : `<p class="big">ลำน้ำยังรับน้ำได้ ใช้ความจุไป ${Math.round(now.inAyt / now.capAyt * 100)}%</p>`}
    ${trend ? `<p>${trend}</p>` : ''}
    ${now.pasak != null ? `<p class="meta">แม่น้ำป่าสัก (S.26) อีก ${n(now.pasak)} ลบ.ม./วิ จากความจุ ${n(now.capPasak)} มาบรรจบที่เกาะเมือง รวมน้ำไหลผ่านอยุธยาทั้งหมด ${n(now.total)} ลบ.ม./วิ</p>` : ''}
  </div>`;
}

// ผังการไหล: การ์ดแต่ละสถานีมีแถบ "ใช้ความจุไปแล้ว" (สเกล 0–150%, ขีดที่ 100% = เต็มตลิ่ง)
// เส้นเชื่อมหนาตามปริมาณน้ำ
function flowDiagramHtml(q, cap, chg, spark){
  const node = n => {
    const v = q[n.id], c = cap[n.id], p = v != null && c ? v / c * 100 : null, k = pctClass(p);
    const w = p == null ? 0 : Math.min(p, 150) / 150 * 100;
    const ch = chg[n.id];
    return `<div class="fnode${n.entry ? ' entry' : ''}">
      <span class="code">${n.code} · ${esc(n.place)}</span>
      <span><b class="num q">${v != null ? Math.round(v).toLocaleString() : '-'}</b> <span class="meta">ลบ.ม./วิ</span>
        ${ch == null ? '' : Math.abs(ch) < 3 ? '<span class="meta">ทรงตัว</span>' : ch > 0 ? `<span class="up">▲${ch.toFixed(0)}%</span>` : `<span class="down">▼${(-ch).toFixed(0)}%</span>`}</span>
      ${p != null ? `<div class="capbar" role="meter" aria-valuenow="${p.toFixed(0)}" aria-valuemin="0" aria-valuemax="150" aria-label="ใช้ความจุลำน้ำ">
          <i class="${k}" style="width:${w}%"></i><em style="left:${100 / 1.5}%"></em></div>
        <span class="meta">ใช้ความจุ <b class="${p > 100 ? 'up' : ''}">${p.toFixed(0)}%</b> (รับได้ ${Math.round(c).toLocaleString()})</span>`
        : '<span class="meta">ไม่มีข้อมูลความจุ</span>'}
      ${spark[n.id] ? `<svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="${spark[n.id]}" vector-effect="non-scaling-stroke"/></svg>` : ''}
    </div>`;
  };
  const pipe = id => `<div class="pipe" aria-hidden="true"><i style="width:${Math.max(2, Math.min(16, (q[id] ?? 0) / 170))}px"></i></div>`;
  return `<div class="fdiag">
    <div class="fcol">
      <h3>แม่น้ำเจ้าพระยา</h3>
      ${FLOW_NET.main.map((n, i) => (i ? pipe(n.id) : '') + node(n)).join('')}
      ${pipe('2626')}
      <p class="meta" style="text-align:center">แยกเป็น 3 สายในอยุธยา</p>
      <div class="fsplit">${FLOW_NET.branches.map(node).join('')}</div>
    </div>
    <div class="fcol">
      <h3>แม่น้ำป่าสัก</h3>
      ${FLOW_NET.pasak.map((n, i) => (i ? pipe(n.id) : '') + node(n)).join('')}
      <p class="meta" style="text-align:center">↓ บรรจบเจ้าพระยาที่เกาะเมืองอยุธยา</p>
    </div>
  </div>`;
}

const FLOW_CSS = `
.bal{border-radius:14px;padding:14px;display:grid;gap:10px;background:var(--st-bg);border:2px solid var(--st)}
.bal-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.bal-row>div{display:grid;gap:0;background:var(--surface);border-radius:10px;padding:8px 10px}
.bal-row b{font-size:1.45rem;line-height:1.2}
.bal-x b{color:var(--lv5)}
.fdiag{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:700px){.fdiag{grid-template-columns:minmax(0,1fr)}}
.fcol{display:grid;gap:0;min-width:0}
.fcol h3{margin-bottom:8px}
.fnode{border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:grid;gap:3px;background:var(--surface);min-width:0}
.fnode.entry{border:2px solid var(--accent)}
.fnode .code{font-size:.8rem;color:var(--muted)}
.fnode .q{font-size:1.2rem}
.fnode svg{width:100%;height:24px;display:block}
.fnode svg path{fill:none;stroke:var(--muted);stroke-width:1.5}
.capbar{position:relative;height:10px;border-radius:5px;background:var(--line)}
.capbar i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--lv2)}
.capbar i.lv3{background:var(--lv3)} .capbar i.lv4{background:var(--lv4)} .capbar i.lv5{background:var(--lv5)}
.capbar em{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink)}
.pipe{display:flex;justify-content:center;height:22px}
.pipe i{display:block;background:var(--water);border-radius:2px}
.fsplit{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
@media (max-width:420px){.fsplit{grid-template-columns:minmax(0,1fr)}}
`;
(function(){ const s = document.createElement('style'); s.textContent = FLOW_CSS; document.head.appendChild(s); })();
