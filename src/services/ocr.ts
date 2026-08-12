import { getOcrConfigForRequest } from './apiConfig';

export interface OcrFigure {
  id: string;
  url: string;
  bbox: number[];
  description?: string; // VL 对插图内容的文字描述（几何关系/标注/数值），供解题 LLM 理解
  ratio?: number;       // 抠图后实际宽高比 w/h，渲染端据此确定 image 控件容器高度（不依赖 LLM 给的 pos.h）
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:image/xxx;base64," prefix
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 调用后端 /api/ocr，用视觉大模型识别题目图片（含数学公式）。
 * 返回识别文本 + 题目自带插图的位置（server 已抠图，figures.url 可直接用于渲染）。
 */
export async function ocrImage(file: File): Promise<{ text: string; figures: OcrFigure[]; figureSummary: string }> {
  const imageBase64 = await fileToBase64(file);
  const ocrCfg = getOcrConfigForRequest();
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, ...ocrCfg }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'OCR 识别失败');
  }
  const data = await res.json();
  return {
    text: (data as { text?: string }).text || '',
    figures: (data as { figures?: OcrFigure[] }).figures || [],
    figureSummary: (data as { figureSummary?: string }).figureSummary || '',
  };
}
