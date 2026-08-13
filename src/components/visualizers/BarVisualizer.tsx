import React, { useMemo } from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { Block } from '../../types/problem';

interface Props {
  data: Block | null;
  progress: number; // 保留兼容（生长动画改用 elapsedFrames 按秒控制）
  isDark?: boolean;
  elapsedFrames?: number; // 场景内已过帧数：柱子在 1 秒内升到顶，避免等太久
}

const W = 800;
const H = 560;
const PAD = { left: 60, right: 40, top: 40, bottom: 70 };

export const BarVisualizer: React.FC<Props> = ({ data, isDark = true, elapsedFrames = 0 }) => {
  const { fps } = useVideoConfig();
  const bars = data?.barData || [];
  const labels = data?.labels || [];
  const highlightIndex = data?.highlightIndex ?? -1;
  const annotations = data?.annotations || [];

  // 主题适配配色
  const BG_FILL = isDark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)';
  const PLACEHOLDER_FILL = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(148,163,184,0.15)';
  const LABEL_COLOR = isDark ? '#e2e8f0' : '#475569';
  const AXIS_COLOR = isDark ? '#64748b' : '#94a3b8';
  const BAR_COLOR = isDark ? '#22d3ee' : '#0891b2';
  const HIGHLIGHT_COLOR = isDark ? '#fbbf24' : '#d97706';
  const VAL_NORMAL = isDark ? '#94a3b8' : '#64748b';
  const VAL_HIGHLIGHT = isDark ? '#fbbf24' : '#d97706';
  const ANNOTATION_BG = isDark ? 'rgba(2,132,199,0.18)' : 'rgba(2,132,199,0.12)';
  const ANNOTATION_TEXT = isDark ? '#7dd3fc' : '#0369a1';

  // 用实际最大值定标（小数值也正确），全 0 时兜底 1e-9
  const maxVal = Math.max(...bars.map(v => Math.abs(v)), 1e-9);

  const layout = useMemo(() => {
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const n = Math.max(bars.length, 1);
    const slot = plotW / n;
    const barW = Math.min(slot * 0.62, 72);
    return { plotW, plotH, n, slot, barW };
  }, [bars.length]);

  // 数值格式化（真实概率值如 0.056 保留 3 位；0 显示 "0"）
  const fmtVal = (v: number): string => {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 100) return Math.round(v).toString();
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(1);
    if (a >= 0.1) return v.toFixed(2);
    return v.toFixed(3);
  };

  if (bars.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <rect x="0" y="0" width={W} height={H} rx="12" fill={PLACEHOLDER_FILL} />
        {annotations.map((a, i) => (
          <text key={i} x={W / 2} y={H / 2 - (annotations.length - 1) * 18 + i * 36}
            textAnchor="middle" fill={LABEL_COLOR} fontSize="20" fontWeight="500">{a}</text>
        ))}
      </svg>
    );
  }

  // 纵轴刻度（0~max 分 4 档）
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => maxVal * t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={BG_FILL} />

      {/* 纵轴刻度网格 + 数字 */}
      {yTicks.map((tv, i) => {
        const ty = H - PAD.bottom - (tv / maxVal) * layout.plotH;
        return (
          <g key={`yt${i}`}>
            <line x1={PAD.left} y1={ty} x2={W - PAD.right} y2={ty} stroke={AXIS_COLOR} strokeWidth="1" strokeDasharray="3 5" opacity="0.5" />
            <text x={PAD.left - 8} y={ty + 4} textAnchor="end" fill={VAL_NORMAL} fontSize="13">
              {fmtVal(tv)}
            </text>
          </g>
        );
      })}

      {/* 基线 */}
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke={AXIS_COLOR} strokeWidth="2" />
      {/* 纵轴 */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke={AXIS_COLOR} strokeWidth="2" />

      {bars.map((v, i) => {
        const cx = PAD.left + layout.slot * i + layout.slot / 2;
        const h = (Math.abs(v) / maxVal) * layout.plotH;
        // 柱子在场景开头 1 秒内升到顶（fps 帧），之后保持全高
        const grow = interpolate(elapsedFrames, [0, Math.max(1, fps)], [0, h], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const y = H - PAD.bottom - grow;
        const highlighted = i === highlightIndex;
        const fill = highlighted ? HIGHLIGHT_COLOR : BAR_COLOR;
        return (
          <g key={i}>
            <rect
              x={cx - layout.barW / 2}
              y={y}
              width={layout.barW}
              height={grow}
              rx="6"
              fill={fill}
              opacity={highlighted ? 1 : 0.75}
            />
            <text x={cx} y={y - 10} textAnchor="middle" fill={highlighted ? VAL_HIGHLIGHT : VAL_NORMAL} fontSize="16" fontWeight={highlighted ? 700 : 500}>
              {fmtVal(v)}
            </text>
            {labels[i] && (
              <text x={cx} y={H - PAD.bottom + 24} textAnchor="middle" fill={VAL_NORMAL} fontSize="15">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}

      {/* 标注 */}
      {annotations.map((a, i) => (
        <g key={`an${i}`}>
          <rect x={PAD.left + 16} y={PAD.top + 14 + i * 34} width={a.length * 15 + 24} height={28}
            fill={ANNOTATION_BG} rx="8" />
          <text x={PAD.left + 28} y={PAD.top + 14 + i * 34 + 20} fill={ANNOTATION_TEXT} fontSize="15" fontWeight="500">
            {a}
          </text>
        </g>
      ))}
    </svg>
  );
};
