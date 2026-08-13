// 轻量数学函数表达式解析器
// 支持: + - * / ^ ( ) 变量 x, 常量 pi
// 以及一元函数: sin cos tan exp ln sqrt abs
// 用法: const f = parseFunction('sin(x)/x'); f(0.5)

type Token =
  | { type: 'num'; value: number }
  | { type: 'var' }
  | { type: 'op'; value: string }   // + - * / ^
  | { type: 'lp' }                   // (
  | { type: 'rp' }                   // )
  | { type: 'func'; value: string }  // sin cos ...
  | { type: 'comma' };

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  sqrt: (x: number) => Math.sqrt(Math.max(0, x)),
  abs: Math.abs,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '').toLowerCase();
  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9' || c === '.') {
      let j = i;
      while (j < s.length && (s[j] >= '0' && s[j] <= '9' || s[j] === '.')) j++;
      tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === 'x') { tokens.push({ type: 'var' }); i++; continue; }
    if (c === 'p') {
      // pi
      if (s.startsWith('pi', i)) { tokens.push({ type: 'num', value: Math.PI }); i += 2; continue; }
    }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lp' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rp' }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }
    // 函数名
    const matched = Object.keys(FUNCS).find(fn => s.startsWith(fn, i));
    if (matched) { tokens.push({ type: 'func', value: matched }); i += matched.length; continue; }
    // 未知字符
    i++;
  }
  return tokens;
}

export function parseFunction(expr: string): (x: number) => number {
  const tokens = tokenize(expr);
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }

  function expect(type: Token['type'], val?: string): Token {
    const t = tokens[pos];
    if (!t || t.type !== type || (val !== undefined && t.type === 'op' && t.value !== val)) {
      throw new Error(`Math parse error near "${expr}" at token ${pos}`);
    }
    pos++;
    return t;
  }

  function parsePrimary(): (x: number) => number {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'num') { pos++; const v = t.value; return () => v; }
    if (t.type === 'var') { pos++; return (x) => x; }
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      pos++;
      const neg = t.value === '-';
      const operand = parsePrimary();
      return neg ? (x) => -operand(x) : operand;
    }
    if (t.type === 'func') {
      pos++;
      expect('lp');
      const arg = parseExpression();
      expect('rp');
      const fn = FUNCS[t.value];
      return (x) => fn(arg(x));
    }
    if (t.type === 'lp') {
      pos++;
      const inner = parseExpression();
      expect('rp');
      return inner;
    }
    throw new Error(`Unexpected token in expression "${expr}"`);
  }

  function parsePower(): (x: number) => number {
    const left = parsePrimary();
    const t = peek();
    if (t && t.type === 'op' && t.value === '^') {
      pos++;
      const right = parsePower();
      return (x) => Math.pow(left(x), right(x));
    }
    return left;
  }

  function parseTerm(): (x: number) => number {
    let left = parsePower();
    while (true) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
        pos++;
        const right = parsePower();
        const op = t.value;
        const L = left; // 保存当前左操作数，避免闭包自引用
        if (op === '*') left = (x) => L(x) * right(x);
        else left = (x) => L(x) / right(x);
      } else break;
    }
    return left;
  }

  function parseExpression(): (x: number) => number {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos++;
        const right = parseTerm();
        const op = t.value;
        const L = left;
        if (op === '+') left = (x) => L(x) + right(x);
        else left = (x) => L(x) - right(x);
      } else break;
    }
    return left;
  }

  const result = parseExpression();
  return result;
}

// 替换表达式中的动态参数为数值字面量（用于参数动画）。
// 用字母/数字边界匹配，避免误替换函数名（abs/tan/exp 等）或数字拼接（2a）。
// 支持任意参数名（如 a / k / w / amp），匹配后由原解析器按普通数字处理。
export function substituteParam(expr: string, name: string, value: number): string {
  const re = new RegExp(`(?<![a-z0-9])${name}(?![a-z0-9])`, 'ig');
  const num = value.toFixed(6).replace(/\.?0+$/, '');
  return expr.replace(re, num);
}

export function evalAt(expr: string, x: number): number | null {
  try {
    const f = parseFunction(expr);
    const v = f(x);
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

// 生成曲线的采样点数组（用于 SVG path）
export function sampleCurve(
  fx: string,
  xRange: [number, number],
  samples = 200,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const [x0, x1] = xRange;
  if (!isFinite(x0) || !isFinite(x1) || x1 <= x0) return points;
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples;
    const y = evalAt(fx, x);
    if (y === null) {
      // 断开不连续点
      if (points.length > 0) points.push([x, NaN]);
      continue;
    }
    points.push([x, y]);
  }
  return points;
}
