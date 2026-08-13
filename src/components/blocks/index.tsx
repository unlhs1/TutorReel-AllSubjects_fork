import { registerControl } from './registry';

export { themeFor, renderLatex, renderMixedLatex, calcFormulaScale } from './theme';
export type { BlockTheme } from './theme';
export { registerControl, getControl, getAllControlTypes } from './registry';
export type { ControlContext, ControlDefinition } from './registry';

import { QuestionCard } from './QuestionCard';
import { TitleCard } from './TitleCard';
import { KeyPointCard } from './KeyPointCard';
import { NoteCard } from './NoteCard';
import { ConclusionCard } from './ConclusionCard';
import { FormulaCard } from './FormulaCard';
import { FormulaSteps } from './FormulaSteps';
import { CaptionCard } from './CaptionCard';
import { FlowCard } from './FlowCard';
import { AnswerSheet } from './AnswerSheet';
import { TableCard } from './TableCard';
import { ArrayVisual } from './ArrayVisual';
import { TreeVisual } from './TreeVisual';
import { GraphVisual } from './GraphVisual';
import { ForceDiagram } from './ForceDiagram';
import { MoleculeDiagram } from './MoleculeDiagram';
import { CircuitDiagram } from './CircuitDiagram';
import { renderLatex } from './theme';
import { MathPlotVisualizer } from '../visualizers/MathPlotVisualizer';
import { BarVisualizer } from '../visualizers/BarVisualizer';

// 字号计算（基于块高度百分比换算 1080p 视频像素）
const FORMULA_BASE = 44;
function calcTextFont(hPct: number): number {
  return Math.min(36, Math.max(16, Math.round((hPct / 100) * 1080 * 0.09)));
}
function calcAnswerFont(hPct: number, steps: number): number {
  return Math.max(16, Math.min(30, Math.round((hPct / 100) * 1080 * 0.09 / Math.max(1, steps))));
}
function calcTableFont(hPct: number, rows: number): number {
  return Math.max(14, Math.min(26, Math.round((hPct / 100) * 1080 * 0.05 / Math.max(1, rows))));
}

// 注册全部控件（显式函数，避免被 tree-shake 移除副作用）。
// MathTemplate 必须调用它；新增控件只需在此函数内加一行 registerControl。
export function registerAllControls(): void {
// ── 通用控件注册 ─────────────────────────────────────────────
registerControl({
  type: 'question-card',
  render: ({ block, theme }) => <QuestionCard block={block} theme={theme} />,
});
registerControl({
  type: 'title-card',
  render: ({ block, theme }) => <TitleCard block={block} theme={theme} />,
});
registerControl({
  type: 'keypoint',
  render: ({ block, theme, index }) => <KeyPointCard block={block} theme={theme} index={index + 1} />,
});
registerControl({
  type: 'note',
  render: ({ block, theme }) => <NoteCard block={block} theme={theme} />,
});
registerControl({
  type: 'conclusion',
  render: ({ block, theme }) => <ConclusionCard block={block} theme={theme} />,
});
registerControl({
  type: 'caption',
  render: ({ block, theme }) => <CaptionCard block={block} theme={theme} />,
});
registerControl({
  type: 'formula-card',
  render: ({ block, theme, width, height }) => (
    <FormulaCard
      block={block}
      theme={theme}
      containerW={(block.pos.w / 100) * width}
      containerH={(block.pos.h / 100) * height}
    />
  ),
});
registerControl({
  type: 'formula-steps',
  render: ({ block, theme, progress, width, height }) => (
    <FormulaSteps
      block={block}
      theme={theme}
      progress={progress}
      containerW={(block.pos.w / 100) * width}
      containerH={(block.pos.h / 100) * height}
    />
  ),
});
registerControl({
  type: 'flow',
  render: ({ block, theme, progress }) => <FlowCard block={block} theme={theme} progress={progress} />,
});
registerControl({
  type: 'answer-sheet',
  render: ({ block, theme }) => (
    <AnswerSheet block={block} theme={theme} fontSize={calcAnswerFont(block.pos.h, block.items?.length || 1)} />
  ),
});
registerControl({
  type: 'table',
  render: ({ block, theme }) => (
    <TableCard block={block} theme={theme} fontSize={calcTableFont(block.pos.h, block.rows?.length || 1)} />
  ),
});

// ── 学科专属可视化控件（物理/化学/CS） ──────────────────────
registerControl({
  type: 'array',
  render: ({ block, theme }) => (
    <ArrayVisual block={block} theme={theme} fontSize={calcTableFont(block.pos.h, block.values?.length || 1)} />
  ),
});
registerControl({
  type: 'tree',
  render: ({ block, theme }) => <TreeVisual block={block} theme={theme} />,
});
registerControl({
  type: 'graph',
  render: ({ block, theme }) => <GraphVisual block={block} theme={theme} />,
});
registerControl({
  type: 'force',
  render: ({ block, theme }) => <ForceDiagram block={block} theme={theme} />,
});
registerControl({
  type: 'molecule',
  render: ({ block, theme }) => <MoleculeDiagram block={block} theme={theme} />,
});
registerControl({
  type: 'circuit',
  render: ({ block, theme }) => <CircuitDiagram block={block} theme={theme} />,
});

// ── 图形控件（带 padding 卡片包裹 + 主题适配） ───────────────
registerControl({
  type: 'plot',
  render: ({ block, theme, progress, isDark, prevPlot }) => (
    <div style={{ padding: 6 }}>
      <MathPlotVisualizer currState={block} prevState={prevPlot} progress={progress} isDark={isDark} />
    </div>
  ),
});
registerControl({
  type: 'bar',
  render: ({ block, progress, isDark, elapsedFrames }) => (
    <div style={{ padding: 6 }}>
      <BarVisualizer data={block} progress={progress} isDark={isDark} elapsedFrames={elapsedFrames} />
    </div>
  ),
});
registerControl({
  type: 'image',
  render: ({ block, theme }) =>
    block.imageUrl ? (
      // 外层必须有显式 height:100%，否则内部 height:100% 链失效，
      // img 会按宽度等比撑高并溢出容器（被 overflow:hidden 裁掉）导致图被裁/显示异常
      <div style={{ padding: 6, height: '100%', boxSizing: 'border-box' }}>
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: theme.cardBg, border: `1.5px solid ${theme.border}`, borderRadius: 16,
          boxShadow: theme.shadow, overflow: 'hidden', boxSizing: 'border-box',
        }}>
          {/* width/height 100% + contain：容器与图等比时图撑满整卡；不成等比时等比留白不拉伸 */}
          <img src={block.imageUrl} alt="插图" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      </div>
    ) : null,
});

// ── 旧数据兼容 ───────────────────────────────────────────────
registerControl({
  type: 'formula',
  render: ({ block, theme }) => (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, fontSize: FORMULA_BASE, color: theme.textMain, boxSizing: 'border-box' }}
      dangerouslySetInnerHTML={{ __html: renderLatex(block.content || '') }}
    />
  ),
});
registerControl({
  type: 'text',
  render: ({ block, theme }) => (
    <div style={{ padding: 8 }}>
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: theme.cardBg, border: `1.5px solid ${theme.border}`, borderRadius: 16,
        boxShadow: theme.shadow, boxSizing: 'border-box', padding: '4% 6%', textAlign: 'center',
      }}>
        <span style={{ fontSize: calcTextFont(block.pos.h), lineHeight: 1.5, color: theme.textMain }}>{block.content}</span>
      </div>
    </div>
  ),
});
} // registerAllControls end
