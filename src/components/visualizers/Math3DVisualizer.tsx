// 3D 数学图形展示（视频版）— SVG 等距投影渲染
// 用于 plot3d 控件：函数曲面 z=f(x,y) / 几何体（立方体/球体/圆柱）+ 切平面。
// 纯 SVG 无 WebGL，progress 驱动缓慢旋转（确定性渲染，适配 Remotion 逐帧输出）。
// 复用 math3dParser 的曲面网格构建。
import React, { useMemo } from 'react';
import { interpolate } from 'remotion';
import { Block } from '../../types/problem';
import { compileSurfaceExpr, buildSurfaceMesh, zToColor } from '../../services/math3dParser';

interface Props {
  block: Block;
  progress: number; // 0-1
  isDark?: boolean;
}

const W = 800;
const H = 560;

// 等距投影矩阵（旋转绕 Y 再绕 X，俯角固定 25°）
function project(
  x: number, y: number, z: number,
  rotY: number, rotX = 0.42,
): { x: number; y: number; z: number } {
  // 绕 Y 旋转
  const x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
  const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
  // 绕 X 旋转（俯视）
  const y1 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
  const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);
  return { x: x1, y: y1, z: z2 };
}

// 屏幕缩放系数（模块级可变）：曲面用小 scale（防顶部 z 冲高溢出），几何体用大 scale（更饱满）
let SCALE = 46;
function toScreen(p: { x: number; y: number }): { x: number; y: number } {
  // 简单正交投影：project() 已完成 3D 旋转，屏幕 x 取旋转后 x，屏幕 y 取 -y（翻转向下）
  return {
    x: W / 2 + p.x * SCALE,
    y: H / 2 - p.y * SCALE,
  };
}

// 曲面网格 → 多边形列表（含深度用于画家排序）
interface Poly { pts: Array<{ x: number; y: number }>; z: number; color: string; }

function buildSurfacePolys(
  expr: string,
  rotY: number,
  range: number,
  isDark: boolean,
): Poly[] {
  const f = compileSurfaceExpr(expr);
  if (!f) return [];
  const evalFn = (x: number, y: number) => f(x, y);
  const mesh = buildSurfaceMesh(evalFn, [-range, range], [-range, range], 24);
  const { positions, index, bounds } = mesh;
  const [, , , , zMin, zMax] = bounds;

  // 把原始 z 压缩到可视高度 [~-0.15r, ~r]，避免顶部冲出画布；颜色仍按原始 z 渐变
  const zVis = (z: number) => {
    const t = (z - zMin) / (zMax - zMin || 1e-9);
    return -0.15 * range + t * range * 1.15;
  };

  const polys: Poly[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t] * 3, ib = index[t + 1] * 3, ic = index[t + 2] * 3;
    const rawA = { x: positions[ia], y: positions[ia + 1], z: positions[ia + 2] };
    const rawB = { x: positions[ib], y: positions[ib + 1], z: positions[ib + 2] };
    const rawC = { x: positions[ic], y: positions[ic + 1], z: positions[ic + 2] };
    // 投影用压缩后的 y，颜色/深度用原始值
    const pa = project(rawA.x, zVis(rawA.y), rawA.z, rotY);
    const pb = project(rawB.x, zVis(rawB.y), rawB.z, rotY);
    const pc = project(rawC.x, zVis(rawC.y), rawC.z, rotY);
    // 不剔除背面：曲面双面可见（SVG 画家算法按深度排序即可，剔除会导致俯视/仰视某面消失）
    const ux = pb.x - pa.x, uy = pb.y - pa.y, uz = pb.z - pa.z;
    const vx = pc.x - pa.x, vy = pc.y - pa.y, vz = pc.z - pa.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const avgZ = (pa.z + pb.z + pc.z) / 3;
    const avgY = (rawA.y + rawB.y + rawC.y) / 3;
    const t01 = (avgY - zMin) / (zMax - zMin);
    const [r, g, b2] = zToColor(Math.min(1, Math.max(0, t01)));
    // 光照：法线朝观察者（nz<0 朝外）更亮，背面稍暗但可见
    const facing = Math.max(0, -nz / (Math.hypot(nx, ny, nz) || 1));
    const light = 0.5 + 0.5 * facing;
    polys.push({
      pts: [pa, pb, pc].map(toScreen),
      z: avgZ,
      color: `rgb(${Math.round(r * 255 * light)},${Math.round(g * 255 * light)},${Math.round(b2 * 255 * light)})`,
    });
  }
  polys.sort((p, q) => p.z - q.z); // 远→近
  return polys;
}

