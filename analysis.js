// Web Worker: วิเคราะห์ทางไหลของน้ำบนกริดความสูงพื้นดิน
// รับ: N (กริด N×N), Z (ความสูงพื้นดินที่ปรับเทียบแล้ว, NaN = ไม่มีข้อมูล), source (1 = แม่น้ำสายหลัก),
//      drain (1 = แม่น้ำ/คลอง ที่น้ำไหลลงได้), level (ระดับน้ำของช่องแม่น้ำ), home {x,y}|null, cellM (เมตรต่อช่อง)
// ส่ง: depth (ความลึกน้ำที่แผ่จากแม่น้ำ), path (ทางไหลจากบ้าน), pond, stats

// binary heap บนดัชนี + ค่าคีย์ (min-heap; ใช้ค่าติดลบเพื่อทำ max-heap)
class Heap {
  constructor(cap){ this.i = new Int32Array(cap); this.k = new Float64Array(cap); this.n = 0; }
  push(idx, key){
    let c = this.n++;
    if (c >= this.i.length) { const i2 = new Int32Array(this.i.length * 2), k2 = new Float64Array(this.i.length * 2); i2.set(this.i); k2.set(this.k); this.i = i2; this.k = k2; }
    while (c > 0) { const p = (c - 1) >> 1; if (this.k[p] <= key) break; this.i[c] = this.i[p]; this.k[c] = this.k[p]; c = p; }
    this.i[c] = idx; this.k[c] = key;
  }
  pop(){
    const top = this.i[0], topK = this.k[0], last = --this.n, li = this.i[last], lk = this.k[last];
    let c = 0;
    while (true) {
      let m = 2 * c + 1;
      if (m >= last) break;
      if (m + 1 < last && this.k[m + 1] < this.k[m]) m++;
      if (this.k[m] >= lk) break;
      this.i[c] = this.i[m]; this.k[c] = this.k[m]; c = m;
    }
    this.i[c] = li; this.k[c] = lk;
    this.lastKey = topK;
    return top;
  }
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const DL = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

self.onmessage = e => {
  const {N, Z, source, drain, still, level, home, cellM} = e.data;
  const NN = N * N, t0 = performance.now();

  // 1) น้ำจากแม่น้ำแผ่ไปถึงไหน: เริ่มจากช่องแม่น้ำ ระดับน้ำสูงก่อน แผ่ไปยังช่องที่พื้นต่ำกว่าระดับน้ำ
  const W = new Float32Array(NN).fill(NaN);
  let h = new Heap(1 << 16);
  for (let i = 0; i < NN; i++) if (source[i] && !isNaN(level[i])) { W[i] = level[i]; h.push(i, -level[i]); }
  while (h.n) {
    const c = h.pop(), lv = W[c], cx = c % N, cy = (c / N) | 0;
    for (let d = 0; d < 8; d++) {
      const x = cx + DX[d], y = cy + DY[d];
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const j = y * N + x;
      if (!isNaN(W[j]) || isNaN(Z[j]) || Z[j] >= lv) continue;
      W[j] = lv; h.push(j, -lv);
    }
  }
  const depth = new Float32Array(NN);
  let area = 0, vol = 0;
  for (let i = 0; i < NN; i++) {
    if (source[i] || isNaN(W[i])) continue;
    const dp = W[i] - Z[i];
    if (dp > .05) { depth[i] = dp; area++; vol += dp; }
  }
  const cellA = cellM * cellM;

  // 1b) จำกัดด้วยปริมาณน้ำจริง: เติมน้ำปริมาตร volume (ลบ.ม.) ลงที่ต่ำที่สุดที่ต่อกับแม่น้ำก่อน
  //     ผิวน้ำในแอ่งที่ต่อกันสูงขึ้นพร้อมกัน: V(ระดับ) = จำนวนช่อง × ระดับ − ผลรวมความสูงพื้น
  const vdepth = new Float32Array(NN);
  let vArea = 0, vLevel = null, vFull = false;
  const volume = e.data.volume || 0;
  if (volume > 0) {
    const target = volume / cellA, seen = new Uint8Array(NN);
    h = new Heap(1 << 16);
    for (let i = 0; i < NN; i++) {
      if (!source[i]) continue;
      const cx = i % N, cy = (i / N) | 0;
      for (let d = 0; d < 8; d++) {
        const x = cx + DX[d], y = cy + DY[d];
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const j = y * N + x;
        if (seen[j] || source[j] || isNaN(W[j])) continue;
        seen[j] = 1; h.push(j, Z[j]);
      }
    }
    const added = [];
    let cnt = 0, sumZ = 0;
    while (h.n) {
      const c = h.pop(), z = Z[c];
      if (cnt && cnt * z - sumZ >= target) { vLevel = (target + sumZ) / cnt; break; }
      cnt++; sumZ += z; added.push(c);
      const cx = c % N, cy = (c / N) | 0;
      for (let d = 0; d < 8; d++) {
        const x = cx + DX[d], y = cy + DY[d];
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const j = y * N + x;
        if (seen[j] || source[j] || isNaN(W[j])) continue;
        seen[j] = 1; h.push(j, Z[j]);
      }
    }
    if (vLevel == null && cnt) { vFull = true; vLevel = -Infinity; for (const i of added) if (W[i] > vLevel) vLevel = W[i]; }
    for (const i of added) { const dp = Math.min(vLevel, W[i]) - Z[i]; if (dp > .02) { vdepth[i] = dp; vArea++; } }
  }

  // 2) ทางไหลของน้ำ: priority-flood จากขอบกรอบและแม่น้ำ/คลอง (จุดที่น้ำไหลออกได้)
  //    แต่ละช่องไหลไปหาช่องที่แผ่มาถึงมัน → ได้ทิศทางการไหลที่ต่อเนื่องแม้พื้นราบ
  const F = new Float32Array(NN).fill(NaN), to = new Int32Array(NN).fill(-1), outlet = new Uint8Array(NN);
  h = new Heap(1 << 16);
  const EPS = 1e-4;
  for (let i = 0; i < NN; i++) {
    const x = i % N, y = (i / N) | 0;
    if (drain[i] || x === 0 || y === 0 || x === N - 1 || y === N - 1) {
      const z = isNaN(Z[i]) ? 0 : Z[i];
      F[i] = z; outlet[i] = drain[i] ? 2 : 1; h.push(i, z);
    }
  }
  while (h.n) {
    const c = h.pop(), fc = F[c], cx = c % N, cy = (c / N) | 0;
    for (let d = 0; d < 8; d++) {
      const x = cx + DX[d], y = cy + DY[d];
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const j = y * N + x;
      if (!isNaN(F[j])) continue;
      const z = isNaN(Z[j]) ? fc : Z[j];
      F[j] = Math.max(z, fc + EPS); to[j] = c; h.push(j, F[j]);
    }
  }

  let path = null, pond = null, needRise = null, homeDepth = null, pathEnd = null;
  if (home) {
    const hi = home.y * N + home.x;
    // ทางไหลจากบ้าน
    path = [hi];
    let c = hi, len = 0, guard = 0;
    while (to[c] >= 0 && !outlet[c] && guard++ < 20000) {
      const n = to[c], d = Math.abs((n % N) - (c % N)) + Math.abs(((n / N) | 0) - ((c / N) | 0));
      len += d === 2 ? Math.SQRT2 : 1;
      c = n; path.push(c);
    }
    pathEnd = {idx: c, type: outlet[c] === 2 ? 'drain' : outlet[c] === 1 ? 'edge' : 'none', lenM: len * cellM};
    // แอ่งที่น้ำขังใกล้บ้าน (รัศมี 2 กม.): กลุ่มช่องที่ถูกเติมเต็มลึก ≥ 0.3 ม. ติดกันอย่างน้อย 20 ช่อง
    const R = Math.round(2000 / cellM), seen = new Uint8Array(NN);
    const isDep = i => !isNaN(Z[i]) && !drain[i] && !(still && still[i]) && F[i] - Z[i] >= .3;
    let bestD2 = Infinity;
    for (let y = Math.max(0, home.y - R); y <= Math.min(N - 1, home.y + R); y++)
      for (let x = Math.max(0, home.x - R); x <= Math.min(N - 1, home.x + R); x++) {
        const i0 = y * N + x;
        if (seen[i0] || !isDep(i0) || (x - home.x) ** 2 + (y - home.y) ** 2 > R * R) continue;
        const q = [i0]; seen[i0] = 1;
        let n = 0, maxD = 0, maxI = i0, near = Infinity, cap = 200000;
        while (q.length && cap--) {
          const c = q.pop(); n++;
          const d = F[c] - Z[c]; if (d > maxD) { maxD = d; maxI = c; }
          const cx = c % N, cy = (c / N) | 0;
          near = Math.min(near, (cx - home.x) ** 2 + (cy - home.y) ** 2);
          for (let k = 0; k < 8; k++) {
            const xx = cx + DX[k], yy = cy + DY[k];
            if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            const j = yy * N + xx;
            if (!seen[j] && isDep(j)) { seen[j] = 1; q.push(j); }
          }
        }
        if (n >= 20 && near < bestD2) { bestD2 = near; pond = {idx: maxI, depth: maxD, areaM2: n * cellM * cellM}; }
      }
    homeDepth = depth[hi] || 0;
    var homeVDepth = vdepth[hi] || 0;

    // 3) น้ำในแม่น้ำต้องสูงขึ้นอีกเท่าไหร่ถึงจะไหลมาถึงบ้าน: หาเส้นทางที่ "จุดสูงสุดต่ำที่สุด" จากแม่น้ำมาบ้าน
    const P = new Float32Array(NN).fill(NaN), L = new Float32Array(NN).fill(NaN);
    h = new Heap(1 << 16);
    for (let i = 0; i < NN; i++) if (source[i] && !isNaN(level[i])) { P[i] = isNaN(Z[i]) ? level[i] : Math.min(Z[i], level[i]); L[i] = level[i]; h.push(i, P[i]); }
    while (h.n) {
      const c = h.pop();
      if (c === hi) break;
      const cx = c % N, cy = (c / N) | 0;
      for (let d = 0; d < 8; d++) {
        const x = cx + DX[d], y = cy + DY[d];
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const j = y * N + x;
        if (!isNaN(P[j]) || isNaN(Z[j])) continue;
        P[j] = Math.max(P[c], Z[j]); L[j] = L[c]; h.push(j, P[j]);
      }
    }
    if (!isNaN(P[hi])) needRise = Math.max(0, P[hi] - L[hi]);
  }

  self.postMessage({
    depth, vdepth, path, pond, pathEnd, homeDepth, homeVDepth: typeof homeVDepth === 'number' ? homeVDepth : null, needRise,
    stats: {areaKm2: area * cellA / 1e6, volMcm: vol * cellA / 1e6, vAreaKm2: vArea * cellA / 1e6, vLevel, vFull, volumeMcm: volume / 1e6, ms: Math.round(performance.now() - t0), bias: e.data.bias}
  }, [depth.buffer, vdepth.buffer]);
};
