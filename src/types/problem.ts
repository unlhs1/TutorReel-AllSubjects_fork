export type ProblemType = 'grammar' | 'java_interview' | 'leetcode' | 'math' | 'general';

export interface BaseProblemData {
  id: string;
  type: ProblemType;
  title: string;
  durationInFrames?: number;
  audioUrl?: string;
  templateId?: string;
  subtitles?: import('../plugins/types').SubtitleSegment[];
}

export interface GrammarProblemData extends BaseProblemData {
  type: 'grammar';
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface GraphNode {
  id: string;           // 节点唯一ID，如 "A"
  label: string;        // 节点显示的文字，如 "Client"
  type?: 'default' | 'highlight' | 'secondary';
  x?: number;           // 0-100 相对 X 坐标 (可选)
  y?: number;           // 0-100 相对 Y 坐标 (可选)
}

export interface GraphEdge {
  from: string;         // 起始节点 ID
  to: string;           // 目标节点 ID
  label?: string;       // 连线上的文字，如 "extends"
  dashed?: boolean;     // 是否是虚线
}

export interface GraphStep {
  text: string;         // 对应当前步骤的讲解文案片段
  activeNodes?: string[];// 当前步骤需要高亮的节点 ID 数组
  activeEdges?: Array<{from: string, to: string}>; // 当前步骤高亮的连线
}

export interface GraphData {
  layout: 'horizontal' | 'vertical' | 'free'; 
  nodes: GraphNode[];
  edges: GraphEdge[];
  steps: GraphStep[];   // 动画序列
}

export interface ComparisonData {
  headers: string[]; // 表头，例如 ["特性", "ArrayList", "LinkedList"]
  rows: string[][]; // 表格行，例如 [["底层数据结构", "动态数组", "双向链表"], ["随机访问", "O(1)", "O(n)"]]
  steps: {
    text: string;
    activeRows: number[]; // 当前步骤高亮的行索引（0-indexed）
  }[];
}

export interface TimelineData {
  events: {
    title: string; // 阶段名称，例如 "实例化"
    description: string; // 阶段描述
  }[];
  steps: {
    text: string;
    activeEvents: number[]; // 当前步骤高亮的事件索引（0-indexed）
  }[];
}

export interface InterviewTips {
  commonMistake?: string;   // 常见错误
  followUp?: string;         // 可能的面试追问
  realWorld?: string;        // 实际应用场景
}

export interface JavaInterviewProblemData extends BaseProblemData {
  type: 'java_interview';
  question: string;
  keyPoints: string[];
  visualIcon?: string; // 保留 Emoji 作为基础兜底
  graphData?: GraphData; // 结构图解数据
  comparisonData?: ComparisonData; // 表格对比数据
  timelineData?: TimelineData; // 时间轴/流程数据
  explanation: string | string[]; // 单段文本 或 分段数组（新格式推荐用数组）
  interviewTips?: InterviewTips;  // 面试实战拓展
  oneLiner?: string;              // 一句话金句总结
}

export interface AnimationStructure {
  id: string; // 唯一标识符，例如 "tree1", "queue1"
  type: 'array' | 'tree' | 'linkedlist' | 'grid';
  data: unknown[]; // Array elements or tree serialized data
  pointers?: Record<string, number>; // Maps pointer names (e.g., 'left', 'i') to array indices
  highlights?: number[]; // Indices of elements to highlight
}

export interface AnimationState {
  structures: AnimationStructure[]; // 支持同时渲染多个数据结构（如树 + 优先队列）
}

export interface ProblemStep {
  text: string; // The explanation text for this step
  state: AnimationState; // The visual state for this step
  codeLines?: number[]; // Indices of the code lines to highlight (0-indexed)
}

export interface VideoStyleConfig {
  layoutSplit: number; // Percentage for the left pane (e.g., 35)
  codeFontSize: string; // Tailwind text size classes (e.g., 'text-sm', 'text-base', 'text-lg')
  textFontWeight: string; // Tailwind font weight classes (e.g., 'font-normal', 'font-medium', 'font-bold')
}

export interface ApproachOverview {
  methodName: string;         // 如 "双指针法", "动态规划"
  coreInsight: string;         // 核心洞察，一句话
  whyBetter?: string;           // 为何优于暴力解（可选）
}

export interface Complexity {
  timeComplexity: string;       // 如 "O(n)"
  spaceComplexity: string;      // 如 "O(1)"
  briefExplanation: string;     // 口语化解释
}

export interface LeetCodeProblemData extends BaseProblemData {
  type: 'leetcode';
  description: string;
  codeSnippet: string;
  language: string;
  problemReading: string;        // Phase 1: 读题部分的配音文案
  approachOverview?: ApproachOverview;  // Phase 2: 思路解析
  steps: ProblemStep[];          // Phase 3: 分步推演
  complexity?: Complexity;       // Phase 4: 复杂度分析
  summary?: string;              // Phase 5: 总结回顾
  explanation?: string;          // 保留可选字段，兼容旧数据
  styleConfig?: VideoStyleConfig; // 视频展示样式配置
}

// ─── Math (高等数学) ───────────────────────────────────────────────

export interface MathPlotState {
  fx: string | null;                 // 函数表达式，如 "sin(x)/x"，null 表示本步无曲线
  xRange: [number, number];          // x 取值范围
  yRange: [number, number];          // y 取值范围
  highlightX?: number | null;        // 重点标注的 x 值（极限点/切点）
  points?: Array<[number, number]>;  // 需要标出的特殊点
  annotations?: string[];            // 屏幕叠加标注文字
}

export interface MathStep {
  text: string;                      // 该步讲解文字（屏幕显示）
  spokenText?: string;               // TTS 口语化逐字稿
  plot?: MathPlotState;              // 函数曲线动画状态
  formula?: string;                  // 该步重点 LaTeX 公式
}

export interface MathProblemData extends BaseProblemData {
  type: 'math';
  title: string;
  knowledgePoint: string;            // 考点
  question: string;                  // 题干（含 LaTeX）
  problemReading?: string;           // 读题配音文案
  steps: MathStep[];                 // 分步推导
  summary?: string;                  // 总结
}

// ─── General（通用题目，LLM 自动判断题型，PPT 式自由排版） ────────

// 预置美工控件类型：AI 不发明样式，只从控件库里选择组合。
// text/formula/plot/bar/image 为兼容旧数据的通用类型，其余为预置美工控件。
export type BlockType =
  | 'text' | 'formula' | 'plot' | 'bar' | 'image'
  | 'question-card'   // 题干卡：topic 标签 + 标题 + 完整题干
  | 'title-card'      // 大标题卡：topic 标签 + 大标题 + 副标题
  | 'keypoint'        // 要点卡：编号徽章 + 标题 + 一句话
  | 'note'            // 提示条：accent 竖线 + 提示文字
  | 'conclusion'      // 结论横幅：accent 渐变底 + 大结论
  | 'formula-card'    // 公式卡：大号公式 + 强调顶部条
  | 'formula-steps'   // 公式推导：多行公式逐步推导（自动编号）
  | 'caption'         // 台词条：底部字幕式解说（AI 自由摆放位置）
  | 'flow'            // 流程箭头：步骤1 → 步骤2 → 步骤3
  | 'answer-sheet'    // 完整作答卡：完整解题步骤 + 最终答案（片尾）
  | 'table'           // 表格卡：对比表/性质表（CS 复杂度、化学元素、物理公式汇总等）
  | 'force'           // 受力分析图（物理）：质点 + 力箭头
  | 'circuit'         // 电路图（物理）：串联直流电路元件
  | 'molecule'        // 分子结构图（化学）：原子 + 化学键
  | 'array'           // 数组可视化（CS）：值格 + 下标 + 高亮
  | 'tree'            // 树可视化（CS/数学）：自动分层布局
  | 'graph';          // 图/网状可视化（CS/图论）：圆形布局

// 元素块：像 PPT 里的预置控件框，LLM 自由决定用哪些、放哪
export interface Block {
  type: BlockType;
  content?: string;                   // text/formula/formula-card/conclusion/note 的内容（formula 为 LaTeX）
  title?: string;                     // title-card 的大标题 / keypoint 的要点标题
  subtitle?: string;                  // title-card 的副标题
  items?: string[];                   // flow 的步骤名数组 / formula-steps 的 LaTeX 行数组
  fx?: string | null;                 // plot: 函数表达式
  xRange?: [number, number];
  yRange?: [number, number];
  highlightX?: number | null;
  points?: Array<[number, number]>;
  // plot 动态增强（"活起来"动画，Remotion interpolate 驱动，无需 Manim）
  animParam?: { name: string; from: number; to: number };  // 参数动画：fx 里的参数 name 随场景进度从 from 平滑变到 to，曲线形态实时演变
  traceX?: { from: number; to: number };                   // 轨迹点：高亮点沿曲线从 x=from 滑到 x=to（极限逼近/切线滑动演示）
  barData?: number[];                 // bar: 柱高
  labels?: string[];                  // bar: 柱标签
  highlightIndex?: number;
  headers?: string[];                 // table: 表头数组
  rows?: string[][];                  // table: 行数组（每行与表头列数一致）
  highlightRow?: number;              // table: 高亮行下标（0 起），可省
  forces?: Array<{ name: string; angle: number; magnitude: number }>;  // force: 力（angle 度，0=右 逆时针，magnitude 相对大小）
  elements?: Array<{ type: 'battery' | 'resistor' | 'bulb' | 'switch'; label?: string }>; // circuit: 串联元件
  atoms?: Array<{ id: string; element: string }>;   // molecule: 原子节点
  bonds?: Array<{ from: string; to: string; order?: number }>; // molecule: 化学键（order 1单 2双）
  values?: Array<string | number>;    // array: 数组值序列
  highlightIndexes?: number[];        // array: 高亮下标
  nodes?: Array<{ id: string; label: string }>;     // tree/graph: 节点
  edges?: Array<{ from: string; to: string; label?: string; dashed?: boolean }>; // tree/graph: 边
  imageRef?: string;                  // image: 引用题目自带图的 id（如 fig1）
  imageUrl?: string;                  // image: server 抠图后填充的实际 URL
  imageRatio?: number;                // image: 抠图实际宽高比 w/h，渲染时容器高度按 pos.w 像素宽 / ratio 计算
  annotations?: string[];
  pos: { x: number; y: number; w: number; h: number };   // 百分比定位 0-100
  animation?: 'fade' | 'slide-up' | 'zoom' | 'none';     // 入场动画
}

// 场景：相当于 PPT 的一页
export interface Scene {
  text: string;                       // 本帧屏幕主文字（底部讲解）
  spokenText: string;                 // 本帧配音逐字稿
  duration?: number;                  // AI 设计的时间轴：本场景时长（秒），server/渲染按此分配帧区间
  blocks: Block[];                    // 本帧的元素块（自由排版）
}

export interface GeneralScript {
  opening: string;                    // 开场读题
  scenes: Scene[];
  summary: string;
}

export interface GeneralProblemData extends BaseProblemData {
  type: 'general';
  title: string;
  topic: string;                      // LLM 判断的题型
  question: string;
  script: GeneralScript;
}

export type AnyProblemData = GrammarProblemData | JavaInterviewProblemData | LeetCodeProblemData | MathProblemData | GeneralProblemData;
