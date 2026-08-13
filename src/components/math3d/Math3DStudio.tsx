// 数学3D 白板：输入/手写公式 → 自动生成 2D/3D 函数图像或几何图形
// 支持：一元函数曲线 y=f(x)（2D↔3D）、二元函数曲面 z=f(x,y)、几何体（立方体/球体/圆柱+切平面）
import React, { useState, useCallback, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseGraphInput, ParsedGraph } from '../../services/math3dParser';
import { Graph2D } from './Graph2D';
import { Graph3D } from './Graph3D';
import { HandwritingPad } from './HandwritingPad';
import { GeoBoard } from './GeoBoard';
import { useTheme } from '../../hooks/useTheme';
import { getOcrConfigForRequest } from '../../services/apiConfig';

type Dim = '2d' | '3d';
type StudioMode = 'graph' | 'geo';

// 预设示例（点击填入）
const EXAMPLES: Array<{ label: string; value: string }> = [
  { label: '二次函数', value: 'y = x^2' },
  { label: '正弦曲线', value: 'y = sin(x)' },
  { label: '双曲线', value: 'y = 1/x' },
  { label: '抛物面', value: 'z = x^2 + y^2' },
  { label: '波浪曲面', value: 'z = sin(x) * cos(y)' },
  { label: '立方体', value: 'cube' },
  { label: '球体', value: 'sphere' },
  { label: '圆柱体', value: 'cylinder' },
];

// KaTeX 渲染（安全：katex 自带转义）
function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: false,
    });
  } catch {
    return '';
  }
}

