import katex from 'katex';
import 'katex/dist/katex.min.css';

// 预置美工控件调色板（深色/浅色两套，全部控件共用）
// 原则：高对比、实色底、少渐变。渐变只用于需要强调的小面积元素（编号徽章/结论横幅/当前步骤）。
export interface BlockTheme {
  dark: boolean;
  bg: string;            // 场景背景（MathTemplate 用）
  cardBg: string;        // 卡片背景（实色）
  cardBgStrong: string;  // 卡片背景（强调/更亮）
  border: string;
  textMain: string;
  textSub: string;
  accent: string;        // 主强调色
  accent2: string;       // 强调渐变第二色
  warn: string;          // 琥珀强调
  shadow: string;
}

export const themeFor = (dark: boolean): BlockTheme =>
  dark
    ? {
        dark,
        bg: '#0f111a',
        cardBg: '#1b1f2e',
        cardBgStrong: '#262c3f',
        border: 'rgba(255,255,255,0.16)',
        textMain: '#f8fafc',
        textSub: '#cbd5e1',
        accent: '#22d3ee',
        accent2: '#0ea5e9',
        warn: '#fbbf24',
        shadow: '0 8px 22px rgba(0,0,0,0.45)',
      }
    : {
        dark,
        bg: '#f4f6fb',
        cardBg: '#ffffff',
        cardBgStrong: '#eef2f9',
        border: '#b3c0d3',
        textMain: '#0f172a',
        textSub: '#475569',
        accent: '#0891b2',
        accent2: '#2563eb',
        warn: '#d97706',
        shadow: '0 6px 18px rgba(15,23,42,0.10)',
      };

// ── LaTeX 渲染工具 ──

export function renderLatex(latex: string, displayMode = true): string {
  const clean = (latex || '')
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    .replace(/\$\$/g, '')
    .replace(/\$/g, '')
    .trim();
  if (!clean) return '';
  try {
    return katex.renderToString(clean, { throwOnError: false, displayMode, strict: false });
  } catch {
    return escapeHtml(latex);
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 混合文本（中文 + \(...\) 公式）→ HTML，用于题干和说明文字。
// 增强：若整段无 \(...\)/$...$ 包裹但含裸 LaTeX 命令（如 \lambda）且无明显中文，
// 自动尝试 katex 渲染，避免反斜杠裸显（如 "/lambda"）。
export function renderMixedLatex(text: string): string {
  if (!text) return '';
  let html = '';
  let matched = false;
  const regex = /\\\(([\s\S]*?)\\\)|\$([^$]*?)\$/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matched = true;
    html += escapeHtml(text.slice(lastIndex, m.index));
    const latex = (m[1] || m[2] || '').trim();
    if (latex) {
      try {
        html += katex.renderToString(latex, { throwOnError: false, displayMode: false, strict: false });
      } catch {
        html += escapeHtml(m[0]);
      }
    }
    lastIndex = m.index + m[0].length;
  }
  html += escapeHtml(text.slice(lastIndex));

  // 裸公式容错：无包裹标记、含 LaTeX 命令、无中文 → 整段按公式渲染。
  // katex 输出 HTML 总含 <annotation> 原始 LaTeX（含反斜杠），故用 katex-error 类判断成功与否。
  if (!matched && /\\[a-zA-Z]+/.test(text) && !/[\u4e00-\u9fff]/.test(text)) {
    const candidate = renderLatex(text, false);
    if (candidate && !candidate.includes('katex-error')) return candidate;
  }
  return html;
}

// ── 公式自适应缩放（避免公式超框被吞） ──
// 视频画布固定 1920×1080，块尺寸已知（百分比），无需 DOM 测量即可计算缩放。

// 估算 LaTeX 渲染后的显示宽度（相对 1em 字号的 em 数）
export function estimateLatexWidth(latex: string): number {
  const cleaned = latex
    .replace(/\\[a-zA-Z]+/g, '') // 去掉 \frac \lim 等命令名
    .replace(/[{}^_\\]/g, '')
    .replace(/\\\(|\\\)/g, '')
    .trim();
  let units = 0;
  for (const ch of cleaned) {
    if (ch === ' ' || ch === ',' || ch === ';') units += 0.25;
    else if ('+-=<>()/[]'.includes(ch)) units += 0.5;
    else units += 0.62;
  }
  return Math.max(1, units);
}

// 计算公式缩放系数：让渲染后的公式在容器内完整可见（≤ 容器 94% 宽、90% 高）
export function calcFormulaScale(
  containerW: number, // px
  containerH: number, // px
  latex: string,
  fontSize: number,   // px 基准字号
): number {
  const estW = estimateLatexWidth(latex) * fontSize * 0.62;
  const estH = fontSize * 1.6;
  const maxW = containerW * 0.94;
  const maxH = containerH * 0.9;
  if (estW <= 0 || estH <= 0) return 1;
  const scale = Math.min(maxW / estW, maxH / estH);
  return Math.min(1.25, Math.max(0.35, scale));
}
