import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { GeneralProblemData, Scene, Block } from '../types/problem';
import { themeFor, getControl, registerAllControls } from '../components/blocks';

// 注册全部控件（必须在渲染前执行，防止 tree-shake 移除注册副作用）
registerAllControls();

interface Props {
  data: GeneralProblemData;
  isDark?: boolean;
}

const EASE_SMOOTH = Easing.bezier(0.25, 0.1, 0.25, 1);

export const MathTemplate: React.FC<Props> = ({ data, isDark = false }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();

  const theme = themeFor(isDark);
  const scenes: Scene[] = data.script?.scenes || [];
  const opening = data.script?.opening || '';
  const summary = data.script?.summary || '';
  const hasSummary = !!summary;

  // 每个场景的帧区间。优先用 AI 设计的时间轴（scene.duration 秒）；否则按配音文本长度比例分配。
  const sceneFrames = useMemo(() => {
    if (!scenes.length) return [];
    const hasDurations = scenes.every(s => typeof s.duration === 'number' && (s.duration as number) > 0);
    const totalSceneDur = hasDurations
      ? scenes.reduce((acc, s) => acc + (s.duration as number), 0)
      : 0;
    const total = hasDurations
      ? totalSceneDur
      : opening.length + scenes.reduce((acc, s) => acc + (s.spokenText || s.text).length, 0);
    if (total === 0) return scenes.map(() => ({ start: 0, end: durationInFrames }));

    const reserve = hasSummary ? fps * 4 : 0;
    const usable = Math.max(1, durationInFrames - reserve);
    // opening 为空时不预留开场空白帧
    const hasOpening = !!opening.trim();
    const openingFrames = hasDurations
      ? (hasOpening ? Math.min(usable, fps * 4) : 0)
      : Math.floor((opening.length / total) * usable);
    const sceneUsable = Math.max(1, usable - openingFrames);
    // 末场景至少保留 1 帧，避免中间场景四舍五入累计溢出导致 start > end
    const maxStart = Math.max(openingFrames, durationInFrames - reserve - 1);
    let cur = openingFrames;
    return scenes.map((s, i) => {
      if (i === scenes.length - 1) {
        return { start: Math.min(cur, maxStart), end: durationInFrames - reserve };
      }
      const weight = hasDurations ? s.duration as number : (s.spokenText || s.text).length;
      let seg = hasDurations
        ? Math.round((weight / totalSceneDur) * sceneUsable)
        : Math.floor((weight / total) * usable);
      seg = Math.max(1, seg);
      if (cur + seg > maxStart) seg = Math.max(1, maxStart - cur);
      const start = cur;
      cur = start + seg;
      return { start, end: cur };
    });
  }, [scenes, opening, durationInFrames, fps, hasSummary]);

  // 定位当前场景
  let idx = 0;
  for (let i = 0; i < sceneFrames.length; i++) {
    if (frame >= sceneFrames[i].start && frame < sceneFrames[i].end) { idx = i; break; }
    if (i === sceneFrames.length - 1 && frame >= sceneFrames[i].end) idx = i;
  }
  const isReadingPhase = sceneFrames.length > 0 && frame < sceneFrames[0].start;
  const currentScene = scenes[idx];
  const prevScene = idx > 0 ? scenes[idx - 1] : null;

  // 场景内推进进度（0-1）
  const rawProgress = sceneFrames.length > 0 && !isReadingPhase
    ? Math.min(1, Math.max(0, (frame - sceneFrames[idx].start) / Math.max(1, sceneFrames[idx].end - sceneFrames[idx].start)))
    : 0;

  // 场景切换淡入（每场景开头 0.5s）
  const sceneFade = isReadingPhase
    ? interpolate(frame, [0, fps * 0.5], [0, 1], { easing: EASE_SMOOTH, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : interpolate(rawProgress, [0, 0.08], [0, 1], { easing: EASE_SMOOTH, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // 总结 overlay
  const summaryStart = hasSummary ? durationInFrames - fps * 5 : 0;
  const showSummary = hasSummary && frame >= summaryStart;
  const summaryOpacity = hasSummary
    ? interpolate(frame, [summaryStart, summaryStart + fps * 1], [0, 1], {
        easing: EASE_SMOOTH, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
    : 0;

  // 块入场动画（按块 index 依次延迟，快速克制）
  // delay ≥ 1 时直接全入场（避免 interpolate 输入区间递减抛错）
  const blockAnim = (anim: Block['animation'], delay: number) => {
    if (delay >= 1) return { opacity: 1, transform: 'none' };
    const p = interpolate(rawProgress, [delay, Math.min(1, delay + 0.12)], [0, 1], {
      easing: EASE_SMOOTH, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    if (anim === 'none') return { opacity: 1, transform: 'none' };
    if (anim === 'slide-up') return { opacity: p, transform: `translateY(${(1 - p) * 20}px)` };
    if (anim === 'zoom') return { opacity: p, transform: `scale(${0.95 + 0.05 * p})` };
    return { opacity: p, transform: 'none' };
  };

  // 渲染一个元素块（注册表驱动 + 自由定位 + 入场动画）
  const renderBlock = (block: Block, i: number) => {
    const anim = blockAnim(block.animation, Math.min(0.9, i * 0.08));
    // image 块：容器高度按图的实际宽高比计算（pos.w 的像素宽 / imageRatio），
    // 不依赖 LLM 给的 pos.h（LLM 常给 8-10% 的扁高度把图压成小条）。上限 68% 防超高溢出，下限 22% 兜底。
    let effectiveH = block.pos.h;
    if (block.type === 'image') {
      if (block.imageRatio && block.imageRatio > 0 && block.pos.w > 0) {
        const desiredPct = ((block.pos.w / 100) * width / block.imageRatio) / height * 100;
        effectiveH = Math.max(effectiveH, Math.min(desiredPct, 68));
      }
      effectiveH = Math.max(effectiveH, 22);
      // 防止 y + height 超出画布底部
      effectiveH = Math.min(effectiveH, Math.max(10, 100 - (block.pos.y || 0)));
    }
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${block.pos.x}%`,
      top: `${block.pos.y}%`,
      width: `${block.pos.w}%`,
      height: `${effectiveH}%`,
      opacity: anim.opacity,
      transform: anim.transform,
      boxSizing: 'border-box',
      overflow: 'hidden',
    };
    const control = getControl(block.type);
    if (!control) return null;
    return (
      <div key={i} style={baseStyle}>
        {control.render({
          block,
          theme,
          progress: rawProgress,
          index: i,
          isDark,
          width,
          height,
          prevPlot: prevScene?.blocks?.find(b => b.type === 'plot') || null,
          elapsedFrames: isReadingPhase ? 0 : Math.max(0, frame - sceneFrames[idx].start),
        })}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{
      backgroundColor: theme.bg,
      background: isDark
        ? 'radial-gradient(1200px 700px at 70% -10%, #141828 0%, #10131c 55%)'
        : 'radial-gradient(1200px 700px at 70% -10%, #ffffff 0%, #f0f2f8 55%)',
      color: theme.textMain,
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    }}>
      {/* 全屏 blocks 自由画布（无固定分区，AI 任意摆放） */}
      <div style={{
        position: 'absolute', inset: 0,
        padding: '2.5% 3%', boxSizing: 'border-box',
        opacity: sceneFade,
      }}>
        {isReadingPhase ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontSize: 32, lineHeight: 1.7, color: theme.textMain, maxWidth: '80%', textAlign: 'center', fontWeight: 500 }}>{opening}</p>
          </div>
        ) : (
          currentScene?.blocks?.map((b, i) => renderBlock(b, i))
        )}
      </div>

      {/* 步骤指示器（右上角浮层，不占布局） */}
      {!isReadingPhase && !showSummary && scenes.length > 0 && (
        <div style={{
          position: 'absolute', top: 20, right: 26, zIndex: 40,
          display: 'flex', alignItems: 'center', gap: 8,
          background: theme.dark ? 'rgba(15,17,26,0.65)' : 'rgba(255,255,255,0.8)',
          border: `1px solid ${theme.border}`, borderRadius: 999, padding: '6px 14px',
        }}>
          {scenes.map((_, s) => (
            <div key={s} style={{
              width: s === idx ? 22 : 8, height: 8, borderRadius: 999,
              background: s === idx
                ? theme.accent
                : s < idx ? theme.accent + '88' : theme.border,
              transition: 'all 0.3s',
            }} />
          ))}
          <span style={{ fontSize: 12, fontWeight: 700, color: theme.textSub, letterSpacing: 1, marginLeft: 4 }}>
            {idx + 1}/{scenes.length}
          </span>
        </div>
      )}

      {/* 总结 overlay */}
      {showSummary && (
        <AbsoluteFill style={{
          background: isDark ? 'rgba(15,17,26,0.94)' : 'rgba(255,255,255,0.94)',
          opacity: summaryOpacity, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ maxWidth: 900, textAlign: 'center', padding: '0 60px' }}>
            <div style={{
              display: 'inline-block', padding: '6px 20px', borderRadius: 999,
              background: theme.accent, color: '#ffffff', fontSize: 15, fontWeight: 800, letterSpacing: 4, marginBottom: 24,
            }}>
              总结
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.5, color: theme.textMain }}>{summary}</div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