export const Math3DStudio: React.FC = () => {
  const { isDark } = useTheme();
  const [mode, setMode] = useState<StudioMode>('graph');
  const [input, setInput] = useState('y = x^2');
  const [graph, setGraph] = useState<ParsedGraph>(() => parseGraphInput('y = x^2'));
  const [dim, setDim] = useState<Dim>('3d');
  const [showPad, setShowPad] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recogResult, setRecogResult] = useState<{ latex: string; expr: string; kind: string } | null>(null);
  const [error, setError] = useState<string>('');
  const [range, setRange] = useState(2.5);

  const latexPreview = useMemo(() => {
    const raw = graph.raw;
    if (graph.kind === 'solid') return '';
    return renderLatex(raw);
  }, [graph]);

  const applyInput = useCallback((val: string) => {
    setInput(val);
    const parsed = parseGraphInput(val);
    setGraph(parsed);
    if (parsed.error) setError(parsed.error);
    else setError('');
    // 曲面 / 几何体自动切到 3D；曲线默认 2D（可手动切 3D）
    setDim(parsed.kind === 'curve' ? '2d' : '3d');
  }, []);

  const handleHandwritingResult = useCallback((dataUrl: string) => {
    setRecognizing(true);
    setRecogResult(null);
    setError('');
    const ocrCfg = getOcrConfigForRequest();
    fetch('/api/ocr-math', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: dataUrl, ...ocrCfg }),
    })
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || '识别失败');
        }
        return res.json();
      })
      .then(data => {
        const r = data as { latex?: string; expr?: string; kind?: string };
        const result = { latex: r.latex || '', expr: r.expr || '', kind: r.kind || 'curve' };
        setRecogResult(result);
        // 有 expr 就直接用；否则用 latex 走解析器
        if (result.expr.trim()) {
          const exprValue = result.kind === 'surface' ? `z = ${result.expr}` : `y = ${result.expr}`;
          applyInput(exprValue);
        } else if (result.latex.trim()) {
          applyInput(result.latex);
        } else {
          setError('未识别出公式，请写得工整些再试');
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setRecognizing(false));
  }, [applyInput]);

  const dimDisabled = graph.kind === 'solid' || graph.kind === 'surface';

  return (
    <div className="p-6 h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">数学3D 白板</h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              {mode === 'graph'
                ? '输入或手写公式，自动生成函数图像 / 几何图形，支持 2D↔3D 切换、几何体切平面操控'
                : '点击建点，选点连成线/面/体，拖动动点实时更新，可求交点/零点/极值'}
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-1">
            {/* 模式切换 */}
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => setMode('graph')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'graph' ? 'bg-cyan-600 text-white' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
              >
                函数图形
              </button>
              <button
                onClick={() => setMode('geo')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'geo' ? 'bg-violet-600 text-white' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
              >
                几何构造
              </button>
            </div>
            {mode === 'graph' && (
              <>
                <button
                  onClick={() => setDim('2d')}
                  disabled={dimDisabled}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${dim === '2d' ? 'bg-cyan-600 text-white' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
                >
                  2D
                </button>
                <button
                  onClick={() => setDim('3d')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dim === '3d' ? 'bg-cyan-600 text-white' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
                >
                  3D
                </button>
              </>
            )}
          </div>
        </div>

        {/* 几何构造模式：动态几何画布 */}
        {mode === 'geo' ? (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
            <div className="h-[600px]">
              <GeoBoard isDark={isDark} />
            </div>
          </div>
        ) : (
        <>
        {/* 输入区 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={e => { setInput(e.target.value); const p = parseGraphInput(e.target.value); setGraph(p); if (p.error) setError(p.error); else setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') applyInput(input); }}
              placeholder="输入公式，如 y = x^2、z = x^2 + y^2、cube、sphere、cylinder"
              className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <button onClick={() => applyInput(input)}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold">
              生成
            </button>
            <button onClick={() => setShowPad(v => !v)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${showPad ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700'}`}>
              手写识别
            </button>
          </div>

          {/* KaTeX 实时预览 */}
          {latexPreview && (
            <div className="flex items-center gap-3 min-h-[40px] px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-dashed border-gray-200 dark:border-zinc-700"
              dangerouslySetInnerHTML={{ __html: latexPreview }} />
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* 手写板 */}
          {showPad && (
            <div className="space-y-2">
              <HandwritingPad onExport={handleHandwritingResult} height={200} />
              {recognizing && <p className="text-sm text-cyan-600 dark:text-cyan-400">正在识别手写公式…</p>}
              {recogResult && !recognizing && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">识别结果：</span>
                  {recogResult.latex ? (
                    <span className="text-sm font-mono" dangerouslySetInnerHTML={{ __html: renderLatex(recogResult.latex) }} />
                  ) : (
                    <span className="text-sm font-mono">{recogResult.expr}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 预设示例 */}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(ex => (
              <button key={ex.value} onClick={() => applyInput(ex.value)}
                className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 hover:text-cyan-700 dark:hover:text-cyan-300 text-gray-600 dark:text-zinc-300 border border-transparent hover:border-cyan-300 dark:hover:border-cyan-800 transition-colors">
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* 视图区 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-300">
              <span className="text-xs font-medium text-gray-400 dark:text-zinc-500">{graph.kind === 'solid' ? `几何体：${graph.solid}` : graph.kind === 'surface' ? '二元函数曲面' : '一元函数曲线'}</span>
              <span className="text-xs font-mono text-cyan-600 dark:text-cyan-400">{graph.expr}</span>
            </div>
            {/* 范围调节（仅函数类） */}
            {graph.kind !== 'solid' && (
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                范围
                <input type="range" min={1.5} max={10} step={0.5} value={range}
                  onChange={e => setRange(Number(e.target.value))} className="w-28 accent-cyan-600" />
                <span className="w-8 font-mono">±{range}</span>
              </label>
            )}
          </div>
          <div className="relative w-full h-[480px] bg-zinc-50 dark:bg-zinc-950">
            {graph.kind === 'curve' && dim === '2d' ? (
              <Graph2D graph={graph} isDark={isDark} range={range} />
            ) : (
              <Graph3D graph={graph} isDark={isDark} range={range} />
            )}
          </div>
        </div>

        {/* 使用说明 */}
        <div className="grid md:grid-cols-3 gap-3 text-xs text-gray-500 dark:text-zinc-400">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-3">
            <p className="font-semibold text-gray-700 dark:text-zinc-200 mb-1">一元函数 y=f(x)</p>
            输入如 <code className="font-mono text-cyan-600">y = x^2</code>、<code className="font-mono text-cyan-600">y = sin(x)</code>。支持 2D↔3D 切换。
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-3">
            <p className="font-semibold text-gray-700 dark:text-zinc-200 mb-1">二元曲面 z=f(x,y)</p>
            输入如 <code className="font-mono text-cyan-600">z = x^2 + y^2</code>。自动 3D 渲染，鼠标拖拽旋转。
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-3">
            <p className="font-semibold text-gray-700 dark:text-zinc-200 mb-1">几何体 + 切平面</p>
            输入 <code className="font-mono text-cyan-600">cube</code> / <code className="font-mono text-cyan-600">sphere</code> / <code className="font-mono text-cyan-600">cylinder</code>，底部滑块调节切平面位置/倾斜，演示"在三维模型上切一个面"。
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
