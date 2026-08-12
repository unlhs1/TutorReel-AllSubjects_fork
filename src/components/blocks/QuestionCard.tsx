import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
}

// 题干卡：topic 标签 + 标题 + 完整题干（可含公式）。AI 放在画面任意位置。
export const QuestionCard: React.FC<Props> = ({ block, theme }) => {
  const question = block.content || '';
  const len = question.length;
  const qFont = len > 260 ? 20 : len > 160 ? 23 : len > 90 ? 26 : 30;
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      background: theme.cardBg,
      border: `1.5px solid ${theme.border}`, borderRadius: 20,
      boxShadow: theme.shadow, overflow: 'hidden', position: 'relative',
      padding: '7% 8%',
    }}>
      {/* 顶部 accent 实色条 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '0.45em',
        background: theme.accent,
      }} />
      <div style={{ marginBottom: '0.5em' }}>
        <span style={{
          display: 'inline-block', padding: '0.25em 0.9em', borderRadius: 999,
          background: theme.accent, color: '#ffffff', fontSize: '0.95em',
          fontWeight: 800, letterSpacing: 1.5,
        }}>
          {block.subtitle || '题目'}
        </span>
      </div>
      {block.title && (
        <h2 style={{ fontSize: '1.7em', fontWeight: 800, lineHeight: 1.3, margin: 0, marginBottom: '0.4em', color: theme.textMain }}>
          {block.title}
        </h2>
      )}
      <div
        style={{ fontSize: qFont, lineHeight: 1.7, color: theme.textSub, overflowY: 'auto', flex: 1, minHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: renderMixedLatex(question) }}
      />
    </div>
  );
};
