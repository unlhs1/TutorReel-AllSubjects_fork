// 3D 数学图形渲染（React Three Fiber）
// 支持：函数曲面 z=f(x,y) / 几何体（立方体/球体/圆柱）+ 可拖动切平面 / 一元函数空间曲线（3D 视图）
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { ParsedGraph, compileExpr, compileComplexExpr, compileComplexValued, buildSurfaceMesh, zToColor, displayVar } from '../../services/math3dParser';

interface Props {
  graph: ParsedGraph;
  isDark?: boolean;
  /** 曲面/几何体网格范围半径 */
  range?: number;
  /** 是否显示坐标轴网格 */
  showGrid?: boolean;
}

// 稀疏参数网格线（沿 x/y 方向各 14 条），避免全三角线框过密掩盖顶点色渐变
function buildSparseGridLines(
  positions: Float32Array,
  width: number,
  height: number,
  segments = 14,
): Float32Array {
  const stride = width * 3;
  const arr: number[] = [];
  // 沿 y 方向（每 row 是一条线）
  const rowStep = Math.max(1, Math.floor(height / segments));
  for (let iy = 0; iy < height; iy += rowStep) {
    arr.push(...Array.from(positions.subarray(iy * stride, (iy + 1) * stride)));
  }
  // 沿 x 方向（每 col 是一条线）
  const colStep = Math.max(1, Math.floor(width / segments));
  for (let ix = 0; ix < width; ix += colStep) {
    for (let iy = 0; iy < height; iy++) {
      const i = (iy * width + ix) * 3;
      arr.push(positions[i], positions[i + 1], positions[i + 2]);
    }
  }
  return new Float32Array(arr);
}

// ── 函数曲面 ──
// 网格范围随相机距离动态延伸（Desmos 式：拉远视角曲面变大），有节流避免每帧重建
function SurfaceMesh({ expr, range = 2.5, isDark }: { expr: string; range: number; isDark?: boolean }) {
  const [meshRange, setMeshRange] = useState(range);
  const lastDistRef = useRef<number>(0);

  // 相机距离 → 曲面显示范围：拉远则范围变大（延伸），拉近则缩小
  useFrame(({ camera }) => {
    const dist = camera.position.length();
    const target = Math.max(range, dist * 1.2);
    // 变化超过 12% 才重建（节流，避免缩放每帧重建 64×64 网格）
    if (Math.abs(target - lastDistRef.current) / (lastDistRef.current || 1) > 0.12) {
      lastDistRef.current = target;
      setMeshRange(target);
    }
  });

  const { positions, index, bounds, width, height } = useMemo(() => {
    const f = compileExpr(expr);
    const evalFn = (x: number, y: number) => (f ? f({ x, y }) : null);
    return buildSurfaceMesh(evalFn, [-meshRange, meshRange], [-meshRange, meshRange], 64);
  }, [expr, meshRange]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    // 顶点色：按 z 归一化映射青蓝→黄
    const [, , , , zMin, zMax] = bounds;
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const z = positions[i + 1];
      const t = Math.min(1, Math.max(0, (z - zMin) / (zMax - zMin)));
      const [r, g, b] = zToColor(t);
      colors[i] = r; colors[i + 1] = g; colors[i + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [positions, index, bounds]);

  // 稀疏网格线（保留立体感但不掩盖渐变色）
  const gridLines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      buildSparseGridLines(positions, width, height), 3));
    return g;
  }, [positions, width, height]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide}
          roughness={0.5} metalness={0.05} transparent opacity={0.95} />
      </mesh>
      <lineSegments geometry={gridLines}>
        <lineBasicMaterial color={isDark ? '#475569' : '#f1f5f9'} transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}

