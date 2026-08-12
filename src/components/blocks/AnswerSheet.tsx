import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme, renderMixedLatex } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  fontSize?: number; // px 步骤字号（由 MathTemplate 按块高和步骤数计算）
}

// 完整作答卡（片尾）：答题纸风格 —— 完整解题步骤 + 底部最终答案框
export const AnswerSheet: React.FC<Props> = ({ block, theme, fontSize = 24 }) => {
  const steps = (block.items && block.items.length ? block.items : []).filter(Boolean);
  const answer = block.content || '';
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
      background: theme.cardBg,
      border: `1.5px solid ${theme.border}`, borderRadius: 20,
      boxShadow: theme.shadow, overflow: 'hidden', position: 'relative',
      padding: '3.5% 5% 4%',
    }}>
      {/* 顶部 accent 条 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '0.4em', background: theme.accent }} />

      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.2em' }}>
        <span style={{
          display: 'inline-block', padding: '0.25em 1em', borderRadius: 999,
          background: theme.accent, color: '#ffffff', fontSize: '1em', fontWeight: 800, letterSpacing: 2,
        }}>
          ★ 完整作答
        </span>
        <div style={{ flex: 1, height: 2, background: theme.border, opacity: 0.6 }} />
      </div>

      {/* 完整解题步骤 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5em', overflow: 'hidden' }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '0.8em', flex: 1, minHeight: 0,
            background: i % 2 === 1 ? theme.cardBgStrong : 'transparent',
            borderRadius: 10, padding: '0.3em 0.8em',
          }}>
            <div style={{
              flexShrink: 0, width: '1.8em', height: '1.8em', borderRadius: '0.5em',
              background: theme.accent, color: '#ffffff', fontWeight: 800, fontSize: '0.9em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i + 1}
            </div>
            <div
              style={{ fontSize, lineHeight: 1.5, color: theme.textMain, flex: 1, minWidth: 0 }}
              dangerouslySetInnerHTML={{ __html: renderMixedLatex(step) }}
            />
          </div>
        ))}
      </div>

      {/* 最终答案框 */}
      <div style={{
        marginTop: '1em', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8em',
        background: theme.accent,
        borderRadius: 14, padding: '1.1em 1.5em',
      }}>
        <span style={{ fontSize: '1em', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>答案</span>
        <div
          style={{ fontSize: Math.min(36, fontSize * 1.3), fontWeight: 800, color: '#ffffff', lineHeight: 1.3 }}
          dangerouslySetInnerHTML={{ __html: renderMixedLatex(answer) }}
        />
      </div>
    </div>
  );
};
