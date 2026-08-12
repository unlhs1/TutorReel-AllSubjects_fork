import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

// 大标题卡（开场/新阶段）：accent 顶部条 + 小标签 + 大标题 + 副标题
export const TitleCard: React.FC<Props> = ({ block, theme }) => (
  <div style={{
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    background: theme.cardBgStrong,
    border: `1.5px solid ${theme.border}`, borderRadius: 20,
    boxShadow: theme.shadow, overflow: 'hidden', position: 'relative',
    padding: '8% 9%',
  }}>
    {/* 顶部 accent 实色条 */}
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: '0.5em',
      background: theme.accent,
    }} />
    {block.subtitle && (
      <div style={{
        fontSize: '1.05em', fontWeight: 800, letterSpacing: 2.5,
        textTransform: 'uppercase', color: theme.accent, marginBottom: '0.45em',
      }}>
        {block.subtitle}
      </div>
    )}
    <div style={{
      fontSize: '2.6em', fontWeight: 800, lineHeight: 1.22, color: theme.textMain,
      margin: 0,
    }}>
      {block.title || block.content}
    </div>
    {block.content && block.title && (
      <div style={{ fontSize: '1.35em', lineHeight: 1.5, color: theme.textSub, marginTop: '0.6em', fontWeight: 500 }}>
        {block.content}
      </div>
    )}
  </div>
);
