import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { Jimp } from 'jimp';
import { splitTextToProblems, testConnection, callLLM, LLMConfig } from './services/llm';
import { generateTTS } from './services/tts';
import { exportQueue } from './services/exportQueue';
import { batchQueue } from './services/batchQueue';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

// In packaged Electron mode these env vars are set by electron/main.ts before
// this module is loaded. In standalone server mode they fall back to cwd.
const APP_DIR  = process.env.PEX_APP_DIR  ?? process.cwd();
const DATA_DIR = process.env.PEX_DATA_DIR ?? process.cwd();

const app = express();
const preferredPort = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '25mb' })); // 题目图片 base64 较大

// ── 视频生成工具规范（外置 txt，供 LLM 多阶段流水线遵守） ──
const TOOLS_DIR = path.join(__dirname, 'tools');
function readTool(name: string): string {
  try { return fs.readFileSync(path.join(TOOLS_DIR, name), 'utf-8'); } catch { return ''; }
}
const VISUAL_SPEC = readTool('visual-spec.txt');
const JSON_SCHEMA_SPEC = readTool('json-schema.txt');
const SPOKEN_GUIDE = readTool('spoken-guide.txt');

const TOOLS_PROMPT = `
以下是本系统定义的视频生成工具规范，你必须严格遵守这些规范来输出内容：

===== 可视化工具规范（visual-spec） =====
${VISUAL_SPEC}

===== 输出 JSON 规范（json-schema） =====
${JSON_SCHEMA_SPEC}

===== 口语化配音规范（spoken-guide） =====
${SPOKEN_GUIDE}
`;

// 容错解析 LLM 返回的 JSON（去掉 <think> 和 markdown 代码块）
function parseLLMJson(content: string): any {
  let clean = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  clean = clean.replace(/^```json/im, '').replace(/```$/m, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)); } catch { return {}; }
    }
    return {};
  }
}

// ── Static file routes (order matters) ──

// User-generated voiceover audio (writable, lives in DATA_DIR)
app.use('/voiceover', express.static(path.join(DATA_DIR, 'public', 'voiceover')));

// Pre-built Remotion bundle (served so export.ts can reference it via HTTP)
const remotionBundleDir = process.env.PEX_REMOTION_BUNDLE_DIR
  ?? path.join(APP_DIR, 'build');
if (fs.existsSync(remotionBundleDir)) {
  app.use('/remotion-bundle', express.static(remotionBundleDir));
}

// Other static assets from the app directory (favicon, etc.)
app.use(express.static(path.join(APP_DIR, 'public')));

// Vite production build (frontend SPA)
const distPath = path.join(APP_DIR, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', hasEnvApiKey: !!process.env.OPENAI_API_KEY });
});

// 题目图片 OCR：用视觉大模型识别题目、公式，并定位题目自带的插图
const OCR_SYSTEM_PROMPT = `你是一个专业的数学题目识别助手。识别图片中的题目内容，只输出一个 JSON 对象，不要多余文字：
{
  "text": "题目和解析的完整文字，数学公式用 LaTeX \\(...\\) 包裹，如 \\lim_{x \\to 0} \\frac{\\sin x}{x}",
  "figures": [
    { "id": "fig1", "bbox": [x1, y1, x2, y2] }
  ],
  "figureSummary": "所有插图的整体语义描述（若有图），重点描述图形的形状与趋势"
}
要求：
1. text：完整保留题目和解析内容，公式用 LaTeX。文字保留原意，手写体也尽量识别。
2. figures：图片中题目自带的插图/图形的边界框。bbox 为归一化坐标（0 到 1，相对图片宽高），顺序为 [左上角x, 左上角y, 右下角x, 右下角y]。
3. 只有明显的图形/插图才输出 figures（如函数图、几何图、分布图、电路图等），纯文字区域不要算。没有插图则 figures 为 []。
4. **bbox 必须完整框住整个图形**：上下左右紧贴图形外边界，不能只框图形的一部分（如只框上半部分），也不能把大量留白圈进来。
5. **figureSummary（关键，必须输出）**：**只客观描述**图片中所有图形元素（坐标曲线、波形、几何图形等）的形状与趋势，**不要下结论（如"这是低通/带通滤波器"），让解题 AI 自己判断**。只要有坐标轴 + 曲线，即使没有独立的"插图框"，也必须描述曲线走势：各区间（低频/高频、左右端）的升降、逼近值、极值点/截止点位置。示例："曲线在 ω=0 处取极小值接近 0，向 ±π 单调上升至接近 1，-3dB 点约在 0.707"。**只有图片完全是纯文字、无任何图形元素时才输出 ""**。若无法看出曲线走势，就写"无法确定曲线走势"，不要跳过。`;

