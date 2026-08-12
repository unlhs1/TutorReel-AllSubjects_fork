import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

const W = 800;
const H = 560;
const CX = W / 2;
const CY = H / 2;
const MAX_LEN = 190;
const FORCE_COLORS = ['#f59e0b', '#22d3ee', '#34d399', '#f472b6', '#818cf8', '#94a3b8'];

// 受力分析图（物理）：质点 + 多个力箭头。angle 为度数（0=水平向右，逆时针为正）
export const ForceDiagram: React.FC<Props> = ({ block, theme }) => {
  const forces = block.forces || [];
  const maxMag = Math.max(...forces.map(f => Math.abs(f.magnitude)), 1);
  const label = block.title || block.content || '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={theme.dark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)'} />

      {/* 参考十字网格 */}
      <line x1={0} y1={CY} x2={W} y2={CY} stroke={theme.border} strokeWidth="1" strokeDasharray="4 6" />
      <line x1={CX} y1={0} x2={CX} y2={H} stroke={theme.border} strokeWidth="1" strokeDasharray="4 6" />

      {/* 力箭头 */}
      {forces.map((f, i) => {
        const color = FORCE_COLORS[i % FORCE_COLORS.length];
        const rad = (f.angle * Math.PI) / 180;
        const len = Math.max(30, (Math.abs(f.magnitude) / maxMag) * MAX_LEN);
        const ex = CX + Math.cos(rad) * len;
        const ey = CY - Math.sin(rad) * len; // SVG y 向下 → 数学 y 向上取负
        const mx = CX + Math.cos(rad) * len * 0.5;
        const my = CY - Math.sin(rad) * len * 0.5;
        return (
          <g key={i}>
            <defs>
              <marker id={`arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            </defs>
            <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={color} strokeWidth="4.5" strokeLinecap="round" markerEnd={`url(#arrow-${i})`} />
            {/* 力名称标签 */}
            <rect x={mx + 10} y={my - 16} width={f.name.length * 16 + 16} height={26} rx="7" fill={theme.cardBgStrong} stroke={color} />
            <text x={mx + 10 + 8} y={my + 2} fill={color} fontSize="17" fontWeight="800">
              {f.name}
            </text>
          </g>
        );
      })}

      {/* 质点 */}
      <circle cx={CX} cy={CY} r="22" fill={theme.accent} />
      <circle cx={CX} cy={CY} r="30" fill="none" stroke={theme.accent} strokeWidth="2" opacity="0.35" />
      {label && (
        <text x={CX} y={CY + 7} textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="800">
          {label}
        </text>
      )}
    </svg>
  );
};
