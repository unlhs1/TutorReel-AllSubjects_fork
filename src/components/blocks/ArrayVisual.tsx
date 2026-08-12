import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  fontSize?: number; // px
}

// 数组可视化（CS 数据结构题）：值格横排 + 下标 + 高亮格
export const ArrayVisual: React.FC<Props> = ({ block, theme, fontSize = 26 }) => {
  const values = block.values || [];
  if (values.length === 0) return null;
  const highlight = new Set(block.highlightIndexes || []);
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      background: theme.cardBg, border: `1.5px solid ${theme.border}`, borderRadius: 16,
      boxShadow: theme.shadow, padding: '4% 5%',
    }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {values.map((v, i) => {
          const hl = highlight.has(i);
          return (
            <div key={i} style={{
              flex: 1, maxWidth: 96, minWidth: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              {/* 值格 */}
              <div style={{
                width: '100%', aspectRatio: '1.4',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 10,
                background: hl ? theme.accent : theme.cardBgStrong,
                border: `2px solid ${hl ? 'transparent' : theme.border}`,
                color: hl ? '#ffffff' : theme.textMain,
                fontWeight: 800, fontSize,
                boxShadow: hl ? `0 6px 16px ${theme.accent}66` : 'none',
                transform: hl ? 'translateY(-3px)' : 'none',
              }}>
                {v}
              </div>
              {/* 下标 */}
              <div style={{ fontSize: fontSize * 0.5, color: theme.textSub, fontWeight: 700 }}>
                {i}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
