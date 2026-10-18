// Layer extension that colors features by a numeric value on the GPU.
//
// Each feature's value is a float attribute; the colormap is a 256×1 LUT
// texture and the stretch (vmin/vmax) a uniform, exactly like ColormapLayer
// does for rasters. Changing colormap or stretch only swaps the LUT or a
// uniform; changing the column only refills one attribute buffer. Neither
// re-runs Python.
//
// Two sentinels travel in the value: MISSING (NaN in the column) fades the
// feature's own color, and KEEP leaves it untouched (polygon outlines).

import { LayerExtension, type Layer, type UpdateParameters } from "@deck.gl/core";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

export const MISSING = 3e38;
export const KEEP = -3e38;

const uniformBlock = /* glsl */ `\
uniform choroplethUniforms {
  float vmin;
  float vmax;
} choropleth;
`;

type ChoroplethModuleProps = { vmin: number; vmax: number; lut: Texture };

const choroplethModule = {
  name: "choropleth",
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { vmin: "f32", vmax: "f32" },
  getUniforms: (opts?: any) =>
    opts && "lut" in opts ? { vmin: opts.vmin, vmax: opts.vmax, choropleth_lut: opts.lut } : opts ?? {},
  inject: {
    "vs:#decl": /* glsl */ `
in float choroplethValues;
out float choropleth_value;
`,
    "vs:#main-end": /* glsl */ `
  choropleth_value = choroplethValues;
`,
    "fs:#decl": /* glsl */ `
in float choropleth_value;
uniform sampler2D choropleth_lut;
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (choropleth_value > 1e37) {
    color.a *= 0.3;
  } else if (choropleth_value > -1e37) {
    float range = choropleth.vmax - choropleth.vmin;
    float t = range != 0.0 ? clamp((choropleth_value - choropleth.vmin) / range, 0.0, 1.0) : 0.5;
    color.rgb = texture(choropleth_lut, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
  }
`,
  },
} as const satisfies ShaderModule<ChoroplethModuleProps>;

export interface ChoroplethProps {
  /** Value of each datum; MISSING or KEEP for the sentinels above. */
  getColorValue: (d: any) => number;
  /** 256 × RGBA8 colormap (see theme/colormaps). */
  colorLut: Uint8Array;
  colorRange: [number, number];
}

const defaultProps = {
  getColorValue: { type: "accessor", value: KEEP },
  colorLut: { type: "object", value: null, compare: false },
  colorRange: { type: "array", value: [0, 1], compare: true },
};

export class ChoroplethExtension extends LayerExtension {
  static extensionName = "ChoroplethExtension";
  static defaultProps = defaultProps as any;

  getShaders() {
    return { modules: [choroplethModule] };
  }

  initializeState(this: Layer<ChoroplethProps>) {
    this.getAttributeManager()?.add({
      choroplethValues: { size: 1, stepMode: "dynamic", accessor: "getColorValue" },
    });
  }

  updateState(this: Layer<ChoroplethProps>, params: UpdateParameters<Layer<ChoroplethProps>>) {
    const { props, oldProps } = params;
    const state = this.state as { choroplethLut?: Texture };
    if (props.colorLut && (props.colorLut !== oldProps.colorLut || !state.choroplethLut)) {
      state.choroplethLut?.destroy();
      state.choroplethLut = this.context.device.createTexture({
        format: "rgba8unorm",
        width: 256,
        height: 1,
        data: props.colorLut,
        mipmaps: false,
        sampler: { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
      });
    }
  }

  draw(this: Layer<ChoroplethProps>) {
    const lut = (this.state as { choroplethLut?: Texture }).choroplethLut;
    if (!lut) return;
    const [vmin, vmax] = this.props.colorRange;
    this.setShaderModuleProps({ choropleth: { vmin, vmax, lut } });
  }

  finalizeState(this: Layer<ChoroplethProps>) {
    (this.state as { choroplethLut?: Texture }).choroplethLut?.destroy();
  }
}
