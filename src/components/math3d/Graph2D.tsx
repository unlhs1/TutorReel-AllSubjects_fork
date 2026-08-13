// 2D 函数曲线渲染（SVG）
// 用于一元函数 y=f(x) 的二维视图：坐标轴 + 网格 + 曲线 + 关键点
import React, { useMemo } from 'react';
import { ParsedGraph, sampleCurve2D, ticks } from '../../services/math3dParser';

interface Props {
  graph: ParsedGraph;
  isDark?: boolean;
  range?: number; // 视图范围半径
}

const W = 800;
const H = 560;
const PAD = { left: 64, right: 24, top: 32, bottom: 52 };

export const Graph2D: React.FC<Props> = ({ graph, isDark = true, range = 5 }) => {
  const variable = graph.vars[0] || 'x';
  const expr = graph.expr;

  const pts = useMemo(() => sampleCurve2D(expr, variable, [-range, range], 320), [expr, variable, range]);

  // 计算 y 实际范围（含曲线 + 留白），自动缩放
  const yRange = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const [, y] of pts) {
      if (isFinite(y)) { if (y < min) min = y; if (y > max) max = y; }
    }
    if (!isFinite(min)) { min = -2; max = 2; }
    // 加入对称留白，避免贴边
    const span = max - min;
    if (span < 1e-6) { min -= 2; max += 2; }
    else { min -= span * 0.15; max += span * 0.15; }
    return [min, max] as [number, number];
  }, [pts]);

  const [y0, y1] = yRange;
  const x0 = -range, x1 = range;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const px = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * plotW;
  const py = (y: number) => PAD.top + ((y1 - y) / (y1 - y0)) * plotH;

  // 构建 path（断点断开）
  const paths = useMemo(() => {
    const pathArr: string[] = [];
    let d = '';
    for (const [x, y] of pts) {
      if (!isFinite(y)) { if (d) { pathArr.push(d); d = ''; } continue; }
      const X = px(x), Y = py(y);
      if (X < PAD.left - 10 || X > W - PAD.right + 10) { if (d) { pathArr.push(d); d = ''; } continue; }
      if (!d) d = `M ${X.toFixed(1)} ${Y.toFixed(1)}`;
      else d += ` L ${X.toFixed(1)} ${Y.toFixed(1)}`;
    }
    if (d) pathArr.push(d);
    return pathArr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts]);

  const AXIS = isDark ? '#64748b' : '#94a3b8';
  const GRID = isDark ? '#334155' : '#cbd5e1';
  const CURVE = isDark ? '#22d3ee' : '#0891b2';
  const LABEL = isDark ? '#e2e8f0' : '#475569';
  const TICK = isDark ? '#94a3b8' : '#64748b';
  const FORMULA = isDark ? '#a5f3fc' : '#0e7490';
  const BG = isDark ? 'rgba(15,23,42,0.5)' : 'rgba(241,245,249,0.9)';

  const xTicks = ticks(x0, x1, 8);
  const yTicks = ticks(y0, y1, 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x={0} y={0} width={W} height={H} rx={12} fill={BG} />

      {/* 网格 */}
      {xTicks.map((v, i) => (
        <line key={`gx${i}`} x1={px(v)} y1={PAD.top} x2={px(v)} y2={H - PAD.bottom}
          stroke={GRID} strokeWidth={1} strokeDasharray="3 5" opacity={0.5} />
      ))}
      {yTicks.map((v, i) => (
        <line key={`gy${i}`} x1={PAD.left} y1={py(v)} x2={W - PAD.right} y2={py(v)}
          stroke={GRID} strokeWidth={1} strokeDasharray="3 5" opacity={0.5} />
      ))}

      {/* 坐标轴 */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke={AXIS} strokeWidth={2} />
      <line x1={PAD.left} y1={py(0)} x2={W - PAD.right} y2={py(0)} stroke={AXIS} strokeWidth={2} />

      {/* 刻度标签 */}
      {xTicks.map((v, i) => (
        <text key={`tx${i}`} x={px(v)} y={H - PAD.bottom + 20} textAnchor="middle" fill={TICK} fontSize={12}>
          {Math.abs(v) < 1e-9 ? '0' : v.toFixed(1).replace(/\.0$/, '')}
        </text>
      ))}
      {yTicks.map((v, i) => (
        <text key={`ty${i}`} x={PAD.left - 10} y={py(v) + 4} textAnchor="end" fill={TICK} fontSize={12}>
          {Math.abs(v) < 1e-9 ? '0' : v.toFixed(1).replace(/\.0$/, '')}
        </text>
      ))}

      {/* 函数标签 */}
      <text x={PAD.left} y={PAD.top - 12} fill={FORMULA} fontSize={19} fontWeight={700} fontFamily="monospace">
        y = {expr}
      </text>

      {/* 曲线 */}
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={CURVE} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {/* 关键点：y=0 附近取整点标注 */}
      {[Math.round(x0), 0, Math.round(x1)].filter(v => v >= x0 && v <= x1).map((v) => {
        // 用编译求值画点（简便：在曲线上采样找最近）
        const idx = pts.findIndex(p => isFinite(p[1]) && Math.abs(p[0] - v) < (x1 - x0) / 320);
        if (idx < 0) return null;
        const [ex, ey] = pts[idx];
        return (
          <g key={`pt${v}`}>
            <circle cx={px(ex)} cy={py(ey)} r={5.5} fill={CURVE} />
            <text x={px(ex) + 10} y={py(ey) - 8} fill={LABEL} fontSize={13} fontWeight={600}>
              ({ex.toFixed(1)}, {ey.toFixed(1)})
            </text>
          </g>
        );
      })}
    </svg>
  );
};
