// 数学三维图形解析器
// 把用户输入（普通表达式 / LaTeX / 几何体命令）转成 mathjs 可求值表达式，
// 判定图形类型（一元函数曲线 / 二元函数曲面 / 几何体），并生成 2D 采样点与 3D 网格。
// 供「数学3D 白板」使用；纯逻辑无副作用，前后端均可 import。
import { create, all } from 'mathjs';

const math = create(all, {});
// mathjs 默认只有 i 虚数单位；j 是电气工程惯例（欧拉形式 e^(jωt)），显式注册为同一虚数单位
try {
  math.import({ j: math.i }, { override: true });
} catch { /* 忽略（旧版本无 import 时不影响 i 用法） */ }

// 常用 mathjs 内置函数/常量名，用于识别自由变量时排除
const BUILTIN = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan',
  'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'log2', 'log10',
  'sqrt', 'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'min',
  'max', 'pow', 'mod', 'gcd', 'lcm', 'pi', 'e', 'phi', 'tau',
  'random', 'norm', 'unit', 'true', 'false', 'NaN', 'Infinity',
  'im', 're', 'conj', 'arg', 'sec', 'csc', 'cot', 'i', 'j',
]);

export type GraphKind = 'curve' | 'surface' | 'solid';
export type SolidType = 'cube' | 'sphere' | 'cylinder';

export interface ParsedGraph {
  kind: GraphKind;
  /** mathjs 可求值表达式（已去掉 y= / z= 前缀） */
  expr: string;
  /** 自由变量（一元→[x] 或 [y]，二元→[x,y]） */
  vars: string[];
  /** 几何体类型 */
  solid?: SolidType;
  /** 用户输入原始形式（展示用） */
  raw: string;
  /** 解析错误信息（解析失败时填充） */
  error?: string;
  /** 复数函数模式：表达式含虚数单位 j，z = x + jy（水平面 Re/Im(z)，纵轴 |f(z)|） */
  isComplex?: boolean;
  /** 纯常数复数表达式（无变量，如 e^(j*pi)+1）——白板直接显示计算结果 */
  isConstExpr?: boolean;
  /** 复数模式下的复变量名（默认 z；宽容处理时可为 ω/theta 等任意单变量） */
  complexVar?: string;
  /** 复值函数螺旋线：实变量 t 扫过、输出为复值（如 e^(j*omega)）→ 3D 曲线 (t, Re f, Im f) */
  isSpiral?: boolean;
}

// ── LaTeX → mathjs 基础转换 ──
// 覆盖教学常见：\frac \sqrt ^ 三角/对数函数 \cdot \times \left\right \pi 等。
// 递归替换花括号分组；嵌套 \frac 也支持。

function findMatchingBrace(s: string, start: number): number {
  // s[start] 应为 '{'，返回配对的 '}' 下标
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return s.length - 1;
}

