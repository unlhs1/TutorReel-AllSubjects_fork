import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

// 结论横幅：accent 渐变底 + "结论"标签 + 大结论文字（核心强调，保持高饱和）
export const ConclusionCard: React.FC<Props> = ({ block, theme }) => (
  <div style={{
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: theme.accent,
    borderRadius: 20, padding: '6% 9%', textAlign: 'center',
    boxShadow: theme.shadow, position: 'relative', overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', right: '-4%', top: '-25%', width: '45%', height: '100%',
      borderRadius: '50%', background: 'rgba(255,255,255,0.14)',
    }} />
    <div style={{ fontSize: '1.05em', fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,0.92)', marginBottom: '0.4em' }}>
      ★ 结论
    </div>
    <div
      style={{ fontSize: '2.2em', fontWeight: 800, lineHeight: 1.35, color: '#ffffff', maxWidth: '94%' }}
      dangerouslySetInnerHTML={{ __html: renderMixedLatex(block.content || '') }}
    />
  </div>
);
