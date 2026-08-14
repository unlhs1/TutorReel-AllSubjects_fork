# TutorReel — AI 题目讲解视频生成工具

上传题目图片或粘贴题目文字，AI 自动生成带图解、公式推导和配音的讲解短视频，一键导出 MP4。面向理工科各学科（数学 / 物理 / 化学 / 计算机 / 统计）的期末题、经典题讲解。

> 本仓库 fork 自 [lightCode1840/TutorReel](https://github.com/lightCode1840/TutorReel)，在原项目基础上做了深度改造（见下文），在此感谢原作者的开源贡献。

## 核心特性

- **多阶段生成流水线** — 题目分析 → 讲解初稿 → 审片修正 → 答案验证 → TTS 配音 → 视频组装，全自动
- **预置美工控件库（20+ 控件）** — AI 从精心设计的控件中自由组合排版，不发明样式：
  - 通用：题干卡 / 要点卡 / 台词条 / 提示条 / 结论横幅 / 公式卡 / 公式推导 / 流程箭头 / 完整作答卡 / 表格卡
  - 学科专属：受力分析图（物理）、电路图（物理）、分子结构（化学）、数组 / 树 / 图（计算机）、函数曲线 / 柱状图（数学）
- **多学科兼容** — 按学科自动选择合适控件（数学用曲线图、物理用受力/电路、化学用分子结构、CS 用数据结构）
- **PPT 式自由布局** — 整个画面是一张自由画布，AI 自主摆放每个控件，无固定分区
- **时间轴驱动** — AI 在脚本中设计每个场景的时长（duration），系统按时间轴生成视频
- **题目解析风主线** — 像老师黑板讲题：题目分析 → 做一步写一步 → 完整作答 → 总结，非产品宣传片风格
- **OCR 抠图** — 通义千问 VL 识别题目图片，自动裁剪题目自带插图供视频引用
- **TTS 双后端** — edge-tts（免费）优先，失败自动回退 DashScope CosyVoice（国内稳定）
- **内容可编辑** — 生成的场景脚本 JSON 支持手动调整，改题干只重跑文案

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React + Vite + Tailwind CSS |
| 视频引擎 | Remotion |
| 桌面壳 | Electron |
| 后端服务 | Express.js + Node.js |
| AI 接口 | OpenAI 兼容协议（DeepSeek / GPT / Qwen） |
| 视觉识别 | 通义千问 VL（DashScope） |
| TTS 引擎 | edge-tts + DashScope CosyVoice |

## 快速开始

> 详细部署文档见仓库根目录的 [`部署方法.txt`](./部署方法.txt)——写给任何 AI Agent 或开发者，按顺序照做即可完成部署、启动、验证。

### 前置要求

- Node.js 20+（推荐 20.19+）
- Microsoft Edge 浏览器（Remotion 渲染视频帧需要）
- 两个 API Key：DeepSeek（必需）、DashScope 通义千问（OCR 识别 + TTS 兜底，建议填）

### 安装与运行（开发模式）

```bash
# 获取代码
git clone https://github.com/unlhs1/TutorReel-AllSubjects_fork.git
cd TutorReel-AllSubjects_fork

# 安装依赖
npm install

# 配置 API Key
cp .env.example .env
# 编辑 .env：
#   OPENAI_API_KEY    = DeepSeek 的 API Key（文本生成，必需）
#   DASHSCOPE_API_KEY = 通义千问的 API Key（OCR 识别 + TTS 兜底，可选）

# 启动开发模式（Express + Vite）
npm run dev
```

浏览器打开 **http://localhost:5173**（或控制台提示的地址）。

### 使用流程

1. 上传带解析的题目图片，或直接粘贴题目文字
2. 选择音色（可选，默认用 DeepSeek 生成脚本后自动配音）
3. 点击「生成」→ AI 走完 4 段流水线生成讲解脚本并配音
4. 预览、微调脚本，导出 MP4

> 导出的 MP4 保存在项目 `out/` 目录。

## 桌面应用

```bash
npm run dist:win   # → dist-app/*.exe
npm run dist:mac   # → dist-app/*.dmg
```

## 项目结构概览

```
src/
├── plugins/general/      # 通用题型插件（图片/文字 → 讲解脚本）
├── components/
│   ├── blocks/           # 预置美工控件库（注册表 + 各学科控件）
│   │   ├── registry.ts   # 控件注册表（新增控件只需注册一行）
│   │   ├── theme.ts      # 调色板 + 公式渲染/缩放工具
│   │   ├── QuestionCard / TitleCard / KeyPointCard / NoteCard /
│   │   │   ConclusionCard / FormulaCard / FormulaSteps / CaptionCard /
│   │   │   FlowCard / AnswerSheet / TableCard
│   │   └── ArrayVisual / TreeVisual / GraphVisual / ForceDiagram /
│   │       MoleculeDiagram / CircuitDiagram     # 学科专属可视化
│   ├── visualizers/      # 函数曲线 / 柱状图
│   ├── editor/           # 通用编辑器
│   └── ui/               # 通用 UI 组件
├── templates/            # Remotion 视频模板
│   └── MathTemplate.tsx  # 自由布局 + 控件分发 + 时间轴驱动
├── services/             # LLM / TTS / OCR / export
├── tools/                # LLM 工具规范（visual-spec / json-schema / spoken-guide）
└── types/problem.ts      # 数据模型（控件类型 / 场景 / 时间轴）
```

## Contributors

- [lightCode1840](https://github.com/lightCode1840) — 原 TutorReel 项目作者，本仓库 fork 自其项目
- [DeepSeek](https://www.deepseek.com/) — 本项目讲解脚本、审片与答案验证由 DeepSeek 大模型驱动

## License

MIT。本仓库 fork 自 [lightCode1840/TutorReel](https://github.com/lightCode1840/TutorReel)，版权与致谢归原作者所有。
