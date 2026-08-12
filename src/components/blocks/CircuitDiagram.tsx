import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

const W = 800;
const H = 560;
const Y = 250;          // 主元件线高度
const BOTTOM = 360;     // 底部回路高度
const SLOT = 110;       // 元件间距
const START_X = 160;    // 第一个元件中心 x

// 电路图（物理）：串联直流电路，元件从左到右排布，底部闭环回路
export const CircuitDiagram: React.FC<Props> = ({ block, theme }) => {
  const elements = block.elements || [];
  if (elements.length === 0) return null;

  const cx = (i: number) => START_X + i * SLOT;
  const lastX = cx(elements.length - 1);
  const WIRE = theme.textSub;
  const ACC = theme.accent;

  const renderSymbol = (type: string, x: number, y: number, label?: string) => {
    switch (type) {
      case 'battery':
        return (
          <g>
            <line x1={x - 8} y1={y - 26} x2={x - 8} y2={y + 26} stroke={WIRE} strokeWidth="4" />
            <line x1={x + 8} y1={y - 14} x2={x + 8} y2={y + 14} stroke={WIRE} strokeWidth="4" />
            <text x={x - 22} y={y - 30} fill={ACC} fontSize="18" fontWeight="800">+</text>
            <text x={x + 10} y={y - 30} fill={ACC} fontSize="18" fontWeight="800">−</text>
            <text x={x} y={y + 44} textAnchor="middle" fill={theme.textSub} fontSize="15">{label || '电池'}</text>
          </g>
        );
      case 'resistor':
        return (
          <g>
            <polyline points={`${x - 30},${y} ${x - 14},${y} ${x - 4},${y - 14} ${x + 6},${y + 14} ${x + 16},${y - 14} ${x + 26},${y + 14} ${x + 30},${y}`}
              fill="none" stroke={WIRE} strokeWidth="3" strokeLinejoin="round" />
            <text x={x} y={y + 44} textAnchor="middle" fill={theme.textSub} fontSize="15">{label || '电阻'}</text>
          </g>
        );
      case 'bulb':
        return (
          <g>
            <circle cx={x} cy={y} r="20" fill="none" stroke={WIRE} strokeWidth="3" />
            <line x1={x - 14} y1={y - 14} x2={x + 14} y2={y + 14} stroke={WIRE} strokeWidth="2.5" />
            <line x1={x + 14} y1={y - 14} x2={x - 14} y2={y + 14} stroke={WIRE} strokeWidth="2.5" />
            <text x={x} y={y + 44} textAnchor="middle" fill={theme.textSub} fontSize="15">{label || '灯泡'}</text>
          </g>
        );
      case 'switch':
        return (
          <g>
            <circle cx={x - 20} cy={y} r="5" fill={WIRE} />
            <circle cx={x + 20} cy={y} r="5" fill={WIRE} />
            <line x1={x - 20} y1={y} x2={x + 12} y2={y - 20} stroke={WIRE} strokeWidth="3" strokeLinecap="round" />
            <text x={x} y={y + 44} textAnchor="middle" fill={theme.textSub} fontSize="15">{label || '开关'}</text>
          </g>
        );
      default:
        return null;
    }
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={theme.dark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)'} />

      {/* 底部闭环回路 */}
      <path d={`M ${START_X - 40} ${Y} L ${START_X - 40} ${BOTTOM} L ${lastX + 40} ${BOTTOM} L ${lastX + 40} ${Y}`}
        fill="none" stroke={WIRE} strokeWidth="3" />

      {/* 元件间导线 */}
      {elements.slice(0, -1).map((_, i) => (
        <line key={`w${i}`} x1={cx(i) + 30} y1={Y} x2={cx(i + 1) - 30} y2={Y} stroke={WIRE} strokeWidth="3" />
      ))}

      {/* 首尾导线接到回路 */}
      <line x1={cx(0) - 40} y1={Y} x2={cx(0) - 30} y2={Y} stroke={WIRE} strokeWidth="3" />
      <line x1={cx(elements.length - 1) + 30} y1={Y} x2={cx(elements.length - 1) + 40} y2={Y} stroke={WIRE} strokeWidth="3" />

      {/* 元件 */}
      {elements.map((el, i) => (
        <g key={i}>{renderSymbol(el.type, cx(i), Y, el.label)}</g>
      ))}
    </svg>
  );
};
