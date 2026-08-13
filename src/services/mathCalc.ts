// 数学科学计算引擎（精确数值，供 LLM 生成脚本时引用真实值）
// 概率分布用数值稳定算法（Lanczos lgamma 避免大阶乘/组合数溢出），支持 n=10000 这类大参数。
import { create, all } from 'mathjs';

// 用 mathjs 的 create 构建独立实例，并注册本项目分布函数，供 LLM 的 calcRequests 直接调用
// 例：evaluate('poissonCdf(50, 70)') → 泊松 P(X≤70)；evaluate('binomialPmf(10000, 0.005, 50)')
const math = create(all, {});
math.import({
  poissonPmf,
  poissonCdf,
  binomialPmf,
  binomialCdf,
  normalPdf,
  normalCdf,
  combination,
  factorial,
}, { override: true });

// ── 通用计算引擎（mathjs）：像真计算器，支持变量赋值、多语句、完整运算符/函数、科学计数、分布函数 ──
// 例：evaluate('R1=6; R2=3; (R1*R2)/(R1+R2)') → 2
//     evaluate('poissonCdf(50,70)') → 泊松 P(X≤70)
//     evaluate('a=10; b=0.005; a*b') → 50
// 多语句用分号分隔，变量在同一表达式内可直接复用；返回最后一个语句的值
export function evaluate(expr: string): number | null {
  // DoS 防护：限长 + 阻止可能分配巨大矩阵/数组的函数
  if (!expr || expr.length > 500) return null;
  if (/\b(ones|zeros|eye|matrix|range|sparse|diag|reshape|resize|rand|random)\s*\(/.test(expr)) return null;
  try {
    const result = math.evaluate(expr);
    let v: unknown = result;
    // 多语句（分号分隔）返回 ResultSet，取最后一个语句的值
    if (result !== null && typeof result === 'object' && 'entries' in result) {
      const entries = (result as { entries: unknown[] }).entries;
      v = entries.length ? entries[entries.length - 1] : NaN;
    }
    const num = typeof v === 'number' ? v : Number(v);
    return isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

// ── 常用物理/电学公式 ──

// 电阻并联：1/R = 1/R1 + 1/R2 + ...
export function parallelResistance(...rs: number[]): number | null {
  if (!rs.length || rs.some(r => r <= 0)) return null;
  return 1 / rs.reduce((sum, r) => sum + 1 / r, 0);
}

// 电阻串联：R = R1 + R2 + ...
export function seriesResistance(...rs: number[]): number {
  return rs.reduce((a, b) => a + b, 0);
}

// LC 谐振频率：f = 1/(2π√(LC))
export function resonantFrequency(L: number, C: number): number | null {
  if (L <= 0 || C <= 0) return null;
  return 1 / (2 * Math.PI * Math.sqrt(L * C));
}

// 电功率：P = U·I
export function electricPower(voltage: number, current: number): number {
  return voltage * current;
}

// ── 对数伽马函数（Lanczos 近似） ──
export function lgamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// 阶乘（精确整数；过大时回退 exp(lgamma)，相对值仍准确）
export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n <= 170) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  return Math.exp(lgamma(n + 1));
}

// 组合数 C(n,k)（数值稳定，对数域）
export function combination(n: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1));
}

// ── 泊松分布 PMF：P(X=k) = e^{-λ} λ^k / k! ──
export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0 || !Number.isInteger(k) || k < 0) return 0;
  if (lambda > 0 && k === 0) return Math.exp(-lambda);
  // log P = k ln λ - λ - lnΓ(k+1)
  return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1));
}

// 泊松分布 CDF：P(X ≤ k)
export function poissonCdf(lambda: number, k: number): number {
  if (lambda <= 0 || !Number.isInteger(k) || k < 0) return 0;
  // 钳制循环上限：远超均值（>4σ）时概率≈1，避免巨大 k 死循环
  const maxK = Math.min(k, Math.max(1000, Math.round(lambda * 4) + 100));
  let sum = 0;
  for (let i = 0; i <= maxK; i++) sum += poissonPmf(lambda, i);
  return Math.min(1, sum);
}

// ── 二项分布 PMF：P(X=k) = C(n,k) p^k (1-p)^{n-k} ──
export function binomialPmf(n: number, p: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (p <= 0 || p >= 1) return p === 0 ? (k === 0 ? 1 : 0) : (k === n ? 1 : 0);
  // log P = ln C(n,k) + k ln p + (n-k) ln(1-p)
  const logP = lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
    + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

// 二项分布 CDF：P(X ≤ k)
export function binomialCdf(n: number, p: number, k: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (k >= n) return 1;
  // 钳制循环上限，防巨大 k 死循环
  const mean = n * p;
  const maxK = Math.min(k, Math.max(1000, Math.round(mean * 4) + 100));
  let sum = 0;
  for (let i = 0; i <= maxK; i++) sum += binomialPmf(n, p, i);
  return Math.min(1, sum);
}

// ── 误差函数（正态 CDF 用，Abramowitz-Stegun 7.1.26 近似） ──
export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// ── 正态分布 PDF/CDF ──
export function normalPdf(mu: number, sigma: number, x: number): number {
  if (sigma <= 0) return 0;
  return Math.exp(-((x - mu) * (x - mu)) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
}

export function normalCdf(mu: number, sigma: number, x: number): number {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

// ── 分布描述（供 dist 机制分发） ──
export interface DistSpec {
  type: 'poisson' | 'binomial' | 'normal';
  lambda?: number;
  n?: number;
  p?: number;
  mu?: number;
  sigma?: number;
}

// 按分布类型 + 自变量 x 求值（bar 图：x 是 labels 里的 k/横轴值）。
// Number() 兼容 dist 参数为字符串占位符替换后的情况（如 {{c2}} → "50"）
export function calcDistValue(dist: DistSpec, x: number): number {
  switch (dist.type) {
    case 'poisson': return poissonPmf(Number(dist.lambda ?? 0), Math.round(x));
    case 'binomial': return binomialPmf(Number(dist.n ?? 0), Number(dist.p ?? 0), Math.round(x));
    case 'normal': return normalPdf(Number(dist.mu ?? 0), Number(dist.sigma ?? 1), x);
    default: return 0;
  }
}
