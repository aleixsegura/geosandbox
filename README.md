# GeoSandbox

A local sandbox for learning Shapely, GDAL/OGR, pyproj, Rasterio and xarray by experimenting. You write Python on the left and see your objects drawn on the right. Geometries go on graph paper, anything with a CRS goes on a map, rasters get a GPU colormap, and CRS objects get a card.

## Install and run

```bash
pixi install     # conda-forge environment: GDAL, rasterio, shapely, pyproj, xarray, Node…
pixi run dev     # backend + frontend → http://127.0.0.1:5173
```

Other tasks:
- `pixi run test` runs the backend tests (pytest: every renderer plus a real kernel).
- `pixi run e2e` runs the Playwright tests. They load every snippet, check that it renders and save screenshots to `frontend/e2e/screenshots/`.
- `pixi run build` builds the production frontend. Once `frontend/dist` exists, the backend serves it itself at http://127.0.0.1:8765.

The **Load snippet…** menu holds demo scripts from `snippets/`, one per library. In the editor, `Ctrl+Enter` runs the current `# %%` cell, `Shift+Enter` runs the whole file and `Ctrl+Shift+Enter` runs the selection. Press `?` for every shortcut. Call `show(obj, label=None)` to draw something that isn't stored in a variable.

## Architecture in ten lines

1. `backend/main.py` is a FastAPI app bound to 127.0.0.1. Each browser tab opens one WebSocket, and all tabs share one persistent IPython kernel (`jupyter_client`).
2. `backend/kernel.py` sends code to the kernel with a line offset. Tracebacks are mapped back to the editor line, and stdout/stderr are streamed out.
3. `backend/kernel_side/` runs *inside* the kernel. After each cell, a hook diffs the namespace (identity plus a cheap content fingerprint) and renders only new or changed variables.
4. `backend/renderers/` is the `type → serializer` registry, keyed by qualified type name and searched along the MRO. To support a new type, add a module there.
5. Each renderer returns `{kind, name, data, meta}`. Its numpy arrays travel kernel → server as binary comm buffers, then server → browser as one aligned binary frame (Float32 coordinates and values, never JSON lists).
6. Coordinates are sent as Float32 offsets from a Float64 origin. Georeferenced data is reprojected to lon/lat, and rasters are warped (nearest neighbour) to Web Mercator.
7. `frontend/` uses Vite, React, TypeScript and Tailwind. Monaco is the editor, deck.gl the canvas, MapLibre the basemap (only when a CRS exists) and three.js the 3D relief view.
8. Rasters are colored on the GPU: values and mask go into an `rg32float` texture and the colormap into a LUT. Colormap and stretch are uniforms, so changing them never re-runs code.
9. When a variable changes, the store keeps its previous version as a dashed "ghost", and the new version fades and scales in over 260 ms.
10. Every color comes from the Notebook theme in `frontend/src/theme/themes.ts`. Variables always use Solarized accents, with red reserved for errors.
