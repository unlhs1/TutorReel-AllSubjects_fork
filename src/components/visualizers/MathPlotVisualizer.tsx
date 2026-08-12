import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Block } from '../../types/problem';
import { sampleCurve, evalAt } from '../../utils/mathParser';

interface Props {
  currState: Block | null;
  prevState: Block | null;
  progress: number; // 0-1 曲线绘制进度
  isDark?: boolean;
}

// SVG 画布
const W = 800;
const H = 560;
const PAD = { left: 74, right: 36, top: 40, bottom: 68 };

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

export const MathPlotVisualizer: React.FC<Props> = ({ currState, prevState, progress, isDark = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 主题适配配色
  const AXIS_COLOR = isDark ? '#64748b' : '#94a3b8';
  const GRID_COLOR = isDark ? '#334155' : '#cbd5e1';
  const CURVE_COLOR = isDark ? '#22d3ee' : '#0891b2';
  const HIGHLIGHT_COLOR = isDark ? '#fbbf24' : '#d97706';
  const BG_FILL = isDark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)';
  const PLACEHOLDER_FILL = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(148,163,184,0.15)';
  const LABEL_COLOR = isDark ? '#e2e8f0' : '#475569';
  const TICK_COLOR = isDark ? '#94a3b8' : '#64748b';
  const FORMULA_LABEL = isDark ? '#a5f3fc' : '#0e7490';
  const ANNOTATION_BG = isDark ? 'rgba(2,132,199,0.18)' : 'rgba(2,132,199,0.12)';
  const ANNOTATION_TEXT = isDark ? '#7dd3fc' : '#0369a1';
  const POINT_COLOR = isDark ? '#f472b6' : '#db2777';

  const hasCurve = !!currState?.fx && currState.fx.trim() !== '';
  const showPlaceholder = !currState || (!hasCurve && !currState.annotations?.length);

  const { paths, scale } = useMemo(() => {
    if (!currState || !hasCurve) return { paths: [] as string[], scale: null as Scale | null };
    const sc = makeScale(currState);
    const pts = sampleCurve(currState.fx!, currState.xRange || [-10, 10]);
    return { paths: buildPaths(pts, sc), scale: sc };
  }, [currState, hasCurve]);

  // 曲线从左到右绘制动画
  const drawClip = useMemo(() => {
    if (!scale) return 'polygon(0% 0%, 0% 100%, 0% 100%, 0% 0%)';
    const reveal = interpolate(progress, [0, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const clipX = scale.px(scale.x0) + (scale.px(scale.x1) - scale.px(scale.x0)) * reveal;
    return `polygon(0% 0%, ${(clipX / W) * 100}% 0%, ${(clipX / W) * 100}% 100%, 0% 100%)`;
  }, [scale, progress]);

  // 高亮点弹入动画
  const highlightPop = spring({
    frame: frame - 5,
    fps,
    config: { damping: 12, stiffness: 120 },
  });

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

  const hx: number | null = currState.highlightX !== undefined && currState.highlightX !== null && isFinite(currState.highlightX)
    ? currState.highlightX
    : null;
  const hy: number | null = hx !== null ? evalAt(currState.fx!, hx) : null;
  const hasHighlight = hx !== null && hy !== null && isFinite(hy);

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
      {currState.fx && (
        <text x={PAD.left} y={PAD.top - 14} fill={FORMULA_LABEL} fontSize="19" fontWeight="700" fontFamily="monospace">
          y = {currState.fx}
        </text>
      )}

      {/* 曲线 */}
      <g clipPath={undefined} style={{ clipPath: drawClip }}>
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={CURVE_COLOR} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>

      {/* 高亮 x 竖线 */}
      {hasHighlight && (
        <g style={{ opacity: highlightPop }}>
          <line x1={scale.px(hx!)} y1={PAD.top} x2={scale.px(hx!)} y2={H - PAD.bottom}
            stroke={HIGHLIGHT_COLOR} strokeWidth="2.5" strokeDasharray="6 5" />
          <circle cx={scale.px(hx!)} cy={scale.py(hy!)} r="7" fill={HIGHLIGHT_COLOR} />
          <circle cx={scale.px(hx!)} cy={scale.py(hy!)} r="13" fill="none" stroke={HIGHLIGHT_COLOR} strokeWidth="2" opacity="0.4" />
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
