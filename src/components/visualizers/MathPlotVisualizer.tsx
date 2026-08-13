import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Block } from '../../types/problem';
import { sampleCurve, evalAt, substituteParam } from '../../utils/mathParser';

interface Props {
  currState: Block | null;
  prevState: Block | null;
  progress: number; // 0-1 场景内推进进度
  isDark?: boolean;
}

// SVG 画布
const W = 800;
const H = 560;
const PAD = { left: 74, right: 36, top: 40, bottom: 68 };

// 模块级常量（避免每次渲染新建数组击穿 useMemo）
const DEFAULT_X_RANGE: [number, number] = [-10, 10];

// 入场阶段结束点：0→ENTER_END 做 morph / reveal，之后参数动画 + 轨迹滑动接管
const ENTER_END = 0.42;
// 无 morph（首次绘制或与上一曲线形态相同）时，入场只留快速淡入，把时间给参数动画
const FAST_ENTER = 0.06;

interface Scale {
  x0: number; x1: number; y0: number; y1: number;
  px: (x: number) => number;
  py: (y: number) => number;
}

function makeScale(state: Block): Scale {
  const [x0, x1] = state.xRange || [-10, 10];
  const [y0, y1] = state.yRange || [-1, 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  return {
    x0, x1, y0, y1,
    px: (x) => PAD.left + ((x - x0) / (x1 - x0)) * plotW,
    py: (y) => PAD.top + ((y1 - y) / (y1 - y0)) * plotH,
  };
}

// 生成网格刻度值
function ticks(min: number, max: number, count: number): number[] {
  const out: number[] = [];
  const step = (max - min) / count;
  for (let i = 0; i <= count; i++) out.push(min + step * i);
  return out;
}

// 曲线 path（把采样点转成 path，遇 NaN 断开）
function buildPaths(points: Array<[number, number]>, sc: Scale): string[] {
  const paths: string[] = [];
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (!isFinite(y)) {
      if (d) { paths.push(d); d = ''; }
      continue;
    }
    const px = sc.px(x);
    const py = sc.py(y);
    if (px < PAD.left - 5 || px > W - PAD.right + 5) { if (d) { paths.push(d); d = ''; } continue; }
    if (!d) d = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
    else d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  if (d) paths.push(d);
  return paths;
}

// 判断两条函数在采样点上是否形态等价（等价则跳过 morph，避免"白等 42%"）
function curvesNear(fx1: string, fx2: string, xRange: [number, number], eps = 1e-6): boolean {
  const [x0, x1] = xRange;
  for (let i = 0; i <= 12; i++) {
    const x = x0 + ((x1 - x0) * i) / 12;
    const y1 = evalAt(fx1, x);
    const y2 = evalAt(fx2, x);
    if (y1 === null || y2 === null) {
      if ((y1 === null) !== (y2 === null)) return false;
      continue;
    }
    if (Math.abs(y1 - y2) > eps) return false;
  }
  return true;
}

// 数字显示：最多 2 位小数，去尾 0
function fmtNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r);
}

