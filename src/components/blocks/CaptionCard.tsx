import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

// 台词条：字幕式解说，AI 自由摆放（通常放底部）。半透明实底 + accent 竖线。
export const CaptionCard: React.FC<Props> = ({ block, theme }) => (
  <div style={{
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center',
    background: theme.dark ? 'rgba(10,12,20,0.72)' : 'rgba(255,255,255,0.92)',
    border: `1.5px solid ${theme.dark ? 'rgba(255,255,255,0.18)' : '#cbd5e1'}`,
    borderRadius: 14, padding: '2.5% 4%', position: 'relative', overflow: 'hidden',
  }}>
    {/* accent 竖线 */}
    <div style={{
      position: 'absolute', left: 0, top: '18%', bottom: '18%', width: '0.4em',
      background: theme.accent, borderRadius: '0 3px 3px 0',
    }} />
    <div
      style={{ fontSize: '1.25em', lineHeight: 1.5, color: theme.textMain, fontWeight: 500 }}
      dangerouslySetInnerHTML={{ __html: renderMixedLatex(block.content || '') }}
    />
  </div>
);
