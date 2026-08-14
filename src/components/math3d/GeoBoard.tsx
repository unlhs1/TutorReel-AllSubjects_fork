// 动态几何构造板（GeoBoard）：GeoGebra 式动态几何
// 点击建点 → 选点连成线/面/体 → 选中高亮/隐藏 → 动点拖动实时更新 → 特殊点（交点/零点/极值）
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import {
  GeoPoint, GeoEntity, EntityKind,
  segmentIntersect3D, findZero, findExtrema, fmt,
  vec, cross, dot, norm, rotateVecAround,
} from '../../services/geoEngine';
import { parseGraphInput, compileExpr, compileSurfaceExpr, buildSurfaceMesh, zToColor } from '../../services/math3dParser';

// ── 工具：Sprite 文字（CanvasTexture，无字体依赖） ──
function makeTextSprite(text: string, color: string, fontSize = 56): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = `bold ${fontSize}px "Segoe UI", "Microsoft YaHei", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.9, 0.45, 1);
  return s;
}

// ── 模式 ──
export type Tool = 'select' | 'point' | 'line' | 'segment' | 'plane' | 'polygon' | 'solid' | 'special' | 'rotate' | 'scale';
export type ViewMode = '3d' | 'xy' | 'xz' | 'yz';

interface Props {
  isDark?: boolean;
}

const POINT_COLORS = ['#f472b6', '#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#60a5fa', '#fb923c', '#e879f9'];

// 实体换色色板（线/面/体共用）
const ENTITY_COLORS = ['#38bdf8', '#ef4444', '#f472b6', '#a78bfa', '#4ade80', '#fbbf24', '#fb923c', '#60a5fa', '#22d3ee', '#f8fafc'];

// 平面视图：返回法向量 + 把 raycast 命中点映射为 (x,y,z)
function getPlaneInfo(mode: ViewMode): { normal: [number, number, number]; mapHit: (x: number, y: number, z: number) => [number, number, number] } {
  if (mode === 'xy') return { normal: [0, 0, 1], mapHit: (x, y) => [x, y, 0] };
  if (mode === 'yz') return { normal: [1, 0, 0], mapHit: (_x, y, z) => [0, y, z] };
  // xz（地面）与 3d 都用 y=0 平面
  return { normal: [0, 1, 0], mapHit: (x, _y, z) => [x, 0, z] };
}

// 平面视图对应相机位置
const VIEW_CAMERA: Record<ViewMode, [number, number, number]> = {
  '3d': [6, 4.5, 7],
  xy: [0, 0, 8],
  xz: [0, 8, 0],
  yz: [8, 0, 0],
};

function getPoint(points: GeoPoint[], id: string): GeoPoint | undefined {
  return points.find(p => p.id === id);
}

export const GeoBoard: React.FC<Props> = ({ isDark = true }) => {
  const [tool, setTool] = useState<Tool>('point');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [entities, setEntities] = useState<GeoEntity[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('点击画布创建点；选中多个点后点「连线/成面/成体」');
  const [showSpecial, setShowSpecial] = useState(false);
  const [presetInput, setPresetInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const presetGraph = useMemo(() => (presetInput.trim() ? parseGraphInput(presetInput) : null), [presetInput]);

  const nextLabelRef = useRef(0);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // 拖动期间实时坐标（不触发 React 渲染，pointerup 一次性提交到 state）
  const livePointsRef = useRef(new Map<string, { x: number; y: number; z: number }>());
  const getLive = useCallback((id: string) => livePointsRef.current.get(id), []);
  const setLive = useCallback((id: string, x: number, y: number, z: number) => {
    livePointsRef.current.set(id, { x, y, z });
  }, []);
  const clearLive = useCallback((id: string) => { livePointsRef.current.delete(id); }, []);

  const nextLabel = useCallback(() => {
    const n = nextLabelRef.current++;
    const letter = String.fromCharCode(65 + (n % 26));
    return n < 26 ? letter : letter + Math.floor(n / 26); // 超过 26 个点：A1、B1...
  }, []);

  // ── 创建点 ──
  const createPoint = useCallback((x: number, y: number, z: number) => {
    const label = nextLabel();
    const id = `p${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setPoints(prev => [...prev, { id, x, y, z, label, free: true }]);
    setSelected([id]);
    setStatus(`已创建点 ${label}(${fmt(x)}, ${fmt(y)}, ${fmt(z)})`);
  }, [nextLabel]);

  // ── 点点击：选中/取消选中 ──
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  // ── 动点拖动：更新坐标（按当前平面投影） ──
  const movePoint = useCallback((id: string, x: number, y: number, z: number) => {
    setPoints(prev => prev.map(p => p.id === id ? { ...p, x, y, z } : p));
  }, []);

  // 对一组点应用变换（实体平移/旋转/缩放）
  const transformPoints = useCallback((ids: string[], fn: (p: GeoPoint) => GeoPoint) => {
    setPoints(prev => prev.map(p => ids.includes(p.id) ? fn(p) : p));
  }, []);

  // 选中目标的三维轴 gizmo（仅 3D 模式且最后选中的是点或实体；实体显示在中心，拖轴整体平移）
  const gizmoTarget = useMemo<GizmoTarget>(() => {
    if (viewMode !== '3d') return null;
    const id = selected[selected.length - 1];
    if (!id || hidden.has(id)) return null;
    if (getPoint(points, id)) return { kind: 'point', id };
    if (entities.some(e => e.id === id)) return { kind: 'entity', id };
    return null;
  }, [selected, points, entities, viewMode, hidden]);

  // ── 实体换色：选中实体时色板改 entity.color（线/面/体渲染读它） ──
  const hasEntitySelected = selected.some(id => entities.some(e => e.id === id));
  const selEntityColor = useMemo(() => {
    const e = entities.find(ent => selected.includes(ent.id));
    return e?.color || '#38bdf8';
  }, [entities, selected]);
  const setEntityColor = useCallback((c: string) => {
    setEntities(prev => prev.map(e => (selected.includes(e.id) ? { ...e, color: c } : e)));
    setStatus(`已设置颜色 ${c}`);
  }, [selected]);

  // ── 用选中点创建实体 ──
  const buildEntity = useCallback((kind: EntityKind) => {
    const selPoints = selectedRef.current.filter(id => pointsRef.current.some(p => p.id === id));
    const needed = kind === 'line' || kind === 'segment' ? 2 : kind === 'plane' || kind === 'circle' || kind === 'polygon' ? 3 : 4;
    if (selPoints.length < needed) {
      setStatus(`${kindName(kind)}需要 ${needed} 个点，当前选中 ${selPoints.length} 个`);
      return;
    }
    const used = selPoints.slice(0, needed).map(id => getPoint(pointsRef.current, id)!).filter(Boolean) as GeoPoint[];
    // 重复点检测（坐标去重）
    const seen = new Set<string>();
    const uniq: GeoPoint[] = [];
    for (const p of used) {
      const k = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      if (!seen.has(k)) { seen.add(k); uniq.push(p); }
    }
    if (uniq.length < needed) {
      setStatus(`${kindName(kind)}需要 ${needed} 个不重复的点`);
      return;
    }
    // 退化检测：三点共线无法成面；四点共面无法成体
    if ((kind === 'plane' || kind === 'polygon' || kind === 'circle') && uniq.length === 3) {
      const [a, b, c] = uniq;
      if (norm(cross(vec(a, b), vec(a, c))) < 1e-4) { setStatus('所选三点共线，无法成面'); return; }
    }
    if (kind === 'solid' && uniq.length === 4) {
      const [a, b, c, d] = uniq;
      if (Math.abs(dot(cross(vec(a, b), vec(a, c)), vec(a, d))) < 1e-4) { setStatus('所选四点共面，无法成体'); return; }
    }
    const id = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    setEntities(prev => [...prev, { id, kind, pointIds: uniq.slice(0, needed).map(p => p.id) }]);
    const labels = uniq.slice(0, needed).map(p => p.label || p.id).join('-');
    setStatus(`已${kindName(kind)}（${labels}）`);
  }, []);

  // ── 隐藏其他 / 全部显示 / 删除 ──
  const hideOthers = useCallback(() => {
    setHidden(prev => {
      const next = new Set(prev);
      points.forEach(p => { if (!selected.includes(p.id)) next.add(p.id); });
      entities.forEach(e => { if (!selected.includes(e.id)) next.add(e.id); });
      return next;
    });
  }, [selected, points, entities]);
  const showAll = useCallback(() => setHidden(new Set()), []);
  const deleteSelected = useCallback(() => {
    const selSet = new Set(selected);
    // 删除选中的点；同时删除引用这些点的实体（防止悬挂实体崩溃）
    setPoints(prev => prev.filter(p => !selSet.has(p.id)));
    setEntities(prev => prev.filter(e => {
      if (selSet.has(e.id)) return false;
      // 实体依赖的点被删 → 一并删除
      if (e.pointIds.some(id => selSet.has(id))) return false;
      return true;
    }));
    setSelected([]);
  }, [selected]);

  // ── 特殊点：线两两三维求交（线段检查）+ 函数零点/极值（对 fx 输入） ──
  const [specialFx, setSpecialFx] = useState('');
  // 编译缓存：specialFx 不变时不重复 math.compile（拖动/缩放等高频场景关键）
  const specialCompiled = useMemo(
    () => (specialFx.trim() ? compileExpr(specialFx) : null),
    [specialFx],
  );
  const specialPoints = useMemo(() => {
    const out: GeoPoint[] = [];
    if (showSpecial) {
      // 线交点：三维最近点，距离 < 容差才算相交；segment 检查参数是否在 [0,1]
      const lineEnts = entities.filter(e => (e.kind === 'line' || e.kind === 'segment') && e.pointIds.length === 2);
      for (let i = 0; i < lineEnts.length; i++) {
        for (let j = i + 1; j < lineEnts.length; j++) {
          const a1 = getPoint(points, lineEnts[i].pointIds[0]), a2 = getPoint(points, lineEnts[i].pointIds[1]);
          const b1 = getPoint(points, lineEnts[j].pointIds[0]), b2 = getPoint(points, lineEnts[j].pointIds[1]);
          if (!a1 || !a2 || !b1 || !b2) continue;
          const hit = segmentIntersect3D(
            a1, a2, b1, b2,
            lineEnts[i].kind === 'line',
            lineEnts[j].kind === 'line',
          );
          if (hit) out.push({ id: `inter_${lineEnts[i].id}_${lineEnts[j].id}`, x: hit.x, y: hit.y, z: hit.z, label: '交点', free: false });
        }
      }
      // 函数零点 / 极值（fx 用 x 变量，画在 x-y 平面 z=0）
      if (specialFx.trim()) {
        for (const z of findZero(specialFx, -8, 8, 200, specialCompiled)) out.push({ id: `zero_${z}`, x: z, y: 0, z: 0, label: `零点 ${fmt(z)}`, free: false });
        for (const e of findExtrema(specialFx, -8, 8, 300, specialCompiled)) {
          out.push({ id: `ext_${e.x}`, x: e.x, y: e.y, z: 0, label: `${e.kind === 'max' ? '极大' : '极小'} ${fmt(e.y)}`, free: false });
        }
      }
    }
    return out;
  }, [showSpecial, entities, points, specialFx, specialCompiled]);

  // ── 3D 画布内容 ──
  const renderEntities = useMemo(() =>
    entities.filter(e => !hidden.has(e.id)).map(e => (
      <EntityMesh key={e.id} entity={e} points={points} selected={selected.includes(e.id)}
        onSelect={() => toggleSelect(e.id)} getLive={getLive}
        tool={tool} viewMode={viewMode} transformEntity={transformPoints} isDark={isDark} />
    )),
  [entities, points, hidden, selected, toggleSelect, getLive, tool, viewMode, transformPoints, isDark]);

  // 颜色用原始索引：隐藏点后颜色不错位
  const renderPoints = useMemo(() =>
    points.map((p, i) => hidden.has(p.id) ? null : (
      <GeoPointMesh key={p.id} point={p} color={POINT_COLORS[i % POINT_COLORS.length]}
        selected={selected.includes(p.id)} onSelect={() => toggleSelect(p.id)} onMove={movePoint}
        viewMode={viewMode} setDragActive={setDragActive} getLive={getLive} setLive={setLive} clearLive={clearLive} />
    )).filter(Boolean),
  [points, hidden, selected, toggleSelect, movePoint, viewMode, getLive, setLive, clearLive]);

  // 特殊点的标签 Sprite（预计算，避免在 map 里调用 hook）
  const specialLabels = useMemo(() => {
    const map = new Map<string, THREE.Sprite>();
    for (const p of specialPoints) {
      const s = makeTextSprite(p.label || '点', '#ef4444', 40);
      s.position.set(0, 0.4, 0);
      map.set(p.id, s);
    }
    return map;
  }, [specialPoints]);

  // specialLabels 重建时释放旧 Sprite 的 texture/material（防泄漏）
  useEffect(() => {
    return () => {
      for (const s of specialLabels.values()) {
        s.material.map?.dispose();
        s.material.dispose();
      }
    };
  }, [specialLabels]);

  const renderSpecial = useMemo(() =>
    specialPoints.map(p => (
      <mesh key={p.id} position={[p.x, p.y, p.z]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color="#ef4444" />
        <primitive object={specialLabels.get(p.id)!} />
      </mesh>
    )),
  [specialPoints, specialLabels]);

  return (
    <div className="w-full h-full relative flex flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
        <ToolBtn active={tool === 'point'} onClick={() => setTool('point')} label="加点" />
        <ToolBtn active={tool === 'select'} onClick={() => setTool('select')} label="选择" />
        {/* 构建按钮是"动作"而非"模式"：点击即用选中点构建，不切换交互模式 */}
        <button onClick={() => buildEntity('line')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">连线</button>
        <button onClick={() => buildEntity('segment')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">线段</button>
        <button onClick={() => buildEntity('plane')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">成面</button>
        <button onClick={() => buildEntity('polygon')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">多边形</button>
        <button onClick={() => buildEntity('solid')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">成体</button>
        <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700 mx-1" />
        <button onClick={() => setShowSpecial(v => !v)}
          className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${showSpecial ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}>
          特殊点
        </button>
        <button onClick={() => setTool(tool === 'rotate' ? 'select' : 'rotate')}
          className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${tool === 'rotate' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}>
          旋转
        </button>
        <button onClick={() => setTool(tool === 'scale' ? 'select' : 'scale')}
          className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${tool === 'scale' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}>
          缩放
        </button>
        <button onClick={hideOthers} className="px-2 py-1 rounded-md text-[11px] font-medium bg-amber-500 text-white hover:bg-amber-600">隐藏其他</button>
        <button onClick={showAll} className="px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700">全部显示</button>
        <button onClick={deleteSelected} disabled={!selected.length} className="px-2 py-1 rounded-md text-[11px] font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-40">删除</button>
        <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700 mx-1" />
        {/* 视图模式：3D / XY / XZ / YZ 平面 */}
        {(['3d', 'xy', 'xz', 'yz'] as ViewMode[]).map(vm => (
          <button key={vm} onClick={() => setViewMode(vm)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${viewMode === vm ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}>
            {vm === '3d' ? '3D' : `${vm[0]}${vm[1]} 平面`}
          </button>
        ))}
        {/* 实体换色：选中实体时显示色板（线/面/体通用） */}
        {hasEntitySelected && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">颜色</span>
            {ENTITY_COLORS.map(c => (
              <button key={c} onClick={() => setEntityColor(c)} title={`设为 ${c}`}
                className={`w-4 h-4 rounded-full border border-black/20 dark:border-white/30 transition-transform hover:scale-110 ${selEntityColor === c ? 'ring-2 ring-cyan-400 ring-offset-1 dark:ring-offset-zinc-900' : ''}`}
                style={{ background: c }} />
            ))}
          </div>
        )}
        <span className={`${hasEntitySelected ? '' : 'ml-auto'} text-[11px] text-gray-400 dark:text-zinc-500`}>{points.length} 点 · {entities.length} 实体 · 选中 {selected.length}</span>
      </div>

      {/* 特殊点函数输入条 */}
      {showSpecial && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900">
          <span className="text-[11px] font-medium text-red-600 dark:text-red-400">函数特殊点</span>
          <input value={specialFx} onChange={e => setSpecialFx(e.target.value)}
            placeholder="y=f(x) 如 x^2-2 或 sin(x)，求零点/极值"
            className="flex-1 px-2 py-1 rounded-md bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-red-400" />
        </div>
      )}

      {/* 预置对象输入条：函数曲线 / 三维体 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-950/30 border-b border-violet-200 dark:border-violet-900">
        <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">函数/三维体</span>
        <input value={presetInput} onChange={e => setPresetInput(e.target.value)}
          placeholder="输入函数 y=x^2 或三维体 cube / sphere / cylinder，与手工点/线共存"
          className="flex-1 px-2 py-1 rounded-md bg-white dark:bg-zinc-800 border border-violet-200 dark:border-violet-800 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-400" />
        {presetInput.trim() && (
          <button onClick={() => setPresetInput('')} className="px-2 py-1 rounded-md text-[11px] font-medium bg-violet-500 text-white hover:bg-violet-600">清除</button>
        )}
      </div>

      {/* 3D 画布 */}
      <div className="flex-1 relative">
        <Canvas gl={{ antialias: true, alpha: true }} camera={{ position: [6, 4.5, 7], fov: 45 }} style={{ background: 'transparent' }}>
          <ambientLight intensity={isDark ? 0.7 : 0.9} />
          <directionalLight position={[6, 8, 4]} intensity={1} />

          <Grid position={[0, -0.02, 0]} args={[10, 10]} cellSize={1} cellThickness={0.6}
            cellColor={isDark ? '#334155' : '#cbd5e1'} sectionSize={5} sectionThickness={1.2}
            sectionColor={isDark ? '#475569' : '#94a3b8'} fadeDistance={40} fadeStrength={1.2} infiniteGrid />
          <Axes isDark={isDark} />

          {presetGraph && <PresetObjects graph={presetGraph} isDark={isDark} />}
          {renderEntities}
          {renderPoints}
          {renderSpecial}
          {/* 选中目标的三维轴 gizmo（3D 模式：点拖轴移动点 / 实体拖轴整体平移；轴自带命中区与拖动逻辑） */}
          {gizmoTarget && <Gizmo3D target={gizmoTarget} points={points} entities={entities}
            getLive={getLive} setLive={setLive} clearLive={clearLive} onMove={movePoint}
            transformEntity={transformPoints} setDragActive={setDragActive} onSelect={toggleSelect} />}

          <GroundClick tool={tool} viewMode={viewMode} onGroundClick={createPoint} />

          <CameraRig viewMode={viewMode} />
          <OrbitControls enableDamping dampingFactor={0.08} makeDefault enabled={!dragActive} />
        </Canvas>

        <div className="absolute bottom-2.5 left-3 right-3 px-3 py-1.5 rounded-lg bg-black/50 dark:bg-white/10 backdrop-blur-md text-[11px] text-white/85">
          {status}
        </div>
      </div>
    </div>
  );
};

function kindName(kind: EntityKind): string {
  return kind === 'line' ? '连线' : kind === 'segment' ? '连线段' : kind === 'plane' ? '成面' : kind === 'circle' ? '画圆' : kind === 'polygon' ? '建多边形' : '成体';
}

function ToolBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${active ? 'bg-cyan-600 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}>
      {label}
    </button>
  );
}

// 坐标轴
function Axes({ isDark }: { isDark: boolean }) {
  const { axes, cleanup } = useMemo(() => {
    const colors = [isDark ? '#f87171' : '#dc2626', isDark ? '#4ade80' : '#16a34a', isDark ? '#60a5fa' : '#2563eb'];
    const arrs: Array<[[number, number, number], [number, number, number]]> = [
      [[-6, 0, 0], [6, 0, 0]],
      [[0, -6, 0], [0, 6, 0]],
      [[0, 0, -6], [0, 0, 6]],
    ];
    const axes = arrs.map((a, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a[0], ...a[1]], 3));
      const m = new THREE.LineBasicMaterial({ color: colors[i] });
      return new THREE.Line(g, m);
    });
    return { axes, cleanup: () => axes.forEach(o => { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }) };
  }, [isDark]);
  useEffect(() => cleanup, [cleanup]);
  return <group>{axes.map((a, i) => <primitive key={i} object={a} />)}</group>;
}

