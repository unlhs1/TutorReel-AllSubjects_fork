import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

interface Props {
  block: Block;
  theme: BlockTheme;
  progress: number; // 0-1，控制步骤高亮
}

// 流程箭头：步骤1 → 步骤2 → 步骤3，当前步骤高亮
export const FlowCard: React.FC<Props> = ({ block, theme, progress }) => {
  const steps = (block.items && block.items.length ? block.items : []).filter(Boolean);
  if (steps.length === 0) return null;
  const current = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.7em',
      background: theme.cardBg, border: `1.5px solid ${theme.border}`, borderRadius: 16,
      boxShadow: theme.shadow, padding: '4% 5%', overflow: 'hidden',
    }}>
      {steps.map((step, i) => {
        const isCurrent = i === current;
        const isDone = i < current;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{ fontSize: '1.6em', fontWeight: 700, color: isDone ? theme.accent : theme.textSub, flexShrink: 0 }}>
                →
              </div>
            )}
            <div style={{
              flex: 1, minWidth: 0, padding: '0.7em 0.5em', textAlign: 'center',
              borderRadius: 12,
              background: isCurrent
                ? theme.accent
                : isDone
                  ? theme.cardBgStrong
                  : theme.cardBgStrong,
              border: `1.5px solid ${isCurrent ? 'transparent' : theme.border}`,
              color: isCurrent ? '#ffffff' : theme.textMain,
              fontWeight: isCurrent ? 800 : 700,
              fontSize: '1.15em', lineHeight: 1.3,
              boxShadow: isCurrent ? `0 6px 16px ${theme.accent}66` : 'none',
              transform: isCurrent ? 'translateY(-3px)' : 'none',
              transition: 'all 0.3s',
            }}>
              {step}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
