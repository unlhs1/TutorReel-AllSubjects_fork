// 2D 函数曲线渲染（SVG）
// 用于一元函数 y=f(x) 的二维视图：坐标轴 + 网格 + 曲线 + 关键点
// 支持方程组（graph.kind === 'system'）：多曲线叠加 + 自动求交点标注
import React, { useMemo } from 'react';
import { ParsedGraph, sampleCurve2D, ticks, compileExpr, findCurveIntersections } from '../../services/math3dParser';

interface Props {
  graph: ParsedGraph;
  isDark?: boolean;
  range?: number; // 视图范围半径
}

const W = 800;
const H = 560;
const PAD = { left: 64, right: 24, top: 32, bottom: 52 };

// 多曲线配色（方程组区分）
const CURVE_COLORS = ['#22d3ee', '#f472b6', '#a78bfa', '#4ade80', '#fbbf24', '#60a5fa', '#fb923c'];

export const Graph2D: React.FC<Props> = ({ graph, isDark = true, range = 5 }) => {
  // 方程组 → 多条曲线；单函数 → 单条
  const graphs = useMemo(() => (graph.kind === 'system' ? (graph.subgraphs || []) : [graph]), [graph]);

  // 每条曲线的采样点
  const curves = useMemo(() => graphs.map(g => ({
    graph: g,
    pts: sampleCurve2D(g.expr, g.vars[0] || 'x', [-range, range], 320),
  })), [graphs, range]);

  // 计算 y 实际范围（合并所有曲线，自动缩放）
  const yRange = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const c of curves) {
      for (const [, y] of c.pts) {
        if (isFinite(y)) { if (y < min) min = y; if (y > max) max = y; }
      }
    }
    if (!isFinite(min)) { min = -2; max = 2; }
    const span = max - min;
    if (span < 1e-6) { min -= 2; max += 2; }
    else { min -= span * 0.15; max += span * 0.15; }
    return [min, max] as [number, number];
  }, [curves]);

  const [y0, y1] = yRange;
  const x0 = -range, x1 = range;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const px = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * plotW;
  const py = (y: number) => PAD.top + ((y1 - y) / (y1 - y0)) * plotH;

  // 每条曲线构建 path（断点断开）
  const paths = useMemo(() => curves.map(c => {
    const pathArr: string[] = [];
    let d = '';
    for (const [x, y] of c.pts) {
      if (!isFinite(y)) { if (d) { pathArr.push(d); d = ''; } continue; }
      const X = px(x), Y = py(y);
      if (X < PAD.left - 10 || X > W - PAD.right + 10) { if (d) { pathArr.push(d); d = ''; } continue; }
      if (!d) d = `M ${X.toFixed(1)} ${Y.toFixed(1)}`;
      else d += ` L ${X.toFixed(1)} ${Y.toFixed(1)}`;
    }
    if (d) pathArr.push(d);
    return pathArr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [curves]);

  // 方程组交点：两两曲线求交（符号变化 + 二分精化）
  const intersections = useMemo(() => {
    if (graphs.length < 2) return [];
    const comps = graphs.map(g => {
      const f = compileExpr(g.expr);
      const v = g.vars[0] || 'x';
      return (x: number) => (f ? f({ [v]: x }) : null);
    });
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        out.push(...findCurveIntersections(comps[i], comps[j], x0, x1));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphs, range]);

  const AXIS = isDark ? '#64748b' : '#94a3b8';
  const GRID = isDark ? '#334155' : '#cbd5e1';
  const LABEL = isDark ? '#e2e8f0' : '#475569';
  const TICK = isDark ? '#94a3b8' : '#64748b';
  const FORMULA = isDark ? '#a5f3fc' : '#0e7490';
  const BG = isDark ? 'rgba(15,23,42,0.5)' : 'rgba(241,245,249,0.9)';
  const INTER = '#ef4444';

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

      {/* 标准十字坐标轴：x=0 竖线（y 轴）+ y=0 横线（x 轴），正方向带箭头；0 不在视图范围内则不画 */}
      {0 >= x0 && 0 <= x1 && 0 >= y0 && 0 <= y1 && (
        <g>
          {/* y 轴（x=0 竖线 + 上端箭头） */}
          <line x1={px(0)} y1={PAD.top} x2={px(0)} y2={H - PAD.bottom} stroke={AXIS} strokeWidth={2} />
          <polygon points={`${px(0) - 5},${PAD.top + 8} ${px(0) + 5},${PAD.top + 8} ${px(0)},${PAD.top}`} fill={AXIS} />
          {/* x 轴（y=0 横线 + 右端箭头） */}
          <line x1={PAD.left} y1={py(0)} x2={W - PAD.right} y2={py(0)} stroke={AXIS} strokeWidth={2} />
          <polygon points={`${W - PAD.right - 8},${py(0) - 5} ${W - PAD.right - 8},${py(0) + 5} ${W - PAD.right},${py(0)}`} fill={AXIS} />
        </g>
      )}

      {/* 刻度标签：跟随十字轴位置（x 刻度贴 x 轴下方、y 刻度贴 y 轴左侧；轴不在范围内时回退画布边缘） */}
      {xTicks.map((v, i) => {
        const labelY = (0 >= y0 && 0 <= y1) ? py(0) + 16 : H - PAD.bottom + 20;
        return (
          <text key={`tx${i}`} x={px(v)} y={labelY} textAnchor="middle" fill={TICK} fontSize={12}>
            {Math.abs(v) < 1e-9 ? '0' : v.toFixed(1).replace(/\.0$/, '')}
          </text>
        );
      })}
      {yTicks.map((v, i) => {
        if (Math.abs(v) < 1e-9) return null; // 原点只保留 x 轴的 0
        const labelX = (0 >= x0 && 0 <= x1) ? px(0) - 8 : PAD.left - 10;
        return (
          <text key={`ty${i}`} x={labelX} y={py(v) + 4} textAnchor="end" fill={TICK} fontSize={12}>
            {v.toFixed(1).replace(/\.0$/, '')}
          </text>
        );
      })}

      {/* 函数标签：单曲线左上角公式；方程组右上角图例 */}
      {graphs.length === 1 ? (
        <text x={PAD.left} y={PAD.top - 12} fill={FORMULA} fontSize={19} fontWeight={700} fontFamily="monospace">
          y = {graph.expr}
        </text>
      ) : (
        <g>
          {graphs.map((g, i) => (
            <g key={i} transform={`translate(${W - PAD.right - 190}, ${PAD.top + 2 + i * 22})`}>
              <rect x={0} y={0} width={12} height={12} rx={2} fill={CURVE_COLORS[i % CURVE_COLORS.length]} opacity={0.9} />
              <text x={18} y={11} fill={LABEL} fontSize={13} fontFamily="monospace">{g.raw.length > 24 ? g.raw.slice(0, 23) + '…' : g.raw}</text>
            </g>
          ))}
        </g>
      )}

      {/* 曲线（多色） */}
      {paths.map((pathArr, ci) => (
        <g key={ci}>
          {pathArr.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={CURVE_COLORS[ci % CURVE_COLORS.length]}
              strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      ))}

      {/* 方程组交点（红色圆点 + 坐标标签） */}
      {intersections.map((p, i) => (
        <g key={`inter${i}`}>
          <circle cx={px(p.x)} cy={py(p.y)} r={6} fill={INTER} stroke={isDark ? '#0f172a' : '#ffffff'} strokeWidth={1.5} />
          <text x={px(p.x) + 10} y={py(p.y) - 9} fill={INTER} fontSize={13} fontWeight={700} fontFamily="monospace">
            ({p.x.toFixed(2)}, {p.y.toFixed(2)})
          </text>
        </g>
      ))}

      {/* 关键点：y=0 附近取整点标注（单曲线时） */}
      {graphs.length === 1 && [Math.round(x0), 0, Math.round(x1)].filter(v => v >= x0 && v <= x1).map((v) => {
        const pts = curves[0].pts;
        const idx = pts.findIndex(p => isFinite(p[1]) && Math.abs(p[0] - v) < (x1 - x0) / 320);
        if (idx < 0) return null;
        const [ex, ey] = pts[idx];
        return (
          <g key={`pt${v}`}>
            <circle cx={px(ex)} cy={py(ey)} r={5.5} fill={CURVE_COLORS[0]} />
            <text x={px(ex) + 10} y={py(ey) - 8} fill={LABEL} fontSize={13} fontWeight={600}>
              ({ex.toFixed(1)}, {ey.toFixed(1)})
            </text>
          </g>
        );
      })}
    </svg>
  );
};
