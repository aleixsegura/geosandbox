# CLAUDE.md

# geo-sandbox

Local sandbox for learning interactively popular geospatial software libraries (Shapely, GDAL, Pyproj, Rasterio, xarray, GeoPandas, DuckDB spatial, H3 and exactextract) and file formats (GeoTIFF/COG, GeoParquet, GeoJSON, KML…): Monaco editor on the left, deck.gl canvas on the right.

## Commands
- `pixi install` — set up environment (conda-forge only; never pip-install GDAL). DuckDB's spatial extension is the one exception: `install_extension("spatial")` downloads it once.
- `pixi run dev` — start backend + frontend
- `pixi run test` — backend tests (pytest)

## Architecture
- `backend/` — FastAPI + persistent IPython kernel (jupyter_client), WebSocket to frontend
- `backend/renderers/` — one renderer per type, registered in the `type → serializer` registry. New type = new renderer, nothing else.
- `frontend/` — Vite + React + TS + Tailwind, Monaco, deck.gl, MapLibre, three.js (3D raster view only)
- `snippets/` — demo scripts used for manual and Playwright verification

## Rules
- Arrays go over WebSocket as binary Float32, never JSON lists.
- Colormaps and stretch are applied on the GPU in the frontend; changing them must not re-run code.
- Shapely geometries have no CRS: Cartesian graph-paper canvas by default, map only when a CRS exists.
- Respect the Notebook theme (the only theme). All colors come from `frontend/src/theme/themes.ts` (matplotlib tab10 for variables and UI accents, Pygments for syntax); no ad-hoc colors.
- Server binds to 127.0.0.1 only.
- After any rendering change, run the affected snippet with Playwright and check the screenshot.

## Commit rules
- Follow 'Conventional Commits' commit format.
- Make commits for each feature you implement, isolated from others.