// 点 mesh：可拖动。拖动期间用 live-ref 直改 mesh position（不触发 React 重渲染），
// 实体组件通过 getLive 联动；pointerup 一次性提交 setPoints。
// 注意：hitbox 只覆盖点本身（0.35），沿轴拖动由 Gizmo3D 的轴命中区负责——缩小 hitbox 避免挡住/误选实体
function GeoPointMesh({ point, color, selected, onSelect, onMove, viewMode, setDragActive, getLive, setLive, clearLive }: {
  point: GeoPoint;
  color: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number, z: number) => void;
  viewMode: ViewMode;
  setDragActive: (v: boolean) => void;
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
  setLive: (id: string, x: number, y: number, z: number) => void;
  clearLive: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const dragState = useRef<{
    id: string;
    start: [number, number, number];
    hitStart: [number, number, number];
    latest: [number, number, number];
    moved: boolean;
    planeConst: number; // 拖动平面过点：normal·point，保证点不在视图平面上时也跟手且不破坏三维坐标
  } | null>(null);
  const draggingRef = useRef(false);
  // 复用 raycast 对象，避免拖动期间每帧分配
  const raycasterRef = useRef(new THREE.Raycaster()).current;
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(), 0)).current;
  const hitRef = useRef(new THREE.Vector3()).current;
  const { camera, pointer } = useThree();
  const label = useMemo(() => makeTextSprite(point.label || '·', selected ? '#ffffff' : color, 44), [point.label, selected, color]);
  const planeInfo = useMemo(() => getPlaneInfo(viewMode), [viewMode]);

  // label 重建时释放旧 Sprite 的 texture/material（防泄漏）
  useEffect(() => () => {
    label.material.map?.dispose();
    label.material.dispose();
  }, [label]);

  // 投射 pointer 到当前视图平面，返回命中点（未命中返回 null）
  // planeConst：normal·point（点沿法向的坐标）。拖动平面过点本身：normal·p - normal·point = 0，
  // THREE.Plane 约定 normal·p + constant = 0 → constant = -normal·point = -planeConst。
  // 点不在视图平面上时拖动也跟手，且不改变三维坐标（保留空间点如 [1,1,1]）
  const projectPointer = useCallback((planeConst = 0) => {
    raycasterRef.setFromCamera(pointer, camera);
    planeRef.normal.set(planeInfo.normal[0], planeInfo.normal[1], planeInfo.normal[2]);
    planeRef.constant = -planeConst;
    return raycasterRef.ray.intersectPlane(planeRef, hitRef);
  }, [pointer, camera, planeInfo, raycasterRef, planeRef, hitRef]);

  useFrame(() => {
    // 非拖动：每帧把 group 位置同步到 point（JSX position 在拖动激活的 setState 渲染时可能覆盖，这里兜底）
    if (groupRef.current) groupRef.current.position.set(point.x, point.y, point.z);
    const ds = dragState.current;
    if (!ds) return;
    const hit = projectPointer(ds.planeConst);
    if (!hit) return;
    const [sx, sy, sz] = ds.start;
    const [hx, hy, hz] = ds.hitStart;
    const nx = sx + (hit.x - hx), ny = sy + (hit.y - hy), nz = sz + (hit.z - hz);
    ds.latest = [nx, ny, nz];
    // 位移阈值：按下后世界位移 < 0.06 视为"点击"（不移动、不激活拖动，避免点选被微抖挪动）
    if (!ds.moved && Math.hypot(hit.x - hx, hit.y - hy, hit.z - hz) < 0.06) return;
    if (!ds.moved) {
      ds.moved = true;
      draggingRef.current = true;
      setDragging(true);
      setDragActive(true); // 禁用 OrbitControls，防止拖点带动画面
    }
    // 拖动期间 ref 直改 mesh position（不触发 React 渲染）
    if (groupRef.current) groupRef.current.position.set(nx, ny, nz);
    setLive(ds.id, nx, ny, nz);
  });

  // 结束拖动：拖动过 → 提交最终坐标；否则视为点击（选中）
  const endDrag = useCallback((commit: boolean) => {
    const ds = dragState.current;
    dragState.current = null;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragging(false);
    setDragActive(false);
    document.body.style.cursor = 'default';
    if (ds && (wasDragging || ds.moved)) {
      if (commit) {
        const [nx, ny, nz] = ds.latest;
        clearLive(ds.id);
        onMove(ds.id, nx, ny, nz);
      } else {
        clearLive(ds.id);
      }
    } else if (ds) {
      onSelect(point.id); // 点击选中
    }
  }, [setDragActive, onMove, onSelect, clearLive, point.id]);

  return (
    <group ref={groupRef} position={[point.x, point.y, point.z]}>
      <mesh key="ball">
        <sphereGeometry args={[dragging ? 0.17 : 0.12, 16, 16]} />
        <meshBasicMaterial color={selected ? '#ffffff' : color} />
      </mesh>
      {/* 命中区：事件绑在有几何的 mesh 上（R3F 事件只 raycast 带 handler 的对象，group 无几何点不中/拖不动）
          半径 0.65 覆盖点本身（球 0.12 + 环 0.22 + 标签，点击容差 ~3 倍）；沿轴拖动由 Gizmo3D 的轴命中区负责（0.65~1.21），
          点 hitbox 小 → 点击点不再"放行穿透"到实体 → 修复误选线/面/体 */}
      <mesh key="hit"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopPropagation();
          // 阻止同元素后续 listener（OrbitControls 的 canvas pointerdown）进入 ROTATE：
          // 仅 stopPropagation 拦不住（同一元素其他 listener 照常执行），不拦则拖动结束后
          // OrbitControls 残留旋转速度在 up 后惯性滑行，画面自己转 ~10°
          e.nativeEvent.stopImmediatePropagation();
          // R3F 内部 pointer capture：按下即捕获，鼠标移出 hitbox 后 pointerup 仍直达本 mesh
          // （R3F 事件系统对 pointerup 仍做 raycast，仅 DOM setPointerCapture 无法让 up 送达移出后的对象）
          try { (e.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
          // 平面拖动基准：视图平面（过点，planeConst = normal·point）
          const planeConst = planeInfo.normal[0] * point.x + planeInfo.normal[1] * point.y + planeInfo.normal[2] * point.z;
          const hit = projectPointer(planeConst);
          if (hit) {
            dragState.current = {
              id: point.id,
              start: [point.x, point.y, point.z],
              hitStart: [hit.x, hit.y, hit.z],
              latest: [point.x, point.y, point.z],
              moved: false,
              planeConst,
            };
            draggingRef.current = false;
            document.body.style.cursor = 'grabbing';
          }
        }}
        onPointerUp={(e) => {
          // 只 R3F 层面 stopPropagation；原生事件放行到 document，让 OrbitControls 收到 pointerup 重置状态（否则 state 残留 ROTATE 导致后续移动旋转相机）
          e.stopPropagation();
          try { (e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
          endDrag(true);
        }}
        onPointerCancel={(e) => {
          e.stopPropagation();
          try { (e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
          endDrag(true);
        }}
        onPointerOver={(e) => { e.stopPropagation(); if (!draggingRef.current) document.body.style.cursor = 'grab'; }}
        onPointerOut={() => { if (!draggingRef.current) document.body.style.cursor = 'default'; }}>
        <sphereGeometry args={[0.65, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh key="ring">
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} wireframe />
        </mesh>
      )}
      <primitive key="label" object={label} position={[0, 0.32, 0]} />
    </group>
  );
}

// 三维轴 gizmo（点/实体通用）：3D 模式选中目标显示 XYZ 轴，拖轴沿轴移动
// 轴自带透明命中区（R3F raycast 命中 cylinder），拖动逻辑在本组件内（不再依赖点的 hitbox 判断）
const AXIS_GIZMO_AXES = [
  { dir: [1, 0, 0] as [number, number, number], color: '#ef4444', rot: [0, 0, -Math.PI / 2] as [number, number, number] },
  { dir: [0, 1, 0] as [number, number, number], color: '#22c55e', rot: [0, 0, 0] as [number, number, number] },
  { dir: [0, 0, 1] as [number, number, number], color: '#3b82f6', rot: [Math.PI / 2, 0, 0] as [number, number, number] },
];

type GizmoTarget = { kind: 'point' | 'entity'; id: string } | null;

function Gizmo3D({ target, points, entities, getLive, setLive, clearLive, onMove, transformEntity, setDragActive, onSelect }: {
  target: NonNullable<GizmoTarget>;
  points: GeoPoint[];
  entities: GeoEntity[];
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
  setLive: (id: string, x: number, y: number, z: number) => void;
  clearLive: (id: string) => void;
  onMove: (id: string, x: number, y: number, z: number) => void;
  transformEntity: (ids: string[], fn: (p: GeoPoint) => GeoPoint) => void;
  setDragActive: (v: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, pointer } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster()).current;
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(), 0)).current;
  const hitRef = useRef(new THREE.Vector3()).current;
  const screenDirRef = useRef(new THREE.Vector3()).current;
  const ptVecRef = useRef(new THREE.Vector3()).current;
  // 拖动状态：axisDir 非 null 表示沿轴；planeOrigin = 按下时目标位置（屏幕平面固定，拖动中不随目标移动）
  const dragRef = useRef<{
    axisDir: [number, number, number];
    start: [number, number, number];
    planeOrigin: [number, number, number];
    hitStart: [number, number, number];
    lastDisp: number;
    moved: boolean;
  } | null>(null);

  // 目标当前原点（点：state 坐标；实体：其点均值）
  const point = target.kind === 'point' ? getPoint(points, target.id) : undefined;
  const entity = target.kind === 'entity' ? entities.find(e => e.id === target.id) : undefined;
  const pts = entity ? entity.pointIds.map(id => getPoint(points, id)).filter(Boolean) as GeoPoint[] : [];
  const origin: [number, number, number] = useMemo(() => {
    if (target.kind === 'point') return point ? [point.x, point.y, point.z] : [0, 0, 0];
    const c: [number, number, number] = [0, 0, 0];
    if (pts.length) for (const p of pts) { c[0] += p.x / pts.length; c[1] += p.y / pts.length; c[2] += p.z / pts.length; }
    return c;
  }, [target, point, pts]);
  const originRef = useRef(origin);
  originRef.current = origin;
  if (target.kind === 'entity' && pts.length === 0) return null;

  // 屏幕平面（过 planeOrigin、法向相机方向）投影
  const projectScreen = useCallback((o: [number, number, number]) => {
    raycasterRef.setFromCamera(pointer, camera);
    camera.getWorldDirection(screenDirRef);
    ptVecRef.set(o[0], o[1], o[2]);
    planeRef.normal.copy(screenDirRef);
    planeRef.constant = -screenDirRef.dot(ptVecRef);
    return raycasterRef.ray.intersectPlane(planeRef, hitRef);
  }, [pointer, camera, raycasterRef, screenDirRef, planeRef, ptVecRef]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    // 位置跟随：点拖动期间坐标在 live-ref（不触发 React 渲染）→ 每帧读 live 同步；
    // 实体拖动走 transformEntity（state 更新重渲染）→ origin 已是最新
    if (target.kind === 'point') {
      const lv = getLive(target.id);
      g.position.set(lv ? lv.x : origin[0], lv ? lv.y : origin[1], lv ? lv.z : origin[2]);
    } else {
      g.position.set(origin[0], origin[1], origin[2]);
    }
    const ds = dragRef.current;
    if (!ds) return;
    const hit = projectScreen(ds.planeOrigin);
    if (!hit) return;
    const [dx, dy, dz] = ds.axisDir;
    const disp = (hit.x - ds.hitStart[0]) * dx + (hit.y - ds.hitStart[1]) * dy + (hit.z - ds.hitStart[2]) * dz;
    // 位移阈值：按下后世界位移 < 0.06 视为"轻点"（不移动、选中目标）
    if (!ds.moved && Math.hypot(hit.x - ds.hitStart[0], hit.y - ds.hitStart[1], hit.z - ds.hitStart[2]) < 0.06) return;
    if (!ds.moved) { ds.moved = true; setDragActive(true); }
    if (target.kind === 'point') {
      const nx = ds.start[0] + dx * disp, ny = ds.start[1] + dy * disp, nz = ds.start[2] + dz * disp;
      g.position.set(nx, ny, nz);
      setLive(target.id, nx, ny, nz);
    } else {
      // 实体：应用位移增量（每帧相对上一帧），实时更新 state（实体几何联动）
      const delta = disp - ds.lastDisp;
      ds.lastDisp = disp;
      if (Math.abs(delta) > 1e-4) {
        transformEntity(entity!.pointIds, p => ({ ...p, x: p.x + dx * delta, y: p.y + dy * delta, z: p.z + dz * delta }));
      }
    }
  });

  const endDrag = useCallback(() => {
    const ds = dragRef.current;
    dragRef.current = null;
    setDragActive(false);
    document.body.style.cursor = 'default';
    if (ds && ds.moved) {
      if (target.kind === 'point') {
        const lv = getLive(target.id);
        if (lv) {
          clearLive(target.id);
          onMove(target.id, lv.x, lv.y, lv.z);
        }
      }
      // 实体：增量已实时提交到 state，无需额外提交
    } else if (ds) {
      onSelect(target.id); // 轻点轴：选中目标
    }
  }, [setDragActive, target, getLive, clearLive, onMove, onSelect]);

  const axisHandlers = (dir: [number, number, number]) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      e.nativeEvent.stopImmediatePropagation(); // 阻止 OrbitControls 进入 ROTATE（拖动不转画面）
      try { (e.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      const o = originRef.current;
      const hit = projectScreen(o);
      if (hit) {
        dragRef.current = {
          axisDir: dir,
          start: o,
          planeOrigin: o,
          hitStart: [hit.x, hit.y, hit.z],
          lastDisp: 0,
          moved: false,
        };
        document.body.style.cursor = 'grabbing';
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      try { (e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
      endDrag();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      e.stopPropagation();
      try { (e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
      endDrag();
    },
  });

  return (
    <group ref={groupRef} position={origin}>
      {AXIS_GIZMO_AXES.map((ax, i) => (
        <group key={i} rotation={ax.rot}>
          {/* 轴杆（从点外部 0.18~1.2 伸出） */}
          <mesh position={[0, 0.69, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 1.02, 8]} />
            <meshBasicMaterial color={ax.color} />
          </mesh>
          {/* 箭头锥体 */}
          <mesh position={[0, 1.24, 0]}>
            <coneGeometry args={[0.08, 0.2, 10]} />
            <meshBasicMaterial color={ax.color} />
          </mesh>
          {/* 命中区：透明粗 cylinder（0.65~1.21 覆盖轴，半径 0.15 容差 ~5 倍视觉），承接沿轴拖动（R3F 只 raycast 带 handler 的对象） */}
          <mesh position={[0, 0.93, 0]} {...axisHandlers(ax.dir)}>
            <cylinderGeometry args={[0.15, 0.15, 0.56, 10]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// 四面体各三角面（索引）
const SOLID_FACES_4 = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] as const;
// 多面体边对（n 点：环边 + 从顶点 0 辐射）
function solidPairs(n: number): Array<[number, number]> {
  if (n === 4) return [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const p: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) p.push([i, (i + 1) % n]);
  for (let i = 1; i < n; i++) p.push([0, i]);
  return p;
}

// 实体 mesh：按类型分发到子组件（每个子组件 hooks 一致，避免"more hooks"错误）
// 支持整体拖动：select 拖=平移，旋转工具拖=绕视图方向旋转，缩放工具拖=绕中心缩放
function EntityMesh({ entity, points, selected, onSelect, getLive, tool, viewMode, transformEntity, isDark }: {
  entity: GeoEntity;
  points: GeoPoint[];
  selected: boolean;
  onSelect: () => void;
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
  tool: Tool;
  viewMode: ViewMode;
  transformEntity: (ids: string[], fn: (p: GeoPoint) => GeoPoint) => void;
  isDark?: boolean;
}) {
  const pts = entity.pointIds.map(id => getPoint(points, id)).filter(Boolean) as GeoPoint[];
  // 按类型校验所需点数，防删除点后悬挂实体崩溃
  const need = entity.kind === 'line' || entity.kind === 'segment' ? 2
    : entity.kind === 'plane' || entity.kind === 'polygon' || entity.kind === 'circle' ? 3 : 4;
  if (pts.length < need) return null;

  const { camera, pointer } = useThree();
  const planeInfo = useMemo(() => getPlaneInfo(viewMode), [viewMode]);
  const raycasterRef = useRef(new THREE.Raycaster()).current;
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(), 0)).current;
  const hitRef = useRef(new THREE.Vector3()).current;
  const fwdRef = useRef(new THREE.Vector3()).current;
  const rightRef = useRef(new THREE.Vector3()).current;
  const upVecRef = useRef(new THREE.Vector3()).current;
  const dragRef = useRef<{
    mode: 'move' | 'rotate' | 'scale';
    center: [number, number, number];
    hitStart: [number, number, number];
    planeConst: number;
    startDist: number;
    moved: boolean;
    lastHit: [number, number, number];
    lastTheta: number;
    lastS: number;
  } | null>(null);

  const center = useMemo(() => {
    const c: [number, number, number] = [0, 0, 0];
    if (pts.length) {
      for (const p of pts) { c[0] += p.x / pts.length; c[1] += p.y / pts.length; c[2] += p.z / pts.length; }
    }
    return c;
  }, [pts]);

  const project = (constVal: number) => {
    raycasterRef.setFromCamera(pointer, camera);
    planeRef.normal.set(planeInfo.normal[0], planeInfo.normal[1], planeInfo.normal[2]);
    planeRef.constant = -constVal;
    return raycasterRef.ray.intersectPlane(planeRef, hitRef);
  };

  const mode = tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'move';

  const applyTransform = (hit: THREE.Vector3) => {
    const ds = dragRef.current;
    if (!ds) return;
    if (ds.mode === 'move') {
      // 平移：应用每帧位移增量（相对上次 hit），避免累积
      const dx = hit.x - ds.lastHit[0], dy = hit.y - ds.lastHit[1], dz = hit.z - ds.lastHit[2];
      ds.lastHit = [hit.x, hit.y, hit.z];
      transformEntity(entity.pointIds, p => ({ ...p, x: p.x + dx, y: p.y + dy, z: p.z + dz }));
    } else if (ds.mode === 'rotate') {
      // 绕视图方向旋转：角度增量（当前总角度 - 上次总角度）
      camera.getWorldDirection(fwdRef);
      rightRef.crossVectors(fwdRef, camera.up).normalize();
      upVecRef.crossVectors(rightRef, fwdRef).normalize();
      const ang = (px: number, py: number, pz: number) => Math.atan2(
        (px - ds.center[0]) * upVecRef.x + (py - ds.center[1]) * upVecRef.y + (pz - ds.center[2]) * upVecRef.z,
        (px - ds.center[0]) * rightRef.x + (py - ds.center[1]) * rightRef.y + (pz - ds.center[2]) * rightRef.z,
      );
      const theta = ang(hit.x, hit.y, hit.z) - ang(ds.hitStart[0], ds.hitStart[1], ds.hitStart[2]);
      const delta = theta - ds.lastTheta;
      ds.lastTheta = theta;
      if (Math.abs(delta) < 0.001) return;
      const axis: [number, number, number] = [fwdRef.x, fwdRef.y, fwdRef.z];
      transformEntity(entity.pointIds, p => {
        const [rx, ry, rz] = rotateVecAround([p.x - ds.center[0], p.y - ds.center[1], p.z - ds.center[2]], axis, delta);
        return { ...p, x: ds.center[0] + rx, y: ds.center[1] + ry, z: ds.center[2] + rz };
      });
    } else {
      // 缩放：比例增量（当前比例 / 上次比例）
      const dist = Math.hypot(hit.x - ds.center[0], hit.y - ds.center[1], hit.z - ds.center[2]);
      const s = ds.startDist > 0.001 ? dist / ds.startDist : 1;
      const delta = s / ds.lastS;
      ds.lastS = s;
      if (Math.abs(delta - 1) < 0.001) return;
      transformEntity(entity.pointIds, p => ({
        ...p,
        x: ds.center[0] + (p.x - ds.center[0]) * delta,
        y: ds.center[1] + (p.y - ds.center[1]) * delta,
        z: ds.center[2] + (p.z - ds.center[2]) * delta,
      }));
    }
  };

  useFrame(() => {
    const ds = dragRef.current;
    if (!ds) return;
    const hit = project(ds.planeConst);
    if (!hit) return;
    ds.moved = true;
    applyTransform(hit);
  });

  const handlePtrDown = (e: { stopPropagation: () => void; nativeEvent?: { stopImmediatePropagation: () => void }; intersections?: Array<{ eventObject: unknown }> }) => {
    // 最近命中守卫：点击点（点 hitbox 更近）时实体即使命中也不接管（R3F 按距离分发，最近者优先）
    const nearest = e.intersections?.[0];
    if (!nearest || nearest.eventObject !== hitMeshRef.current) return;
    e.stopPropagation();
    // 同 GeoPointMesh：阻止 OrbitControls 进入 ROTATE（拖实体时画面不跟着转/不惯性滑行）
    e.nativeEvent?.stopImmediatePropagation();
    const c = center;
    const planeConst = planeInfo.normal[0] * c[0] + planeInfo.normal[1] * c[1] + planeInfo.normal[2] * c[2];
    const hit = project(planeConst);
    if (hit) {
      dragRef.current = {
        mode,
        center: c,
        hitStart: [hit.x, hit.y, hit.z],
        planeConst,
        startDist: Math.hypot(hit.x - c[0], hit.y - c[1], hit.z - c[2]),
        moved: false,
        lastHit: [hit.x, hit.y, hit.z],
        lastTheta: 0,
        lastS: 1,
      };
    }
  };
  const handlePtrUp = (e: { stopPropagation: () => void; intersections?: Array<{ eventObject: unknown }> }) => {
    const nearest = e.intersections?.[0];
    if (!nearest || nearest.eventObject !== hitMeshRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  };

  // ── 命中几何：按实体形状（≈视觉大小），不用包围球（长线/大面的包围球是视觉的 10 倍+ → 误触）──
  // 坐标 key：点坐标不变时 useMemo 不重建（拖动实体每帧 setPoints 时避免每帧 new geometry）
  const coordKey = pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).join('|');
  // 线/线段：细圆柱（半径 0.15，两端各收口 0.35——端点即点，收口保证点击端点时点优先）
  const lineHitGeo = useMemo(() => {
    if (entity.kind !== 'line' && entity.kind !== 'segment') return null;
    const a = pts[0], b = pts[1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
    if (len < 0.8) return null; // 太短：无本体命中区（靠端点/轴操作）
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const geo = new THREE.CylinderGeometry(0.15, 0.15, len - 0.7, 8, 1, true);
    geo.computeBoundingSphere();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, uy, uz));
    const pos: [number, number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    return { geo, pos, quat };
  }, [entity.kind, coordKey, pts]);
  // 面/多边形/圆：三角面本身
  const faceHitGeo = useMemo(() => {
    if (entity.kind !== 'plane' && entity.kind !== 'polygon' && entity.kind !== 'circle') return null;
    const [a, b, c] = pts;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]), 3));
    geo.computeBoundingSphere();
    return { geo, pos: [0, 0, 0] as [number, number, number], quat: null };
  }, [entity.kind, coordKey, pts]);
  // 体：四个三角面
  const solidHitGeo = useMemo(() => {
    if (entity.kind !== 'solid') return null;
    const faceIdx = pts.length === 4 ? SOLID_FACES_4 : [];
    const fPos = new Float32Array(faceIdx.length * 9);
    faceIdx.forEach(([i, j, k], idx) => {
      const o = idx * 9;
      fPos[o] = pts[i].x; fPos[o + 1] = pts[i].y; fPos[o + 2] = pts[i].z;
      fPos[o + 3] = pts[j].x; fPos[o + 4] = pts[j].y; fPos[o + 5] = pts[j].z;
      fPos[o + 6] = pts[k].x; fPos[o + 7] = pts[k].y; fPos[o + 8] = pts[k].z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    geo.computeBoundingSphere();
    return { geo, pos: [0, 0, 0] as [number, number, number], quat: null };
  }, [entity.kind, coordKey, pts]);
  const hitMesh = lineHitGeo ?? faceHitGeo ?? solidHitGeo;
  const hitMeshRef = useRef<THREE.Mesh>(null);
  // 命中几何释放（拖动期间坐标变化会重建）
  useEffect(() => () => {
    [lineHitGeo, faceHitGeo, solidHitGeo].forEach(g => g?.geo.dispose());
  }, [lineHitGeo, faceHitGeo, solidHitGeo]);

  const color = selected ? '#fbbf24' : (entity.color || '#38bdf8');
  let child: React.ReactElement | null = null;
  if (entity.kind === 'line' || entity.kind === 'segment') {
    child = <LineEntity a={pts[0]} b={pts[1]} isLine={entity.kind === 'line'} color={color} getLive={getLive} />;
  } else if (entity.kind === 'plane' || entity.kind === 'polygon' || entity.kind === 'circle') {
    child = <FaceEntity a={pts[0]} b={pts[1]} c={pts[2]} color={color} getLive={getLive} />;
  } else if (entity.kind === 'solid') {
    // 棱线高亮：选中黄 / 平时白（深色）或深灰（浅色主题）
    const edgeColor = selected ? '#fbbf24' : (isDark ? '#f8fafc' : '#1e293b');
    child = <SolidEntity pts={pts} color={color} edgeColor={edgeColor} getLive={getLive} />;
  }
  if (!child) return null;
  return (
    <group>
      {/* 形状命中 mesh（≈视觉大小）：线=细圆柱（两端收口）、面/体=三角面；承接点击/拖动/选中 */}
      {hitMesh && (
        <mesh ref={hitMeshRef} geometry={hitMesh.geo} position={hitMesh.pos} quaternion={hitMesh.quat ?? undefined}
          onPointerDown={handlePtrDown}
          onPointerUp={handlePtrUp}
          onClick={(e) => {
            e.stopPropagation();
            // 最近命中守卫：R3F 的 click 会分发给"按下时命中的所有对象"（绕过 stopPropagation），
            // 点 A 在实体命中区内时点击 A 会误触发本 onClick → 误选线/面/体。
            // 只在"本实体是最近命中"时才响应点击（最近命中 = intersections[0]）
            const nearest = e.intersections?.[0];
            if (!nearest || nearest.eventObject !== hitMeshRef.current) return;
            onSelect();
          }}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {child}
    </group>
  );
}

// 线：拖动联动（getLive 读取被拖点实时坐标，原地更新 geometry）
// 用 LineSegments2 + LineMaterial 真实线宽（WebGL 下 LineBasicMaterial.linewidth 恒为 1px，太细）
function LineEntity({ a, b, isLine, color, getLive }: {
  a: GeoPoint; b: GeoPoint; isLine: boolean; color: string;
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
}) {
  const { size } = useThree();
  // 线材质：像素线宽 3（与体棱线/预置体一致），分辨率跟随画布尺寸
  const mat = useMemo(() => new LineMaterial({
    color,
    linewidth: 3,
    resolution: new THREE.Vector2(size.width, size.height),
  }), [color]);
  const geo = useMemo(() => {
    const extend = isLine ? 4 : 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx**2 + dy**2 + dz**2) || 1;
    const ux = dx/len, uy = dy/len, uz = dz/len;
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array([
      a.x - ux*extend, a.y - uy*extend, a.z - uz*extend,
      b.x + ux*extend, b.y + uy*extend, b.z + uz*extend,
    ]));
    return g;
  }, [a, b, isLine]);
  const lineObj = useMemo(() => {
    const o = new LineSegments2(geo, mat);
    o.frustumCulled = false; // 拖动中 boundingSphere 频繁变化，关闭视锥裁剪防闪烁
    return o;
  }, [geo, mat]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useEffect(() => { mat.resolution.set(size.width, size.height); }, [mat, size]);

  useFrame(() => {
    const pa = getLive(a.id), pb = getLive(b.id);
    if (!pa && !pb) return;
    const ax = pa ? pa.x : a.x, ay = pa ? pa.y : a.y, az = pa ? pa.z : a.z;
    const bx = pb ? pb.x : b.x, by = pb ? pb.y : b.y, bz = pb ? pb.z : b.z;
    const extend = isLine ? 4 : 0;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx**2 + dy**2 + dz**2) || 1;
    const ux = dx/len, uy = dy/len, uz = dz/len;
    const st = geo.attributes.instanceStart as THREE.BufferAttribute;
    const en = geo.attributes.instanceEnd as THREE.BufferAttribute;
    st.setXYZ(0, ax - ux*extend, ay - uy*extend, az - uz*extend);
    en.setXYZ(0, bx + ux*extend, by + uy*extend, bz + uz*extend);
    st.needsUpdate = true;
    en.needsUpdate = true;
  });

  return <primitive object={lineObj} />;
}

// 面/多边形：半透明三角 + 描边（LineSegments2 真实线宽 3px，拖动实时联动）
function FaceEntity({ a, b, c, color, getLive }: {
  a: GeoPoint; b: GeoPoint; c: GeoPoint; color: string;
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
}) {
  const faceRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  const { faceGeo, edgeGeo, edgeMat, edgeObj, cleanup } = useMemo(() => {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z]), 3));
    fg.computeVertexNormals();
    fg.computeBoundingSphere();
    // 描边 = 闭合三角形三条边（a-b, b-c, c-a）
    const eg = new LineSegmentsGeometry();
    eg.setPositions(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z,
      b.x,b.y,b.z, c.x,c.y,c.z,
      c.x,c.y,c.z, a.x,a.y,a.z,
    ]));
    const em = new LineMaterial({
      color,
      linewidth: 3,
      resolution: new THREE.Vector2(size.width, size.height),
    });
    const eo = new LineSegments2(eg, em);
    eo.frustumCulled = false; // 拖动中关闭视锥裁剪防闪烁
    return { faceGeo: fg, edgeGeo: eg, edgeMat: em, edgeObj: eo, cleanup: () => { fg.dispose(); eg.dispose(); em.dispose(); } };
  }, [a, b, c, color]);
  useEffect(() => cleanup, [cleanup]);
  useEffect(() => { edgeMat.resolution.set(size.width, size.height); }, [edgeMat, size]);

  useFrame(() => {
    const pa = getLive(a.id), pb = getLive(b.id), pc = getLive(c.id);
    if (!pa && !pb && !pc) return;
    const ax = pa ? pa.x : a.x, ay = pa ? pa.y : a.y, az = pa ? pa.z : a.z;
    const bx = pb ? pb.x : b.x, by = pb ? pb.y : b.y, bz = pb ? pb.z : b.z;
    const cx = pc ? pc.x : c.x, cy = pc ? pc.y : c.y, cz = pc ? pc.z : c.z;
    if (faceRef.current) {
      const pos = faceRef.current.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, ax, ay, az); pos.setXYZ(1, bx, by, bz); pos.setXYZ(2, cx, cy, cz);
      pos.needsUpdate = true;
      faceRef.current.geometry.computeVertexNormals();
    }
    const st = edgeGeo.attributes.instanceStart as THREE.BufferAttribute;
    const en = edgeGeo.attributes.instanceEnd as THREE.BufferAttribute;
    st.setXYZ(0, ax, ay, az); en.setXYZ(0, bx, by, bz);
    st.setXYZ(1, bx, by, bz); en.setXYZ(1, cx, cy, cz);
    st.setXYZ(2, cx, cy, cz); en.setXYZ(2, ax, ay, az);
    st.needsUpdate = true;
    en.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={faceRef} geometry={faceGeo}>
        <meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={edgeObj} />
    </group>
  );
}

