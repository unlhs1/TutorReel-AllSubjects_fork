import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

// 提示条：warning 竖线 + "注意" 标签 + 提示文字
export const NoteCard: React.FC<Props> = ({ block, theme }) => (
  <div style={{
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    background: theme.dark ? 'rgba(251,191,36,0.16)' : 'rgba(251,191,36,0.18)',
    border: `1.5px solid ${theme.dark ? 'rgba(251,191,36,0.5)' : '#d97706'}`,
    borderRadius: 16, padding: '6% 8%', position: 'relative', overflow: 'hidden',
  }}>
    {/* 左侧 warning 竖线 */}
    <div style={{
      position: 'absolute', left: 0, top: '16%', bottom: '16%', width: '0.5em',
      background: theme.warn, borderRadius: '0 4px 4px 0',
    }} />
    <div style={{ fontSize: '1.05em', fontWeight: 800, letterSpacing: 1.5, color: theme.warn, marginBottom: '0.3em' }}>
      ⚠ 注意
    </div>
    <div
      style={{ fontSize: '1.3em', lineHeight: 1.5, color: theme.textMain, fontWeight: 600 }}
      dangerouslySetInnerHTML={{ __html: renderMixedLatex(block.content || '') }}
    />
  </div>
);