// 几何体：立方体/球体/圆柱 → 面列表 + 切平面
interface SolidFace { pts: Array<{ x: number; y: number }>; color: string; opacity: number; }

function buildSolidPolys(
  solid: string,
  rotY: number,
  cutOffset: number,
  cutTilt: number,
  isDark: boolean,
): { faces: SolidFace[]; cut: Poly | null; edges: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> } {
  const mainColor = isDark ? '#38bdf8' : '#0284c7';
  const cutColor = isDark ? '#fbbf24' : '#f59e0b';
  const faces: SolidFace[] = [];
  const edges: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = [];
  const edges3: Array<[number, number, number, number, number, number]> = [];

  if (solid === 'cube') {
    const s = 1.25;
    const verts: Array<[number, number, number]> = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
    ];
    // 六个面（顶点索引）
    const quads = [
      [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
      [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5],
    ];
    const proj = verts.map(v => project(v[0], v[1], v[2], rotY));
    const scr = proj.map(toScreen);
    for (const q of quads) {
      const [a, b, c, d] = q;
      const avgZ = (proj[a].z + proj[b].z + proj[c].z + proj[d].z) / 4;
      // 朝向：由法线决定，正面亮背面暗
      faces.push({
        pts: [scr[a], scr[b], scr[c], scr[d]],
        color: mainColor,
        opacity: avgZ > 0 ? 0.7 : 0.25,
      });
    }
    // 12 条边
    const edgeQuads = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edgeQuads) {
      edges.push({ p1: scr[a], p2: scr[b] });
    }
    // 切平面：在立方体内部偏移一个矩形，倾斜绕其中心水平轴
    const cy = (cutOffset * 2 - 1) * s * 0.9;
    const half = s * 1.05;
    const tilt = cutTilt;
    // 切平面顶点（局部：x/z 平面矩形，y=cy），先绕 X 轴倾斜再平移回 cy，最后随整体绕 Y 旋转
    const corners: Array<[number, number, number]> = [
      [-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half],
    ];
    const cutProj = corners.map(([x, , z]) => {
      // 倾斜：绕 X 轴旋转（y' = y·cos - z·sin，z' = y·sin + z·cos），再平移到 y=cy
      const yT = 0 * Math.cos(tilt) - z * Math.sin(tilt);
      const zT = 0 * Math.sin(tilt) + z * Math.cos(tilt);
      const p = project(x, cy + yT, zT, rotY);
      return toScreen({ x: p.x, y: p.y });
    });
    return {
      faces,
      cut: {
        pts: cutProj,
        z: 999, // 显示在最上层
        color: cutColor,
      },
      edges,
    };
  }

  if (solid === 'sphere') {
    const r = 1.35;
    // 经纬线 → 多边形
    const latN = 10, lonN = 18;
    for (let i = 0; i < latN; i++) {
      for (let j = 0; j < lonN; j++) {
        const th1 = (i / latN) * Math.PI, th2 = ((i + 1) / latN) * Math.PI;
        const ph1 = (j / lonN) * Math.PI * 2, ph2 = ((j + 1) / lonN) * Math.PI * 2;
        const pts3 = [
          [r * Math.sin(th1) * Math.cos(ph1), r * Math.cos(th1), r * Math.sin(th1) * Math.sin(ph1)],
          [r * Math.sin(th1) * Math.cos(ph2), r * Math.cos(th1), r * Math.sin(th1) * Math.sin(ph2)],
          [r * Math.sin(th2) * Math.cos(ph2), r * Math.cos(th2), r * Math.sin(th2) * Math.sin(ph2)],
          [r * Math.sin(th2) * Math.cos(ph1), r * Math.cos(th2), r * Math.sin(th2) * Math.sin(ph1)],
        ] as Array<[number, number, number]>;
        const proj = pts3.map(v => project(v[0], v[1], v[2], rotY));
        const avgZ = proj.reduce((s2, p) => s2 + p.z, 0) / 4;
        const avgY = proj.reduce((s2, p) => s2 + p.y, 0) / 4;
        // 法线方向近似：用三角法线
        faces.push({
          pts: proj.map(toScreen),
          color: mainColor,
          opacity: avgZ > 0 ? (0.55 + avgY * 0.1) : 0.2,
        });
        edges3.push(...pts3.map(p => [...p, ...p] as [number, number, number, number, number, number]).slice(0, 0));
      }
    }
    // 经纬线（作为装饰边缘）
    for (let j = 0; j <= lonN; j++) {
      const ph = (j / lonN) * Math.PI * 2;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= latN; i++) {
        const th = (i / latN) * Math.PI;
        const p = toScreen(project(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph), rotY));
        if (prev) edges.push({ p1: prev, p2: p });
        prev = p;
      }
    }
    // 切平面：穿过球心的圆盘（投影为椭圆），倾斜绕其中心
    const cy = (cutOffset * 2 - 1) * r * 0.95;
    const tilt = cutTilt;
    const N = 24;
    const cutProj: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      // 圆盘在 x-z 平面，绕 X 轴倾斜后平移到 y=cy
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      const yT = -z * Math.sin(tilt);
      const zT = z * Math.cos(tilt);
      const p = project(x, cy + yT, zT, rotY);
      cutProj.push(toScreen({ x: p.x, y: p.y }));
    }
    return { faces, cut: { pts: cutProj, z: 999, color: cutColor }, edges };
  }

  // cylinder
  {
    const r = 1.1, h = 1.3;
    const sides = 20;
    const faces: SolidFace[] = [];
    const edges2: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = [];
    // 侧面
    for (let i = 0; i < sides; i++) {
      const th1 = (i / sides) * Math.PI * 2, th2 = ((i + 1) / sides) * Math.PI * 2;
      const pts3 = [
        [r * Math.cos(th1), -h, r * Math.sin(th1)],
        [r * Math.cos(th2), -h, r * Math.sin(th2)],
        [r * Math.cos(th2), h, r * Math.sin(th2)],
        [r * Math.cos(th1), h, r * Math.sin(th1)],
      ] as Array<[number, number, number]>;
      const proj = pts3.map(v => project(v[0], v[1], v[2], rotY));
      const avgZ = proj.reduce((s2, p) => s2 + p.z, 0) / 4;
      faces.push({ pts: proj.map(toScreen), color: mainColor, opacity: avgZ > 0 ? 0.6 : 0.2 });
    }
    // 顶底
    for (const ySign of [-1, 1]) {
      const pts3: Array<[number, number, number]> = [];
      for (let i = 0; i <= sides; i++) {
        const th = (i / sides) * Math.PI * 2;
        pts3.push([r * Math.cos(th), ySign * h, r * Math.sin(th)]);
      }
      const proj = pts3.map(v => project(v[0], v[1], v[2], rotY));
      const avgZ = proj.reduce((s2, p) => s2 + p.z, 0) / proj.length;
      faces.push({ pts: proj.map(toScreen), color: mainColor, opacity: avgZ > 0 ? 0.7 : 0.2 });
    }
    // 母线 + 圆周
    for (let i = 0; i <= sides; i++) {
      const th = (i / sides) * Math.PI * 2;
      const top = toScreen(project(r * Math.cos(th), h, r * Math.sin(th), rotY));
      const bot = toScreen(project(r * Math.cos(th), -h, r * Math.sin(th), rotY));
      edges2.push({ p1: bot, p2: top });
    }
    const cy = (cutOffset * 2 - 1) * h * 0.95;
    const tilt = cutTilt;
    const N = 24;
    const cutPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      const yT = -z * Math.sin(tilt);
      const zT = z * Math.cos(tilt);
      const p = project(x, cy + yT, zT, rotY);
      cutPts.push(toScreen({ x: p.x, y: p.y }));
    }
    return { faces, cut: { pts: cutPts, z: 999, color: cutColor }, edges: edges2 };
  }
}