// 体：高亮棱线（LineSegments2 真实线宽，白/黄）+ 半透明三角面 + 顶点球（棱线顶点亮色小球）
function SolidEntity({ pts, color, edgeColor, getLive }: {
  pts: GeoPoint[]; color: string; edgeColor: string;
  getLive: (id: string) => { x: number; y: number; z: number } | undefined;
}) {
  const edgesRef = useRef<LineSegments2>(null);
  const facesRef = useRef<THREE.Mesh>(null);
  const vertexRefs = useRef<Array<THREE.Mesh | null>>([]);
  const pointIds = useMemo(() => pts.map(p => p.id), [pts]);
  const { size } = useThree();
  // 棱线材质：LineMaterial 支持真实线宽（像素单位）；分辨率跟随画布尺寸
  const edgesMat = useMemo(() => new LineMaterial({
    color: edgeColor,
    linewidth: 3,
    resolution: new THREE.Vector2(size.width, size.height),
  }), [edgeColor]);
  const edgesGeo = useMemo(() => {
    const pairs = solidPairs(pts.length);
    const pos = new Float32Array(pairs.length * 6);
    pairs.forEach(([i, j], k) => {
      const o = k * 6;
      pos[o] = pts[i].x; pos[o+1] = pts[i].y; pos[o+2] = pts[i].z;
      pos[o+3] = pts[j].x; pos[o+4] = pts[j].y; pos[o+5] = pts[j].z;
    });
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    return g;
  }, [pts]);
  const edgesObj = useMemo(() => {
    const obj = new LineSegments2(edgesGeo, edgesMat);
    obj.frustumCulled = false; // 拖动中 boundingSphere 频繁变化，关闭视锥裁剪防闪烁
    return obj;
  }, [edgesGeo, edgesMat]);
  const { facesGeo, cleanup } = useMemo(() => {
    const faceIdx = pts.length === 4 ? SOLID_FACES_4 : [];
    const fPos = new Float32Array(faceIdx.length * 9);
    faceIdx.forEach(([i, j, k], idx) => {
      const o = idx * 9;
      fPos[o] = pts[i].x; fPos[o+1] = pts[i].y; fPos[o+2] = pts[i].z;
      fPos[o+3] = pts[j].x; fPos[o+4] = pts[j].y; fPos[o+5] = pts[j].z;
      fPos[o+6] = pts[k].x; fPos[o+7] = pts[k].y; fPos[o+8] = pts[k].z;
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    fg.computeVertexNormals();
    return { facesGeo: fg, cleanup: () => fg.dispose() };
  }, [pts]);
  useEffect(() => cleanup, [cleanup]);
  useEffect(() => () => { edgesGeo.dispose(); edgesMat.dispose(); }, [edgesGeo, edgesMat]);
  // 分辨率跟随画布尺寸（窗口缩放后线宽不畸变）
  useEffect(() => { edgesMat.resolution.set(size.width, size.height); }, [edgesMat, size]);

  // 顶点球：共享 geometry/material（多个 mesh 引用同一实例，卸载一次释放）
  const vertexGeo = useMemo(() => new THREE.SphereGeometry(0.1, 12, 12), []);
  const vertexMat = useMemo(() => new THREE.MeshBasicMaterial({ color: edgeColor }), [edgeColor]);
  useEffect(() => () => { vertexGeo.dispose(); vertexMat.dispose(); }, [vertexGeo, vertexMat]);

  useFrame(() => {
    if (!pointIds.some(id => getLive(id))) return;
    const coords = pts.map((p, i) => {
      const lv = getLive(pointIds[i]);
      return lv ? [lv.x, lv.y, lv.z] : [p.x, p.y, p.z];
    });
    if (edgesRef.current) {
      // LineSegmentsGeometry：instanceStart/instanceEnd 直改（拖动实时联动）
      const st = edgesGeo.attributes.instanceStart as THREE.BufferAttribute;
      const en = edgesGeo.attributes.instanceEnd as THREE.BufferAttribute;
      solidPairs(coords.length).forEach(([i, j], k) => {
        st.setXYZ(k, coords[i][0], coords[i][1], coords[i][2]);
        en.setXYZ(k, coords[j][0], coords[j][1], coords[j][2]);
      });
      st.needsUpdate = true;
      en.needsUpdate = true;
    }
    if (facesRef.current && coords.length === 4) {
      const pos = facesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      SOLID_FACES_4.forEach(([i, j, k], idx) => {
        const o = idx * 3;
        pos.setXYZ(o, coords[i][0], coords[i][1], coords[i][2]);
        pos.setXYZ(o + 1, coords[j][0], coords[j][1], coords[j][2]);
        pos.setXYZ(o + 2, coords[k][0], coords[k][1], coords[k][2]);
      });
      pos.needsUpdate = true;
      facesRef.current.geometry.computeVertexNormals();
    }
    // 顶点球跟随 live（拖动中点实时联动）
    vertexRefs.current.forEach((m, i) => {
      if (!m) return;
      const lv = getLive(pointIds[i]);
      m.position.set(lv ? lv.x : (pts[i]?.x ?? 0), lv ? lv.y : (pts[i]?.y ?? 0), lv ? lv.z : (pts[i]?.z ?? 0));
    });
  });

  return (
    <group>
      <mesh ref={facesRef} geometry={facesGeo}>
        <meshBasicMaterial color={color} transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
      <primitive ref={edgesRef} object={edgesObj} />
      {/* 顶点球：棱线顶点亮色小球（点被隐藏时体仍完整；点可见时被点球覆盖无妨） */}
      {pts.map((p, i) => (
        <mesh key={i} ref={el => { vertexRefs.current[i] = el; }} position={[p.x, p.y, p.z]}>
          <primitive object={vertexGeo} attach="geometry" />
          <primitive object={vertexMat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

// ── 预置对象：函数曲线 / 曲面 / 三维体（与手工构造点线面共存） ──
// 按类型拆成独立子组件（hooks 一致），避免切换输入类型时"more hooks"错误
function PresetObjects({ graph, isDark }: { graph: ReturnType<typeof parseGraphInput>; isDark: boolean }) {
  if (graph.kind === 'curve') return <PresetCurve expr={graph.expr} variable={graph.vars[0] || 'x'} isDark={isDark} />;
  if (graph.kind === 'surface') return <PresetSurface expr={graph.expr} isDark={isDark} />;
  if (graph.kind === 'solid' && graph.solid) return <PresetSolid solid={graph.solid} isDark={isDark} />;
  return null;
}

// 一元函数曲线（画在 x-y 平面，函数值沿 Y）；Line2 + LineMaterial 真实线宽（LineBasicMaterial 恒 1px 太细）
function PresetCurve({ expr, variable, isDark }: { expr: string; variable: string; isDark: boolean }) {
  const points = useMemo(() => {
    const f = compileExpr(expr);
    const pts: number[] = [];
    if (!f) return pts;
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const x = -6 + (12 * i) / N;
      const y = f({ [variable]: x });
      if (y === null || !isFinite(y)) { pts.push(x, 0, 0); continue; }
      pts.push(x, Math.max(-8, Math.min(8, y)), 0);
    }
    return pts;
  }, [expr, variable]);
  const { size } = useThree();
  const { lineObj, cleanup } = useMemo(() => {
    if (points.length < 3) return { lineObj: null, cleanup: () => {} }; // 编译失败/无数据：不渲染
    const g = new LineGeometry();
    g.setPositions(points);
    const m = new LineMaterial({
      color: isDark ? '#22d3ee' : '#0891b2',
      linewidth: 3,
      resolution: new THREE.Vector2(size.width, size.height),
    });
    const o = new Line2(g, m);
    o.frustumCulled = false;
    return { lineObj: o, cleanup: () => { g.dispose(); m.dispose(); } };
  }, [points, isDark, size.width, size.height]);
  useEffect(() => cleanup, [cleanup]);
  if (!lineObj) return null;
  return <primitive object={lineObj} />;
}

// 二元曲面
function PresetSurface({ expr, isDark }: { expr: string; isDark: boolean }) {
  const mesh = useMemo(() => {
    const f = compileSurfaceExpr(expr);
    const evalFn = (x: number, y: number) => (f ? f(x, y) : null);
    return buildSurfaceMesh(evalFn, [-3, 3], [-3, 3], 48);
  }, [expr]);
  const { geo, cleanup } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    g.computeVertexNormals();
    const [, , , , zMin, zMax] = mesh.bounds;
    const colors = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const z = mesh.positions[i + 1];
      const t = Math.min(1, Math.max(0, (z - zMin) / (zMax - zMin)));
      const [r, gg, b] = zToColor(t);
      colors[i] = r; colors[i + 1] = gg; colors[i + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geo: g, cleanup: () => g.dispose() };
  }, [mesh]);
  useEffect(() => cleanup, [cleanup]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.85} />
    </mesh>
  );
}

// 三维体（预置）：半透明体 + 棱线勾勒（LineSegments2 真实线宽；cube 12 条边、cylinder 上下圆边；sphere 光滑无棱线）
function PresetSolid({ solid, isDark }: { solid: string; isDark: boolean }) {
  const color = isDark ? '#38bdf8' : '#0284c7';
  const edgeColor = isDark ? '#f8fafc' : '#1e293b';
  const { size } = useThree();
  // 棱线材质（像素线宽 3，分辨率跟随画布）
  const edgesMat = useMemo(() => new LineMaterial({
    color: edgeColor,
    linewidth: 3,
    resolution: new THREE.Vector2(size.width, size.height),
  }), [edgeColor]);
  // EdgesGeometry → LineSegmentsGeometry（取棱边，与几何体尺寸一致）
  const edgesGeo = useMemo(() => {
    let src: THREE.BufferGeometry | null = null;
    if (solid === 'cube') src = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
    else if (solid === 'cylinder') src = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 2.2, 32));
    if (!src) return null; // sphere 光滑面，无棱线
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array(src.attributes.position.array));
    src.dispose();
    return g;
  }, [solid]);
  useEffect(() => () => { edgesGeo?.dispose(); edgesMat.dispose(); }, [edgesGeo, edgesMat]);
  useEffect(() => { edgesMat.resolution.set(size.width, size.height); }, [edgesMat, size]);
  const edgesObj = useMemo(() => {
    if (!edgesGeo) return null;
    const o = new LineSegments2(edgesGeo, edgesMat);
    o.frustumCulled = false;
    return o;
  }, [edgesGeo, edgesMat]);

  return (
    <group>
      {solid === 'cube' && (
        <group>
          <mesh><boxGeometry args={[2, 2, 2]} /><meshStandardMaterial color={color} transparent opacity={0.45} /></mesh>
          {edgesObj && <primitive object={edgesObj} />}
        </group>
      )}
      {solid === 'sphere' && (
        <mesh><sphereGeometry args={[1.3, 32, 32]} /><meshStandardMaterial color={color} transparent opacity={0.45} /></mesh>
      )}
      {solid === 'cylinder' && (
        <group>
          <mesh><cylinderGeometry args={[1, 1, 2.2, 32]} /><meshStandardMaterial color={color} transparent opacity={0.45} /></mesh>
          {edgesObj && <primitive object={edgesObj} />}
        </group>
      )}
    </group>
  );
}

// 地面/平面点击层：投射到当前视图平面，tool==='point' 时点击建点
function GroundClick({ tool, viewMode, onGroundClick }: {
  tool: Tool;
  viewMode: ViewMode;
  onGroundClick: (x: number, y: number, z: number) => void;
}) {
  const { camera, pointer } = useThree();
  const planeInfo = useMemo(() => getPlaneInfo(viewMode), [viewMode]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(...planeInfo.normal), 0), [planeInfo]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const [hover, setHover] = useState(false);
  const planeMeshRef = useRef<THREE.Mesh>(null);
  // 按下屏幕位置（用于拖动阈值：旋转相机/拖拽不误建点）
  const downPos = useRef<[number, number] | null>(null);
  // 让位守卫：点击位置有其他对象（点/轴/实体）命中时，本平面不接管——
  // 透视下平面交点几乎总是比轴/实体更近，若不加守卫，其 stopPropagation 会吃掉点/轴的 down
  const hasOtherHit = (e: { intersections?: Array<{ eventObject: unknown }> }) =>
    !!e.intersections?.some(h => h.eventObject !== planeMeshRef.current);

  const handleClick = useCallback(() => {
    if (tool !== 'point') return; // 只有"加点"工具才建点
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (hit) {
      const [x, y, z] = planeInfo.mapHit(hit.x, hit.y, hit.z);
      onGroundClick(x, y, z);
    }
  }, [tool, raycaster, camera, pointer, plane, planeInfo, target, onGroundClick]);

  return (
    <mesh ref={planeMeshRef}
      onPointerDown={(e) => {
        if (hasOtherHit(e)) return; // 点/轴/实体命中时让位
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        downPos.current = [e.clientX, e.clientY];
      }}
      onPointerUp={(e) => {
        if (hasOtherHit(e)) return; // 让位（拖动结束/点击对象时平面不处理）
        // 只 R3F 层面 stopPropagation；原生放行到 document，让 OrbitControls 收到 pointerup 重置状态
        e.stopPropagation();
        // 位移阈值：按下抬起移动 < 6px 才算点击（旋转相机/拖拽不误建点）
        const dp = downPos.current;
        downPos.current = null;
        if (dp && Math.hypot(e.clientX - dp[0], e.clientY - dp[1]) < 6) {
          handleClick();
        }
      }}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}>
      {/* 大平面承接点击（旋转到当前视图平面朝向） */}
      <mesh rotation={viewMode === 'xy' ? [0, 0, 0] : viewMode === 'yz' ? [0, Math.PI / 2, 0] : [-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial color={hover ? '#22d3ee' : '#38bdf8'} transparent opacity={0.015} side={THREE.DoubleSide}
          depthWrite={false} depthTest={false} />
      </mesh>
    </mesh>
  );
}

// 相机适配：视图模式切换时把相机定位到平面法向，并同步 OrbitControls target
// 注意：不能调 controls.update()——它会用 controls 内部 spherical 覆盖相机位置（导致相机漂移/俯视动画）
function CameraRig({ viewMode }: { viewMode: ViewMode }) {
  const { camera } = useThree();
  const controls = useThree(s => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void } } | null;
  useEffect(() => {
    const pos = VIEW_CAMERA[viewMode];
    camera.position.set(...pos);
    camera.up.set(0, 1, 0);
    if (viewMode === 'xz') camera.up.set(0, 0, -1); // 俯视地面
    camera.lookAt(0, 0, 0);
    // 同步 target 到原点（仅设置，不 update——update 会用旧 spherical 覆盖相机位置）
    if (controls) {
      controls.target.set(0, 0, 0);
    }
  }, [viewMode, camera, controls]);
  return null;
}
