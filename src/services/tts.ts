import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getAudioDurationInSeconds } from 'get-audio-duration';
import { EdgeTTS } from 'node-edge-tts';
import { SubtitleSegment } from '../plugins/types';

// In packaged Electron builds PEX_DATA_DIR points to the user's writable data dir.
// Falls back to the project root for regular dev/server mode.
const outputDir = path.join(process.env.PEX_DATA_DIR ?? process.cwd(), 'public', 'voiceover');

// DashScope（通义 CosyVoice）是国内稳定 TTS，优先使用；edge-tts 作免费兜底
const DASHSCOPE_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation';

// 前端音色（edge-tts id）→ DashScope CosyVoice 音色映射
const DASHSCOPE_VOICE_MAP: Record<string, string> = {
  'zh-CN-XiaoxiaoNeural': 'longxiaochun', // 女·温柔
  'zh-CN-XiaoyiNeural': 'longxiaoxia',    // 女·活泼
  'zh-CN-YunxiNeural': 'longshu',         // 男·磁性
  'zh-CN-YunjianNeural': 'longcheng',     // 男·沉稳
  'zh-CN-YunyangNeural': 'longhua',       // 男·新闻
  'en-US-AriaNeural': 'longxiaochun',
  'en-US-GuyNeural': 'longshu',
};

// 清洗文本：去掉换行与 markdown 符号，避免 TTS 读出乱码
function sanitizeForTTS(text: string): string {
  return text
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/_{2,}/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#/g, '');
}

// 阿里云 DashScope CosyVoice 语音合成（短文本同步返回二进制 mp3，长文本返回 audio.url）
async function dashScopeTTS(text: string, outputPath: string, dashScopeVoice: string, apiKeyOverride?: string): Promise<void> {
  const apiKey = apiKeyOverride || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  const resp = await fetch(DASHSCOPE_TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'cosyvoice-v1',
      input: { text },
      voice: dashScopeVoice,
      response_format: 'mp3',
      sample_rate: 48000,
    }),
  });
  if (!resp.ok) {
    throw new Error(`DashScope TTS ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const ct = resp.headers.get('content-type') || '';
  let buf: Buffer;
  if (ct.includes('application/json')) {
    // 长文本异步模式：返回 JSON，需再下载 audio.url
    const data = await resp.json() as { output?: { audio?: { url?: string } } };
    const url = data?.output?.audio?.url;
    if (!url) throw new Error('DashScope TTS 未返回音频 URL');
    const audioResp = await fetch(url);
    buf = Buffer.from(await audioResp.arrayBuffer());
  } else {
    buf = Buffer.from(await resp.arrayBuffer());
  }
  fs.writeFileSync(outputPath, buf);
}

// edge-tts 兜底：微软在线服务国内不稳定，加 30s 超时 + 3 次重试
async function edgeTTSWithRetry(text: string, outputPath: string, voice: string): Promise<void> {
  const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      const tts = new EdgeTTS({ voice, lang, timeout: 30000 });
      await tts.ttsPromise(text, outputPath);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`edge-tts 第${attempt}次失败，重试:`, err);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) throw lastErr;
}

export function estimateSubtitles(text: string, durationInSeconds: number): SubtitleSegment[] {
  const phrases = text.split(/(?<=[。！？\n])\s*/g).map(s => s.trim()).filter(Boolean);
  if (phrases.length === 0) {
    return [{ text, startMs: 0, endMs: Math.round(durationInSeconds * 1000) }];
  }
  const totalChars = phrases.reduce((sum, p) => sum + p.length, 0);
  const totalMs = durationInSeconds * 1000;
  let currentMs = 0;
  return phrases.map(phrase => {
    const segMs = (phrase.length / totalChars) * totalMs;
    const segment: SubtitleSegment = {
      text: phrase,
      startMs: Math.round(currentMs),
      endMs: Math.round(currentMs + segMs),
    };
    currentMs += segMs;
    return segment;
  });
}

export async function generateTTS(text: string, _filename?: string, voice: string = 'zh-CN-XiaoxiaoNeural', apiKey?: string): Promise<{ audioUrl: string; durationInSeconds: number; subtitles: SubtitleSegment[] }> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // voice 参与缓存 key，避免不同音色互相覆盖
  const hash = crypto.createHash('md5').update(`${text}|${voice}`).digest('hex');
  const filename = hash;
  const outputPath = path.join(outputDir, `${filename}.mp3`);

  try {
    if (fs.existsSync(outputPath)) {
      console.log(`Audio for hash ${hash} already exists, skipping TTS generation.`);
      const durationInSeconds = await getAudioDurationInSeconds(outputPath);
      return {
        audioUrl: `/voiceover/${filename}.mp3`,
        durationInSeconds,
        subtitles: estimateSubtitles(text, durationInSeconds),
      };
    }

    const cleanText = sanitizeForTTS(text);

    // TTS 策略：默认免费 edge-tts；失败自动回退 DashScope（国内稳定，若有 key）；都失败则报错提示
    const dashScopeKey = apiKey || process.env.DASHSCOPE_API_KEY;
    const dashScopeVoice = DASHSCOPE_VOICE_MAP[voice] || 'longxiaochun';
    let synthOk = false;
    try {
      await edgeTTSWithRetry(cleanText, outputPath, voice);
      synthOk = true;
      console.log('TTS 使用 edge-tts 免费合成成功');
    } catch (edgeErr) {
      console.warn('edge-tts 失败，尝试 DashScope:', edgeErr);
      if (dashScopeKey) {
        try {
          await dashScopeTTS(cleanText, outputPath, dashScopeVoice, dashScopeKey);
          synthOk = true;
          console.log(`TTS 回退 DashScope 成功 (voice=${dashScopeVoice})`);
        } catch (dsErr) {
          console.error('DashScope TTS 也失败:', dsErr);
        }
      }
    }
    if (!synthOk) {
      throw new Error('语音合成失败：免费语音（edge-tts）连接不上，且未配置可用的国内语音（DashScope）。可在设置面板的「题目图片识别（OCR）」中填入通义千问 Key 作为国内替代。');
    }

    // Get exact audio duration
    const durationInSeconds = await getAudioDurationInSeconds(outputPath);

    return {
      audioUrl: `/voiceover/${filename}.mp3`,
      durationInSeconds,
      subtitles: estimateSubtitles(text, durationInSeconds),
    };
  } catch (error) {
    console.error("Error generating TTS:", error);
    throw error;
  }
}
