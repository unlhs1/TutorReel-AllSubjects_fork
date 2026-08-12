import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderLatex, calcFormulaScale } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  progress: number; // 0-1，控制逐行显现
  fontSize?: number; // px 基准字号
  containerW: number; // px
  containerH: number; // px
}

// 公式推导：多行公式逐步推导，行首圆形编号，未推进到的行淡出。
// 每行公式自适应缩放，避免超框被吞。
export const FormulaSteps: React.FC<Props> = ({ block, theme, progress, fontSize = 28, containerW, containerH }) => {
  const rows = block.items && block.items.length ? block.items : block.content ? [block.content] : [];
  if (rows.length === 0) return null;
  const revealed = Math.max(1, Math.ceil(progress * rows.length));
  const rowContainerH = Math.max(40, containerH / rows.length);
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5em',
      background: theme.cardBgStrong,
      border: `1.5px solid ${theme.border}`, borderRadius: 18,
      boxShadow: theme.shadow, padding: '4% 6%', overflow: 'hidden',
    }}>
      {rows.map((row, i) => {
        const shown = i < revealed;
        const isCurrent = i === revealed - 1;
        const scale = calcFormulaScale(containerW * 0.9, rowContainerH, row, fontSize);
        return (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.8em',
              opacity: shown ? 1 : 0.55,
              transform: shown ? 'none' : 'translateX(10px)',
              transition: 'opacity 0.4s, transform 0.4s',
              flex: 1, minHeight: 0,
            }}
          >
            <div style={{
              flexShrink: 0, width: '2em', height: '2em', borderRadius: '0.55em',
              background: isCurrent ? theme.accent : theme.cardBg,
              border: `1.5px solid ${isCurrent ? 'transparent' : theme.border}`,
              color: isCurrent ? '#ffffff' : theme.textSub,
              fontWeight: 800, fontSize: '0.9em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{ fontSize, color: theme.textMain, lineHeight: 1.4, transform: `scale(${scale})` }}
                dangerouslySetInnerHTML={{ __html: renderLatex(row) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