/** 把单个 LaTeX 片段转成 mathjs（不处理等号/前置变量） */
function latexToMathInner(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      // 命令
      const m = /^[a-zA-Z]+/.exec(s.slice(i + 1));
      if (m) {
        const cmd = m[0];
        const cmdStart = i + 1 + cmd.length;
        // 跳过其后可能的空格
        let j = cmdStart;
        while (j < s.length && /\s/.test(s[j])) j++;
        switch (cmd) {
          case 'frac': {
            // \frac{a}{b} → (a)/(b)
            let a = '', b = '';
            if (s[j] === '{') { const end = findMatchingBrace(s, j); a = latexToMathInner(s.slice(j + 1, end)); j = end + 1; }
            while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '{') { const end = findMatchingBrace(s, j); b = latexToMathInner(s.slice(j + 1, end)); j = end + 1; }
            out += `(${a})/(${b})`;
            i = j;
            continue;
          }
          case 'sqrt': {
            let a = '';
            if (s[j] === '{') { const end = findMatchingBrace(s, j); a = latexToMathInner(s.slice(j + 1, end)); j = end + 1; }
            out += `sqrt(${a})`;
            i = j;
            continue;
          }
          case 'left': case 'right': {
            // \left( \right) → 直接输出括号本身（跳过命令，保留下一字符）
            i = cmdStart;
            continue;
          }
          case 'cdot': case 'times': {
            out += '*';
            i = j;
            continue;
          }
          case 'pi': { out += 'pi'; i = j; continue; }
          case 'ln': { out += 'log'; i = j; continue; }
          case 'log': {
            // 常见 \log_{10} 下标 → log10；\log 默认自然对数（mathjs log）
            if (s[j] === '_') {
              let k = j + 1;
              if (s[k] === '{') { const end = findMatchingBrace(s, k); const base = latexToMathInner(s.slice(k + 1, end)); k = end + 1; out += `log${base === '10' ? '10' : base}`; i = k; continue; }
            }
            out += 'log';
            i = j;
            continue;
          }
          case 'sin': case 'cos': case 'tan': case 'cot':
          case 'asin': case 'acos': case 'atan':
          case 'sinh': case 'cosh': case 'tanh':
          case 'exp': case 'abs': case 'floor': case 'ceil': {
            out += cmd;
            i = j;
            continue;
          }
          case 'mathrm': case 'text': {
            if (s[j] === '{') { const end = findMatchingBrace(s, j); out += s.slice(j + 1, end); i = end + 1; continue; }
            i = j;
            continue;
          }
          default: {
            // 未知命令：跳过
            i = j;
            continue;
          }
        }
      } else {
        // 孤立反斜杠（如 \,）跳过
        i++;
        continue;
      }
    }
    if (c === '{') {
      // 花括号当分组（如 x^{2} 的 {2} 已由 ^ 处理；单独出现当括号）
      const end = findMatchingBrace(s, i);
      out += `(${latexToMathInner(s.slice(i + 1, end))})`;
      i = end + 1;
      continue;
    }
    if (c === '}') { i++; continue; }
    if (c === '^') {
      // 上标：^{...} 或 ^2
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '{') {
        const end = findMatchingBrace(s, j);
        out += `^(${latexToMathInner(s.slice(j + 1, end))})`;
        i = end + 1;
      } else {
        out += '^';
        i = j;
      }
      continue;
    }
    if (c === '_') {
      // 下标：函数下标通常可忽略（如 x_1 是变量名，保留原样）；\log_10 已在 log 处理
      // 这里简单跳过下标整体，避免 mathjs 解析失败
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '{') { const end = findMatchingBrace(s, j); i = end + 1; continue; }
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 公开：LaTeX 转 mathjs 表达式 */
export function latexToMathjs(latex: string): string {
  // 去掉 $ 包裹与首尾空白
  let s = latex.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\(|\\\)$/g, '').trim();
  // 若形如 y=... 或 z=...，只保留右侧（由 parseGraphInput 统一处理，这里只做兜底）
  const eqIdx = s.indexOf('=');
  if (eqIdx > 0) s = s.slice(eqIdx + 1);
  return latexToMathInner(s).trim();
}

// ── 变量检测 ──
// 扫描表达式中出现的标识符，排除 mathjs 内置函数/常量，识别自由变量
// 支持单字母（x/y/z）与多字符小写变量名（如希腊字母映射后的 omega、theta）
function detectVars(expr: string): string[] {
  const tokens = expr.match(/[a-zA-Z][a-zA-Z0-9]*/g) || [];
  const vars = new Set<string>();
  for (const t of tokens) {
    if (!BUILTIN.has(t) && /^[a-z][a-z0-9]*$/.test(t)) vars.add(t);
  }
  return [...vars];
}

