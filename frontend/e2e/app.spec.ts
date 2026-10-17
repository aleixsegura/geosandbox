import { expect, test, type Page } from "@playwright/test";

const SHOTS = "e2e/screenshots";

const SNIPPETS: { name: string; vars: string[]; mode: "paper" | "map"; select?: string }[] = [
  { name: "shapely_basics", vars: ["parcel", "river", "wells", "bowtie", "buffer_zone", "dry_land"], mode: "paper", select: "bowtie" },
  { name: "gdal_ogr", vars: ["ds", "seu_vella", "walk", "walk_dry"], mode: "map", select: "ds" },
  { name: "pyproj_crs", vars: ["wgs84", "utm31", "to_utm", "to_utm.transform()", "strict.transform()"], mode: "map", select: "strict.transform()" },
  { name: "rasterio_dem", vars: ["dem", "elevation", "slope_deg", "hillshade"], mode: "map", select: "dem" },
  { name: "xarray_time", vars: ["ndvi", "annual_mean", "summer", "cube"], mode: "map", select: "ndvi" },
  { name: "geopandas_towns", vars: ["towns", "towns_utm", "areas"], mode: "map", select: "areas" },
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/tiles\.openfreemap|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("booted")) {
      localStorage.clear();
      sessionStorage.setItem("booted", "1");
    }
  });
  await page.goto("/");
  await page.waitForSelector(".monaco-editor");
  await expect(page.getByTestId("kernel-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("kernel-status")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("var-list-empty")).toBeVisible();
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__store.getState().kernel === "busy", null, { timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId("kernel-status")).toHaveAttribute("data-state", "idle", { timeout: 90_000 });
}

async function runSnippet(page: Page, name: string): Promise<void> {
  const { code } = await (await page.request.get(`/api/snippets/${name}`)).json();
  await page.getByTestId("snippets").selectOption(name);
  await page.waitForFunction((c) => (window as any).__editorApi.editor.getValue() === c, code);
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Shift+Enter");
  await waitIdle(page);
}

async function setCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => (window as any).__editorApi.setCode(c), code);
}

async function runCellAt(page: Page, line: number): Promise<void> {
  await page.evaluate((l) => (window as any).__editorApi.editor.setPosition({ lineNumber: l, column: 1 }), line);
  await page.evaluate(() => (window as any).__editorApi.runCell());
  await waitIdle(page);
}

for (const s of SNIPPETS) {
  test(`${s.name} renders every object`, async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await runSnippet(page, s.name);
    for (const v of s.vars) await expect(page.getByTestId(`var-${v}`)).toBeVisible();
    await expect(page.getByTestId("canvas")).toHaveAttribute("data-mode", s.mode);
    if (s.select) {
      await page.getByTestId(`var-${s.select}`).click();
      await expect(page.getByTestId("inspector")).toBeVisible();
    }
    await page.waitForTimeout(s.mode === "map" ? 3000 : 1200); // tiles, transitions
    await page.getByTestId("right-canvas").screenshot({ path: `${SHOTS}/${s.name}.png` });
    await page.screenshot({ path: `${SHOTS}/${s.name}-full.png` });
    expect(errors).toEqual([]);
  });
}

test("a Python error marks the right line and the kernel survives", async ({ page }) => {
  await boot(page);
  const code = [
    "# %% first cell",
    "a = 1",
    "",
    "# %% second cell",
    "b = a + 1",
    "c = b * 2",
    "d = 1 / 0  # line 7",
    "e = 5",
  ].join("\n");
  await setCode(page, code);
  await runCellAt(page, 2); // first cell defines `a`
  await runCellAt(page, 5); // runs lines 4–8, error on file line 7
  await expect(page.getByTestId("console-body")).toContainText("ZeroDivisionError");
  await expect.poll(() => page.evaluate(() => (window as any).__editorApi.errorLines())).toEqual([7]);
  await expect(page.locator(".gs-error-line")).toHaveCount(1);

  // The kernel kept its state: `b` from the failed cell still exists.
  await setCode(page, "print('alive', b)");
  await runCellAt(page, 1);
  await expect(page.getByTestId("console-body")).toContainText("alive 2");
  await expect.poll(() => page.evaluate(() => (window as any).__editorApi.errorLines())).toEqual([]);
});

