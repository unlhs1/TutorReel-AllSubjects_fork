import React, { useMemo } from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

const W = 800;
const H = 560;
const PADX = 70;
const PADY = 70;

// 树自动分层布局：后序算子树宽度，前序分配 x，y=depth
function layoutTree(nodes: Array<{ id: string; label: string }>, edges: Array<{ from: string; to: string; label?: string; dashed?: boolean }>) {
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  edges.forEach(e => {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
    parent.set(e.to, e.from);
  });
  const roots = nodes.filter(n => !parent.has(n.id)).map(n => n.id);
  const pos = new Map<string, { x: number; y: number }>();

  const assignX = (id: string, xStart: number, depth: number): number => {
    const kids = children.get(id) || [];
    if (kids.length === 0) {
      pos.set(id, { x: xStart + 0.5, y: depth });
      return 1;
    }
    let cur = xStart;
    kids.forEach(k => { cur += assignX(k, cur, depth + 1); });
    const xs = kids.map(k => pos.get(k)!.x);
    pos.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth });
    return cur;
  };
  roots.forEach(r => assignX(r, 0, 0));

  const maxX = Math.max(...Array.from(pos.values()).map(p => p.x), 1);
  const maxY = Math.max(...Array.from(pos.values()).map(p => p.y), 1);
  const scaleX = (x: number) => PADX + (x / maxX) * (W - PADX * 2);
  const scaleY = (y: number) => PADY + (y / maxY) * (H - PADY * 2);
  return { pos, scaleX, scaleY };
}

export const TreeVisual: React.FC<Props> = ({ block, theme }) => {
  const nodes = block.nodes || [];
  const edges = block.edges || [];
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    return layoutTree(nodes, edges);
  }, [nodes, edges]);

  if (!layout) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x="0" y="0" width={W} height={H} rx="12" fill={theme.dark ? 'rgba(15,23,42,0.4)' : 'rgba(241,245,249,0.9)'} />

      {/* 边 */}
      {edges.map((e, i) => {
        const p1 = layout.pos.get(e.from);
        const p2 = layout.pos.get(e.to);
        if (!p1 || !p2) return null;
        return (
          <line
            key={i}
            x1={layout.scaleX(p1.x)} y1={layout.scaleY(p1.y)}
            x2={layout.scaleX(p2.x)} y2={layout.scaleY(p2.y)}
            stroke={theme.textSub} strokeWidth="2.5"
            strokeDasharray={e.dashed ? '6 4' : undefined}
            opacity="0.8"
          />
        );
      })}

      {/* 节点 */}
      {nodes.map(n => {
        const p = layout.pos.get(n.id);
        if (!p) return null;
        const cx = layout.scaleX(p.x);
        const cy = layout.scaleY(p.y);
        return (
          <g key={n.id}>
            <circle cx={cx} cy={cy} r="34" fill={theme.cardBg} stroke={theme.accent} strokeWidth="2.5" />
            <text x={cx} y={cy + 6} textAnchor="middle" fill={theme.textMain} fontSize="24" fontWeight="800">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