// ── 希腊字母 → ASCII 变量名（用户可能直接输入 ω/π/θ 等，mathjs 只认 ASCII）──
// π→pi、τ→tau 是 mathjs 内置常量；其余映射为拉丁变量名；替换时自动补隐式乘法（jω → j*omega）
const GREEK_MAP: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta',
  η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma',
  τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Α: 'alpha', Β: 'beta', Γ: 'gamma', Δ: 'delta', Ε: 'epsilon', Ζ: 'zeta',
  Η: 'eta', Θ: 'theta', Ι: 'iota', Κ: 'kappa', Λ: 'lambda', Μ: 'mu',
  Ν: 'nu', Ξ: 'xi', Ο: 'omicron', Π: 'pi', Ρ: 'rho', Σ: 'sigma',
  Τ: 'tau', Υ: 'upsilon', Φ: 'phi', Χ: 'chi', Ψ: 'psi', Ω: 'omega',
};

export function normalizeGreek(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const lat = GREEK_MAP[c];
    if (lat) {
      const prev = out[out.length - 1];
      // 前面紧邻字母/数字/右括号 → 补 *（隐式乘法：jω → j*omega、2π → 2*pi）
      const needMul = prev !== undefined && /[a-zA-Z0-9)]/.test(prev);
      out += needMul ? '*' + lat : lat;
    } else {
      out += c;
    }
  }
  return out;
}

/** 希腊字母 → 显示名（轴标签等展示用） */
export function displayVar(name: string): string {
  const INV: Record<string, string> = {
    omega: 'ω', theta: 'θ', phi: 'φ', alpha: 'α', beta: 'β', gamma: 'γ',
    delta: 'δ', lambda: 'λ', sigma: 'σ', mu: 'μ', epsilon: 'ε', tau: 'τ', pi: 'π',
  };
  return INV[name] || name;
}

// ── 输入规范化：用户可能输入 y=x^2、z=x^2+y^2、x^2、sin(x)、cube 等 ──
function normalizeInput(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/＝/g, '=');
}

// 提取表达式右侧（y= / z= / f(x)= 等前缀），返回 { body, leftVars }
function splitEquation(s: string): { body: string; left: string } {
  const eqIdx = s.indexOf('=');
  if (eqIdx < 0) return { body: s, left: '' };
  return { body: s.slice(eqIdx + 1).trim(), left: s.slice(0, eqIdx).trim() };
}