test("changing colormap and stretch never re-runs code", async ({ page }) => {
  await boot(page);
  await runSnippet(page, "rasterio_dem");
  await page.getByTestId("var-dem").click();
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => (window as any).__geosandbox.executes);
  const canvas = page.getByTestId("right-canvas");
  const shotA = await canvas.screenshot();
  await page.getByTestId("cmap-magma").click();
  await page.getByTestId("stretch").getByText("min–max").click();
  await page.waitForTimeout(500);
  const shotB = await canvas.screenshot({ path: `${SHOTS}/colormap-magma.png` });
  expect(await page.evaluate(() => (window as any).__geosandbox.executes)).toBe(before);
  expect(Buffer.compare(shotA, shotB)).not.toBe(0);
});

test("re-running a buffer leaves a ghost of the previous version", async ({ page }) => {
  await boot(page);
  await runSnippet(page, "shapely_basics");
  const text = await page.evaluate(() => (window as any).__editorApi.editor.getValue());
  await setCode(page, text.replace("well.buffer(2.5)", "well.buffer(4)"));
  const line = text.split("\n").findIndex((l: string) => l.includes("well.buffer(")) + 1;
  await runCellAt(page, line);
  const ghost = await page.evaluate(() => (window as any).__store.getState().vars.buffer_zone.ghost);
  expect(ghost?.meta.features[0].area).toBeCloseTo(Math.PI * 2.5 ** 2, 0);
  await page.waitForTimeout(600);
  await page.getByTestId("right-canvas").screenshot({ path: `${SHOTS}/ghost.png` });
});

test("3D relief view renders a DEM", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await runSnippet(page, "rasterio_dem");
  await page.getByTestId("var-dem").click();
  await page.getByTestId("toggle-3d").click();
  await expect(page.locator('[data-testid="relief3d"] canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId("right-canvas").screenshot({ path: `${SHOTS}/relief3d.png` });
  expect(errors).toEqual([]);
});

test("cube slider, playback and dataset variables", async ({ page }) => {
  await boot(page);
  await runSnippet(page, "xarray_time");
  await page.getByTestId("var-ndvi").click();
  await page.getByTestId("slider-time").fill("6");
  await expect(page.getByTestId("inspector")).toContainText("2024-07-01");
  await page.getByTestId("play").click();
  await page.waitForTimeout(1500);
  const slice = await page.evaluate(() => (window as any).__store.getState().rasterStyles.ndvi.slice[0]);
  expect(slice).not.toBe(6);
  await page.getByTestId("play").click();
  await page.getByTestId("var-cube").click();
  await page.getByTestId("dataset-vars").getByText("anomaly").click();
  await expect(page.getByTestId("xr-summary")).toContainText("time: 12");
  await page.waitForTimeout(800);
  await page.getByTestId("right-canvas").screenshot({ path: `${SHOTS}/dataset-anomaly.png` });
});

test("hovering a vertex shows its coordinates", async ({ page }) => {
  await boot(page);
  await setCode(page, "from shapely import Polygon\nsquare = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])");
  await page.evaluate(() => (window as any).__editorApi.runAll());
  await waitIdle(page);
  await page.waitForTimeout(800);
  const box = (await page.getByTestId("canvas").boundingBox())!;
  const [x, y] = await page.evaluate(() => (window as any).__gsProject([10, 10]));
  await page.mouse.move(box.x + x, box.y + y);
  const tip = page.getByText("square · vertex").locator("..");
  await expect(tip).toBeVisible();
  const found = await tip.innerText();
  expect(found).toMatch(/x, y\s+10, 10/);
});

test("? opens the shortcuts overlay", async ({ page }) => {
  await boot(page);
  await page.getByTestId("var-list-empty").click();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts")).toBeVisible();
  await page.waitForTimeout(400); // fade-in
  await page.screenshot({ path: `${SHOTS}/shortcuts.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts")).toBeHidden();
});
