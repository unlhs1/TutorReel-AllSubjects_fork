import React, { useState, useRef, useEffect } from 'react';
import { AnyProblemData, GeneralProblemData } from '../../types/problem';
import { getApiConfigForRequest, getOcrConfigForRequest, getTtsConfigForRequest } from '../../services/apiConfig';
import { streamSSE } from '../../services/streamSSE';
import { ocrImage, OcrFigure } from '../../services/ocr';
import { TTS_VOICES } from '../../services/ttsVoices';

interface GeneralEditorProps {
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

const defaultScenes = '[\n  {\n    "text": "建立随机变量模型",\n    "spokenText": "第一步，我们建立随机变量模型。",\n    "blocks": [\n      { "type": "text", "content": "X ~ B(10000, 0.005)", "pos": { "x": 20, "y": 30, "w": 60, "h": 20 }, "animation": "fade" }\n    ]\n  }\n]';

export const GeneralEditor: React.FC<GeneralEditorProps> = ({ initialData, onChange, onSubmit }) => {
  const init = initialData?.type === 'general' ? initialData as GeneralProblemData : undefined;
  const [title, setTitle] = useState(init?.title || '');
  const [topic, setTopic] = useState(init?.topic || '');
  const [question, setQuestion] = useState(init?.question || '');
  const [opening, setOpening] = useState(init?.script?.opening || '');
  const [summary, setSummary] = useState(init?.script?.summary || '');
  const [scenesText, setScenesText] = useState(
    init ? JSON.stringify(init.script.scenes, null, 2) : defaultScenes
  );
  const [audioUrl, setAudioUrl] = useState(initialData?.audioUrl || '');
  const [durationInFrames, setDurationInFrames] = useState(initialData?.durationInFrames || 0);
  const [aiModel, setAiModel] = useState('deepseek-v4-flash');
  const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [rawText, setRawText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  // 图片上传 + OCR
  const [imagePreview, setImagePreview] = useState<string>('');
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [figures, setFigures] = useState<OcrFigure[]>([]);
  const [figureSummary, setFigureSummary] = useState('');

  const [isContentOpen, setIsContentOpen] = useState(!!initialData);
  const [isStepsOpen, setIsStepsOpen] = useState(!!initialData);

  const loadingMessages = [
    '正在分析题目类型与考点…',
    '正在生成讲解脚本初稿…',
    '正在审查修正脚本…',
    '正在合成配音…',
    '正在生成动画数据…',
  ];

  // 防双提交（isGenerating 异步赋值，连点会双提交）
  const isGeneratingRef = useRef(false);
  // 卸载守卫：异步回调完成后组件可能已卸载
  const mountedRef = useRef(true);
  // OCR 竞态守卫：连续换图时丢弃过期结果
  const ocrSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  React.useEffect(() => {
    const id = initialData?.id || Date.now().toString();
    let parsedScenes: GeneralProblemData['script']['scenes'] = [];
    try { parsedScenes = JSON.parse(scenesText); } catch { /* 保持空 */ }
    const currentData: GeneralProblemData = {
      id, type: 'general', title, topic, question,
      script: { opening, scenes: parsedScenes, summary },
    };
    if (audioUrl) { currentData.audioUrl = audioUrl; currentData.durationInFrames = durationInFrames; }
    (currentData as unknown as Record<string, unknown>).voice = voice;
    onChange?.(currentData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, topic, question, opening, scenesText, summary, audioUrl, durationInFrames, voice]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreview) URL.revokeObjectURL(imagePreview); // 释放旧预览
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    void runOcr(file);
  };

  const runOcr = async (file: File) => {
    const seq = ++ocrSeqRef.current; // 竞态守卫：连续换图时丢弃过期结果
    setIsOcrLoading(true);
    setErrorMessage('');
    try {
      const { text, figures: fg, figureSummary: fs } = await ocrImage(file);
      if (!mountedRef.current || seq !== ocrSeqRef.current) return;
      if (!text.trim()) throw new Error('未识别到有效文字');
      setRawText(text);
      setFigures(fg);
      setFigureSummary(fs);
    } catch (err) {
      if (seq !== ocrSeqRef.current) return;
      const msg = err instanceof Error ? err.message : 'OCR 识别失败';
      setErrorMessage(msg);
    } finally {
      if (seq === ocrSeqRef.current) setIsOcrLoading(false);
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
    }, 3000);
    try {
      const parsedData = await streamSSE('/api/parse', {
        rawText, model: aiModel, voice, figures, figureSummary, ...getApiConfigForRequest(), ...getOcrConfigForRequest(), ...getTtsConfigForRequest(),
      } as Record<string, unknown>);
      if (!mountedRef.current) return; // 组件已卸载，丢弃结果

      if (parsedData.title) setTitle(parsedData.title);
      if (parsedData.topic) setTopic(parsedData.topic);
      if (parsedData.question) setQuestion(parsedData.question);
      if (parsedData.script?.opening) setOpening(parsedData.script.opening);
      if (parsedData.script?.scenes) setScenesText(JSON.stringify(parsedData.script.scenes, null, 2));
      if (parsedData.script?.summary) setSummary(parsedData.script.summary);
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

  // 断点续跑：用当前编辑的题干，只重跑文案生成（分析→初稿→审查→答案验证）
  const handleRegenerateScript = async () => {
    if (!question.trim()) {
      setErrorMessage('请先填写题干，或先用「一键生成讲解」');
      return;
    }
    if (isGeneratingRef.current) return; // 防双提交
    isGeneratingRef.current = true;
    setIsGenerating(true);
    setLoadingStep(0);
    setErrorMessage('');
    const interval = setInterval(() => {
      setLoadingStep(prev => prev < 4 ? prev + 1 : prev);
    }, 3000);
    try {
      const res = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, topic, question, figures, figureSummary, model: aiModel, voice, ...getApiConfigForRequest(), ...getOcrConfigForRequest(), ...getTtsConfigForRequest() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || '脚本重生成失败');
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      const parsedData = (data as { final: Record<string, unknown> }).final;
      const script = (parsedData.script || {}) as { opening?: string; scenes?: unknown; summary?: string };
      if (script.opening) setOpening(script.opening);
      if (script.scenes) setScenesText(JSON.stringify(script.scenes, null, 2));
      if (script.summary) setSummary(script.summary);
      if (parsedData.audioUrl) setAudioUrl(parsedData.audioUrl as string);
      if (parsedData.durationInFrames) setDurationInFrames(parsedData.durationInFrames as number);
      setIsContentOpen(true);
      setIsStepsOpen(true);
      onSubmit(parsedData as unknown as AnyProblemData);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '脚本重生成失败';
      setErrorMessage(msg);
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
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">通用题解</h2>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">上传题目图片或粘贴题目，AI 自动判断题型并生成讲解视频</p>
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
                  <button type="button" onClick={() => { setImagePreview(''); setRawText(''); }}
                    className="text-xs text-gray-400 hover:text-red-400 shrink-0 mt-1">清除</button>
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
              placeholder="OCR 识别结果会自动填入这里，也可以直接粘贴题目文本"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex items-center gap-3 flex-wrap">
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
                onClick={handleRegenerateScript}
                disabled={isGenerating || !question.trim()}
                title="改完题干后，只重跑文案生成（不重新分析题目）"
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg text-xs font-medium text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                仅重生成脚本
              </button>
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
                ) : '一键生成讲解'}
              </button>
            </div>
            {errorMessage && (
              <div className="mt-3 flex items-start gap-2.5 px-3.5 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">生成失败</p>
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
            <span>题目与脚本编辑</span>
            <Chevron open={isContentOpen} />
          </button>
          {isContentOpen && (
            <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-zinc-800 pt-4">
              <div>
                <label className={labelCls}>题目标题</label>
                <input type="text" className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="AI 自动填写" />
              </div>
              <div>
                <label className={labelCls}>题型（AI 自动判断）</label>
                <input type="text" className={inputCls} value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：概率统计 / 极限 / 积分" />
              </div>
              <div>
                <label className={labelCls}>题干（LaTeX 公式用 \( \) 包裹）</label>
                <textarea rows={3} className={`${inputCls} resize-none`} value={question} onChange={e => setQuestion(e.target.value)} placeholder="题目内容" />
              </div>
              <div>
                <label className={labelCls}>开场配音文案</label>
                <textarea rows={2} className={`${inputCls} resize-none`} value={opening} onChange={e => setOpening(e.target.value)} placeholder="开场读题，自动转配音" />
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
              <span>场景脚本 JSON</span>
              <span className="text-xs font-normal text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">AI 已生成</span>
            </div>
            <Chevron open={isStepsOpen} />
          </button>
          {isStepsOpen && (
            <div className="px-5 pb-5 border-t border-gray-100 dark:border-zinc-800 pt-4">
              <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">每个场景含 text（屏幕主文字）/ spokenText（配音）/ duration（本场景秒数，AI 设计时间轴）/ blocks（预置美工控件：title-card/keypoint/note/conclusion/formula-card/formula-steps/flow/plot/bar/image，pos 为百分比位置）。</p>
              <textarea rows={16} className={`${codeInputCls} resize-none w-full`} value={scenesText} onChange={e => setScenesText(e.target.value)} spellCheck={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
