import { AnyProblemData } from '../types/problem';
import { exportVideo } from './export';

export type ExportStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ExportTask {
  id: string;
  status: ExportStatus;
  progress: number;
  outputUrl?: string;
  outputPath?: string; // MP4 绝对路径（渲染完成后，供前端展示/打开文件夹）
  error?: string;
}

class ExportQueue {
  private tasks: Map<string, ExportTask> = new Map();
  private queue: Array<{ taskId: string; videoData: AnyProblemData; showWatermark: boolean }> = [];
  private running = 0;
  private readonly MAX_CONCURRENT = 2; // 避免并发渲染吃满 CPU/内存

  addTask(taskId: string, videoData: AnyProblemData, showWatermark = false): ExportTask {
    const existing = this.tasks.get(taskId);
    // 同一 taskId 已在处理/排队：不重复（避免两路写同一输出文件）
    if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
      return existing;
    }
    const task: ExportTask = {
      id: taskId,
      status: 'pending',
      progress: 0,
    };
    this.tasks.set(taskId, task);
    this.queue.push({ taskId, videoData, showWatermark });
    this.pump();
    return task;
  }

  getTask(taskId: string): ExportTask | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(taskId: string, updates: Partial<ExportTask>) {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, ...updates });
    }
  }

  private pump(): void {
    while (this.running < this.MAX_CONCURRENT && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.running++;
      this.processTask(next.taskId, next.videoData, next.showWatermark)
        .finally(() => { this.running--; this.pump(); });
    }
  }

  private async processTask(taskId: string, videoData: AnyProblemData, showWatermark: boolean): Promise<void> {
    this.updateTask(taskId, { status: 'processing', progress: 0 });

    const outputFilename = `export_${taskId}`;

    try {
      const outputFile = await exportVideo(videoData, outputFilename, (progress) => {
        this.updateTask(taskId, { progress });
      }, showWatermark);

      this.updateTask(taskId, {
        status: 'done',
        progress: 1,
        outputUrl: `/api/export/download/${outputFilename}.mp4`,
        outputPath: outputFile,
      });
    } catch (error) {
      this.updateTask(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const exportQueue = new ExportQueue();
