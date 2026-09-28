// growable merged-geometry builder: position, normal, aInfo (mat code, ao, u, v) + index.
// one builder is reused for every chunk build; finish() copies out exact-size arrays.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.vcap = 8192;
    this.icap = 16384;
    this.pos = new Float32Array(this.vcap * 3);
    this.nrm = new Float32Array(this.vcap * 3);
    this.inf = new Float32Array(this.vcap * 4);
    this.idx = new Uint32Array(this.icap);
    this.M = new Float64Array(12);
    this.reset();
  }

  reset() {
    this.nv = 0;
    this.ni = 0;
    this.identity();
  }

  identity() {
    const M = this.M;
    M.fill(0);
    M[0] = M[4] = M[8] = 1;
  }

  /** set the current prop transform: translate then rotate yaw (y), pitch (x), roll (z) */
  setXform(tx, ty, tz, yaw = 0, pitch = 0, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz (column vectors), stored row-major in M[0..8], translation M[9..11]
    const M = this.M;
    M[0] = cy * cr + sy * sp * sr; M[1] = -cy * sr + sy * sp * cr; M[2] = sy * cp;
    M[3] = cp * sr; M[4] = cp * cr; M[5] = -sp;
    M[6] = -sy * cr + cy * sp * sr; M[7] = sy * sr + cy * sp * cr; M[8] = cy * cp;
    M[9] = tx; M[10] = ty; M[11] = tz;
  }

  _grow(nv, ni) {
    if (this.nv + nv > this.vcap) {
      while (this.nv + nv > this.vcap) this.vcap *= 2;
      const p = new Float32Array(this.vcap * 3); p.set(this.pos); this.pos = p;
      const n = new Float32Array(this.vcap * 3); n.set(this.nrm); this.nrm = n;
      const f = new Float32Array(this.vcap * 4); f.set(this.inf); this.inf = f;
    }
    if (this.ni + ni > this.icap) {
      while (this.ni + ni > this.icap) this.icap *= 2;
      const x = new Uint32Array(this.icap); x.set(this.idx); this.idx = x;
    }
  }

  vert(x, y, z, nx, ny, nz, m, ao, u, v) {
    const i = this.nv++;
    const p = i * 3, q = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.nrm[p] = nx; this.nrm[p + 1] = ny; this.nrm[p + 2] = nz;
    this.inf[q] = m; this.inf[q + 1] = ao; this.inf[q + 2] = u; this.inf[q + 3] = v;
    return i;
  }

  /** raw quad in chunk space: corners a,b,c,d counter-clockwise seen from the front */
  quad(a, b, c, d, nx, ny, nz, m, ao, uv) {
    this._grow(4, 6);
    const i = this.nv;
    this.vert(a[0], a[1], a[2], nx, ny, nz, m, ao[0], uv[0], uv[1]);
    this.vert(b[0], b[1], b[2], nx, ny, nz, m, ao[1], uv[2], uv[3]);
    this.vert(c[0], c[1], c[2], nx, ny, nz, m, ao[2], uv[4], uv[5]);
    this.vert(d[0], d[1], d[2], nx, ny, nz, m, ao[3], uv[6], uv[7]);
    const x = this.idx;
    x[this.ni++] = i; x[this.ni++] = i + 1; x[this.ni++] = i + 2;
    x[this.ni++] = i; x[this.ni++] = i + 2; x[this.ni++] = i + 3;
  }

  _tp(out, x, y, z) {
    const M = this.M;
    out[0] = M[0] * x + M[1] * y + M[2] * z + M[9];
    out[1] = M[3] * x + M[4] * y + M[5] * z + M[10];
    out[2] = M[6] * x + M[7] * y + M[8] * z + M[11];
  }

  _tn(out, x, y, z) {
    const M = this.M;
    out[0] = M[0] * x + M[1] * y + M[2] * z;
    out[1] = M[3] * x + M[4] * y + M[5] * z;
    out[2] = M[6] * x + M[7] * y + M[8] * z;
  }

  /** transformed box: centre (cx,cy,cz), size, material. ao darkens toward the floor. faces: skip mask (1 -y, 2 +y) */
  box(cx, cy, cz, sx, sy, sz, m, skip = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (let f = 0; f < 6; f++) {
      if (f === 2 && skip & 1) continue;
      if (f === 3 && skip & 2) continue;
      const ax = f >> 1;
      const s = f & 1 ? 1 : -1;
      // local normal
      const n = _n; n[0] = n[1] = n[2] = 0; n[ax] = s;
      // tangent axes
      const ua = ax === 0 ? 2 : 0, va = ax === 1 ? 2 : 1;
      const h = [hx, hy, hz];
      const c = [cx, cy, cz];
      for (let k = 0; k < 4; k++) {
        const su = k === 1 || k === 2 ? 1 : -1;
        const sv = k >= 2 ? 1 : -1;
        const p = [0, 0, 0];
        p[ax] = c[ax] + s * h[ax];
        p[ua] = c[ua] + su * h[ua];
        p[va] = c[va] + sv * h[va];
        _c[k][0] = p[0]; _c[k][1] = p[1]; _c[k][2] = p[2];
        _uv[k * 2] = (su * h[ua] + h[ua]);
        _uv[k * 2 + 1] = (sv * h[va] + h[va]);
      }
      // orient ccw from outside: cross(u, v) must match n
      const cross = (ua === 1 && va === 2) || (ua === 2 && va === 0) || (ua === 0 && va === 1) ? 1 : -1;
      const flip = cross * s < 0;
      this._tn(_wn, n[0], n[1], n[2]);
      for (let k = 0; k < 4; k++) {
        this._tp(_w[k], _c[k][0], _c[k][1], _c[k][2]);
        _ao[k] = aoY(_w[k][1]) * (_wn[1] < -0.5 ? 0.62 : 1);
      }
      if (flip) {
        swap(_w, 1, 3); swapUv(1, 3); const t = _ao[1]; _ao[1] = _ao[3]; _ao[3] = t;
      }
      this.quad(_w[0], _w[1], _w[2], _w[3], _wn[0], _wn[1], _wn[2], m, _ao, _uv);
    }
  }

  /** transformed quad from 4 local corners (flat xyz x4, ccw seen from the front), local normals (flat x4 or x1), uv x8 */
  lquad(P, Nn, m, uv, ao = -1) {
    const per = Nn.length >= 12;
    for (let k = 0; k < 4; k++) {
      this._tp(_w[k], P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      const o = per ? k * 3 : 0;
      this._tn(_wnk[k], Nn[o], Nn[o + 1], Nn[o + 2]);
      _ao[k] = ao >= 0 ? ao : aoY(_w[k][1]);
    }
    this._grow(4, 6);
    const i = this.nv;
    for (let k = 0; k < 4; k++) this.vert(_w[k][0], _w[k][1], _w[k][2], _wnk[k][0], _wnk[k][1], _wnk[k][2], m, _ao[k], uv[k * 2], uv[k * 2 + 1]);
    const x = this.idx;
    x[this.ni++] = i; x[this.ni++] = i + 1; x[this.ni++] = i + 2;
    x[this.ni++] = i; x[this.ni++] = i + 2; x[this.ni++] = i + 3;
  }

  /** flat panel facing local -z centred at (cx, cy, cz); uv rect r = [u0, v0, u1, v1], u0 on the viewer's left */
  panel(cx, cy, cz, w, h, m, r, ao = 1) {
    const x0 = cx + w / 2, x1 = cx - w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    _P[0] = x0; _P[1] = y0; _P[2] = cz; _P[3] = x1; _P[4] = y0; _P[5] = cz;
    _P[6] = x1; _P[7] = y1; _P[8] = cz; _P[9] = x0; _P[10] = y1; _P[11] = cz;
    _UV[0] = r[0]; _UV[1] = r[1]; _UV[2] = r[2]; _UV[3] = r[1]; _UV[4] = r[2]; _UV[5] = r[3]; _UV[6] = r[0]; _UV[7] = r[3];
    this.lquad(_P, _NZ, m, _UV, ao);
  }

  /** flat panel facing local +y (floor decal); r maps u along -x (viewer at -z), v along +z */
  hpanel(cx, cy, cz, w, d, m, r, ao = 1) {
    const x0 = cx + w / 2, x1 = cx - w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    _P[0] = x0; _P[1] = cy; _P[2] = z0; _P[3] = x1; _P[4] = cy; _P[5] = z0;
    _P[6] = x1; _P[7] = cy; _P[8] = z1; _P[9] = x0; _P[10] = cy; _P[11] = z1;
    _UV[0] = r[0]; _UV[1] = r[1]; _UV[2] = r[2]; _UV[3] = r[1]; _UV[4] = r[2]; _UV[5] = r[3]; _UV[6] = r[0]; _UV[7] = r[3];
    this.lquad(_P, _NY, m, _UV, ao);
  }

  /** transformed cylinder along local axis ('x'|'y'|'z'). uvr: optional atlas rect wrapped around the side; r1: radius at +len/2 */
  cyl(cx, cy, cz, r, len, sides, axis, m, caps = true, uvr = null, r1 = r) {
    const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const ua = a === 0 ? 1 : a === 1 ? 2 : 0, va = a === 0 ? 2 : a === 1 ? 0 : 1;
    const c = [cx, cy, cz];
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2;
      const tm = (t0 + t1) / 2;
      const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const set = (P, t, s) => { const rr = s > 0 ? r1 : r; P[a] = c[a] + s * len / 2; P[ua] = c[ua] + Math.cos(t) * rr; P[va] = c[va] + Math.sin(t) * rr; };
      set(p[0], t0, -1); set(p[1], t1, -1); set(p[2], t1, 1); set(p[3], t0, 1);
      const n = [0, 0, 0]; n[ua] = Math.cos(tm); n[va] = Math.sin(tm);
      this._tn(_wn, n[0], n[1], n[2]);
      for (let k = 0; k < 4; k++) { this._tp(_w[k], p[k][0], p[k][1], p[k][2]); _ao[k] = aoY(_w[k][1]); }
      // ensure ccw
      const e1 = sub(_w[1], _w[0]), e2 = sub(_w[2], _w[0]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const u0 = (i / sides) * 2 * Math.PI * r, u1 = ((i + 1) / sides) * 2 * Math.PI * r;
      _uv[0] = u0; _uv[1] = 0; _uv[2] = u1; _uv[3] = 0; _uv[4] = u1; _uv[5] = len; _uv[6] = u0; _uv[7] = len;
      if (uvr) {
        const a0 = uvr[0] + (uvr[2] - uvr[0]) * (i / sides), a1 = uvr[0] + (uvr[2] - uvr[0]) * ((i + 1) / sides);
        _uv[0] = a0; _uv[1] = uvr[1]; _uv[2] = a1; _uv[3] = uvr[1]; _uv[4] = a1; _uv[5] = uvr[3]; _uv[6] = a0; _uv[7] = uvr[3];
      }
      if (cr[0] * _wn[0] + cr[1] * _wn[1] + cr[2] * _wn[2] < 0) { swap(_w, 1, 3); swapUv(1, 3); }
      this.quad(_w[0], _w[1], _w[2], _w[3], _wn[0], _wn[1], _wn[2], m, _ao, _uv);
    }
    if (!caps) return;
    for (const s of [-1, 1]) {
      const n = [0, 0, 0]; n[a] = s;
      this._tn(_wn, n[0], n[1], n[2]);
      const ctr = [0, 0, 0]; ctr[a] = c[a] + s * len / 2; ctr[ua] = c[ua]; ctr[va] = c[va];
      const rc = s > 0 ? r1 : r;
      for (let i = 0; i < sides; i += 2) {
        // fan as quads (centre, i, i+1, i+2)
        const pts = [ctr];
        for (let k = 0; k < 3; k++) {
          const t = ((i + k) / sides) * Math.PI * 2;
          const P = [0, 0, 0]; P[a] = ctr[a]; P[ua] = c[ua] + Math.cos(t) * rc; P[va] = c[va] + Math.sin(t) * rc; pts.push(P);
        }
        for (let k = 0; k < 4; k++) { this._tp(_w[k], pts[k][0], pts[k][1], pts[k][2]); _ao[k] = aoY(_w[k][1]); _uv[k * 2] = pts[k][ua]; _uv[k * 2 + 1] = pts[k][va]; }
        const e1 = sub(_w[1], _w[0]), e2 = sub(_w[2], _w[0]);
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[0] * _wn[0] + cr[1] * _wn[1] + cr[2] * _wn[2] < 0) { swap(_w, 1, 3); swapUv(1, 3); }
        this.quad(_w[0], _w[1], _w[2], _w[3], _wn[0], _wn[1], _wn[2], m, _ao, _uv);
      }
    }
  }

  /** transformed ellipsoid (lat-long), smooth normals */
  ellipsoid(cx, cy, cz, rx, ry, rz, m, seg = 10, rings = 7) {
    const P = _EP, Nn = _EN, uv = _EUV;
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * Math.PI, t1 = ((j + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i++) {
        const p0 = (i / seg) * Math.PI * 2, p1 = ((i + 1) / seg) * Math.PI * 2;
        const cs = [[t0, p0], [t0, p1], [t1, p1], [t1, p0]];
        for (let k = 0; k < 4; k++) {
          const [t, ph] = cs[k];
          const x = rx * Math.sin(t) * Math.cos(ph), y = ry * Math.cos(t), z = rz * Math.sin(t) * Math.sin(ph);
          P[k * 3] = cx + x; P[k * 3 + 1] = cy + y; P[k * 3 + 2] = cz + z;
          let nx = x / (rx * rx), ny = y / (ry * ry), nz = z / (rz * rz);
          const l = Math.hypot(nx, ny, nz) || 1;
          Nn[k * 3] = nx / l; Nn[k * 3 + 1] = ny / l; Nn[k * 3 + 2] = nz / l;
          uv[k * 2] = ph / (Math.PI * 2); uv[k * 2 + 1] = t / Math.PI;
        }
        this.lquad(P, Nn, m, uv);
      }
    }
  }

  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.inf.slice(0, this.nv * 4), 4));
    const idx = this.nv > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _n = [0, 0, 0];
const _wn = [0, 0, 0];
const _c = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _w = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _ao = [1, 1, 1, 1];
const _uv = new Float32Array(8);
const _wnk = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _P = new Float64Array(12);
const _UV = new Float32Array(8);
const _NZ = [0, 0, -1];
const _EP = new Float64Array(12), _EN = new Float64Array(12), _EUV = new Float32Array(8);
const _NY = [0, 1, 0];
function swap(arr, i, j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
function swapUv(i, j) {
  const a = _uv[i * 2], b = _uv[i * 2 + 1];
  _uv[i * 2] = _uv[j * 2]; _uv[i * 2 + 1] = _uv[j * 2 + 1];
  _uv[j * 2] = a; _uv[j * 2 + 1] = b;
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
// props get darker near the floor (cheap ground contact)
function aoY(y) {
  const t = Math.min(1, Math.max(0, y / 0.45));
  return 0.5 + 0.5 * t * (2 - t);
}