// 自动裁剪图片纯白边：让插图内容占满图片，避免渲染时白边过多导致图形显示过小
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function autoTrimWhite(img: any): any {
  const { width: w, height: h } = img.bitmap;
  const data = img.bitmap.data;
  const THRESH = 240; // 像素 RGB 均 > THRESH 视为白（含灰白背景/浅噪点）
  let minX = w, minY = h, maxX = -1, maxY = -1;
  // 采样扫描（步长 2，足够且快）
  for (let y = 0; y < h; y += 2) {
    const row = y * w * 4;
    for (let x = 0; x < w; x += 2) {
      const i = row + x * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a > 200 && !(r >= THRESH && g >= THRESH && b >= THRESH)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return img; // 无效边界，原样返回
  const pad = 4;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const cw = Math.min(w - x0, maxX - minX + 1 + pad * 2);
  const ch = Math.min(h - y0, maxY - minY + 1 + pad * 2);
  if (cw < 8 || ch < 8) return img;
  return img.clone().crop({ x: x0, y: y0, w: cw, h: ch });
}

// 插图描述：把裁剪出的题目插图转成文字，供解题 LLM 理解图的内容（几何关系/标注/数值）
const FIGURE_DESCRIBE_PROMPT = `你是一个严谨的题目插图描述器。描述这张题目插图中的图形信息，供解题 AI 使用。请提取：
1. 图形类型（几何图/函数曲线/波形图/幅频特性图/电路图/柱状图/坐标图/立体图等）
2. 所有标注的字母/顶点（如 A、B、C、O）
3. 已知数值（边长、角度、坐标、函数表达式、刻度、频率等）
4. 关键关系（平行、垂直、相等、相切、包含、比例等）
5. 若是函数曲线/波形/幅频特性图（关键）：详细描述曲线在坐标轴上的整体走势——例如"低频段 |H|≈1（通带），高频段衰减到 0（阻带），截止频率 ωc≈1"、"带通形状，中心频率处最高"、"曲线单调递减"等，给出极值点/截止点的位置。这类图的解题依据全在曲线走势里，必须具体描述。
6. 若是几何图：给出各顶点标注、线段长度、角度、平行垂直关系。
只输出客观描述，不要解题，不要多余话。`;

// 整图图形语义兜底：主 OCR 未给出 figureSummary 时，单独描述整张图的图形内容
const FIGURE_SUMMARY_PROMPT = `你是严谨的题目图形描述器。观察这张图片中的所有图形内容，输出客观描述供解题 AI 使用。重点：
1. 是否有坐标曲线/波形/几何图形/电路图等图形元素？
2. 若有曲线（幅频特性、函数曲线、波形等）：详细描述曲线走势——在坐标轴各区间（如低频/高频、左右端）的升降、逼近值、极值点/截止点位置。例如"曲线在 ω=0 处取极小值接近 0，向 ±π 单调上升至接近 1"、"曲线在低频段接近 1，高频段衰减到 0，-3dB 点约在 ωc=1"。
3. 若是几何图：描述顶点标注、边长、角度、平行垂直关系。
4. 若是纯文字无图形：输出"无图形"。
**只输出客观走势描述，不要判断图形性质/滤波器类型/下结论。**`;

app.post('/api/ocr', async (req, res) => {
  try {
    const { imageBase64, ocrKey, ocrBaseURL, ocrModel } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const resolvedModel = ocrModel || process.env.OCR_MODEL || 'qwen-vl-max';
    console.log(`[ocr] model=${resolvedModel} apiKey=${ocrKey ? 'YES' : 'NO'} envKey=${process.env.DASHSCOPE_API_KEY ? 'YES' : 'NO'}`);
    const client = new OpenAI({
      apiKey: ocrKey || process.env.DASHSCOPE_API_KEY || '',
      baseURL: ocrBaseURL || process.env.OCR_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    const response = await client.chat.completions.create({
      model: resolvedModel,
      messages: [
        { role: 'system', content: OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            { type: 'text', text: '请识别图片中的数学题目，输出 JSON。' },
          ],
        },
      ],
      max_tokens: 1500,
    });
    const content = response.choices[0]?.message?.content || '';
    const parsed = parseLLMJson(content);
    const text = parsed.text || '';
    let figureSummary = typeof parsed.figureSummary === 'string' ? parsed.figureSummary : '';
    const figures: Array<{ id: string; bbox: number[] }> = Array.isArray(parsed.figures) ? parsed.figures : [];
    console.log(`[ocr] text=${text.length}字 figures=${figures.length} figureSummary=${figureSummary.length}字`);

    // 兜底：题目明显含图形（"如图/曲线/波形"等线索）但没拿到 figureSummary → 再调一次 VL 描述整张图
    if (figureSummary.length < 20 && (figures.length > 0 || /如图|图所|曲线|波形|图形|坐标|图像|滤波器|特性曲线/.test(text))) {
      try {
        const sumResp = await client.chat.completions.create({
          model: resolvedModel,
          messages: [
            { role: 'system', content: FIGURE_SUMMARY_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                { type: 'text', text: '请描述这张图片中的所有图形内容。' },
              ],
            },
          ],
          max_tokens: 500,
        });
        const s = (sumResp.choices[0]?.message?.content || '').trim();
        if (s && s !== '无图形') {
          figureSummary = s;
          console.log(`[ocr] 兜底图形描述成功: ${s.slice(0, 100)}`);
        }
      } catch (descErr) {
        console.warn('[ocr] 兜底图形描述失败:', descErr instanceof Error ? descErr.message : descErr);
      }
    }

    // 抠图：从原图按 bbox 裁剪保存（供渲染引用），并对每张图调用 VL 生成文字描述（供解题 LLM 理解）
    const figureResults: Array<{ id: string; url: string; bbox: number[]; description?: string; ratio?: number }> = [];
    if (figures.length > 0) {
      const figDir = path.join(APP_DIR, 'public', 'question-figures');
      fs.mkdirSync(figDir, { recursive: true });
      try {
        const img = await Jimp.read(Buffer.from(imageBase64, 'base64'));
        const w = img.bitmap.width;
        const h = img.bitmap.height;
        for (const fig of figures) {
          const [fx1, fy1, fx2, fy2] = Array.isArray(fig.bbox) ? fig.bbox : [0, 0, 1, 1];
          // bbox 外扩 3%，避免 VL 只框住图形的一部分而截断
          const PAD = 0.03;
          const cx1 = Math.max(0, Math.min(1, fx1 - PAD));
          const cy1 = Math.max(0, Math.min(1, fy1 - PAD));
          const cx2 = Math.max(0, Math.min(1, fx2 + PAD));
          const cy2 = Math.max(0, Math.min(1, fy2 + PAD));
          const px = Math.round(cx1 * w);
          const py = Math.round(cy1 * h);
          const pw = Math.max(4, Math.round((cx2 - cx1) * w));
          const ph = Math.max(4, Math.round((cy2 - cy1) * h));
          console.log(`[ocr] 图 ${fig.id} 原bbox=[${fx1.toFixed(2)},${fy1.toFixed(2)},${fx2.toFixed(2)},${fy2.toFixed(2)}] → 裁剪 x=${px} y=${py} w=${pw} h=${ph} (图 ${w}x${h})`);
          const filename = `${fig.id}-${Date.now()}.png`;
          const filepath = path.join(figDir, filename);
          let crop = img.clone().crop({ x: px, y: py, w: pw, h: ph });
          crop = autoTrimWhite(crop); // 裁剪掉纯白边，让图形占满图片
          await crop.write(filepath as `${string}.${string}`);
          // 记录抠图后的实际宽高比 w/h，渲染端按此比例确定 image 控件容器高度（不依赖 LLM 给的 pos.h）
          const ratio = crop.bitmap.width / crop.bitmap.height;
          const figRatio = Number.isFinite(ratio) && ratio > 0 ? Number(ratio.toFixed(3)) : undefined;
          console.log(`[ocr] 图 ${fig.id} 抠图后 ${crop.bitmap.width}x${crop.bitmap.height} ratio=${figRatio}`);

          // 用 VL 描述插图内容（供解题 LLM 理解几何关系/标注）
          let description = '';
          try {
            const cropB64 = fs.readFileSync(filepath).toString('base64');
            const figResp = await client.chat.completions.create({
              model: resolvedModel,
              messages: [
                { role: 'system', content: FIGURE_DESCRIBE_PROMPT },
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${cropB64}` } },
                    { type: 'text', text: '请描述这张题目插图。' },
                  ],
                },
              ],
              max_tokens: 500,
            });
            description = (figResp.choices[0]?.message?.content || '').trim();
          } catch (descErr) {
            console.warn(`[ocr] 图 ${fig.id} 描述失败:`, descErr instanceof Error ? descErr.message : descErr);
          }
          figureResults.push({ id: fig.id, url: `/question-figures/${filename}`, bbox: fig.bbox, description, ratio: figRatio });
        }
        console.log(`[ocr] 抠图完成: ${figureResults.length} 张（含描述 ${figureResults.filter(f => f.description).length} 张）`);
      } catch (cropErr) {
        console.error('OCR 抠图失败:', cropErr);
      }
    }

    res.json({ text, figures: figureResults, figureSummary });
  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'OCR 识别失败' });
  }
});

app.post('/api/ocr-test', async (req, res) => {
  try {
    const { ocrKey, ocrBaseURL } = req.body;
    if (!ocrKey?.trim()) {
      return res.status(400).json({ success: false, error: 'OCR API Key 不能为空' });
    }
    const client = new OpenAI({
      apiKey: ocrKey,
      baseURL: ocrBaseURL || process.env.OCR_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    await client.models.list();
    res.json({ success: true });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const isAuth = err.status === 401 || err.status === 403;
    res.status(400).json({
      success: false,
      error: isAuth ? 'OCR API Key 无效，请检查是否为通义千问（DashScope）的 Key' : (err.message || '连接失败'),
    });
  }
});

app.post('/api/test-config', async (req, res) => {
  const { apiKey, baseURL } = req.body;
  if (!apiKey?.trim()) {
    return res.status(400).json({ success: false, error: 'API Key 不能为空' });
  }
  try {
    await testConnection({ apiKey, baseURL });
    res.json({ success: true });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const isAuthError = err.status === 401 || err.status === 403;
    res.status(400).json({
      success: false,
      error: isAuthError ? 'API Key 无效，请检查是否正确' : (err.message || '连接失败'),
    });
  }
});

app.post('/api/batch/split-text', async (req, res) => {
  try {
    const { rawText, model, apiKey, baseURL } = req.body;
    if (!rawText) {
      return res.status(400).json({ error: 'Missing rawText' });
    }
    const problems = await splitTextToProblems(rawText, model, { apiKey, baseURL });
    res.json({ problems });
  } catch (error) {
    console.error('API Error during split-text:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to split text' });
  }
});

app.post('/api/batch/scrape', async (req, res) => {
  try {
    const { url, model } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Missing url' });
    }

    // Only allow public HTTP(S) URLs — block SSRF to internal networks
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
      return res.status(400).json({ error: 'Internal network URLs are not allowed' });
    }

    // 简单 MVP 实现：获取网页 HTML 并用正则剔除标签，然后交给 LLM 拆分
    const fetchRes = await fetch(url);
    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch URL: ${fetchRes.statusText}`);
    }
    
    const html = await fetchRes.text();
    // 粗略移除 script 和 style 标签内容，再移除所有 HTML 标签
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // 截取前 10000 个字符避免 token 超限
      .substring(0, 10000);

    const problems = await splitTextToProblems(cleanText, model);
    res.json({ problems });
  } catch (error) {
    console.error('API Error during scrape:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to scrape and split' });
  }
});

app.post('/api/batch/start', async (req, res) => {
  try {
    const { items, apiKey, baseURL, model } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing items array' });
    }
    const job = batchQueue.createJob(items, { apiKey, baseURL, model });
    res.json({ jobId: job.id, message: 'Batch job started' });
  } catch (error) {
    console.error('API Error during batch start:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start batch' });
  }
});

app.get('/api/batch/status/:id', (req, res) => {
  const jobId = req.params.id;
  const job = batchQueue.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.post('/api/batch/merge/:id', (req, res) => {
  const jobId = req.params.id;
  const job = batchQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const validItems = job.items.filter(item => item.status === 'done' && item.videoUrl);
  if (validItems.length === 0) {
    return res.status(400).json({ error: 'No successful videos to merge' });
  }

  const outDir = path.resolve(DATA_DIR, 'out');
  const mergedFilename = `merged_${jobId}.mp4`;
  const mergedFilepath = path.resolve(outDir, mergedFilename);
  const listFilepath = path.resolve(outDir, `list_${jobId}.txt`);

  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const listContent = validItems.map(item => {
      const filename = item.videoUrl!.split('/').pop();
      const absPath = path.resolve(outDir, filename!);
      return `file '${absPath}'`;
    }).join('\n');
    
    fs.writeFileSync(listFilepath, listContent, 'utf-8');

    // Use ffmpeg-static bundled binary when available, fall back to system ffmpeg
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegBin: string = (() => { try { return require('ffmpeg-static') ?? 'ffmpeg'; } catch { return 'ffmpeg'; } })();
    const cmd = `"${ffmpegBin}" -y -f concat -safe 0 -i "${listFilepath}" -c copy "${mergedFilepath}"`;
    
    exec(cmd, (error, stdout, stderr) => {
      try {
        if (fs.existsSync(listFilepath)) fs.unlinkSync(listFilepath);
      } catch (e) {
        console.warn('Failed to delete list file:', e);
      }

      if (error) {
        console.error('FFmpeg merge error:', error, stderr);
        return res.status(500).json({ error: 'Failed to merge videos via FFmpeg' });
      }

      res.json({
        message: 'Merged successfully',
        videoUrl: `/api/export/download/${mergedFilename}`
      });
    });
  } catch (error) {
    console.error('Merge exception:', error);
    res.status(500).json({ error: 'Internal server error during merge' });
  }
});

// 从题目分析结果生成完整视频脚本：
// Stage2 初稿 → Stage3 审片 → Stage4 答案验证 → 组装 imageUrl → TTS
async function generateVideoScript(
  analysis: any,
  figures: any[],
  figureSummary: string,
  m: string,
  llmConfig: LLMConfig,
  voice?: string,
  ttsApiKey?: string,
): Promise<any> {
  let figuresInfo = '';
  const figSummaryText = figureSummary
    ? `\n【插图整体语义】题目图中的图形含义如下（解题必须据此理解图，尤其曲线走势）：
${figureSummary}\n`
    : '';
  if (Array.isArray(figures) && figures.length > 0) {
    figuresInfo = `${figSummaryText}\n题目自带以下插图（已从原图抠出，可在视频中用 image 控件显示原图）：
${figures.map((f: { id: string; url: string; description?: string }) => `- ${f.id} (${f.url})${f.description ? ` 图内容：${f.description}` : ''}`).join('\n')}
重要：解题必须依据上述"图内容"描述正确理解图（几何关系、曲线走势、标注、数值）；在讲解到对应内容时用 image 控件（imageRef 填图 id）在视频中展示原图。每张图最多用一次。\n`;
  } else if (figSummaryText) {
    figuresInfo = figSummaryText;
  }

  // Stage 2: 生成讲解初稿
  const draftRaw = await callLLM(
    `你是一个专业教师，负责把一道题制作成讲解短视频脚本。请严格遵循工具规范生成完整 JSON 脚本。

${TOOLS_PROMPT}

要求：
1. 【mode 判断】先判断：输入是"要解的题目"（有具体问题要答）→ mode=problem-solving，用 4 段式主线（题目分析→题目作答→完整作答→总结）；输入是"讲解某概念/定义/定理/公式"（无具体要解的题）→ mode=concept-explaining，用讲解式主线（概念引入→分点展开→小结→总结）。
2. 输出必须严格符合 json-schema 中定义的完整结构：id、type(固定为"general")、title、topic、mode、question、script.opening、script.scenes(3-6个场景，每场景含 text/spokenText/duration/blocks)、script.summary。
3. spokenText 严格按 spoken-guide 口语化，禁止数学符号缩写。
4. 【控件】blocks 必须从 visual-spec 的"预置美工控件库"中选择，禁止发明新类型、禁止用纯 text 堆长段文字。**按学科选控件**（见 visual-spec 的"学科兼容"表：数学用 plot/bar/formula-steps，物理用 formula-card/table，化学用 table/formula-card，计算机用 table/flow，统计用 bar/table）。problem-solving 模式：每个作答场景含解析类控件（formula-steps/plot/bar/keypoint/note/table），倒数第 2 场景必须 answer-sheet 完整作答；concept-explaining 模式：每场景含讲解控件（formula-card/plot/bar/keypoint/note/table），不用 answer-sheet。
5. 【图形比例+克制】每 3 个场景至少 1 个图形控件（plot/bar/image），理想每 2 个场景 1 个，但**图形是辅助不是装饰**：同一道题**优先只用一个图形控件**（数学题通常 plot 或 image），**禁止各种图表都用一遍**（不要轮流塞 bar+plot+flow+table 凑数）；每类图表全片最多一次；达到下限后专心讲推导，不要再加新图。
6. 【动态 plot（数学题加分项）】数学题（极限/导数/函数性质/图像变换）优先用 plot 的动态能力"演"出过程：极限逼近用 traceX（高亮点沿曲线滑向极限点，如 { "from": -6, "to": 0 }）；参数如何影响图像用 animParam（fx 里放参数名并从 from 变到 to，如 fx:"a*sin(x)" 配 animParam:{name:"a",from:1,to:5}）；连续步骤函数形态变化靠跨场景自动 morph。**animParam 与 traceX 互斥，一个 plot 只能二选一**（禁止同用）；animParam.name 是单字母、不能是 x、必须出现在 fx 里；traceX 的 from/to 在 xRange 内且 from<to。动态 plot 用 fade。
7. 【动画克制】默认 fade/none；zoom 只用于最终答案，slide-up 只用于关键公式。禁止每个块都 zoom/slide-up。
8. 【时间轴】每个场景必须填 duration（秒）：讲解/作答步骤 5-8 秒，完整作答 6-8 秒，总时长 25-60 秒。
9. 如果题目自带插图，在讲解到对应内容时用 image 控件引用。
${figuresInfo}`,
    `题目信息：\n${JSON.stringify(analysis)}`,
    m, llmConfig
  );
  const draft = parseLLMJson(draftRaw);
  console.log(`[script] Stage2 初稿 steps=${Array.isArray(draft?.script?.scenes) ? draft.script.scenes.length : 'N/A'}`);

  // Stage 3: 审查修正
  const reviewRaw = await callLLM(
    `你是一个资深视频审片专家。审查下面的讲解视频脚本，发现问题直接修正，输出修正后的完整 JSON（严格按 json-schema，结构不能缺）。

审查要点：
0. 【mode】mode 判断是否正确：输入是"要解的题目"→ problem-solving；"讲解概念/定理"→ concept-explaining。判断错则修正 mode。
1. 结构完整：必须有 script.opening、script.scenes(3-6个场景)、script.summary。
2. 每场景必须有 text、spokenText、duration、blocks；每个 block 必须有 type 和 pos。
3. spokenText 是否口语化（无 x^2、lim、∑ 等符号缩写）。
4. block 数据是否完整可绘制（plot 需 fx/xRange/yRange；**同一 plot 不得同时出现 animParam 与 traceX**；若用 animParam 则 name 不能是 x、必须出现在 fx 中且 from/to 齐全、from 与 to 的波峰波谷应落在 yRange 内；若用 traceX 则 from/to 在 xRange 内且 from<to；bar 需 barData/labels）。
5. formula 是否标准 LaTeX；pos 是否在 0-100 且不重叠。
6. 数学推导和结论是否正确。
7. 【视觉平衡+克制】图形控件（plot/bar/image）是否达到每 3 场景至少 1 个；若不足，把合适的文字场景改成图形场景。**同时检查是否图表滥用**：同一道题是否堆了多种图表（bar+plot+flow+table 轮番上）；若是，删掉非必要的图表控件，只保留最能说明问题的那个，达到下限后专心讲推导。
8. 【时间轴】每场景是否都填了 duration；节奏是否合理（讲解/作答 5-8s、完整作答 6-8s），总时长是否 25-60s。
9. 【控件规范】blocks 是否只用了 visual-spec 控件库中的类型。
10. 【主线结构】problem-solving 模式：倒数第 2 场景是否 answer-sheet 完整作答；每个作答场景是否含解析类控件（formula-steps/plot/bar/keypoint/note）。concept-explaining 模式：是否按"引入→分点→小结"组织。
11. 【动画克制】zoom/slide-up 是否被滥用（只在最终答案用 zoom、关键公式用 slide-up，其余 fade/none）；若滥用改为 fade。

${TOOLS_PROMPT}`,
    `待审查脚本：\n${JSON.stringify(draft)}`,
    m, llmConfig
  );
  let finalData = parseLLMJson(reviewRaw);
  if (!finalData?.script?.scenes?.length && Array.isArray(draft?.script?.scenes) && draft.script.scenes.length) {
    console.log('[script] Stage3 审查输出异常，回退初稿');
    finalData = draft;
  }
  console.log(`[script] Stage3 审查完成 steps=${Array.isArray(finalData?.script?.scenes) ? finalData.script.scenes.length : 'N/A'} summary=${finalData?.script?.summary ? 'YES' : 'NO'}`);

  // Stage 4: 答案准确性审查（教学正确率保障）
  const verifyRaw = await callLLM(
    `你是一个严谨的学科验证专家，负责确保教学视频内容的正确性。审查下面的讲解脚本，发现问题直接修正，输出修正后的完整 JSON（严格按 json-schema，结构不能缺）。

审查要点：
1. 最终答案是否正确——是否准确回答了题目所问。
2. 每一步推导是否严谨，有无跳步、算错或概念错误。
3. 公式、符号、定理使用是否正确。
4. spokenText 是否与 text 内容一致。
5. 若发现错误，修正 text/spokenText/formula 等字段；若无错误，原样输出。
6. 必须完整保留 scenes 的 duration（时间轴）和每个 block 的 pos（布局），不得省略。

${TOOLS_PROMPT}`,
    `待验证脚本：\n${JSON.stringify(finalData)}`,
    m, llmConfig
  );
  const verifiedData = parseLLMJson(verifyRaw);
  if (Array.isArray(verifiedData?.script?.scenes) && verifiedData.script.scenes.length) {
    finalData = verifiedData;
    console.log('[script] Stage4 答案验证通过');
  } else {
    console.log('[script] Stage4 验证输出异常，保留 Stage3 结果');
  }

  // 组装
  if (!finalData.id) finalData.id = `gen-${Date.now()}`;
  finalData.type = 'general';

  // 把 image 块的 imageRef 替换为实际抠图 URL，并带上抠图宽高比（渲染端按比例显示，不依赖 LLM 的 pos.h）
  const figuresMap = new Map<string, { url: string; ratio?: number }>();
  for (const f of figures || []) {
    if (f?.id && f?.url) figuresMap.set(f.id, { url: f.url, ratio: typeof f.ratio === 'number' ? f.ratio : undefined });
  }
  for (const scene of (finalData.script?.scenes || []) as Array<{ blocks?: Array<{ type?: string; imageRef?: string; imageUrl?: string; imageRatio?: number }> }>) {
    for (const block of scene.blocks || []) {
      if (block.type === 'image' && block.imageRef) {
        const entry = figuresMap.get(block.imageRef);
        if (entry) {
          block.imageUrl = entry.url;
          if (entry.ratio) block.imageRatio = entry.ratio;
        }
      }
    }
  }

  // TTS：开场 + 各场景配音 + 总结
  const opening = finalData.script?.opening || '';
  const scenes = finalData.script?.scenes || [];
  const summaryTxt = finalData.script?.summary || '';
  const explanationText = scenes.map((s: { spokenText?: string }) => s.spokenText || '').filter(Boolean).join('。');
  const ttsText = [opening, explanationText, summaryTxt].filter(Boolean).join('。');
  console.log(`[script] TTS文本长度=${ttsText.length} opening=${opening.length} steps=${explanationText.length} summary=${summaryTxt.length}`);

  if (ttsText) {
    try {
      const { audioUrl, durationInSeconds, subtitles } = await generateTTS(ttsText, finalData.id, voice, ttsApiKey);
      finalData.audioUrl = audioUrl;
      const fps = 30;
      // 视频时长 = max(配音时长, AI 设计的时间轴总时长) + 尾部 2s
      const scenes2 = finalData.script?.scenes || [];
      const hasDurations = scenes2.length > 0 && scenes2.every((s: { duration?: number }) => typeof s.duration === 'number' && (s.duration as number) > 0);
      const specSeconds = hasDurations ? scenes2.reduce((acc: number, s: { duration?: number }) => acc + (s.duration as number), 0) : 0;
      const videoSeconds = Math.max(durationInSeconds, specSeconds);
      finalData.durationInFrames = Math.ceil(videoSeconds * fps) + (2 * fps);
      console.log(`[script] 视频时长: 配音=${durationInSeconds.toFixed(1)}s AI时间轴=${specSeconds.toFixed(1)}s → 总=${videoSeconds.toFixed(1)}s (${finalData.durationInFrames}帧)`);
      finalData.subtitles = subtitles;
    } catch (ttsError) {
      console.error('Failed to generate TTS, proceeding without audio:', ttsError);
      finalData.durationInFrames = 500;
    }
  } else {
    finalData.durationInFrames = 500;
  }

  return finalData;
}

app.post('/api/parse', async (req, res) => {
  try {
    const { rawText, model, apiKey, baseURL, voice, figures, ocrKey, figureSummary } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: 'Missing rawText' });
    }

    const llmConfig: LLMConfig = {};
    if (apiKey) llmConfig.apiKey = apiKey;
    if (baseURL) llmConfig.baseURL = baseURL;
    const m = model || 'deepseek-chat';
    console.log(`[parse] 全流程开始 model=${m} apiKey=${apiKey ? 'YES' : 'NO'} envKey=${process.env.OPENAI_API_KEY ? 'YES' : 'NO'}`);

    // Stage 1: 分析题目类型
    const analysisRaw = await callLLM(
      `你是一个题目分析专家。分析用户提供的题目，只输出一个 JSON 对象，不要多余文字：
{"title": "题目标题", "topic": "题目类型（如：概率统计/极限/导数/定积分/级数/几何/代数/其他）", "question": "完整题干文本（数学公式用 LaTeX，\\(...\\) 包裹）", "note": "解题思路要点简述（1-2句）"}`,
      `用户题目：\n${rawText}`,
      m, llmConfig
    );
    const analysis = parseLLMJson(analysisRaw);
    console.log(`[parse] Stage1 分析完成 topic=${analysis.topic || 'N/A'} title=${analysis.title || 'N/A'}`);

    const finalData = await generateVideoScript(analysis, figures || [], figureSummary || '', m, llmConfig, voice, ocrKey);
    console.log(`[parse] 全流程完成 steps=${Array.isArray(finalData.script?.scenes) ? finalData.script.scenes.length : 'N/A'} audio=${finalData.audioUrl ? 'YES' : 'NO'}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ final: finalData })}\n\n`);
    res.end();
  } catch (error) {
    console.error('API Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error occurred during parsing'
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' })}\n\n`);
      res.end();
    }
  }
});

// 断点续跑：只从文案生成处重跑（跳过题目分析，使用用户已编辑的题干）
app.post('/api/generate-script', async (req, res) => {
  try {
    const { title, topic, question, note, figures, figureSummary, model, apiKey, baseURL, voice, ocrKey } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Missing question' });
    }
    const llmConfig: LLMConfig = {};
    if (apiKey) llmConfig.apiKey = apiKey;
    if (baseURL) llmConfig.baseURL = baseURL;
    const m = model || 'deepseek-chat';
    const analysis = { title, topic, question, note };
    console.log(`[generate-script] 从文案处重跑 topic=${topic || 'N/A'}`);

    const finalData = await generateVideoScript(analysis, figures || [], figureSummary || '', m, llmConfig, voice, ocrKey);
    res.json({ final: finalData });
  } catch (error) {
    console.error('generate-script error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '脚本生成失败' });
  }
});

app.post('/api/generate-audio', async (req, res) => {
  try {
    const { id, problemReading, stepsText, explanation, voice, ocrKey } = req.body;
    
    // Construct the full text to be spoken
    let explanationText = '';
    if (stepsText) {
      try {
        const steps = JSON.parse(stepsText);
        if (Array.isArray(steps)) {
          explanationText = steps.map(step => step.spokenText || step.text).join('。');
        }
      } catch {
        console.warn('Failed to parse stepsText, falling back to empty string');
      }
    } else if (explanation) {
      explanationText = Array.isArray(explanation) ? (explanation as string[]).join('。') : (explanation as string);
    }
    
    const ttsText = (problemReading ? problemReading + '。' : '') + explanationText;
    
    if (!ttsText) {
      return res.status(400).json({ error: 'No text provided for audio generation' });
    }

    const problemId = id || Date.now().toString();
    console.log('Generating TTS manually...');
    
    const { audioUrl, durationInSeconds, subtitles } = await generateTTS(ttsText, problemId, voice, ocrKey);

    const fps = 30;
    const durationInFrames = Math.ceil(durationInSeconds * fps) + (2 * fps);

    res.json({
      audioUrl,
      durationInFrames,
      subtitles,
    });

  } catch (error) {
    console.error('API Error during manual audio generation:', error);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

app.post('/api/export', async (req, res) => {
  try {
    const { videoData, showWatermark } = req.body;
    if (!videoData) {
      return res.status(400).json({ error: 'Missing videoData' });
    }

    const taskId = `${videoData.id || 'unknown'}_${Date.now()}`;
    exportQueue.addTask(taskId, videoData, !!showWatermark);

    // Immediately respond that export has started
    res.json({ 
      message: 'Export started successfully.',
      taskId
    });

  } catch (error) {
    console.error('API Error during export:', error);
    res.status(500).json({ error: 'Failed to start export process' });
  }
});

app.get('/api/export/status/:id', (req, res) => {
  const taskId = req.params.id;
  const task = exportQueue.getTask(taskId);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json(task);
});

app.get('/api/export/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // strip any directory components
  const outDir = path.resolve(DATA_DIR, 'out');
  const filePath = path.resolve(outDir, filename);

  // Ensure the resolved path is still inside the out/ directory
  if (!filePath.startsWith(outDir + path.sep) && filePath !== outDir) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading file' });
      }
    }
  });
});

