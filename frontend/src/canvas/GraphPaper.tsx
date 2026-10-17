import { useEffect, useRef } from "react";

import type { Theme } from "../theme/themes";

export interface PaperView {
  target: [number, number];
  zoom: number; // log2(pixels per unit)
}

interface Props {
  view: PaperView;
  width: number;
  height: number;
  flipY: boolean;
  theme: Theme;
}

/** 1-2-5 step ≥ minimum world size. */
function niceStep(min: number): number {
  const exp = Math.floor(Math.log10(min));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= min) return m * base;
  return 10 * base;
}

function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-6) return "0";
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const text = v.toFixed(decimals);
  if (Math.abs(v) >= 1e5) {
    const [int, frac] = text.split(".");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (frac ? `.${frac}` : "");
  }
  return text;
}

/**
 * Graph paper behind the orthographic deck.gl view: minor/major grids that
 * adapt to zoom and labelled X/Y axes. Drawn with Canvas 2D for crisp lines.
 */
export default function GraphPaper({ view, width, height, flipY, theme }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, width, height);

    const scale = 2 ** view.zoom;
    const [tx, ty] = view.target;
    const sx = (x: number) => (x - tx) * scale + width / 2;
    const sy = (y: number) => (flipY ? (y - ty) * scale : -(y - ty) * scale) + height / 2;
    const x0 = tx - width / 2 / scale;
    const x1 = tx + width / 2 / scale;
    const y0 = ty - height / 2 / scale;
    const y1 = ty + height / 2 / scale;

    const minor = niceStep(14 / scale);
    const lead = Math.round(minor / 10 ** Math.floor(Math.log10(minor)));
    const major = minor * (lead === 2 ? 5 : lead === 5 ? 2 : 5);

    const lines = (step: number, color: string, lw: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const px = Math.round(sx(x)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const py = Math.round(sy(y)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    };
    lines(minor, theme.gridMinor, 1);
    lines(major, theme.gridMajor, 1);

    // Axes through the origin, when visible.
    ctx.beginPath();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1.25;
    if (x0 <= 0 && x1 >= 0) {
      const px = Math.round(sx(0)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    if (y0 <= 0 && y1 >= 0) {
      const py = Math.round(sy(0)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();

    // Tick labels along the bottom and left edges, on a paper-colored band.
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = theme.paper;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, height - 18, width, 18);
    ctx.fillRect(0, 0, 0, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.pencil;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    let lastRight = -Infinity;
    for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
      const px = sx(x);
      const text = formatTick(x, major);
      const w = ctx.measureText(text).width;
      if (px - w / 2 < lastRight + 8 || px - w / 2 < 2 || px + w / 2 > width - 2) continue;
      ctx.fillText(text, px, height - 5);
      lastRight = px + w / 2;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let lastY = Infinity;
    const ys: number[] = [];
    for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) ys.push(y);
    if (!flipY) ys.reverse();
    for (const y of ys) {
      const py = sy(y);
      if (py > height - 24 || py < 8 || Math.abs(py - lastY) < 16) continue;
      const text = formatTick(y, major);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(2, py - 7, w + 6, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.pencil;
      ctx.fillText(text, 5, py);
      lastY = py;
    }

    // Axis names.
    ctx.font = 'italic 11px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = theme.faint;
    ctx.textAlign = "right";
    ctx.fillText("x", width - 8, height - 24);
    ctx.textAlign = "left";
    ctx.fillText(flipY ? "y ↓  (row)" : "y", 8, 14);
  }, [view, width, height, flipY, theme]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ width, height }} />;
}
