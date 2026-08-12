import React from 'react';
import { Block } from '../../types/problem';
import { BlockTheme } from './theme';

// 控件注册表：新增学科控件只需写一个组件 + registerControl 注册，
// 不用改 MathTemplate 的分发逻辑。借鉴 TheoremExplainAgent 的扩展层思想。

export interface ControlContext {
  block: Block;
  theme: BlockTheme;
  progress: number;      // 0-1 场景内推进进度（控制动画/高亮）
  index: number;         // 块在场景中的序号（0 起）
  isDark: boolean;
  width: number;         // 视频画布宽（px）
  height: number;        // 视频画布高（px）
  prevPlot: Block | null; // 上个场景的 plot 块（用于图形过渡）
}

export type ControlRenderer = (ctx: ControlContext) => React.ReactNode | null;

export interface ControlDefinition {
  type: string;
  render: ControlRenderer;
}

const registry = new Map<string, ControlDefinition>();

export function registerControl(def: ControlDefinition): void {
  registry.set(def.type, def);
}

export function getControl(type: string): ControlDefinition | undefined {
  return registry.get(type);
}

export function getAllControlTypes(): string[] {
  return Array.from(registry.keys());
}
