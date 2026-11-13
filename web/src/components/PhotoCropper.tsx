import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  src: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

const VIEW_W = 280;
const VIEW_H = 420;
const OUT_W = 512;
const OUT_H = 768;

export default function PhotoCropper({ src, onCancel, onConfirm }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const m = Math.max(VIEW_W / im.width, VIEW_H / im.height);
      setImg(im);
      setMinScale(m);
      setScale(m);
      const w = im.width * m;
      const h = im.height * m;
      setPos({ x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2 });
    };
    im.src = src;
  }, [src]);

  function clamp(p: { x: number; y: number }, s: number) {
    if (!img) return p;
    const w = img.width * s;
    const h = img.height * s;
    const minX = Math.min(0, VIEW_W - w);
    const minY = Math.min(0, VIEW_H - h);
    return {
      x: Math.min(0, Math.max(minX, p.x)),
      y: Math.min(0, Math.max(minY, p.y)),
    };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, sx: pos.x, sy: pos.y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPos(clamp({ x: dragRef.current.sx + dx, y: dragRef.current.sy + dy }, scale));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function onScale(v: number) {
    if (!img) return;
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const ix = (cx - pos.x) / scale;
    const iy = (cy - pos.y) / scale;
    const np = { x: cx - ix * v, y: cy - iy * v };
    setScale(v);
    setPos(clamp(np, v));
  }

  function confirm() {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const k = OUT_W / VIEW_W;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    const dw = img.width * scale * k;
    const dh = img.height * scale * k;
    const dx = pos.x * k;
    const dy = pos.y * k;
    ctx.drawImage(img, dx, dy, dw, dh);
    onConfirm(canvas.toDataURL("image/jpeg", 0.85));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-4 max-w-sm w-full">
        <div className="text-sm font-semibold text-slate-900 mb-2">Bildausschnitt wählen (2:3)</div>
        <div
          ref={stageRef}
          className="relative mx-auto overflow-hidden rounded-md bg-slate-100 select-none touch-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEW_W, height: VIEW_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: img.width * scale,
                height: img.height * scale,
                maxWidth: "none",
                pointerEvents: "none",
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 ring-2 ring-blue-500/70 rounded-md" />
        </div>

        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Zoom</label>
          <input
            type="range"
            min={minScale}
            max={minScale * 4}
            step={0.01}
            value={scale}
            onChange={(e) => onScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <p className="text-xs text-slate-500 mt-2">
          Bild ziehen, um den Ausschnitt zu verschieben.
        </p>

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            Abbrechen
          </button>
          <button type="button" onClick={confirm} className="btn-primary flex-1" disabled={!img}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
