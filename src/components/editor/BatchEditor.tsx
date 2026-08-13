import React, { useState, useEffect, useRef } from 'react';
import { Toast, useToast } from '../ui/Toast';
import { getApiConfigForRequest, getOcrConfigForRequest, getTtsConfigForRequest } from '../../services/apiConfig';
import { ocrImage, OcrFigure } from '../../services/ocr';
import { TTS_VOICES } from '../../services/ttsVoices';

// 批量任务里的一道学科题（与 server batchQueue.BatchItemInput 对应）
interface BatchItemInput {
  title: string;
  question: string;
  topic?: string;
  figures?: OcrFigure[];
  figureSummary?: string;
  preview?: string; // 仅前端展示用，提交时剔除
}

export const BatchEditor: React.FC = () => {
  const [inputType, setInputType] = useState<'text' | 'images'>('text');
  const [textInput, setTextInput] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [isSplitting, setIsSplitting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const [parsedItems, setParsedItems] = useState<BatchItemInput[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const startingRef = useRef(false); // 防重复创建批量任务
  const { toastMessage, showToast, setToastMessage } = useToast();

  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/batch/status/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          setJobStatus(data);
          if (data.status === 'done' || data.status === 'failed') {
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error('Failed to fetch job status', e);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [jobId]);

  // 文本模式：LLM 拆分多道学科题
  const handleSplitText = async () => {
    if (!textInput.trim()) return;
    setIsSplitting(true);
    setParsedItems([]);
    setJobId(null);
    setJobStatus(null);
    setMergedVideoUrl(null);
    try {
      const res = await fetch('/api/batch/split-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: textInput, ...getApiConfigForRequest() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to split');
      }
      const data = await res.json();
      setParsedItems(data.problems || []);
    } catch (error) {
      showToast('提取失败', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setIsSplitting(false);
    }
  };

  // 图片模式：逐张 OCR 生成题目列表
  const handleOcrImages = async () => {
    if (imageFiles.length === 0) return;
    setIsSplitting(true);
    setOcrProgress({ done: 0, total: imageFiles.length });
    setParsedItems([]);
    setJobId(null);
    setJobStatus(null);
    setMergedVideoUrl(null);

    const items: BatchItemInput[] = [];
    for (let i = 0; i < imageFiles.length; i++) {
      try {
        const { text, figures, figureSummary } = await ocrImage(imageFiles[i]);
        items.push({
          title: (text.trim() || `题目 ${i + 1}`).slice(0, 18),
          question: text,
          topic: '',
          figures,
          figureSummary,
          preview: imagePreviews[i],
        });
      } catch (error) {
        console.warn(`OCR 第 ${i + 1} 张失败:`, error);
        items.push({ title: `题目 ${i + 1}`, question: '', topic: '', preview: imagePreviews[i] });
      }
      setOcrProgress({ done: i + 1, total: imageFiles.length });
    }
    setParsedItems(items);
    setIsSplitting(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 12);
    setImageFiles(files);
    setImagePreviews([]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveItem = (idx: number) => {
    setParsedItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleStartBatch = async () => {
    if (parsedItems.length === 0 || startingRef.current) return;
    startingRef.current = true;
    try {
      const cleanItems = parsedItems.map(({ preview, ...rest }) => rest);
      const res = await fetch('/api/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cleanItems,
          voice,
          ...getApiConfigForRequest(),
          ...getOcrConfigForRequest(),
          ...getTtsConfigForRequest(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start batch');
      }
      const data = await res.json();
      setJobId(data.jobId);
    } catch (error) {
      showToast('启动失败', error instanceof Error ? error.message : '无法启动批量任务', 'error');
    } finally {
      startingRef.current = false;
    }
  };

  const handleMergeVideos = async () => {
    if (!jobId) return;
    setIsMerging(true);
    try {
      const res = await fetch(`/api/batch/merge/${jobId}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to merge videos');
      setMergedVideoUrl(data.videoUrl);
      showToast('合并成功', '所有片段已合并，点击下方链接下载。', 'success');
    } catch (error) {
      showToast('合并失败', error instanceof Error ? error.message : '合并过程中出现未知错误', 'error');
    } finally {
      setIsMerging(false);
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '等待中';
      case 'parsing': return 'AI 解析中';
      case 'tts': return '语音合成中';
      case 'rendering': return '视频渲染中';
      case 'done': return '完成';
      case 'failed': return '失败';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400';
      case 'parsing': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'tts': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'rendering': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'done': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400';
    }
  };

  const inputCls = 'w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors';

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-900 overflow-hidden">
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />

      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">批量生产流水线</h2>
          <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">长文本拆分 / 多张题目图片批量生成讲解视频</p>
        </div>
        <div className="relative">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            title="讲解音色"
            className="appearance-none pl-3 pr-8 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs font-medium text-gray-700 dark:text-zinc-300 focus:ring-2 focus:ring-cyan-500/20 outline-none cursor-pointer"
          >
            {TTS_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      <div className="p-8 flex-1 overflow-y-auto">
        {!jobId ? (
          <>
            <div className="mb-6">
              {/* Input type toggle */}
              <div className="flex gap-2 mb-4">
                {[
                  { id: 'text', label: '长文本拆分' },
                  { id: 'images', label: '题目图片（批量 OCR）' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setInputType(id as 'text' | 'images')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      inputType === id
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {inputType === 'text' ? (
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={7}
                  placeholder="在此粘贴多道学科题目的长文本（数学/物理/化学/计算机/统计等），系统会自动拆分成多道题..."
                  className={`${inputCls} resize-none`}
                />
              ) : (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="w-full text-sm text-gray-500 dark:text-zinc-400 file:mr-4 file:px-4 file:py-2.5 file:rounded-xl file:border-0 file:bg-cyan-600 file:text-white file:text-sm file:font-semibold hover:file:bg-cyan-700 cursor-pointer"
                  />
                  <p className="text-xs text-gray-400 dark:text-zinc-500">支持一次选多张题目图片（最多 12 张），每张会自动 OCR 识别文字、公式与插图。若某张识别为空，可在列表中删除。</p>
                  {imagePreviews.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {imagePreviews.map((src, i) => (
                        <div key={i} className="relative w-28 h-28 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800">
                          <img src={src} alt={`题目图 ${i + 1}`} className="w-full h-full object-contain" />
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold">{i + 1}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={inputType === 'text' ? handleSplitText : handleOcrImages}
                  disabled={isSplitting || (inputType === 'text' ? !textInput.trim() : imageFiles.length === 0)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {isSplitting && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {isSplitting
                    ? (inputType === 'images' && ocrProgress
                      ? `OCR 识别中 ${ocrProgress.done}/${ocrProgress.total}…`
                      : '智能拆分中…')
                    : '提取题目列表'}
                </button>
              </div>
            </div>

            {parsedItems.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between bg-gray-50 dark:bg-zinc-800/50">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">已提取 {parsedItems.length} 道题目</h3>
                  <button
                    onClick={handleStartBatch}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    开始批量生产
                  </button>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto">
                  {parsedItems.map((item, idx) => (
                    <div key={idx} className="p-4 flex items-center gap-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400`}>
                        {idx + 1}
                      </span>
                      {item.preview && (
                        <img src={item.preview} alt="" className="shrink-0 w-14 h-14 rounded-lg object-contain border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 truncate">{item.title || '未命名题目'}</h4>
                          {item.topic && <span className="shrink-0 px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 text-[10px] font-medium">{item.topic}</span>}
                          {item.figures && item.figures.length > 0 && <span className="shrink-0 text-[10px] text-gray-400 dark:text-zinc-500">含 {item.figures.length} 张插图</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">{item.question}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(idx)}
                        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        title="删除此题"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between bg-gray-50 dark:bg-zinc-800/50">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">任务队列执行中</h3>
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">系统将自动依序完成：AI 生成脚本 → 配音 → 视频渲染</p>
              </div>
              {jobStatus?.status === 'done' && (
                <div className="flex gap-2">
                  {mergedVideoUrl ? (
                    <a
                      href={`${mergedVideoUrl}`}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载完整长视频
                    </a>
                  ) : (
                    <button
                      onClick={handleMergeVideos}
                      disabled={isMerging}
                      className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {isMerging && (
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      合并所有片段
                    </button>
                  )}
                  <button
                    onClick={() => { setJobId(null); setJobStatus(null); setMergedVideoUrl(null); }}
                    className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    返回新建任务
                  </button>
                </div>
              )}
            </div>

            <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[600px] overflow-y-auto">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {Array.isArray(jobStatus?.items) && jobStatus.items.map((item: any, idx: number) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </span>
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{item.title}</h4>
                        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 line-clamp-1">{item.question}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>
                        {getStatusText(item.status)}
                      </span>
                      {item.videoUrl && (
                        <a
                          href={`${item.videoUrl}`}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-800 font-medium"
                        >
                          下载视频
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="w-full bg-gray-100 dark:bg-zinc-800 rounded-full h-1 overflow-hidden">
                    <div
                      className={`h-1 rounded-full transition-all duration-500 ${
                        item.status === 'failed' ? 'bg-red-500' : 'bg-cyan-600'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  {item.error && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1.5">错误: {item.error}</p>
                  )}
                </div>
              ))}

              {!jobStatus && (
                <div className="p-12 flex justify-center">
                  <svg className="animate-spin h-8 w-8 text-cyan-500" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