// 将表达式转成 mathjs 兼容：处理隐式乘法（2x→2*x、3sin(x)→3*sin(x)、2(x+1)→2*(x+1)）
function fixImplicitMul(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c;
    if (i === s.length - 1) continue;
    const next = s[i + 1];
    // 数字/右括号 后面紧跟 字母或左括号 → 补 *
    const needMul =
      (/\d|\)/.test(c) && /[a-zA-Z(]/.test(next)) ||
      (/\d/.test(c) && next === 'x') ||
      (/\d/.test(c) && next === 'j'); // 2j → 2*j（复数模式）
    // 排除 函数名内部（sin( 已是合法）
    if (needMul) out += '*';
  }
  // 单独处理 e^x、pi*x 等数学常量后的隐式乘法。
  // 坑：`\b(e)(?=[a-zA-Z(])` 会把 exp( / sqrt( 等函数名首字母 e 误判为常量 e → e*xp！
  // 用负向后顾：e 必须是独立常量（前面不是字母），且后面紧跟字母/括号时才补 *。
  // 再排除 e 后紧跟已知函数名片段的情况（exp( / 表达式里 e 后是 'x' 等变量则保留）。
  out = out.replace(/(?<![a-zA-Z0-9])(pi)(?=[a-zA-Z(])/g, '$1*');
  out = out.replace(/(?<![a-zA-Z0-9])(e)(?=(?:x|y|[0-9])(?![a-zA-Z])|\()/g, '$1*');
  return out;
}

// 移除对 mathjs 非法的字符（如大括号残留）
function sanitize(s: string): string {
  return s.replace(/[{}]/g, '').replace(/^[\s*+]+/, '').replace(/[\s*+]+$/, '');
}

const SOLID_ALIASES: Record<string, SolidType> = {
  cube: 'cube', 立方体: 'cube', 正方体: 'cube',
  sphere: 'sphere', 球体: 'sphere', 球: 'sphere',
  cylinder: 'cylinder', 圆柱体: 'cylinder', 圆柱: 'cylinder',
};

/** 主入口：解析用户输入 → 判定图形类型（complexMode：显式「复数坐标」开关，勾选后才按复变函数处理） */
export function parseGraphInput(raw: string, complexMode = false): ParsedGraph {
  const input = normalizeInput(raw);
  if (!input) return { kind: 'curve', expr: '', vars: [], raw, error: '请输入表达式或几何体名称' };

  // 1) 几何体命令（优先）：直接命中
  const solidKey = input.toLowerCase().replace(/^生成|画|显示|创建/, '');
  if (SOLID_ALIASES[solidKey]) {
    return { kind: 'solid', expr: '', vars: [], solid: SOLID_ALIASES[solidKey], raw: input };
  }

  // 2) 拆分等号
  const { body, left } = splitEquation(input);

  // 3) LaTeX → mathjs（若含反斜杠则按 LaTeX 处理）；希腊字母 → ASCII 变量名（ω→omega、π→pi）
  let expr = body;
  if (/\\/.test(expr)) {
    expr = latexToMathjs(expr);
  }
  expr = normalizeGreek(sanitize(fixImplicitMul(expr)));

  if (!expr) return { kind: 'curve', expr: '', vars: [], raw, error: '未解析到有效表达式' };

  // 4) 复数坐标模式（显式开关，不做任何自动判别——i/j 在其他学科可能是电流/下标/普通变量）：
  //    · 无变量：常数复数（如 e^(j*pi)+1）→ 直接显示计算结果
  //    · x/y 两变量：x/y 作为实/虚部（如 x + j*y、x^2+y^2）→ |f(z)| 曲面
  //    · 单变量 z：复变函数（z = x + jy）→ |f(z)| 曲面（色相=相位）
  //    · 单变量非 z 且含 i/j（如 e^(j*omega)）：实变量→复值输出 → 3D 螺旋线 (t, Re f, Im f)
  //    · 单变量非 z 无 i/j（如 sin(omega)）：宽容按复变曲面（变量当 z）
  if (complexMode) {
    const cVars = detectVars(expr).filter(v => v !== 'i' && v !== 'j');
    const hasImagUnit = /(?<![a-zA-Z0-9])(?:i|j)(?![a-zA-Z0-9])/.test(expr);
    if (cVars.length === 0) {
      return { kind: 'surface', expr, vars: [], isComplex: true, isConstExpr: true, raw: input };
    }
    if (cVars.length === 2 && cVars.includes('x') && cVars.includes('y')) {
      return { kind: 'surface', expr, vars: ['x', 'y'], isComplex: true, raw: input };
    }
    if (cVars.length === 1 && cVars[0] === 'z') {
      return { kind: 'surface', expr, vars: ['z'], isComplex: true, raw: input };
    }
    if (cVars.length === 1 && hasImagUnit) {
      return { kind: 'surface', expr, vars: [cVars[0]], isComplex: true, isSpiral: true, complexVar: cVars[0], raw: input };
    }
    if (cVars.length === 1) {
      return { kind: 'surface', expr, vars: [cVars[0]], isComplex: true, complexVar: cVars[0], raw: input };
    }
    return { kind: 'curve', expr, vars: cVars, raw: input, error: '复数坐标模式请用 z（复变量）、x/y（实/虚部）或单变量（如 e^(j*omega) 螺旋线），如 e^z、sin(z)、x + j*y、e^(j*pi)+1' };
  }

  // 5) 判定类型：左值含 z 或表达式变量含 ≥2 个 → 曲面；否则一元曲线
  const leftLower = left.toLowerCase();
  const vars = detectVars(expr);
  // 若左侧明确为 z = → 曲面；否则看自由变量个数
  const isSurface = leftLower.startsWith('z') || vars.length >= 2;

  if (isSurface) {
    return { kind: 'surface', expr, vars: ['x', 'y'], raw: input };
  }
  // 一元曲线：变量取 [x]（若表达式中只有 y，如 y^2，则用 y 作自变量）
  const curveVar = vars.includes('x') ? 'x' : (vars[0] || 'x');
  return { kind: 'curve', expr, vars: [curveVar], raw: input };
}

// ── 自研双变量求值器（x/y），不依赖 mathjs，供 Remotion 视频渲染（webpack bundle 下 mathjs compile 可能失效） ──
// 支持：+ - * / ^ ( ) 常量 pi e，函数 sin cos tan asin acos atan exp log sqrt abs pow，变量 x/y
type BinOp = '+' | '-' | '*' | '/' | '^';
const FUNC_2VAR: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, log: Math.log, sqrt: (v) => Math.sqrt(Math.max(0, v)), abs: Math.abs,
};
const CONST_2VAR: Record<string, number> = { pi: Math.PI, e: Math.E };