export const Math3DVisualizer: React.FC<Props> = ({ block, progress, isDark = true }) => {
  // 缓慢旋转：入场 1s 转到位，之后随 progress 缓慢绕 Y 旋转（4 圈/全片）
  const rotY = useMemo(() => {
    return interpolate(progress, [0, 1], [0.5, 0.5 + Math.PI * 2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }, [progress]);

  const range = block.range3d ?? 2.5;
  const cutOffset = block.cutOffset ?? 0.5;
  const cutTilt = block.cutTilt ?? 0;

  // 曲面用小 scale（防 z 冲高溢出画布），几何体用大 scale（更饱满）
  const isSolid = !!block.solid;
  // 自适应缩放：让图形撑满 SVG 画布（曲面按 range 反比，几何体固定较大值）
  SCALE = isSolid ? 230 : Math.max(80, Math.min(320 / range, 320));

  // 曲面
  const surfacePolys = useMemo(() => {
    if (block.fx && block.solid !== 'cube' && block.solid !== 'sphere' && block.solid !== 'cylinder') {
      const p = buildSurfacePolys(block.fx, rotY, range, isDark);
      return p;
    }
    return [];
  }, [block.fx, block.solid, rotY, range, isDark]);

  // 几何体
  const solidResult = useMemo(() => {
    if (block.solid) {
      return buildSolidPolys(block.solid, rotY, cutOffset, cutTilt, isDark);
    }
    return null;
  }, [block.solid, rotY, cutOffset, cutTilt, isDark]);

  const BG = isDark ? 'rgba(15,23,42,0.5)' : 'rgba(241,245,249,0.9)';
  const AXIS = isDark ? '#64748b' : '#94a3b8';
  const GRID = isDark ? '#334155' : '#cbd5e1';
  const LABEL = isDark ? '#a5f3fc' : '#0e7490';
  const lineWidth = 3;

  // 地面网格（投影到 y=0）
  const gridLines = useMemo(() => {
    const lines: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = [];
    const step = range * 0.5;
    for (let v = -range; v <= range + 0.001; v += step) {
      lines.push({
        p1: toScreen(project(v, 0, -range, rotY)),
        p2: toScreen(project(v, 0, range, rotY)),
      });
      lines.push({
        p1: toScreen(project(-range, 0, v, rotY)),
        p2: toScreen(project(range, 0, v, rotY)),
      });
    }
    return lines;
  }, [range, rotY]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x={0} y={0} width={W} height={H} rx={12} fill={BG} />

      {/* 地面网格 */}
      {gridLines.map((l, i) => (
        <line key={`g${i}`} x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} stroke={GRID} strokeWidth={1} strokeDasharray="4 5" opacity={0.7} />
      ))}

      {/* 三轴 */}
      <line x1={toScreen(project(-range, 0, 0, rotY)).x} y1={toScreen(project(-range, 0, 0, rotY)).y}
        x2={toScreen(project(range, 0, 0, rotY)).x} y2={toScreen(project(range, 0, 0, rotY)).y} stroke={AXIS} strokeWidth={2} />
      <line x1={toScreen(project(0, -range, 0, rotY)).x} y1={toScreen(project(0, -range, 0, rotY)).y}
        x2={toScreen(project(0, range, 0, rotY)).x} y2={toScreen(project(0, range, 0, rotY)).y} stroke={AXIS} strokeWidth={2} />
      <line x1={toScreen(project(0, 0, -range, rotY)).x} y1={toScreen(project(0, 0, -range, rotY)).y}
        x2={toScreen(project(0, 0, range, rotY)).x} y2={toScreen(project(0, 0, range, rotY)).y} stroke={AXIS} strokeWidth={2} />

      {/* 曲面 */}
      {surfacePolys.map((p, i) => (
        <polygon key={`s${i}`} points={p.pts.map(pt => `${pt.x},${pt.y}`).join(' ')} fill={p.color} stroke={isDark ? '#0f172a' : '#e2e8f0'} strokeWidth={0.8} />
      ))}

      {/* 几何体面 + 边 */}
      {solidResult && solidResult.faces.map((f, i) => (
        <polygon key={`f${i}`} points={f.pts.map(pt => `${pt.x},${pt.y}`).join(' ')} fill={f.color} opacity={f.opacity} stroke={isDark ? '#1e293b' : '#cbd5e1'} strokeWidth={1} />
      ))}
      {solidResult && solidResult.edges.map((e, i) => (
        <line key={`e${i}`} x1={e.p1.x} y1={e.p1.y} x2={e.p2.x} y2={e.p2.y} stroke={isDark ? '#7dd3fc' : '#0c4a6e'} strokeWidth={lineWidth} opacity={0.8} />
      ))}
      {/* 切平面 */}
      {solidResult && solidResult.cut && (
        <g>
          <polygon points={solidResult.cut.pts.map(pt => `${pt.x},${pt.y}`).join(' ')} fill={solidResult.cut.color} opacity={0.55} />
          <polygon points={solidResult.cut.pts.map(pt => `${pt.x},${pt.y}`).join(' ')} fill="none" stroke={solidResult.cut.color} strokeWidth={lineWidth + 1} />
        </g>
      )}

      {/* 标题标签 */}
      <text x={30} y={40} fill={LABEL} fontSize={22} fontWeight={700} fontFamily="monospace">
        {block.solid ? `几何体：${block.solid}` : (block.fx ? `z = ${block.fx}` : '3D')}
      </text>
    </svg>
  );
};
