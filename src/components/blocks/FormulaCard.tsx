import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderLatex, calcFormulaScale } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  fontSize?: number;        // px 基准字号
  containerW: number;       // px 块实际宽
  containerH: number;       // px 块实际高
}

// 公式卡：实色卡片 + 顶部 accent 条 + 公式自适应缩放（不超框）
export const FormulaCard: React.FC<Props> = ({ block, theme, fontSize = 40, containerW, containerH }) => {
  const latex = block.content || '';
  const scale = calcFormulaScale(containerW, containerH, latex, fontSize);
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: theme.cardBgStrong,
      border: `1.5px solid ${theme.border}`, borderRadius: 18,
      boxShadow: theme.shadow, overflow: 'hidden', position: 'relative', padding: '5%',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '0.4em',
        background: theme.accent,
      }} />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0,
      }}>
        <div
          style={{ fontSize, lineHeight: 1.4, color: theme.textMain, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: renderLatex(latex) }}
        />
      </div>
    </div>
  );
};
