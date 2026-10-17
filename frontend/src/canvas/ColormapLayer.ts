// BitmapLayer variant that colors raw float data on the GPU.
//
// The values and validity mask live in one rg32float texture (r = value,
// g = valid). A 256×1 RGBA lookup texture holds the colormap, and the
// stretch (vmin/vmax) is a uniform: changing colormap or stretch only updates
// a uniform or swaps the LUT, never the data and never re-runs Python.

import { BitmapLayer, type BitmapLayerProps } from "@deck.gl/layers";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import type { DefaultProps, UpdateParameters } from "@deck.gl/core";

const uniformBlock = /* glsl */ `\
uniform colormapUniforms {
  float vmin;
  float vmax;
  float opacity;
} colormap;
`;

type ColormapModuleProps = {
  vmin: number;
  vmax: number;
  opacity: number;
  dataTexture: Texture;
  lutTexture: Texture;
};

const colormapModule = {
  name: "colormap",
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { vmin: "f32", vmax: "f32", opacity: "f32" },
} as const satisfies ShaderModule<ColormapModuleProps>;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME colormap-bitmap-layer-fragment-shader
precision highp float;

uniform highp sampler2D dataTexture;
uniform sampler2D lutTexture;

in vec2 vTexCoord;
in vec2 vTexPos;
out vec4 fragColor;

vec3 packUVsIntoRGB(vec2 uv) {
  vec2 uv8bit = floor(uv * 256.);
  vec2 uvFraction = fract(uv * 256.);
  vec2 uvFraction4bit = floor(uvFraction * 16.);
  float fractions = uvFraction4bit.x + uvFraction4bit.y * 16.;
  return vec3(uv8bit, fractions) / 255.;
}

void main(void) {
  vec2 uv = vTexCoord;
  vec2 sample_ = texture(dataTexture, uv).rg;
  if (sample_.g < 0.5) discard;
  float range = colormap.vmax - colormap.vmin;
  float t = range != 0.0 ? clamp((sample_.r - colormap.vmin) / range, 0.0, 1.0) : 0.5;
  vec4 color = texture(lutTexture, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
  fragColor = vec4(color.rgb, colormap.opacity * layer.opacity);

  geometry.uv = uv;
  DECKGL_FILTER_COLOR(fragColor, geometry);

  if (bool(picking.isActive) && !bool(picking.isAttribute)) {
    fragColor.rgb = packUVsIntoRGB(uv);
  }
}
`;

export interface ColormapLayerProps extends Omit<BitmapLayerProps, "image"> {
  /** Interleaved [value, valid] pairs, row-major, top row first. */
  texels: Float32Array;
  texWidth: number;
  texHeight: number;
  lut: Uint8Array;
  vmin: number;
  vmax: number;
  fade: number;
}

const defaultProps: DefaultProps<ColormapLayerProps> = {
  texels: { type: "object", value: new Float32Array(2), compare: true },
  texWidth: 1,
  texHeight: 1,
  lut: { type: "object", value: new Uint8Array(1024), compare: true },
  vmin: 0,
  vmax: 1,
  fade: 1,
};

export class ColormapLayer extends BitmapLayer<ColormapLayerProps> {
  static layerName = "ColormapLayer";
  static defaultProps = defaultProps as any;

  declare state: BitmapLayer["state"] & { dataTexture?: Texture; lutTexture?: Texture };

  getShaders() {
    const shaders = super.getShaders();
    return { ...shaders, fs, modules: [...shaders.modules, colormapModule] };
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params as any);
    const { props, oldProps } = params;
    const device = this.context.device;
    if (props.texels !== oldProps.texels || !this.state.dataTexture) {
      this.state.dataTexture?.destroy();
      this.state.dataTexture = device.createTexture({
        format: "rg32float",
        width: props.texWidth,
        height: props.texHeight,
        data: props.texels,
        mipmaps: false,
        sampler: { minFilter: "nearest", magFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
      });
    }
    if (props.lut !== oldProps.lut || !this.state.lutTexture) {
      this.state.lutTexture?.destroy();
      this.state.lutTexture = device.createTexture({
        format: "rgba8unorm",
        width: 256,
        height: 1,
        data: props.lut,
        mipmaps: false,
        sampler: { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
      });
    }
  }

  finalizeState(context: any) {
    super.finalizeState(context);
    this.state.dataTexture?.destroy();
    this.state.lutTexture?.destroy();
  }

  draw(opts: any) {
    const { shaderModuleProps } = opts;
    const { model, bounds, disablePicking, dataTexture, lutTexture } = this.state as any;
    if (shaderModuleProps.picking.isActive && disablePicking) return;
    if (!model || !dataTexture || !lutTexture) return;
    model.shaderInputs.setProps({
      bitmap: {
        bounds,
        coordinateConversion: 0,
        desaturate: 0,
        tintColor: [1, 1, 1],
        transparentColor: [0, 0, 0, 0],
      },
      colormap: {
        vmin: this.props.vmin,
        vmax: this.props.vmax,
        opacity: this.props.fade,
        dataTexture,
        lutTexture,
      },
    });
    model.draw(this.context.renderPass);
  }

  getPickingInfo(params: any) {
    const info = params.info;
    if (!info.color) {
      info.bitmap = null;
      return info;
    }
    const [u, v, frac] = info.color;
    const uv = [(u + (frac & 0x0f) / 16) / 256, (v + (frac & 0xf0) / 256) / 256];
    const { texWidth: width, texHeight: height } = this.props;
    info.index = 0;
    info.bitmap = { size: { width, height }, uv, pixel: [Math.floor(uv[0] * width), Math.floor(uv[1] * height)] };
    return info;
  }
}