// Serve Remotion bundle files at root level so the bundle HTML's
// root-relative asset references (/bundle.js, /*.wasm) resolve correctly
// during export rendering.
if (fs.existsSync(remotionBundleDir)) {
  app.use(express.static(remotionBundleDir));
}

// SPA fallback — must be after all API routes and static mounts
if (fs.existsSync(distPath)) {
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

function startServer(port: number, retriesLeft = 5, isFallback = false) {
  const server = app.listen(port, () => {
    const mode = fs.existsSync(distPath) ? 'production' : 'development';
    const actualPort = (server.address() as { port: number }).port;
    process.env.PORT = String(actualPort);
    if (actualPort !== 3001) {
      console.warn(`Port 3001 was occupied, bound to http://localhost:${actualPort}`);
    }
    console.log(`Server running at http://localhost:${actualPort} [${mode}]`);
    if (fs.existsSync(distPath)) {
      console.log(`Open http://localhost:${actualPort} in your browser`);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      if (retriesLeft > 0) {
        console.warn(`Port ${port} is in use, trying ${port + 1} (${retriesLeft} retries left)...`);
        server.close();
        startServer(port + 1, retriesLeft - 1, true);
      } else {
        // Last resort: let the OS assign a random free port
        console.warn('No preferred port available, falling back to random port...');
        server.close();
        startServer(0, 0, true);
      }
    } else {
      throw err;
    }
  });
}

startServer(preferredPort);
