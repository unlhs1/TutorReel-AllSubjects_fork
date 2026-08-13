// 动态几何构造引擎
// 数据模型：点 / 线 / 面 / 体 + 特殊点（交点/零点/极值点），动点依赖关系。
// 纯逻辑无副作用，供 GeoBoard 交互画布使用。
import { compileExpr } from './math3dParser';

// ── 数据模型 ──

export interface GeoPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  label?: string;          // 默认 A/B/C...
  free: boolean;           // true=自由点（可拖动）；false=派生点（交点等，自动计算）
  parentIds?: string[];    // 派生点依赖的实体 id
}

export type EntityKind = 'line' | 'segment' | 'plane' | 'polygon' | 'solid' | 'circle';

export interface GeoEntity {
  id: string;
  kind: EntityKind;
  pointIds: string[];      // 关联的点 id（线 2 个、面 3 个、体 4+ 个、圆 3 个）
  label?: string;
  color?: string;          // 高亮色
}

export interface GeoBoardState {
  points: GeoPoint[];
  entities: GeoEntity[];
  selected: string[];      // 选中的点/实体 id
  hidden: Set<string>;     // 隐藏的点/实体 id
  nextPointLabel: string;  // 下一个自动点标签
}

// ── 几何计算 ──

// 两点 → 方向向量
export function vec(p1: {x:number;y:number;z:number}, p2: {x:number;y:number;z:number}) {
  return { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
}

// 向量叉积
export function cross(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// 向量点积
export function dot(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function norm(v: {x:number;y:number;z:number}) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// 两点距离
export function dist2D(p1: {x:number;y:number}, p2: {x:number;y:number}) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// 两点三维距离
export function dist3D(p1: {x:number;y:number;z:number}, p2: {x:number;y:number;z:number}) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

// ── 二维线段相交：求两条线段所在直线的交点（二维平面，z 忽略） ──
// 返回交点或 null（平行/重合）
export function lineLineIntersect2D(
  p1: {x:number;y:number}, p2: {x:number;y:number},
  q1: {x:number;y:number}, q2: {x:number;y:number},
): { x: number; y: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = q2.x - q1.x, d2y = q2.y - q1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // 平行或重合
  const t = ((q1.x - p1.x) * d2y - (q1.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

// ── 三维两线最近点（求交点，若在容差内相交） ──
// 两条线：P1 + t·d1 与 P2 + s·d2，求最小距离点对，返回 [pointOnLine1, pointOnLine2, distance]
export function lineLineClosest3D(
  p1: {x:number;y:number;z:number}, d1: {x:number;y:number;z:number},
  p2: {x:number;y:number;z:number}, d2: {x:number;y:number;z:number},
): { t: number; s: number; dist: number; p: {x:number;y:number;z:number} } {
  const r = vec(p2, p1); // p1 → p2 向量（反）
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  const b = dot(d1, d2);
  const denom = a * e - b * b;
  let t: number, s: number;
  if (Math.abs(denom) < 1e-9) {
    t = 0;
    s = e > 1e-9 ? f / e : 0;
  } else {
    const c = dot(d1, r);
    t = (b * f - c * e) / denom;
    s = (a * f - b * c) / denom;
  }
  const pt1 = { x: p1.x + t * d1.x, y: p1.y + t * d1.y, z: p1.z + t * d1.z };
  const pt2 = { x: p2.x + s * d2.x, y: p2.y + s * d2.y, z: p2.z + s * d2.z };
  return { t, s, dist: dist3D(pt1, pt2), p: pt1 };
}

// ── 三维线段/直线求交（含区间检查）：两线最近距离 < eps 才算相交 ──
// line 无限延伸；segment 要求参数 t/s ∈ [0,1]。返回交点坐标或 null。
export function segmentIntersect3D(
  p1: {x:number;y:number;z:number}, p2: {x:number;y:number;z:number},
  q1: {x:number;y:number;z:number}, q2: {x:number;y:number;z:number},
  isLine1: boolean, isLine2: boolean,
  eps = 0.05,
): { x: number; y: number; z: number } | null {
  const d1 = vec(p1, p2);
  const d2 = vec(q1, q2);
  const res = lineLineClosest3D(p1, d1, q1, d2);
  if (res.dist > eps) return null;
  if (!isLine1 && (res.t < -eps || res.t > 1 + eps)) return null;
  if (!isLine2 && (res.s < -eps || res.s > 1 + eps)) return null;
  return res.p;
}

// ── 函数零点：在 [a,b] 区间内二分/扫描找零点 ──
// compiled 可选：传入已编译函数避免重复 math.compile（拖动等高频场景）
export function findZero(
  fx: string,
  a: number,
  b: number,
  samples = 200,
  compiled?: ((scope: Record<string, number>) => number | null) | null,
): number[] {
  const f = compiled ?? compileExpr(fx);
  if (!f) return [];
  const zeros: number[] = [];
  let prevX = a, prevY = f({ x: a });
  const step = (b - a) / samples;
  for (let i = 1; i <= samples; i++) {
    const x = a + step * i;
    const y = f({ x });
    if (y !== null && prevY !== null && prevY !== 0 && Math.sign(y) !== Math.sign(prevY)) {
      // 二分精化
      let lo = prevX, hi = x, flo = prevY;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const fm = f({ x: mid });
        if (fm === null) break;
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; }
        else hi = mid;
      }
      zeros.push((lo + hi) / 2);
    }
    if (y !== null && Math.abs(y) < 1e-6 && zeros[zeros.length - 1] !== undefined && Math.abs(zeros[zeros.length - 1] - x) > 0.5) {
      zeros.push(x);
    }
    prevX = x; prevY = y;
  }
  return zeros;
}

// ── 函数极值点：扫描找局部极值（相邻采样值比较） ──
export function findExtrema(
  fx: string,
  a: number,
  b: number,
  samples = 300,
  compiled?: ((scope: Record<string, number>) => number | null) | null,
): Array<{ x: number; y: number; kind: 'max' | 'min' }> {
  const f = compiled ?? compileExpr(fx);
  if (!f) return [];
  const out: Array<{ x: number; y: number; kind: 'max' | 'min' }> = [];
  const vals: Array<{ x: number; y: number }> = [];
  const step = (b - a) / samples;
  for (let i = 0; i <= samples; i++) {
    const x = a + step * i;
    const y = f({ x });
    if (y !== null) vals.push({ x, y });
  }
  for (let i = 1; i < vals.length - 1; i++) {
    const p = vals[i];
    // 严格局部极值
    if (p.y > vals[i - 1].y && p.y >= vals[i + 1].y) {
      if (out.length === 0 || out[out.length - 1].x !== p.x) out.push({ x: p.x, y: p.y, kind: 'max' });
    } else if (p.y < vals[i - 1].y && p.y <= vals[i + 1].y) {
      if (out.length === 0 || out[out.length - 1].x !== p.x) out.push({ x: p.x, y: p.y, kind: 'min' });
    }
  }
  return out;
}

// ── 工具：坐标是否在容差内相同 ──
export function samePoint(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}, eps = 0.05) {
  return dist3D(a, b) < eps;
}

// ── 绕单位向量 axis 旋转 θ 角（Rodrigues 公式），v 为三维向量 ──
export function rotateVecAround(v: [number, number, number], axis: [number, number, number], theta: number): [number, number, number] {
  const [x, y, z] = v;
  const [ax, ay, az] = axis;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const dot = x * ax + y * ay + z * az;
  const cx = ay * z - az * y, cy = az * x - ax * z, cz = ax * y - ay * x;
  return [
    x * cos + cx * sin + ax * dot * (1 - cos),
    y * cos + cy * sin + ay * dot * (1 - cos),
    z * cos + cz * sin + az * dot * (1 - cos),
  ];
}

// 工具：数字格式化
export function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r);
}