// ── 复数函数曲面（复数模式）──
// 水平面 = 复平面（x 实部、y 虚部），纵轴 = |f(z)|（模，钳制防奇点冲高），顶点色 = 相位 arg f(z)（色相环）
// 颜色语义：红色相位 0°、青色 ±180°、绿色 ±90°、紫红 ±135°——一眼看出函数值方向
function phaseHueToRgb(h: number): [number, number, number] {
  // h ∈ [0, 360)，s=0.9, l=0.55 的 HSL → RGB
  const s = 0.9, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function ComplexSurfaceMesh({ expr, range = 2.5 }: { expr: string; range: number }) {
  const [meshRange, setMeshRange] = useState(range);
  const lastDistRef = useRef<number>(0);

  // 相机距离 → 曲面显示范围（与普通曲面一致：拉远延伸）
  useFrame(({ camera }) => {
    const dist = camera.position.length();
    const target = Math.max(range, dist * 1.2);
    if (Math.abs(target - lastDistRef.current) / (lastDistRef.current || 1) > 0.12) {
      lastDistRef.current = target;
      setMeshRange(target);
    }
  });

  const { positions, index, phases } = useMemo(() => {
    const f = compileComplexExpr(expr);
    const segments = 64;
    const positions = new Float32Array((segments + 1) * (segments + 1) * 3);
    const index = new Uint32Array(segments * segments * 6);
    const phases = new Float32Array((segments + 1) * (segments + 1));
    const cap = meshRange * 1.5; // 模钳制（1/z 等奇点冲高）
    for (let iy = 0; iy <= segments; iy++) {
      const y = -meshRange + (2 * meshRange * iy) / segments;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -meshRange + (2 * meshRange * ix) / segments;
        const w = f ? f(x, y) : null;
        const mag = w ? Math.min(Math.hypot(w.re, w.im), cap) : 0;
        const phase = w && mag > 1e-9 ? Math.atan2(w.im, w.re) : 0;
        const p = (iy * (segments + 1) + ix) * 3;
        positions[p] = x;
        positions[p + 1] = mag;
        positions[p + 2] = y;
        phases[iy * (segments + 1) + ix] = phase;
      }
    }
    for (let iy = 0; iy < segments; iy++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iy * (segments + 1) + ix;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;
        const o = (iy * segments + ix) * 6;
        index[o] = a; index[o + 1] = c; index[o + 2] = b;
        index[o + 3] = b; index[o + 4] = c; index[o + 5] = d;
      }
    }
    return { positions, index, phases };
  }, [expr, meshRange]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    // 顶点色：色相 = 相位（arg w），-π..π → 0..360
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < phases.length; i++) {
      const hue = ((phases[i] / Math.PI) * 180 + 360) % 360;
      const [r, g, b] = phaseHueToRgb(hue);
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [positions, index, phases]);

  // 稀疏网格线（保留立体感但不掩盖相位渐变色）
  const gridLines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const width = 65, height = 65;
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      buildSparseGridLines(positions, width, height), 3));
    return g;
  }, [positions]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide}
          roughness={0.5} metalness={0.05} transparent opacity={0.95} />
      </mesh>
      <lineSegments geometry={gridLines}>
        <lineBasicMaterial color="#475569" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}

