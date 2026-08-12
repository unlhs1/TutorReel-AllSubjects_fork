import React from 'react';
import { BookOpen } from 'lucide-react';
import { ContentTypePlugin, TemplateProps } from '../types';
import { GeneralEditor } from '../../components/editor/GeneralEditor';
import { MathTemplate } from '../../templates/MathTemplate';
import { GeneralProblemData } from '../../types/problem';

const defaultTheme = {
  background: '#0f0f11',
  cardBg: '#18181b',
  textPrimary: '#f4f4f5',
  textSecondary: '#71717a',
  accent: '#22B8CF',
  borderColor: '#27272a',
  codeFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const GeneralTemplateAdapter: React.FC<TemplateProps> = ({ data, isDark }) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  React.createElement(MathTemplate, { data: data as any, isDark });

export const generalPlugin: ContentTypePlugin = {
  id: 'general',
  displayName: '通用题解',
  Icon: BookOpen,
  // 多阶段流水线在 server 端完成，前端无需 systemPrompt
  buildSystemPrompt: () => '',
  parseResponse: (raw: string): GeneralProblemData => {
    const parsed = JSON.parse(raw) as GeneralProblemData;
    if (!parsed.id) parsed.id = `gen-${Date.now()}`;
    return parsed;
  },
  EditorComponent: GeneralEditor,
  defaultTemplateId: 'default',
  templates: [
    {
      id: 'default',
      name: '默认',
      theme: defaultTheme,
      Component: GeneralTemplateAdapter,
    },
  ],
};
