import React, { useMemo } from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

const W = 800;
const H = 560;
const R = 200;
const CX = W / 2;
const CY = H / 2;
const NODE_R = 40;

// 图/网状可视化：节点均匀分布在圆环上，边连线。适用于图论、关系网、有向图。
export const GraphVisual: React.FC<Props> = ({ block, theme }) => {
  const nodes = block.nodes || [];
  const edges = block.edges || [];
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
      map.set(n.id, { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) });
    });
    return map;
  }, [nodes]);

  if (nodes.length === 0) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={theme.dark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)'} />

      {/* 边 */}
      {edges.map((e, i) => {
        const p1 = positions.get(e.from);
        const p2 = positions.get(e.to);
        if (!p1 || !p2) return null;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        return (
          <g key={i}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={theme.textSub} strokeWidth="2.5"
              strokeDasharray={e.dashed ? '6 4' : undefined} opacity="0.85" />
            {e.label && (
              <rect x={mx - 22} y={my - 16} width={44} height={24} rx="8" fill={theme.cardBgStrong} stroke={theme.border} />
            )}
            {e.label && (
              <text x={mx} y={my + 5} textAnchor="middle" fill={theme.accent} fontSize="16" fontWeight="700">
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* 节点 */}
      {nodes.map(n => {
        const p = positions.get(n.id);
        if (!p) return null;
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={NODE_R} fill={theme.cardBg} stroke={theme.accent} strokeWidth="2.5" />
            <text x={p.x} y={p.y + 6} textAnchor="middle" fill={theme.textMain} fontSize="22" fontWeight="800">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