// 把表达式 token 化成后缀（Shunting-yard），然后按 (x,y) 求值
function compileTwoVar(expr: string): ((x: number, y: number) => number) | null {
  const s = expr.replace(/\s+/g, '').toLowerCase();
  // 解析成 token 数组
  const toks: Array<{ t: 'num' | 'var' | 'op' | 'func' | 'lp' | 'rp'; v?: number | string }> = [];
  // 判断某个位置的正负号是否是一元（前置为 null/ '(' / 二元运算符）
  const isUnaryAt = (idx: number): boolean => {
    if (idx === 0) return true;
    const p = s[idx - 1];
    return p === '(' || '+-*/^,'.includes(p);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9' || c === '.') {
      let j = i;
      while (j < s.length && (/[0-9.]/.test(s[j]))) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === 'x' || c === 'y') { toks.push({ t: 'var', v: c }); i++; continue; }
    if ('+-*/^()'.includes(c)) {
      // 一元正负号：注入 0 作为左操作数（-x → 0-x）
      if ((c === '-' || c === '+') && isUnaryAt(i)) {
        toks.push({ t: 'num', v: 0 });
        toks.push({ t: 'op', v: c as BinOp });
        i++;
        continue;
      }
      if (c === '(') toks.push({ t: 'lp' });
      else if (c === ')') toks.push({ t: 'rp' });
      else toks.push({ t: 'op', v: c as BinOp });
      i++;
      continue;
    }
    // 函数名/常量（最长匹配）
    const word = s.slice(i).match(/^[a-z]+/);
    if (word) {
      const w = word[0];
      if (FUNC_2VAR[w]) { toks.push({ t: 'func', v: w }); i += w.length; continue; }
      if (CONST_2VAR[w]) { toks.push({ t: 'num', v: CONST_2VAR[w] }); i += w.length; continue; }
      return null; // 未知函数
    }
    return null;
  }

  // Shunting-yard → RPN
  const out: Array<typeof toks[number]> = [];
  const stack: Array<typeof toks[number]> = [];
  const prec: Record<string, number> = { '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };
  for (const tok of toks) {
    if (tok.t === 'num' || tok.t === 'var') { out.push(tok); continue; }
    if (tok.t === 'func') { stack.push(tok); continue; }
    if (tok.t === 'lp') { stack.push(tok); continue; }
    if (tok.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop()!);
      stack.pop(); // 弹 lp
      if (stack.length && stack[stack.length - 1].t === 'func') out.push(stack.pop()!);
      continue;
    }
    // op
    const p = prec[tok.v as string];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.t === 'lp' || top.t === 'func') break;
      const topP = prec[top.v as string];
      if (topP >= p) out.push(stack.pop()!);
      else break;
    }
    stack.push(tok);
  }
  while (stack.length) out.push(stack.pop()!);

  // 求值
  return (x, y) => {
    const st: number[] = [];
    for (const tok of out) {
      if (tok.t === 'num') { st.push(tok.v as number); continue; }
      if (tok.t === 'var') { st.push(tok.v === 'x' ? x : y); continue; }
      if (tok.t === 'func') {
        const a = st.pop();
        if (a === undefined) return NaN;
        st.push(FUNC_2VAR[tok.v as string](a));
        continue;
      }
      // op
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return NaN;
      switch (tok.v) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/': st.push(b === 0 ? NaN : a / b); break;
        case '^': st.push(Math.pow(a, b)); break;
        default: return NaN;
      }
    }
    return st[st.length - 1];
  };
}

