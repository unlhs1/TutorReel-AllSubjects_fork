// 手写公式白板：canvas 手写 → 导出 PNG（白底、粗笔画，利于 VL 识别）
// 支持鼠标 + 触摸绘制、清空、撤销、导出
import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  onExport?: (dataUrl: string) => void; // 导出 base64 PNG（不含 data: 前缀，由调用方决定）
  onReset?: () => void;
  height?: number;
  strokeWidth?: number;
  strokeColor?: string;
}

export const HandwritingPad: React.FC<Props> = ({
  onExport,
  onReset,
  height = 220,
  strokeWidth = 5,
  strokeColor = '#111827',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const [dirty, setDirty] = useState(false);

  const getPos = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // 高 DPI：物理像素 = css * dpr，保证笔画清晰
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      // 白底（VL 识别友好）
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
  }, [height, strokeWidth, strokeColor]);

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setupCanvas]);

  const pushUndo = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    const imgData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    undoStack.current.push(imgData);
    if (undoStack.current.length > 20) undoStack.current.shift();
    setDirty(true);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = getPos(e);
    pushUndo();
  }, [getPos, pushUndo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPos(e);
    if (last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  }, [getPos]);

  const endDraw = useCallback(() => {
    drawing.current = false;
    last.current = null;
  }, []);

  const clear = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    undoStack.current = [];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    // 重填白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
    onReset?.();
  }, [onReset]);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !undoStack.current.length) return;
    const prev = undoStack.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    setDirty(undoStack.current.length > 0);
  }, []);

  const exportPNG = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 导出前自动裁剪到笔画边界，避免大片留白干扰识别
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const a = data[i + 3];
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // 非白像素（含黑笔画 / 灰度）
        if (a > 60 && (r < 245 || g < 245 || b < 245)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    let exportCanvas = canvas;
    if (maxX >= minX && maxY >= minY) {
      // 加一点边距
      const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.02);
      const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
      const sw = Math.min(canvas.width - sx, maxX - minX + 1 + pad * 2);
      const sh = Math.min(canvas.height - sy, maxY - minY + 1 + pad * 2);
      const tmp = document.createElement('canvas');
      tmp.width = sw;
      tmp.height = sh;
      const tctx = tmp.getContext('2d')!;
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, sw, sh);
      tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      exportCanvas = tmp;
    }
    const dataUrl = exportCanvas.toDataURL('image/png');
    onExport?.(dataUrl.split(',')[1]); // 返回纯 base64
  }, [onExport]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
        className="touch-none rounded-lg cursor-crosshair border border-gray-300 dark:border-zinc-700 shadow-inner"
        style={{ display: 'block' }}
      />
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        <button onClick={undo} disabled={!dirty}
          className="px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 dark:bg-zinc-800/90 border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-700 disabled:opacity-40">
          撤销
        </button>
        <button onClick={clear}
          className="px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 dark:bg-zinc-800/90 border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-700">
          清空
        </button>
        <button onClick={exportPNG}
          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-600 hover:bg-cyan-700 text-white">
          识别公式
        </button>
      </div>
    </div>
  );
};