// ── 复值函数螺旋线（复数坐标模式）：实变量 t 扫过 → w = f(t) 为复值 ──
// 3D 参数曲线 (t, Re f, Im f)：X = 实输入轴，Y = 实部，Z = 虚部；顶点色 = 相位 arg f
// 经典例子：e^(j*omega) → 单位圆螺旋；e^(j*omega)+1 → 圆心平移到 (1,0) 的螺旋
function SpiralCurve({ expr, varName, baseRange }: { expr: string; varName: string; baseRange: number }) {
  const { lineObj, cleanup } = useMemo(() => {
    const f = compileComplexValued(expr, varName);
    const N = 500;
    const pts: number[] = [];
    const colors: number[] = [];
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const t = -baseRange + (2 * baseRange * i) / N;
      const w = f ? f(t) : null;
      const re = w ? w.re : 0;
      const im = w ? w.im : 0;
      if (!isFinite(re) || !isFinite(im)) {
        prev = null; // 断点（奇点）
        continue;
      }
      const phase = Math.hypot(re, im) > 1e-9 ? Math.atan2(im, re) : 0;
      const hue = ((phase / Math.PI) * 180 + 360) % 360;
      const [r, g, b] = phaseHueToRgb(hue);
      // 断点处断开（用 -1,-1,-1 哨兵分割子段，LineSegments 需要成对——改用多条 Line）
      void prev;
      pts.push(t, re, im);
      colors.push(r, g, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeBoundingSphere();
    const m = new THREE.LineBasicMaterial({ vertexColors: true });
    return { lineObj: new THREE.Line(g, m), cleanup: () => { g.dispose(); m.dispose(); } };
  }, [expr, varName, baseRange]);
  useEffect(() => cleanup, [cleanup]);
  return <primitive object={lineObj} />;
}

// ── 几何体（立方体/球体/圆柱）──
// cutOffset: 切平面法向偏移（0~1），cutTilt: 切平面倾斜
function SolidMesh({ solid, cutOffset, cutTilt, isDark }: {
  solid: string;
  cutOffset: number;
  cutTilt: number;
  isDark?: boolean;
}) {
  const baseColor = isDark ? '#38bdf8' : '#0284c7';
  const planeColor = isDark ? '#fbbf24' : '#f59e0b';
  const commonMaterial = {
    color: baseColor,
    transparent: true,
    opacity: 0.55,
    roughness: 0.4,
    metalness: 0.15,
    side: THREE.DoubleSide as THREE.Side,
  };

  return (
    <group>
      {solid === 'cube' && (
        <mesh>
          <boxGeometry args={[2, 2, 2]} />
          <meshStandardMaterial {...commonMaterial} />
          <lineSegments geometry={new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2))}>
            <lineBasicMaterial color={isDark ? '#7dd3fc' : '#0c4a6e'} />
          </lineSegments>
        </mesh>
      )}
      {solid === 'sphere' && (
        <mesh>
          <sphereGeometry args={[1.3, 32, 32]} />
          <meshStandardMaterial {...commonMaterial} />
        </mesh>
      )}
      {solid === 'cylinder' && (
        <mesh>
          <cylinderGeometry args={[1, 1, 2.2, 32]} />
          <meshStandardMaterial {...commonMaterial} />
          <lineSegments geometry={new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 2.2, 32))}>
            <lineBasicMaterial color={isDark ? '#7dd3fc' : '#0c4a6e'} transparent opacity={0.5} />
          </lineSegments>
        </mesh>
      )}

      {/* 切平面：矩形平面穿过几何体（半透明 + 描边），位置/倾斜可调 */}
      <group position={[0, cutOffset * 2.4 - 1.2, 0]} rotation={[cutTilt, 0, 0]}>
        <mesh>
          <planeGeometry args={[3.2, 3.2]} />
          <meshBasicMaterial color={planeColor} transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments geometry={new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.2, 3.2))}>
          <lineBasicMaterial color={planeColor} transparent opacity={0.9} />
        </lineSegments>
      </group>
    </group>
  );
}

