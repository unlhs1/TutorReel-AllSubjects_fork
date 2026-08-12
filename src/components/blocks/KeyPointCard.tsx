import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  index: number; // 编号徽章（从 1 开始）
}

// 要点卡：编号徽章 + 标题 + 一句话说明
export const KeyPointCard: React.FC<Props> = ({ block, theme, index }) => (
  <div style={{
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    background: theme.cardBg,
    border: `1.5px solid ${theme.border}`, borderRadius: 18,
    boxShadow: theme.shadow, overflow: 'hidden', position: 'relative',
    padding: '7% 7%',
  }}>
    {/* 左侧 accent 竖条 */}
    <div style={{
      position: 'absolute', left: 0, top: '14%', bottom: '14%', width: '0.45em',
      background: theme.accent, borderRadius: '0 4px 4px 0',
    }} />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85em' }}>
      <div style={{
        flexShrink: 0, minWidth: '2em', height: '2em', borderRadius: '0.6em',
        background: theme.accent, color: '#ffffff', fontWeight: 800, fontSize: '1.2em',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {String(index).padStart(2, '0')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.title && (
          <div style={{ fontSize: '1.6em', fontWeight: 800, color: theme.textMain, lineHeight: 1.3, marginBottom: '0.28em' }}>
            {block.title}
          </div>
        )}
        {block.content && (
          <div
            style={{ fontSize: '1.15em', lineHeight: 1.55, color: theme.textSub }}
            dangerouslySetInnerHTML={{ __html: renderMixedLatex(block.content) }}
          />
        )}
      </div>
    </div>
  </div>
);
