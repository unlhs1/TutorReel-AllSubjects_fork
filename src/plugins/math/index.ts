import React from 'react';
import { Sigma } from 'lucide-react';
import { ContentTypePlugin, TemplateProps } from '../types';
import { buildMathSystemPrompt } from './prompt';
import { MathEditor } from '../../components/editor/MathEditor';
import { MathTemplate } from '../../templates/MathTemplate';
import { MathProblemData } from '../../types/problem';

const defaultTheme = {
  background: '#0f0f11',
  cardBg: '#18181b',
  textPrimary: '#f4f4f5',
  textSecondary: '#71717a',
  accent: '#22B8CF',
  borderColor: '#27272a',
  codeFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const MathTemplateAdapter: React.FC<TemplateProps> = ({ data, isDark }) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  React.createElement(MathTemplate, { data: data as any, isDark });

export const mathPlugin: ContentTypePlugin = {
  id: 'math',
  displayName: '数学题解',
  Icon: Sigma,
  buildSystemPrompt: () => buildMathSystemPrompt(),
  parseResponse: (raw: string): MathProblemData => {
    const parsed = JSON.parse(raw) as MathProblemData;
    if (!parsed.id) parsed.id = `math-${Date.now()}`;
    return parsed;
  },
  EditorComponent: MathEditor,
  defaultTemplateId: 'default',
  templates: [
    {
      id: 'default',
      name: '默认',
      theme: defaultTheme,
      Component: MathTemplateAdapter,
    },
  ],
};
