import React, { useState, useRef, useEffect } from 'react';
import { AnyProblemData, MathProblemData } from '../../types/problem';
import { getApiConfigForRequest, getTtsConfigForRequest } from '../../services/apiConfig';
import { streamSSE } from '../../services/streamSSE';
import { ocrImage } from '../../services/ocr';
import { TTS_VOICES } from '../../services/ttsVoices';

interface MathEditorProps {
  initialData?: AnyProblemData;
  onChange?: (data: AnyProblemData) => void;
  onSubmit: (data: AnyProblemData) => void;
}

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const defaultSteps = '[\n  {\n    "text": "观察分子分母趋势",\n    "spokenText": "首先观察分子和分母的变化趋势。",\n    "plot": {\n      "fx": "sin(x)/x",\n      "xRange": [-8, 8],\n      "yRange": [-0.5, 1.5],\n      "highlightX": 0,\n      "annotations": ["x→0 时函数值趋近 1"]\n    },\n    "formula": "\\\\lim_{x \\\\to 0} \\\\frac{\\\\sin x}{x}"\n  }\n]';

export const MathEditor: React.FC<MathEditorProps> = ({ initialData, onChange, onSubmit }) => {
  const [title, setTitle] = useState(initialData?.type === 'math' ? initialData.title : '重要极限：lim(x→0) sinx/x');
  const [knowledgePoint, setKnowledgePoint] = useState(initialData?.type === 'math' ? initialData.knowledgePoint : '重要极限');
  const [question, setQuestion] = useState(initialData?.type === 'math' ? initialData.question : '求极限：\\(\\lim_{x \\to 0} \\frac{\\sin x}{x}\\)');
  const [problemReading, setProblemReading] = useState(initialData?.type === 'math' ? (initialData as unknown as Record<string, unknown>).problemReading as string || '' : '');
  const [summary, setSummary] = useState(initialData?.type === 'math' ? (initialData as unknown as Record<string, unknown>).summary as string || '' : '');
  const [stepsText, setStepsText] = useState(
    initialData?.type === 'math'
      ? JSON.stringify((initialData as unknown as Record<string, unknown>).steps, null, 2)
      : defaultSteps
  );
  const [audioUrl, setAudioUrl] = useState(initialData?.audioUrl || '');
  const [durationInFrames, setDurationInFrames] = useState(initialData?.durationInFrames || 0);
  const [aiModel, setAiModel] = useState('deepseek-v4-flash');
  const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [rawText, setRawText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  // 防双提交 + 卸载守卫
  const isGeneratingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 图片上传 + OCR
  const [imagePreview, setImagePreview] = useState<string>('');
  const [isOcrLoading, setIsOcrLoading] = useState(false);

  const [isContentOpen, setIsContentOpen] = useState(!!initialData);
  const [isStepsOpen, setIsStepsOpen] = useState(!!initialData);

  const loadingMessages = [
    '正在识别题目结构…', '正在提取解题思路…', '正在编写讲解文案…',
    '正在合成配音…', '正在生成数学动画数据…',
  ];

  React.useEffect(() => {
    const id = initialData?.id || Date.now().toString();
    let parsedSteps: MathProblemData['steps'] = [];
    try { parsedSteps = JSON.parse(stepsText); } catch { /* 保持空 */ }
    const currentData: MathProblemData = {
      id, type: 'math', title, knowledgePoint, question, problemReading,
      steps: parsedSteps, summary,
    };
    if (audioUrl) { currentData.audioUrl = audioUrl; currentData.durationInFrames = durationInFrames; }
    (currentData as unknown as Record<string, unknown>).voice = voice;
    onChange?.(currentData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, knowledgePoint, question, problemReading, stepsText, summary, audioUrl, durationInFrames, voice]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    // 自动触发 OCR
    void runOcr(file);
  };

  const runOcr = async (file: File) => {
    setIsOcrLoading(true);
    setErrorMessage('');
    try {
      const { text } = await ocrImage(file);
      if (!text.trim()) throw new Error('未识别到有效文字');
      setRawText(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OCR 识别失败';
      setErrorMessage(msg);
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleAutoGenerate = async () => {
    if (!rawText.trim()) return;
    if (isGeneratingRef.current) return; // 防双提交
    isGeneratingRef.current = true;
    setIsGenerating(true);
    setLoadingStep(0);
    setErrorMessage('');
    const interval = setInterval(() => {
      setLoadingStep(prev => prev < loadingMessages.length - 1 ? prev + 1 : prev);
    }, 2000);
    try {
      const parsedData = await streamSSE('/api/parse', {
        rawText, targetType: 'math', model: aiModel, voice, ...getApiConfigForRequest(), ...getTtsConfigForRequest(),
      } as Record<string, unknown>);
      if (!mountedRef.current) return; // 组件已卸载，丢弃结果

      if (parsedData.title) setTitle(parsedData.title);
      if (parsedData.knowledgePoint) setKnowledgePoint(parsedData.knowledgePoint);
      if (parsedData.question) setQuestion(parsedData.question);
      if (parsedData.problemReading) setProblemReading(parsedData.problemReading);
      if (parsedData.steps) setStepsText(JSON.stringify(parsedData.steps, null, 2));
      if (parsedData.summary) setSummary(parsedData.summary);
      if (parsedData.audioUrl) setAudioUrl(parsedData.audioUrl);
      if (parsedData.durationInFrames) setDurationInFrames(parsedData.durationInFrames);

      setIsContentOpen(true);
      setIsStepsOpen(true);
      onSubmit(parsedData);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '解析失败，请检查网络连接与 API Key 配置';
      setErrorMessage(msg);
      console.error('解析失败:', error);
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
      isGeneratingRef.current = false;
    }
  };

  const inputCls = 'w-full px-3.5 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors';
  const codeInputCls = 'w-full px-3.5 py-2.5 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 dark:focus:ring-cyan-500/30 dark:focus:border-zinc-600 outline-none transition-colors';
  const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5';

  return (
    <div className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">数学题解</h2>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">上传题目图片或粘贴题目，AI 生成函数动画讲解视频</p>
        </div>
      </div>

      <div className="p-5 space-y-3">
        {/* AI Parse */}
        <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-cyan-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">AI 智能解析</span>
            <span className="ml-auto text-xs bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-full font-medium">推荐</span>
          </div>
          <div className="px-5 pb-5 space-y-3 border-t border-gray-100 dark:border-zinc-800">
            {/* 图片上传 */}
            <div className="mt-3">
              <label className={labelCls}>上传带解析的题目图片</label>
              <div className="flex items-start gap-3">
                <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${imagePreview ? 'border-cyan-500/50 bg-cyan-50/30 dark:bg-cyan-500/5' : 'border-gray-300 dark:border-zinc-700 hover:border-cyan-400'}`}>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                  {imagePreview ? (
                    <img src={imagePreview} alt="题目" className="max-h-40 rounded-lg" />
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-zinc-500 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      点击选择图片，上传后自动识别
                    </span>
                  )}
                </label>
                {imagePreview && (
                  <button
                    type="button"
                    onClick={() => { setImagePreview(''); setRawText(''); }}
                    className="text-xs text-gray-400 hover:text-red-400 shrink-0 mt-1"
                  >清除</button>
                )}
              </div>
              {isOcrLoading && (
                <p className="text-xs text-cyan-500 mt-2 flex items-center gap-2">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  正在识别题目与公式…
                </p>
              )}
            </div>

            <textarea
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="OCR 识别结果会自动填入这里，也可以直接粘贴题目文本（含 LaTeX）"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  className="appearance-none pl-3 pr-8 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs font-medium text-gray-700 dark:text-zinc-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none cursor-pointer"
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                >
                  <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                  <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <div className="relative">
                <select
                  className="appearance-none pl-3 pr-8 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs font-medium text-gray-700 dark:text-zinc-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none cursor-pointer"
                  value={voice}
                  onChange={e => setVoice(e.target.value)}
                  title="讲解音色"
                >
                  {TTS_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAutoGenerate}
                disabled={isGenerating || !rawText.trim()}
                className="ml-auto flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {loadingMessages[loadingStep]}
                  </>
                ) : '一键解析题目'}
              </button>
            </div>
            {errorMessage && (
              <div className="mt-3 flex items-start gap-2.5 px-3.5 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">解析失败</p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">{errorMessage}</p>
                </div>
                <button type="button" onClick={() => setErrorMessage('')} className="text-red-400 hover:text-red-600 shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Manual edit */}
        <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          <button type="button" onClick={() => setIsContentOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            <span>题目编辑</span>
            <Chevron open={isContentOpen} />
          </button>
          {isContentOpen && (
            <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-zinc-800 pt-4">
              <div>
                <label className={labelCls}>题目标题</label>
                <input type="text" className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：求极限 lim(x→0) sinx/x" />
              </div>
              <div>
                <label className={labelCls}>考点</label>
                <input type="text" className={inputCls} value={knowledgePoint} onChange={e => setKnowledgePoint(e.target.value)} placeholder="例如：重要极限 / 洛必达法则" />
              </div>
              <div>
                <label className={labelCls}>
                  题干（LaTeX 公式用 \( \) 包裹）
                </label>
                <textarea rows={3} className={`${inputCls} resize-none`} value={question} onChange={e => setQuestion(e.target.value)} placeholder="求极限：\(\lim_{x \to 0} \frac{\sin x}{x}\)" />
              </div>
              <div>
                <label className={labelCls}>读题配音文案</label>
                <textarea rows={2} className={`${inputCls} resize-none`} value={problemReading} onChange={e => setProblemReading(e.target.value)} placeholder="现在我们来看这道题…" />
              </div>
              <div>
                <label className={labelCls}>总结金句</label>
                <textarea rows={2} className={`${inputCls} resize-none`} value={summary} onChange={e => setSummary(e.target.value)} placeholder="视频末尾展示的总结" />
              </div>
            </div>
          )}
        </div>

        {/* Steps JSON */}
        <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          <button type="button" onClick={() => setIsStepsOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            <div className="flex items-center gap-2">
              <span>动画步骤 JSON</span>
              <span className="text-xs font-normal text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">AI 已生成</span>
            </div>
            <Chevron open={isStepsOpen} />
          </button>
          {isStepsOpen && (
            <div className="px-5 pb-5 border-t border-gray-100 dark:border-zinc-800 pt-4">
              <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">每步可含 plot（函数曲线）、formula（LaTeX 公式）、text/spokenText（讲解）。</p>
              <textarea rows={16} className={`${codeInputCls} resize-none w-full`} value={stepsText} onChange={e => setStepsText(e.target.value)} spellCheck={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