// ── 一元函数：3D 空间曲线（画在 x-y 平面，函数值沿 Y 轴向上，符合 y=f(x) 直觉） ──
// 采样范围随相机距离动态延伸（Desmos 式：拉远视角曲线继续向外生长），
// 让函数不是"U 形固定一段"而是"随视角无限延伸"。
function SpaceCurve({ expr, variable, baseRange = 5 }: { expr: string; variable: string; baseRange?: number }) {
  const lineRef = useRef<THREE.Line>(null);
  const N = 240;

  // 每帧根据相机距离重建采样点
  useFrame(({ camera }) => {
    const line = lineRef.current;
    if (!line) return;
    const f = compileExpr(expr);
    if (!f) return;
    const geom = line.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    // 当前视野半径：相机到原点距离 × 系数（保证曲线延伸到视野之外）
    const dist = camera.position.length();
    const viewR = Math.max(baseRange, dist * 1.8);
    // y 值上限同样随视野放大，避免远处曲线被钳死成 U 形
    const yClamp = viewR * 1.6;
    let count = 0;
    for (let i = 0; i <= N; i++) {
      const v = -viewR + (2 * viewR * i) / N;
      const y = f({ [variable]: v } as Record<string, number>);
      let yy = 0;
      if (y !== null && isFinite(y)) {
        yy = Math.max(-yClamp, Math.min(yClamp, y));
      }
      posAttr.setXYZ(count++, v, yy, 0);
    }
    posAttr.needsUpdate = true;
    geom.setDrawRange(0, count);
    geom.computeBoundingSphere();
  });

  const lineObj = useMemo(() => {
    // 预分配 buffer（每帧原位更新顶点，避免重复创建 geometry）
    const positions = new Float32Array((N + 1) * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({ color: '#22d3ee', linewidth: 2 });
    return new THREE.Line(g, m);
  }, [N]);

  return <primitive ref={lineRef} object={lineObj} />;
}

// 文字 Sprite（CanvasTexture，纯 WebGL，离线可靠）
function makeTextSprite(text: string, color: string, fontSize = 64): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = `bold ${fontSize}px "Segoe UI", "Microsoft YaHei", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.7, 1);
  return sprite;
}

// 单条动态轴：用 THREE.ArrowHelper（自带杆 + 锥体箭头），长度随相机距离延伸
function DynamicAxis({ dir, color, label }: {
  dir: [number, number, number];
  color: string;
  label: string;
}) {
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const labelRef = useRef<THREE.Sprite>(null);

  // 单位方向向量 + 初始箭头（ArrowHelper 方向默认 +Y，后续 setDirection）
  const u = useMemo(() => new THREE.Vector3(...dir).normalize(), [dir]);
  const arrow = useMemo(() => {
    const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, color, 0.25, 0.14);
    return a;
  }, [color]);

  // 标签 Sprite（固定朝向相机）
  const labelObj = useMemo(() => makeTextSprite(label, color), [label, color]);

  useFrame(({ camera }) => {
    // 长度 = 相机距离 × 0.75（末端留在可见视野内，拉远变长）
    const dist = camera.position.length();
    const len = Math.max(2, dist * 0.75);
    const headLen = Math.max(0.3, len * 0.1);
    const headW = Math.max(0.18, len * 0.05);
    if (arrowRef.current) {
      arrowRef.current.setDirection(u);
      arrowRef.current.setLength(len, headLen, headW);
    }
    // 标签放在箭头末端外侧
    if (labelRef.current) {
      labelRef.current.position.copy(u.clone().multiplyScalar(len + 0.6));
      labelRef.current.scale.set(1.2, 0.6, 1);
    }
  });

  return (
    <group>
      <primitive ref={arrowRef} object={arrow} />
      <primitive ref={labelRef} object={labelObj} />
    </group>
  );
}

// 轴上的刻度数字（Sprite，随轴延伸在正负方向各若干格）
function AxisTick({ value, dir, color }: {
  value: number;          // 刻度值（正负）
  dir: 'x' | 'y' | 'z';
  color: string;
}) {
  const labelObj = useMemo(() => {
    const text = String(Math.round(value));
    return makeTextSprite(text, color, 48);
  }, [value, color]);
  const pos = useMemo(() => {
    const p = new THREE.Vector3(0, 0, 0);
    if (dir === 'x') p.set(value, -0.25, 0);
    else if (dir === 'y') p.set(-0.25, value, 0);
    else p.set(0, -0.25, value);
    return p;
  }, [value, dir]);
  return <primitive object={labelObj} position={pos} />;
}

// 无限网格 + 三轴（正方向箭头 + 标签 + 刻度，随视角延伸）
// 复数坐标模式：曲面 → X=Re(z)、Y=Im(z)、Z=|f(z)|；螺旋线 → X=实输入变量、Y=Re f、Z=Im f
function CoordGrid({ range = 5, isDark, isComplex = false, isSpiral = false, varName = 't' }:
  { range?: number; isDark?: boolean; isComplex?: boolean; isSpiral?: boolean; varName?: string }) {
  const gridCell = isDark ? '#334155' : '#cbd5e1';
  const gridSection = isDark ? '#475569' : '#94a3b8';
  const axisX = isDark ? '#f87171' : '#dc2626';
  const axisY = isDark ? '#4ade80' : '#16a34a';
  const axisZ = isDark ? '#60a5fa' : '#2563eb';
  const tickColor = isDark ? '#94a3b8' : '#64748b';

  // 刻度范围：跟随相机距离动态延伸（拉远显示更多数字），用 state + 节流
  const [viewRange, setViewRange] = useState(range);
  const lastTickRange = useRef(0);
  useFrame(({ camera }) => {
    const dist = camera.position.length();
    // 视野范围 ≈ 相机距离 × 1.4（覆盖可视区域），最小为滑块 range
    const target = Math.max(range, dist * 1.4);
    // 整数级变化才更新（避免每帧重建 Sprite）
    const rounded = Math.ceil(target);
    if (rounded !== lastTickRange.current) {
      lastTickRange.current = rounded;
      setViewRange(rounded);
    }
  });

  // 刻度列表：按视野范围自适应步长（≥8 用 2，≥16 用 5），显示到 viewRange
  const ticks = useMemo(() => {
    const step = viewRange >= 16 ? 5 : viewRange >= 8 ? 2 : viewRange >= 2.5 ? 1 : 0.5;
    const max = viewRange;
    const arr: number[] = [];
    for (let v = step; v <= max; v += step) arr.push(Math.round(v * 100) / 100);
    return arr;
  }, [viewRange]);

  return (
    <group>
      {/* 无限网格：随相机延伸，远近自适应（不是一次性渲染固定区块） */}
      <Grid
        position={[0, -0.02, 0]}
        args={[10, 10]}
        cellSize={viewRange >= 16 ? 5 : viewRange >= 8 ? 2 : viewRange >= 2.5 ? 1 : 0.5}
        cellThickness={0.6}
        cellColor={gridCell}
        sectionSize={viewRange >= 16 ? 10 : viewRange >= 8 ? 5 : 2.5}
        sectionThickness={1.2}
        sectionColor={gridSection}
        fadeDistance={viewRange * 8}
        fadeStrength={1.2}
        infiniteGrid
      />

      {/* 三轴：正半轴箭头 + 标签随视角延伸（复数坐标：曲面 Re/Im/|f|，螺旋线 变量/Re/Im） */}
      <DynamicAxis dir={[1, 0, 0]} color={axisX} label={isComplex ? (isSpiral ? `+${displayVar(varName)}` : '+Re(z)') : '+X'} />
      <DynamicAxis dir={[0, 1, 0]} color={axisY} label={isComplex ? '+Re' : '+Y'} />
      <DynamicAxis dir={[0, 0, 1]} color={axisZ} label={isComplex ? (isSpiral ? '+Im' : '+|f(z)|') : '+Z'} />

      {/* 刻度数字：正负方向，随视角延伸 */}
      {ticks.map(v => (
        <group key={`tx${v}`}>
          <AxisTick value={v} dir="x" color={tickColor} />
          <AxisTick value={-v} dir="x" color={tickColor} />
        </group>
      ))}
      {ticks.map(v => (
        <group key={`ty${v}`}>
          <AxisTick value={v} dir="y" color={tickColor} />
          <AxisTick value={-v} dir="y" color={tickColor} />
        </group>
      ))}
      {ticks.map(v => (
        <group key={`tz${v}`}>
          <AxisTick value={v} dir="z" color={tickColor} />
          <AxisTick value={-v} dir="z" color={tickColor} />
        </group>
      ))}
    </group>
  );
}

// 相机自动适配内容（根据图形类型预设视角）
function CameraRig({ mode }: { mode: string }) {
  const { camera } = useThree();
  useEffect(() => {
    if (mode === 'surface') { camera.position.set(4.5, 3.5, 5.5); }
    else if (mode === 'curve3d') { camera.position.set(0, 3.5, 8); }
    else { camera.position.set(4, 3, 5); }
    camera.lookAt(0, 0, 0);
  }, [mode, camera]);
  return null;
}

// 鼠标悬浮坐标：投射到 y=0 平面，把世界坐标 + 函数值通过回调传给外层 DOM 显示
// evalValue: 给定 (x, y=0, z) 返回曲面 z 值 或 曲线 y 值（用于悬浮提示显示函数值）
function HoverCoord({ onHover, evalValue }: {
  onHover: (p: { x: number; y: number; z: number; fval: number | null } | null) => void;
  evalValue?: ((x: number, z: number) => number | null) | null;
}) {
  const { camera, pointer } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const lastRef = useRef<string>('');

  useFrame(() => {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (hit) {
      const key = `${hit.x.toFixed(2)},${hit.z.toFixed(2)}`;
      if (key !== lastRef.current) {
        lastRef.current = key;
        // 函数值：对曲面算 z=f(x,y)；对曲线算 y=f(x)
        let fval: number | null = null;
        if (evalValue) {
          const v = evalValue(hit.x, hit.z);
          fval = v !== null && isFinite(v) ? v : null;
        }
        onHover({ x: hit.x, y: 0, z: hit.z, fval });
      }
    } else if (lastRef.current !== '') {
      lastRef.current = '';
      onHover(null);
    }
  });
  return null;
}

export const Graph3D: React.FC<Props> = ({ graph, isDark = true, range = 2.5, showGrid = true }) => {
  // 几何体切平面参数（可被外部控制）
  const [cutOffset, setCutOffset] = useState(0.5);
  const [cutTilt, setCutTilt] = useState(0);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; z: number; fval: number | null } | null>(null);

  const mode = graph.kind === 'system'
    ? (graph.subgraphs?.every(s => s.kind === 'surface') ? 'surface' : 'curve3d')
    : graph.kind === 'surface' ? 'surface'
      : graph.kind === 'solid' ? 'solid'
        : 'curve3d';

  // 悬浮坐标函数值计算：曲面 z=f(x,y)（复数坐标：|f(z)|），曲线 y=f(x)；螺旋线/方程组无高度值
  const hoverEval = useMemo(() => {
    if (graph.kind === 'system' || graph.kind === 'solid') return null;
    if (graph.kind === 'surface' && !graph.isSpiral) {
      if (graph.isComplex) {
        const f = compileComplexExpr(graph.expr);
        return f ? ((x: number, y: number) => {
          const w = f(x, y);
          return w ? Math.hypot(w.re, w.im) : null;
        }) : null;
      }
      const f = compileExpr(graph.expr);
      return f ? ((x: number, z: number) => f({ x, y: z })) : null;
    }
    if (graph.kind === 'curve') {
      const v = graph.vars[0] || 'x';
      const f = compileExpr(graph.expr);
      return f ? ((x: number) => f({ [v]: x })) : null;
    }
    return null;
  }, [graph]);

  // 2D 显示时给一个等轴视角；3D 由 OrbitControls 控制
  return (
    <div className="w-full h-full relative">
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ position: mode === 'surface' ? [4.5, 3.5, 5.5] : [0, 3.5, 8], fov: 45 }}
        style={{ background: isDark ? 'transparent' : 'transparent' }}
      >
        <CameraRig mode={mode} />
        <ambientLight intensity={isDark ? 0.7 : 0.9} />
        <directionalLight position={[6, 8, 4]} intensity={1.1} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} color={isDark ? '#3b82f6' : '#ffffff'} />

        {graph.kind === 'system' ? (
          /* 方程组：多个子图叠加（全曲线 → 空间曲线组；全曲面 → 曲面组） */
          (graph.subgraphs || []).map((sg, i) => {
            if (sg.kind === 'surface') {
              return sg.isSpiral
                ? <SpiralCurve key={i} expr={sg.expr} varName={sg.complexVar || sg.vars[0] || 't'} baseRange={range * 2} />
                : sg.isComplex
                  ? <ComplexSurfaceMesh key={i} expr={sg.expr} range={range} />
                  : <SurfaceMesh key={i} expr={sg.expr} range={range} isDark={isDark} />;
            }
            if (sg.kind === 'curve') {
              return <SpaceCurve key={i} expr={sg.expr} variable={sg.vars[0] || 'x'} baseRange={range * 2} />;
            }
            return null;
          })
        ) : graph.kind === 'surface' && (graph.isSpiral
          ? <SpiralCurve expr={graph.expr} varName={graph.complexVar || graph.vars[0] || 't'} baseRange={range * 2} />
          : graph.isComplex
            ? <ComplexSurfaceMesh expr={graph.expr} range={range} />
            : <SurfaceMesh expr={graph.expr} range={range} isDark={isDark} />)}
        {graph.kind === 'solid' && graph.solid && (
          <SolidMesh solid={graph.solid} cutOffset={cutOffset} cutTilt={cutTilt} isDark={isDark} />
        )}
        {graph.kind === 'curve' && (
          <SpaceCurve expr={graph.expr} variable={graph.vars[0] || 'x'} baseRange={range * 2} />
        )}
        {showGrid && <CoordGrid range={range * 2} isDark={isDark} isComplex={!!graph.isComplex}
          isSpiral={!!graph.isSpiral} varName={graph.complexVar || graph.vars[0] || 't'} />}

        <HoverCoord onHover={setHoverPos} evalValue={hoverEval} />

        {/* 指示点：鼠标所在位置的函数点（曲面 f(x,z) 或曲线 f(x)）渲染小球 */}
        {hoverPos && hoverPos.fval !== null && graph.kind !== 'solid' && (
          <mesh position={graph.kind === 'surface'
            ? [hoverPos.x, hoverPos.fval, hoverPos.z]
            : [hoverPos.x, hoverPos.fval, 0]}>
            <sphereGeometry args={[0.09, 20, 20]} />
            <meshBasicMaterial color={isDark ? '#fbbf24' : '#d97706'} />
          </mesh>
        )}

        <OrbitControls enableDamping dampingFactor={0.08} makeDefault />
      </Canvas>

      {/* 悬浮坐标提示（DOM overlay）：显示地面坐标 + 鼠标位置的函数值（复数坐标：|f|） */}
      {hoverPos && (
        <div className="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-black/55 dark:bg-white/10 backdrop-blur-md text-[12px] font-mono text-white/90 pointer-events-none">
          x = {hoverPos.x.toFixed(2)}　z = {hoverPos.z.toFixed(2)}
          {hoverPos.fval !== null && (
            <span>　{graph.kind === 'surface'
              ? (graph.isComplex ? `|f| = ${hoverPos.fval.toFixed(3)}` : `f = ${hoverPos.fval.toFixed(3)}`)
              : `y = ${hoverPos.fval.toFixed(3)}`}</span>
          )}
        </div>
      )}

      {/* 几何体切平面控制条 */}
      {graph.kind === 'solid' && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 bg-black/45 dark:bg-white/10 backdrop-blur-md rounded-xl px-3 py-2.5">
          <span className="text-[11px] font-medium text-white/80 whitespace-nowrap">切平面</span>
          <div className="flex flex-col flex-1 gap-1.5">
            <label className="flex items-center gap-2 text-[10px] text-white/60">
              <span className="w-14">位置</span>
              <input type="range" min={0} max={1} step={0.01} value={cutOffset}
                onChange={e => setCutOffset(Number(e.target.value))} className="flex-1 accent-amber-400" />
              <span className="w-8 text-right font-mono">{cutOffset.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-2 text-[10px] text-white/60">
              <span className="w-14">倾斜</span>
              <input type="range" min={0} max={1.4} step={0.01} value={cutTilt}
                onChange={e => setCutTilt(Number(e.target.value))} className="flex-1 accent-amber-400" />
              <span className="w-8 text-right font-mono">{cutTilt.toFixed(2)}</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
