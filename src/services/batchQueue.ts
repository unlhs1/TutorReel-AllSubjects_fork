import { AnyProblemData } from '../types/problem';
import { LLMConfig } from './llm';
import { generateVideoScript } from './videoScript';
import { exportQueue } from './exportQueue';

export type BatchTaskStatus = 'pending' | 'parsing' | 'tts' | 'rendering' | 'done' | 'failed';

// 批量任务里的一道学科题（支持文本题与带 OCR 图的题）
export interface BatchItemInput {
  title: string;
  question: string;
  topic?: string;
  figures?: Array<{ id: string; url: string; description?: string; ratio?: number }>;
  figureSummary?: string;
}

export interface BatchItem extends BatchItemInput {
  id: string;
  status: BatchTaskStatus;
  progress: number; // 0-100 for current step, or just overall
  error?: string;
  videoUrl?: string;
  data?: AnyProblemData;
}

export interface BatchJobConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  voice?: string;
  ocrKey?: string;      // DashScope key（OCR / TTS 回退兜底）
  ttsKey?: string;      // 独立 TTS 回退 key（优先于 ocrKey）
  dashVoice?: string;   // DashScope 回退音色
}

export interface BatchJob {
  id: string;
  items: BatchItem[];
  status: 'running' | 'done' | 'failed';
  createdAt: number;
  llmConfig?: LLMConfig;
  config?: BatchJobConfig;
}

class BatchQueue {
  private jobs: Map<string, BatchJob> = new Map();

  createJob(
    itemsData: BatchItemInput[],
    config?: BatchJobConfig
  ): BatchJob {
    const jobId = `batch_${Date.now()}`;
    const items: BatchItem[] = itemsData.map((item, index) => ({
      id: `${jobId}_item_${index}`,
      title: item.title,
      question: item.question,
      topic: item.topic,
      figures: item.figures,
      figureSummary: item.figureSummary,
      status: 'pending',
      progress: 0,
    }));

    const job: BatchJob = {
      id: jobId,
      items,
      status: 'running',
      createdAt: Date.now(),
      llmConfig: config ? { apiKey: config.apiKey, baseURL: config.baseURL } : undefined,
      config,
    };

    this.jobs.set(jobId, job);
    this.processJob(jobId);
    return job;
  }

  getJob(jobId: string): BatchJob | undefined {
    return this.jobs.get(jobId);
  }

  private updateItemStatus(jobId: string, itemId: string, updates: Partial<BatchItem>) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const itemIndex = job.items.findIndex(i => i.id === itemId);
    if (itemIndex > -1) {
      job.items[itemIndex] = { ...job.items[itemIndex], ...updates };
      this.jobs.set(jobId, job);
    }
  }

  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    for (const item of job.items) {
      try {
        await this.processItem(jobId, item);
      } catch (error) {
        console.error(`Error processing batch item ${item.id}:`, error);
        this.updateItemStatus(jobId, item.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    job.status = 'done';
    this.jobs.set(jobId, job);
    this.scheduleCleanup(jobId);
  }

  // 完成后 30 分钟从内存清理，避免 job（含完整视频数据）长期泄漏
  private scheduleCleanup(jobId: string): void {
    setTimeout(() => {
      if (this.jobs.delete(jobId)) {
        console.log(`[batchQueue] job ${jobId} 已清理`);
      }
    }, 30 * 60 * 1000);
  }

  private async processItem(jobId: string, item: BatchItem) {
    this.updateItemStatus(jobId, item.id, { status: 'parsing', progress: 10 });

    // 1. 走通用学科流水线：Stage2 初稿 → Stage3 审片 → Stage4 验证 → 组装 imageUrl → TTS
    const job = this.jobs.get(jobId);
    const llmConfig: LLMConfig = {};
    if (job?.llmConfig?.apiKey) llmConfig.apiKey = job.llmConfig.apiKey;
    if (job?.llmConfig?.baseURL) llmConfig.baseURL = job.llmConfig.baseURL;

    const analysis = { title: item.title, topic: item.topic || '', question: item.question };
    const ttsApiKey = job?.config?.ttsKey || job?.config?.ocrKey;
    const finalData = await generateVideoScript(
      analysis,
      item.figures || [],
      item.figureSummary || '',
      job?.config?.model ?? 'deepseek-v4-flash',
      llmConfig,
      job?.config?.voice,
      ttsApiKey,
      job?.config?.dashVoice,
    );

    finalData.id = item.id;
    if (!finalData.title) finalData.title = item.title;
    if (!finalData.question) finalData.question = item.question;

    // 2. Rendering（等待 exportQueue）
    this.updateItemStatus(jobId, item.id, { status: 'rendering', progress: 60, data: finalData });
    exportQueue.addTask(item.id, finalData);

    // Poll for export completion (max 5-minute timeout)
    const MAX_POLL_MS = 300_000;
    const pollStart = Date.now();
    await new Promise<void>((resolve, reject) => {
      const interval = setInterval(() => {
        const status = exportQueue.getTask(item.id);
        if (!status) {
          clearInterval(interval);
          reject(new Error('Export task not found'));
          return;
        }

        if (Date.now() - pollStart > MAX_POLL_MS) {
          clearInterval(interval);
          reject(new Error('Export timed out after 5 minutes'));
          return;
        }

        if (status.status === 'processing') {
          // Map 0-1 to 60-99
          const renderProgress = 60 + Math.floor(status.progress * 39);
          this.updateItemStatus(jobId, item.id, { progress: renderProgress });
        } else if (status.status === 'done') {
          clearInterval(interval);
          this.updateItemStatus(jobId, item.id, {
            status: 'done',
            progress: 100,
            videoUrl: status.outputUrl
          });
          resolve();
        } else if (status.status === 'failed') {
          clearInterval(interval);
          reject(new Error(status.error || 'Render failed'));
        }
      }, 1000);
    });
  }
}

export const batchQueue = new BatchQueue();
