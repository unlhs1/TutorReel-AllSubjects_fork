import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  fontSize?: number; // px
}

// 表格卡：表头 accent 底 + 斑马纹数据行 + 可高亮行。
// 用于 CS 复杂度对比、化学元素/反应表、物理公式汇总、统计对比等跨学科场景。
export const TableCard: React.FC<Props> = ({ block, theme, fontSize = 22 }) => {
  const headers = block.headers || [];
  const rows = block.rows || [];
  const highlightRow = block.highlightRow ?? -1;
  const colCount = Math.max(headers.length, rows[0]?.length || 0, 1);
  if (colCount === 0) return null;

  const gridCols = `repeat(${colCount}, minmax(0, 1fr))`;
  const cellCls: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0.45em 0.5em', boxSizing: 'border-box', textAlign: 'center',
  };

  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
      background: theme.cardBg, border: `1.5px solid ${theme.border}`, borderRadius: 16,
      boxShadow: theme.shadow, overflow: 'hidden', padding: '3% 4%',
    }}>
      {block.title && (
        <div style={{ fontSize: fontSize * 1.15, fontWeight: 800, color: theme.textMain, marginBottom: '0.6em', textAlign: 'center' }}>
          {block.title}
        </div>
      )}

      {/* 表头 */}
      {headers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, marginBottom: '0.4em' }}>
          {headers.map((h, i) => (
            <div key={i} style={{
              ...cellCls,
              background: theme.accent,
              color: '#ffffff', fontWeight: 800, borderRadius: 8, fontSize: fontSize * 0.95,
            }}>
              <span dangerouslySetInnerHTML={{ __html: renderMixedLatex(h) }} />
            </div>
          ))}
        </div>
      )}

      {/* 数据行 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.35em', overflow: 'hidden' }}>
        {rows.map((row, ri) => {
          const highlighted = ri === highlightRow;
          return (
            <div key={ri} style={{
              display: 'grid', gridTemplateColumns: gridCols, flex: 1, minHeight: 0,
              background: highlighted
                ? (theme.dark ? 'rgba(34,211,238,0.14)' : 'rgba(8,145,178,0.12)')
                : (ri % 2 === 1 ? theme.cardBgStrong : 'transparent'),
              borderRadius: 8,
              border: `1.5px solid ${highlighted ? theme.accent : 'transparent'}`,
            }}>
              {Array.from({ length: colCount }, (_, ci) => (
                <div key={ci} style={{ ...cellCls, fontSize: fontSize * 0.9, color: highlighted ? theme.textMain : theme.textSub, fontWeight: highlighted ? 700 : 500 }}>
                  <span dangerouslySetInnerHTML={{ __html: renderMixedLatex(row[ci] || '') }} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
