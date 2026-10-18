# geo-sandbox

A local sandbox for learning Shapely, GDAL/OGR, pyproj, Rasterio and xarray by experimenting. You write Python on the left and see your objects drawn on the right. Geometries go on graph paper, anything with a CRS goes on a map, rasters get a GPU colormap, and CRS objects get a card.

## Install and run

```bash
pixi install     # conda-forge environment: GDAL, rasterio, shapely, pyproj, xarray, Node…
pixi run dev     # backend + frontend → http://127.0.0.1:5173
```

Other tasks:
- `pixi run test` runs the backend tests (pytest: every renderer plus a real kernel).
- `pixi run e2e` runs the Playwright tests on their own servers (ports 5174 and 8766, with their own kernel), so they never touch a running `pixi run dev`. They load every snippet, check that it renders and save screenshots to `frontend/e2e/screenshots/`.
- `pixi run build` builds the production frontend. Once `frontend/dist` exists, the backend serves it itself at http://127.0.0.1:8765.

The **Load snippet…** menu holds demo scripts from `snippets/`, one per library, plus two on file formats. In the editor, `Ctrl+Enter` runs the current `# %%` cell, `Shift+Enter` runs the whole file and `Ctrl+Shift+Enter` runs the selection. Press `C` (or the eraser in the canvas toolbar) to clear the canvas; the kernel keeps its variables and re-running a cell draws them again. Press `?` for every shortcut. Call `show(obj, label=None)` to draw something that isn't stored in a variable. A GeoDataFrame with numeric columns can be colored by one of them (**Color by** in the inspector); like raster colormaps, this runs on the GPU and never re-runs code.

Assign a `pathlib.Path` to draw a file and see what's inside it. Vector files (GeoJSON, KML, GeoPackage, FlatGeobuf, Shapefile, GeoParquet) show their layers, schema, driver capabilities and companion files, and GeoParquet also shows its row groups and `geo` metadata. Raster files (GeoTIFF, COG) show whether they pass GDAL's COG validator and where their image directories sit. Any rasterio or GDAL dataset also reports its internal layout (strips or tiles, compression, overviews), and **show blocks** draws its block grid on the canvas.

## Exercises with Claude

**Exercises** in the top bar (or `E`) asks Claude, through the Anthropic Messages API, for a set of exercises on a library: how many, level, language and an optional topic. They open in the editor, one `# %%` cell each with the statement, a hint and starter code that builds its own data.

The backend reads the key from `ANTHROPIC_API_KEY`, or from a `.env` file at the project root (gitignored):

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # then restart pixi run dev
```

The key stays on the server. The model defaults to `claude-sonnet-5-5` (about half the price of Opus; a 5-exercise set costs a few cents); set `GEOSANDBOX_MODEL` to use another one, e.g. `claude-opus-5-5` or the cheaper `claude-haiku-5-5`.

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
10. Every color comes from the Notebook theme in `frontend/src/theme/themes.ts`. Variables use matplotlib's tab10 palette, with red reserved for errors.