export const MathPlotVisualizer: React.FC<Props> = ({ currState, prevState, progress, isDark = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 主题适配配色
  const AXIS_COLOR = isDark ? '#64748b' : '#94a3b8';
  const GRID_COLOR = isDark ? '#334155' : '#cbd5e1';
  const CURVE_COLOR = isDark ? '#22d3ee' : '#0891b2';
  const PREV_COLOR = isDark ? '#8b5cf6' : '#7c3aed';
  const BG_FILL = isDark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)';
  const PLACEHOLDER_FILL = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(148,163,184,0.15)';
  const LABEL_COLOR = isDark ? '#e2e8f0' : '#475569';
  const TICK_COLOR = isDark ? '#94a3b8' : '#64748b';
  const FORMULA_LABEL = isDark ? '#a5f3fc' : '#0e7490';
  const ANNOTATION_BG = isDark ? 'rgba(2,132,199,0.18)' : 'rgba(2,132,199,0.12)';
  const ANNOTATION_TEXT = isDark ? '#7dd3fc' : '#0369a1';
  const POINT_COLOR = isDark ? '#f472b6' : '#db2777';
  const TRACE_COLOR = isDark ? '#fbbf24' : '#d97706';
  const HL_COLOR = POINT_COLOR; // 静态 highlightX 用品红，与黄色轨迹点区分

  const hasCurve = !!currState?.fx && currState.fx.trim() !== '';
  const showPlaceholder = !currState || (!hasCurve && !currState.annotations?.length);

  const xRange: [number, number] = currState?.xRange ?? DEFAULT_X_RANGE;
  const scale = useMemo(() => (currState ? makeScale(currState) : null), [currState]);

  // ── 动态参数动画：入场阶段固定为 from 形态，之后参数平滑演变（曲线形态真的在动） ──
  const anim = currState?.animParam;
  // 动态互斥：有 animParam 时忽略 traceX（避免"曲线变形+点滑动"双动视觉过载）
  const trace = anim ? null : currState?.traceX;
  const fx = currState?.fx || null;
  // 基础形态（from 值）—— morph/reveal 的目标；实时形态（paramVal）—— 参数动画的当前形态
  const fxBase = useMemo(() => (fx && anim ? substituteParam(fx, anim.name, anim.from) : fx), [fx, anim]);

  // ── 上一场景曲线（morph 源）──
  const prevFx = prevState?.fx && prevState.fx !== fx ? prevState.fx : null;
  // 形态等价检测：prev 与 base 几乎相同（如 sin(x)→1*sin(x)）时跳过 morph，消"白等"
  const nearPrev = useMemo(() => {
    if (!prevFx || !fxBase || !scale) return false;
    return curvesNear(prevFx, fxBase, xRange);
  }, [prevFx, fxBase, xRange, scale]);
  const hasPrev = !!prevFx && !nearPrev;

  // 入场结束点：真 morph 用 0.42；无 morph（首次绘制 / 形态等价）时只留快速淡入，参数动画全程接管
  const effectiveEnter = hasPrev ? ENTER_END : (anim ? FAST_ENTER : ENTER_END);

  // 参数动画阶段（入场结束后启动）
  const paramPhaseT = interpolate(progress, [effectiveEnter, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const paramVal = anim ? anim.from + (anim.to - anim.from) * paramPhaseT : null;
  const fxLive = useMemo(() => {
    if (fx && anim && paramVal !== null) return substituteParam(fx, anim.name, paramVal);
    return fx;
  }, [fx, anim, paramVal]);

  const livePts = useMemo(() => (fxLive && scale ? sampleCurve(fxLive, xRange) : []), [fxLive, scale, xRange]);
  const livePaths = useMemo(() => (scale ? buildPaths(livePts, scale) : []), [livePts, scale]);

  // ── 入场阶段：morph（prev 曲线 → 基础形态曲线 逐点线性插值变形）。
  //    按 x 值逐点 evalAt 插值（不依赖采样数组索引），两曲线断点位置不同也不会错位连桥线 ──
  const morphPaths = useMemo(() => {
    if (!hasPrev || !scale || !prevFx || !fxBase) return [] as string[];
    const t = interpolate(progress, [0, ENTER_END], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const [x0, x1] = xRange;
    const SAMPLES = 200;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / SAMPLES;
      const py = evalAt(prevFx, x);
      const by = evalAt(fxBase, x);
      const y = py !== null && by !== null ? py + (by - py) * t : (by !== null ? by : (py !== null ? py : NaN));
      pts.push([x, y]);
    }
    return buildPaths(pts, scale);
  }, [hasPrev, prevFx, fxBase, xRange, scale, progress]);

  // 入场后 live 曲线淡入（与 morph 曲线同形态无缝交叉）
  const liveFade = interpolate(progress, [ENTER_END, Math.min(1, ENTER_END + 0.08)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const morphFade = interpolate(progress, [ENTER_END, Math.min(1, ENTER_END + 0.08)], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  // 入场早期整体淡入（防第一帧闪现）
  const enterOpacity = interpolate(progress, [0, 0.06], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // 无 prev 时：入场用从左到右 reveal（reveal 在 effectiveEnter 时刻=1，与全显示无缝）
  const reveal = interpolate(progress, [0, effectiveEnter], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drawClip = scale
    ? `polygon(0% 0%, ${(scale.px(scale.x0) + (scale.px(scale.x1) - scale.px(scale.x0)) * reveal) / W * 100}% 0%, ${(scale.px(scale.x0) + (scale.px(scale.x1) - scale.px(scale.x0)) * reveal) / W * 100}% 100%, 0% 100%)`
    : 'polygon(0% 0%, 0% 100%, 0% 100%, 0% 0%)';

  const showMorph = hasPrev && progress < ENTER_END + 0.08;
  const showReveal = !hasPrev && progress < effectiveEnter;

  // ── 高亮点 / 轨迹点：traceX 让点沿曲线滑动（极限逼近/切线演示）；否则用静态 highlightX ──
  const traceT = interpolate(progress, [0.12, 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hx: number | null = trace
    ? trace.from + (trace.to - trace.from) * traceT
    : (currState?.highlightX !== undefined && currState?.highlightX !== null && isFinite(currState.highlightX)
      ? currState.highlightX
      : null);

  // 高亮点 y：morph 阶段用插值曲线上的点（贴合可见曲线），否则用实时曲线
  const hy: number | null = useMemo(() => {
    if (hx === null) return null;
    if (showMorph && prevFx && fxBase) {
      const t = interpolate(progress, [0, ENTER_END], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const py = evalAt(prevFx, hx);
      const by = evalAt(fxBase, hx);
      const y = py !== null && by !== null ? py + (by - py) * t : (by !== null ? by : py);
      return y !== null && isFinite(y) ? y : null;
    }
    return fxLive ? evalAt(fxLive, hx) : null;
  }, [hx, showMorph, prevFx, fxBase, fxLive, progress]);

  const hasHighlight = hx !== null && hy !== null && isFinite(hy);
  const highlightPop = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 120 } });
  // trace 时高亮点在入场后才出现
  const traceOpacity = trace ? interpolate(progress, [0.1, 0.14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;

  // 函数表达式标签：morph 阶段显示 prev 曲线表达式；参数动画显示参数区间（稳定不逐帧抖）
  const labelFx = useMemo(() => {
    if (showMorph && prevFx) return prevFx;
    if (anim && fx) return `${fx}  (${anim.name}: ${fmtNum(anim.from)}→${fmtNum(anim.to)})`;
    return fxLive;
  }, [showMorph, prevFx, anim, fx, fxLive]);

  if (showPlaceholder) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <rect x="0" y="0" width={W} height={H} rx="12" fill={PLACEHOLDER_FILL} />
        {currState?.annotations?.map((a, i) => (
          <text key={i} x={W / 2} y={H / 2 - (currState.annotations!.length - 1) * 18 + i * 36}
            textAnchor="middle" fill={LABEL_COLOR} fontSize="20" fontWeight="500">{a}</text>
        ))}
      </svg>
    );
  }

  if (!scale) return null;

  const xTicks = ticks(scale.x0, scale.x1, 8);
  const yTicks = ticks(scale.y0, scale.y1, 6);
  const showXLabels = xTicks.filter((_, i) => i % 2 === 0);

  const hlColor = trace ? TRACE_COLOR : HL_COLOR;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={BG_FILL} />

      {/* 网格 */}
      {xTicks.map((v, i) => (
        <line key={`gx${i}`} x1={scale.px(v)} y1={PAD.top} x2={scale.px(v)} y2={H - PAD.bottom} stroke={GRID_COLOR} strokeWidth="1" strokeDasharray="3 5" opacity="0.5" />
      ))}
      {yTicks.map((v, i) => (
        <line key={`gy${i}`} x1={PAD.left} y1={scale.py(v)} x2={W - PAD.right} y2={scale.py(v)} stroke={GRID_COLOR} strokeWidth="1" strokeDasharray="3 5" opacity="0.5" />
      ))}

      {/* 坐标轴 */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke={AXIS_COLOR} strokeWidth="2" />
      <line x1={PAD.left} y1={scale.py(0)} x2={W - PAD.right} y2={scale.py(0)} stroke={AXIS_COLOR} strokeWidth="2" />
      {/* 刻度标签 */}
      {showXLabels.map((v, i) => (
        <text key={`tx${i}`} x={scale.px(v)} y={H - PAD.bottom + 18} textAnchor="middle" fill={TICK_COLOR} fontSize="12">
          {Math.abs(v) < 1e-9 ? '0' : v.toFixed(1).replace(/\.0$/, '')}
        </text>
      ))}
      {yTicks.map((v, i) => (
        <text key={`ty${i}`} x={PAD.left - 8} y={scale.py(v) + 4} textAnchor="end" fill={TICK_COLOR} fontSize="12">
          {v.toFixed(1).replace(/\.0$/, '')}
        </text>
      ))}

      {/* 函数表达式标签 */}
      {labelFx && (
        <text x={PAD.left} y={PAD.top - 14} fill={FORMULA_LABEL} fontSize="19" fontWeight="700" fontFamily="monospace">
          y = {labelFx}
        </text>
      )}

      {/* 曲线：入场 morph → 实时曲线（参数演变） */}
      {showMorph ? (
        <g style={{ opacity: enterOpacity * morphFade }}>
          {morphPaths.map((d, i) => (
            <path key={`m${i}`} d={d} fill="none" stroke={PREV_COLOR} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      ) : (
        <g style={{ clipPath: showReveal ? drawClip : undefined, opacity: enterOpacity * (hasPrev ? liveFade : 1) }}>
          {livePaths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={CURVE_COLOR} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      )}

      {/* 高亮/轨迹：竖线 + 交点圆（trace 时沿曲线滑动，静态 highlight 用品红区分） */}
      {hasHighlight && (
        <g style={{ opacity: highlightPop * traceOpacity }}>
          <line x1={scale.px(hx!)} y1={PAD.top} x2={scale.px(hx!)} y2={H - PAD.bottom}
            stroke={hlColor} strokeWidth="2.5" strokeDasharray="6 5" />
          <circle cx={scale.px(hx!)} cy={scale.py(hy!)} r="7" fill={hlColor} />
          <circle cx={scale.px(hx!)} cy={scale.py(hy!)} r="13" fill="none" stroke={hlColor} strokeWidth="2" opacity="0.4" />
        </g>
      )}

      {/* 特殊点 */}
      {currState.points?.map(([px, py], i) => (
        <g key={`pt${i}`}>
          <circle cx={scale.px(px)} cy={scale.py(py)} r="6" fill={POINT_COLOR} />
          <text x={scale.px(px) + 12} y={scale.py(py) - 8} fill={POINT_COLOR} fontSize="14" fontWeight="600">
            ({px}, {py})
          </text>
        </g>
      ))}

      {/* 标注文字 */}
      {currState.annotations?.map((a, i) => (
        <g key={`an${i}`}>
          <rect x={PAD.left + 16} y={PAD.top + 14 + i * 34} width={undefined} height={28}
            fill={ANNOTATION_BG} rx="8"
            style={{ width: a.length * 15 + 24 }} />
          <text x={PAD.left + 16 + 12} y={PAD.top + 14 + i * 34 + 20} fill={ANNOTATION_TEXT} fontSize="15" fontWeight="500">
            {a}
          </text>
        </g>
      ))}
    </svg>
  );
};