/** 编译二元曲面表达式（不依赖 mathjs，Remotion bundle 安全），返回 f(x,y) 或 null */
export function compileSurfaceExpr(expr: string): ((x: number, y: number) => number | null) | null {
  const f = compileTwoVar(expr);
  if (!f) return null;
  return (x, y) => {
    const v = f(x, y);
    return isFinite(v) ? v : null;
  };
}

// 尝试编译表达式，返回编译函数或 null（校验语法）
export function compileExpr(expr: string): ((scope: Record<string, number>) => number | null) | null {
  try {
    const node = math.compile(expr);
    return (scope) => {
      try {
        const v = node.evaluate({ ...scope });
        const n = typeof v === 'number' ? v : Number(v);
        return isFinite(n) ? n : null;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

// ── 复数求值（复数函数模式）：w = f(z)，z = x + jy ──
// mathjs 原生支持复数（create(all) 内置 Complex / 虚数单位 i、j），这里封装复数编译与求值
export interface ComplexVal { re: number; im: number; }

/** 编译复数表达式（复数坐标模式），返回 (zRe, zIm) => { re, im } | null
 *  scope：z = x + jy（复变量），同时提供 x/y 实数（实/虚部），支持 e^z、sin(z)、x + j*y 等写法 */
export function compileComplexExpr(expr: string): ((zRe: number, zIm: number) => ComplexVal | null) | null {
  try {
    const node = math.compile(expr);
    return (zRe, zIm) => {
      try {
        const v = node.evaluate({ z: math.complex(zRe, zIm), x: zRe, y: zIm } as Record<string, unknown>);
        return toComplexVal(v);
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

/** 编译复值函数（螺旋线）：实变量 t → 复值 w（如 e^(j*omega)），返回 t => { re, im } | null */
export function compileComplexValued(expr: string, varName: string): ((t: number) => ComplexVal | null) | null {
  try {
    const node = math.compile(expr);
    return (t) => {
      try {
        const scope: Record<string, unknown> = { x: t, y: 0 };
        scope[varName] = t;
        const v = node.evaluate(scope);
        return toComplexVal(v);
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

/** 编译并求值无变量的常数复数表达式（如 e^(j*pi)+1） */
export function compileConstComplex(expr: string): ComplexVal | null {
  try {
    const node = math.compile(expr);
    const v = node.evaluate({});
    return toComplexVal(v);
  } catch {
    return null;
  }
}

function toComplexVal(v: unknown): ComplexVal | null {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (v && typeof v === 'object' && 're' in v && 'im' in v) {
    const re = (v as { re: unknown }).re, im = (v as { im: unknown }).im;
    if (typeof re === 'number' && typeof im === 'number') return { re, im };
  }
  return null;
}

/** 复数格式化：0 / 纯实数 / 纯虚数 / 一般（如 -1、2j、-1+2j） */
export function formatComplex(v: ComplexVal): string {
  const { re, im } = v;
  if (!isFinite(re) || !isFinite(im)) return '∞（不收敛）';
  const fmt = (n: number): string => {
    const a = Math.abs(n);
    if (a < 1e-9) return '0';
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  };
  if (Math.abs(re) < 1e-9 && Math.abs(im) < 1e-9) return '0';
  if (Math.abs(im) < 1e-9) return fmt(re);
  const imPart = `${im < 0 ? '-' : '+'}${fmt(Math.abs(im))}j`;
  if (Math.abs(re) < 1e-9) return imPart[0] === '+' ? imPart.slice(1) : imPart;
  return `${fmt(re)}${imPart}`;
}

// ── 2D 曲线采样 ──
// 返回采样点（NaN 表示不连续断点）；不抛异常
export function sampleCurve2D(
  expr: string,
  variable: string,
  range: [number, number],
  samples = 240,
): Array<[number, number]> {
  const f = compileExpr(expr);
  if (!f) return [];
  const pts: Array<[number, number]> = [];
  const [a, b] = range;
  if (!isFinite(a) || !isFinite(b) || b <= a) return pts;
  for (let i = 0; i <= samples; i++) {
    const v = a + ((b - a) * i) / samples;
    const y = f({ [variable]: v } as Record<string, number>);
    pts.push([v, y === null ? NaN : y]);
  }
  return pts;
}

// ── 3D 曲面网格 ──
// 返回 { positions: Float32Array(x,y,z 交错), index: Uint32Array, bounds: [x0,x1,y0,y1,zMin,zMax] }
// 通过 evalAt 回调（由调用方传入 compileExpr 的结果）避免重复编译
export interface SurfaceMesh {
  positions: Float32Array;
  index: Uint32Array;
  bounds: [number, number, number, number, number, number];
  width: number;
  height: number;
}

export function buildSurfaceMesh(
  evalFn: (x: number, y: number) => number | null,
  xRange: [number, number],
  yRange: [number, number],
  segments = 60,
): SurfaceMesh {
  const [x0, x1] = xRange;
  const [y0, y1] = yRange;
  const w = segments;
  const h = segments;
  const positions = new Float32Array((w + 1) * (h + 1) * 3);
  const index = new Uint32Array(w * h * 6);
  let zMin = Infinity, zMax = -Infinity;

  for (let iy = 0; iy <= h; iy++) {
    const y = y0 + ((y1 - y0) * iy) / h;
    for (let ix = 0; ix <= w; ix++) {
      const x = x0 + ((x1 - x0) * ix) / w;
      const z = evalFn(x, y);
      const zz = z === null ? 0 : z;
      if (z !== null) { if (zz < zMin) zMin = zz; if (zz > zMax) zMax = zz; }
      const p = (iy * (w + 1) + ix) * 3;
      positions[p] = x;
      positions[p + 1] = zz;
      positions[p + 2] = y;
    }
  }
  // 网格索引（CCW）
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const a = iy * (w + 1) + ix;
      const b = a + 1;
      const c = a + (w + 1);
      const d = c + 1;
      const o = (iy * w + ix) * 6;
      index[o] = a; index[o + 1] = c; index[o + 2] = b;
      index[o + 3] = b; index[o + 4] = c; index[o + 5] = d;
    }
  }
  if (!isFinite(zMin)) zMin = -1;
  if (!isFinite(zMax)) zMax = 1;
  if (Math.abs(zMax - zMin) < 1e-9) { zMax = zMin + 1; zMin = zMin - 1; }
  return {
    positions, index,
    bounds: [x0, x1, y0, y1, zMin, zMax],
    width: w + 1, height: h + 1,
  };
}

// ── 2D 折线路径（SVG d 字符串）──
export function curveToPath(pts: Array<[number, number]>): string[] {
  const paths: string[] = [];
  let d = '';
  for (const [x, y] of pts) {
    if (!isFinite(y)) {
      if (d) { paths.push(d); d = ''; }
      continue;
    }
    if (!d) d = `M ${x.toFixed(4)} ${y.toFixed(4)}`;
    else d += ` L ${x.toFixed(4)} ${y.toFixed(4)}`;
  }
  if (d) paths.push(d);
  return paths;
}

// 等距网格刻度值
export function ticks(min: number, max: number, count: number): number[] {
  const out: number[] = [];
  const step = (max - min) / count;
  for (let i = 0; i <= count; i++) out.push(min + step * i);
  return out;
}

// 颜色渐变辅助：z 值 → 青色系（用于曲面顶点色，低→高）
export function zToColor(t: number): [number, number, number] {
  // t ∈ [0,1]，深蓝 → 青 → 黄绿
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0.05, 0.1, 0.45]],
    [0.45, [0.1, 0.6, 0.8]],
    [0.75, [0.2, 0.85, 0.75]],
    [1, [0.95, 0.85, 0.35]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}
