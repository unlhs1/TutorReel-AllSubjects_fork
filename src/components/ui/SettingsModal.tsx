import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ApiConfig, PRESETS, OCR_DEFAULTS, TTS_DEFAULTS, getApiConfig, saveApiConfig } from '../../services/apiConfig';
import { DASHSCOPE_VOICES } from '../../services/ttsVoices';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [preset, setPreset] = useState<ApiConfig['preset']>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(PRESETS.deepseek.baseURL);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saved, setSaved] = useState(false);
  // OCR / 视觉模型配置
  const [ocrKey, setOcrKey] = useState('');
  const [ocrBaseURL, setOcrBaseURL] = useState(OCR_DEFAULTS.DEFAULT_OCR_BASE_URL);
  const [ocrModel, setOcrModel] = useState(OCR_DEFAULTS.DEFAULT_OCR_MODEL);
  const [ocrTestStatus, setOcrTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [ocrTestMessage, setOcrTestMessage] = useState('');
  // TTS / 语音合成配置（DashScope 回退）
  const [ttsKey, setTtsKey] = useState('');
  const [dashVoice, setDashVoice] = useState(TTS_DEFAULTS.DEFAULT_DASH_VOICE);

  useEffect(() => {
    if (open) {
      const config = getApiConfig();
      if (config.preset) setPreset(config.preset);
      if (config.apiKey) setApiKey(config.apiKey);
      if (config.baseURL) setBaseURL(config.baseURL);
      if (config.ocrKey) setOcrKey(config.ocrKey);
      if (config.ocrBaseURL) setOcrBaseURL(config.ocrBaseURL);
      if (config.ocrModel) setOcrModel(config.ocrModel);
      if (config.ttsKey) setTtsKey(config.ttsKey);
      if (config.dashVoice) setDashVoice(config.dashVoice);
      setTestStatus('idle');
      setTestMessage('');
      setSaved(false);
    }
  }, [open]);

  const handlePresetChange = (p: ApiConfig['preset']) => {
    setPreset(p);
    if (p !== 'custom') {
      setBaseURL(PRESETS[p].baseURL);
    }
    setTestStatus('idle');
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setTestMessage('请先输入 API Key');
      setTestStatus('error');
      return;
    }
    setTestStatus('testing');
    setTestMessage('');
    try {
      const res = await fetch('/api/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseURL }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage('连接成功！API Key 有效。');
      } else {
        setTestStatus('error');
        setTestMessage(data.error || '连接失败');
      }
    } catch {
      setTestStatus('error');
      setTestMessage('无法连接到后端服务，请先启动后端。');
    }
  };

  const handleOcrTest = async () => {
    if (!ocrKey.trim()) {
      setOcrTestStatus('error');
      setOcrTestMessage('请先填写 OCR API Key');
      return;
    }
    setOcrTestStatus('testing');
    setOcrTestMessage('正在测试 OCR 连接…');
    try {
      const res = await fetch('/api/ocr-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocrKey, ocrBaseURL, ocrModel }),
      });
      const data = await res.json();
      if (data.success) {
        setOcrTestStatus('success');
        setOcrTestMessage('OCR 连接成功！可以识别题目图片了。');
      } else {
        setOcrTestStatus('error');
        setOcrTestMessage(data.error || 'OCR 连接失败');
      }
    } catch {
      setOcrTestStatus('error');
      setOcrTestMessage('无法连接后端服务');
    }
  };

  const handleSave = async () => {
    saveApiConfig({ preset, apiKey, baseURL, ocrKey, ocrBaseURL, ocrModel, ttsKey, dashVoice });
    setSaved(true);
    // 未填 Key：允许使用服务端 .env 配置，直接保存关闭
    if (!apiKey.trim()) {
      setTestStatus('success');
      setTestMessage('配置已保存（将使用服务端 .env 的 Key）');
      setTimeout(() => { setSaved(false); onClose(); }, 1000);
      return;
    }
    // 已填 Key：保存后自动测试连接
    setTestStatus('testing');
    setTestMessage('正在测试连接…');
    let saveOk = false;
    try {
      const res = await fetch('/api/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseURL }),
      });
      const data = await res.json();
      if (data.success) {
        saveOk = true;
        setTestStatus('success');
        setTestMessage('配置已保存，连接成功！现在可以去生成视频了。');
      } else {
        setTestStatus('error');
        setTestMessage(`配置已保存，但连接失败：${data.error || '请检查 API Key'}`);
      }
    } catch {
      setTestStatus('error');
      setTestMessage('配置已保存，但无法连接后端服务');
    }
    // 成功才自动关闭；失败保留弹窗让用户看到错误
    setTimeout(() => {
      setSaved(false);
      if (saveOk) onClose();
    }, 1500);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-800 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg className="w-4 h-4 text-gray-600 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">AI 服务配置</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Preset */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-3">服务商预设</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PRESETS) as ApiConfig['preset'][]).map((p) => (
                <button
                  key={p}
                  onClick={() => handlePresetChange(p)}
                  className={`py-2.5 px-3 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                    preset === p
                      ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400'
                      : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {PRESETS[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestStatus('idle'); }}
                placeholder="sk-..."
                className="w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
              >
                {showKey ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1.5">API Key 仅存储在本地浏览器，不会上传到任何服务器。</p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">Base URL</label>
            <input
              type="text"
              value={baseURL}
              onChange={(e) => { setBaseURL(e.target.value); setTestStatus('idle'); }}
              placeholder="https://api.deepseek.com"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
            />
          </div>

          {/* OCR / 视觉模型配置 */}
          <div className="border-t border-gray-100 dark:border-zinc-800 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <label className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">题目图片识别（OCR）</label>
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3 leading-relaxed">
              用于识别题目图片中的文字与数学公式。默认走通义千问（DashScope），也可换成任意支持 OpenAI 兼容格式的视觉模型。
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">OCR API Key（DashScope）</label>
                <input
                  type="password"
                  value={ocrKey}
                  onChange={(e) => setOcrKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">OCR Base URL</label>
                <input
                  type="text"
                  value={ocrBaseURL}
                  onChange={(e) => setOcrBaseURL(e.target.value)}
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">OCR 模型名称</label>
                <input
                  type="text"
                  value={ocrModel}
                  onChange={(e) => setOcrModel(e.target.value)}
                  placeholder="qwen-vl-max"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
                />
              </div>
              <button
                onClick={handleOcrTest}
                disabled={ocrTestStatus === 'testing'}
                className="w-full py-2.5 px-4 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {ocrTestStatus === 'testing' ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    测试中…
                  </>
                ) : '测试 OCR 连接'}
              </button>
              {ocrTestStatus !== 'idle' && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
                  ocrTestStatus === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/30'
                }`}>
                  {ocrTestMessage}
                </div>
              )}
            </div>
          </div>

          {/* 语音合成（TTS） */}
          <div className="border-t border-gray-100 dark:border-zinc-800 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 8.5a5 5 0 010 7" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 5.5a9 9 0 010 13" />
              </svg>
              <label className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">语音合成（TTS）</label>
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3 leading-relaxed">
              配音优先用免费的 edge-tts；连接不上时自动回退到国内稳定的 DashScope CosyVoice。回退需要 DashScope Key 与音色，不配则静默跳过回退。
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">DashScope TTS Key（回退用，可留空）</label>
                <input
                  type="password"
                  value={ttsKey}
                  onChange={(e) => setTtsKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm font-mono"
                />
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1.5">留空时回退复用上方「OCR」的 DashScope Key，或服务端 .env 的 DASHSCOPE_API_KEY。</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">回退音色（CosyVoice）</label>
                <select
                  value={dashVoice}
                  onChange={(e) => setDashVoice(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-gray-900 dark:text-zinc-100 focus:bg-white dark:focus:bg-zinc-800 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-colors text-sm"
                >
                  {DASHSCOPE_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1.5">edge-tts 正常时用编辑器里选的音色；回退到 DashScope 时用这里选的音色。</p>
              </div>
            </div>
          </div>

          {/* Connection test result */}
          {testStatus !== 'idle' && (
            <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium animate-in fade-in duration-200 ${
              testStatus === 'testing' ? 'bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400' :
              testStatus === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30' :
              'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/30'
            }`}>
              {testStatus === 'testing' && (
                <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {testStatus === 'success' && (
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {testStatus === 'error' && (
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span>{testStatus === 'testing' ? '正在测试连接…' : testMessage}</span>
            </div>
          )}

          {/* Usage tip */}
          <div className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-4 border border-gray-100 dark:border-zinc-700">
            <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
              <span className="font-semibold text-gray-600 dark:text-zinc-300">使用提示：</span>
              配置后，所有 AI 解析请求将使用此 API Key 和服务商。若留空，将使用后端{' '}
              <code className="font-mono text-cyan-600 dark:text-cyan-400">.env</code>{' '}
              中的默认配置。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="flex-1 py-2.5 px-4 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {testStatus === 'testing' ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                测试中…
              </>
            ) : '测试连接'}
          </button>
          <button
            onClick={handleSave}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              saved
                ? 'bg-emerald-500 text-white'
                : 'bg-cyan-600 hover:bg-cyan-700 text-white'
            }`}
          >
            {saved ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                已保存
              </>
            ) : '保存配置'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
