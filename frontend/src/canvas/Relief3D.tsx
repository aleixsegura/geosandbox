// Single-band raster as a lit relief surface (three.js). Colormap, stretch and
// vertical exaggeration update the existing mesh in place: no re-run, no rebuild.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useStore, type VarEntry } from "../state/store";
import { colormapLut } from "../theme/colormaps";
import { THEME as theme } from "../theme/themes";
import type { NDArray } from "../ws/protocol";
import { rasterExtent, rasterOf } from "./display";
import { sliceIndex, sliceTexels, stretchRange } from "./layers";

const MAX_SEGMENTS = 512;

interface Surface {
  width: number; // world units (metres when the CRS is metric)
  height: number;
  base: number; // z units per data unit at exaggeration 1
  heights: Float32Array; // per vertex, data units relative to min
  values: Float32Array; // per vertex, raw values (for coloring)
  valid: Uint8Array;
  cols: number;
  rows: number;
}

function buildSurface(values: NDArray, texels: Float32Array, meta: Record<string, any>): Surface {
  const [, H, W] = values.shape;
  const { width, height, metric } = rasterExtent(meta);
  const s = meta.stats_global ?? { min: 0, max: 1 };
  const range = s.max - s.min || 1;
  const scale = Math.min(1, MAX_SEGMENTS / Math.max(W, H));
  const cols = Math.max(2, Math.round(W * scale));
  const rows = Math.max(2, Math.round(H * scale));
  const n = cols * rows;
  const heights = new Float32Array(n);
  const vals = new Float32Array(n);
  const valid = new Uint8Array(n);
  for (let iy = 0; iy < rows; iy++) {
    const r = Math.round((iy * (H - 1)) / (rows - 1));
    for (let ix = 0; ix < cols; ix++) {
      const c = Math.round((ix * (W - 1)) / (cols - 1));
      const k = (r * W + c) * 2;
      const i = iy * cols + ix;
      const ok = texels[k + 1] > 0;
      valid[i] = ok ? 1 : 0;
      vals[i] = texels[k];
      heights[i] = ok ? texels[k] - s.min : 0;
    }
  }
  return { width, height, base: metric ? 1 : (0.15 * Math.max(width, height)) / range, heights, values: vals, valid, cols, rows };
}

export default function Relief3D({ entry }: { entry: VarEntry }) {
  const host = useRef<HTMLDivElement>(null);
  const style = useStore((s) => s.rasterStyles[entry.name]);
  const setStyle = useStore((s) => s.setRasterStyle);
  const raster = rasterOf(entry.payload, style);
  const index = raster && style ? sliceIndex(raster.meta, style) : 0;

  const surface = useMemo(() => {
    if (!raster) return null;
    const { values, mask } = raster.data as { values: NDArray; mask: NDArray };
    return buildSurface(values, sliceTexels(values, mask, index), raster.meta);
  }, [raster, index]);

  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh | null;
    grid: THREE.GridHelper | null;
  } | null>(null);

  // Scene, camera, lights, render loop.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 1, 1e7);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 1, 1.4); // north-west, like a classic hillshade
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    three.current = { renderer, scene, camera, controls, mesh: null, grid: null };

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // Paper background and a notebook grid under the surface.
  useEffect(() => {
    const t = three.current;
    if (!t || !surface) return;
    t.scene.background = new THREE.Color(theme.paper);
    if (t.grid) {
      t.scene.remove(t.grid);
      t.grid.geometry.dispose();
    }
    const size = Math.max(surface.width, surface.height) * 1.6;
    const grid = new THREE.GridHelper(size, 32, new THREE.Color(theme.gridMajor), new THREE.Color(theme.gridMinor));
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -size * 0.002;
    t.scene.add(grid);
    t.grid = grid;
  }, [surface]);

  // Mesh geometry (rebuilt only when the data or slice changes).
  useEffect(() => {
    const t = three.current;
    if (!t || !surface) return;
    if (t.mesh) {
      t.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    const geom = new THREE.PlaneGeometry(surface.width, surface.height, surface.cols - 1, surface.rows - 1);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < surface.heights.length; i++) pos.setZ(i, surface.heights[i] * surface.base);
    // Drop triangles touching nodata (warped rasters have empty margins).
    const index = geom.getIndex()!.array;
    const kept: number[] = [];
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      if (surface.valid[a] && surface.valid[b] && surface.valid[c]) kept.push(a, b, c);
    }
    geom.setIndex(kept);
    geom.computeVertexNormals();
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(surface.heights.length * 3), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    t.scene.add(mesh);
    t.mesh = mesh;

    const extent = Math.max(surface.width, surface.height);
    t.camera.near = extent / 500;
    t.camera.far = extent * 50;
    // Back off further on narrow canvases so the whole surface is in view.
    const k = Math.max(1, 1.3 / t.camera.aspect);
    t.camera.position.set(-extent * 0.2 * k, -extent * 1.35 * k, extent * 0.9 * k);
    t.camera.updateProjectionMatrix();
    t.controls.target.set(0, 0, 0);
    t.controls.update();
  }, [surface]);

  // Exaggeration and colors: cheap in-place updates.
  useEffect(() => {
    const t = three.current;
    if (!t?.mesh || !surface || !style || !raster) return;
    t.mesh.scale.z = style.exaggeration;
    const [vmin, vmax] = stretchRange(raster.meta, style);
    const lut = colormapLut(style.colormap, style.reverse);
    const paper = new THREE.Color(theme.paper);
    const colors = (t.mesh.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;
    const span = vmax - vmin || 1;
    for (let i = 0; i < surface.values.length; i++) {
      if (!surface.valid[i]) {
        colors[i * 3] = paper.r;
        colors[i * 3 + 1] = paper.g;
        colors[i * 3 + 2] = paper.b;
        continue;
      }
      const k = Math.max(0, Math.min(255, Math.round(((surface.values[i] - vmin) / span) * 255))) * 4;
      // LUT is sRGB; three.js works in linear space.
      const c = new THREE.Color().setRGB(lut[k] / 255, lut[k + 1] / 255, lut[k + 2] / 255, THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    t.mesh.geometry.attributes.color.needsUpdate = true;
  }, [surface, style, raster]);

  if (!raster || !style) return null;
  return (
    <div className="absolute inset-0" data-testid="relief3d">
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 font-hand text-2xl text-emph">
        {entry.name} <span className="text-pencil">· relief ×{style.exaggeration}</span>
      </div>
      <button
        type="button"
        onClick={() => setStyle(entry.name, { show3d: false })}
        className="absolute bottom-4 left-4 rounded border border-rule bg-panel/90 px-2.5 py-1 font-sans text-xs text-pencil shadow-sm hover:text-ink"
      >
        Back to 2D
      </button>
      <div className="pointer-events-none absolute bottom-4 right-4 font-sans text-2xs text-faint">drag to orbit · right-drag to pan · scroll to zoom</div>
    </div>
  );
}
