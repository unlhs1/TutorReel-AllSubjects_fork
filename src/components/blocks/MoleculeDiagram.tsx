import React, { useMemo } from 'react';
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
const R = 210;
const NODE_R = 36;

// 分子结构图（化学）：原子自动圆形布局 + 化学键连线（支持单键/双键）
export const MoleculeDiagram: React.FC<Props> = ({ block, theme }) => {
  const atoms = block.atoms || [];
  const bonds = block.bonds || [];
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    atoms.forEach((a, i) => {
      const ang = (i / Math.max(1, atoms.length)) * Math.PI * 2 - Math.PI / 2;
      map.set(a.id, { x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang) });
    });
    return map;
  }, [atoms]);

  if (atoms.length === 0) return null;

  // 画化学键（单/双）
  const renderBond = (from: string, to: string, order: number, key: number) => {
    const p1 = positions.get(from);
    const p2 = positions.get(to);
    if (!p1 || !p2) return null;
    // 缩短到原子边缘
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    const s1 = { x: p1.x + ux * NODE_R, y: p1.y + uy * NODE_R };
    const s2 = { x: p2.x - ux * NODE_R, y: p2.y - uy * NODE_R };
    if (order === 2) {
      // 双键：平行偏移两条线
      const ox = -uy * 5;
      const oy = ux * 5;
      return (
        <g key={key}>
          <line x1={s1.x + ox} y1={s1.y + oy} x2={s2.x + ox} y2={s2.y + oy} stroke={theme.textSub} strokeWidth="3" />
          <line x1={s1.x - ox} y1={s1.y - oy} x2={s2.x - ox} y2={s2.y - oy} stroke={theme.textSub} strokeWidth="3" />
        </g>
      );
    }
    return <line key={key} x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={theme.textSub} strokeWidth="3" />;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={theme.dark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)'} />

      {/* 化学键 */}
      {bonds.map((b, i) => renderBond(b.from, b.to, b.order || 1, i))}

      {/* 原子 */}
      {atoms.map(a => {
        const p = positions.get(a.id);
        if (!p) return null;
        return (
          <g key={a.id}>
            <circle cx={p.x} cy={p.y} r={NODE_R} fill={theme.cardBg} stroke={theme.accent} strokeWidth="2.5" />
            <text x={p.x} y={p.y + 8} textAnchor="middle" fill={theme.textMain} fontSize="26" fontWeight="800">
              {a.element}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
