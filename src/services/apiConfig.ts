const CONFIG_KEY = 'pex_api_config';

export interface ApiConfig {
  apiKey: string;
  baseURL: string;
  preset: 'deepseek' | 'openai' | 'qwen' | 'custom';
  // OCR / 视觉模型配置（用于题目图片识别）
  ocrKey: string;
  ocrBaseURL: string;
  ocrModel: string;
}

export const PRESETS: Record<ApiConfig['preset'], { label: string; baseURL: string }> = {
  deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  qwen: { label: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  custom: { label: '自定义', baseURL: '' },
};

const DEFAULT_OCR_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_OCR_MODEL = 'qwen-vl-max';

export function getApiConfig(): Partial<ApiConfig> {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as ApiConfig) : {};
  } catch {
    return {};
  }
}

export function saveApiConfig(config: ApiConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function hasApiConfig(): boolean {
  const config = getApiConfig();
  return !!(config.apiKey?.trim());
}

export function getApiConfigForRequest(): { apiKey?: string; baseURL?: string } {
  const config = getApiConfig();
  return {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  };
}

// OCR / 视觉模型配置（前端传入，导师可自定义模型名与 API 地址）
export function getOcrConfigForRequest(): { ocrKey?: string; ocrBaseURL?: string; ocrModel?: string } {
  const config = getApiConfig();
  return {
    ...(config.ocrKey ? { ocrKey: config.ocrKey } : {}),
    ...(config.ocrBaseURL ? { ocrBaseURL: config.ocrBaseURL } : {}),
    ...(config.ocrModel ? { ocrModel: config.ocrModel } : {}),
  };
}

export const OCR_DEFAULTS = { DEFAULT_OCR_BASE_URL, DEFAULT_OCR_MODEL };
