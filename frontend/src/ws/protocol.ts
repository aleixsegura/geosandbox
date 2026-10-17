// Decoder for the binary frames packed by backend/protocol.py:
// [u32 header length][header JSON][pad to 4][buffer 0][pad][buffer 1]…
// Buffers become typed-array views on the frame (no copies).

export type TypedArray = Float32Array | Uint32Array | Int32Array | Uint8Array;

export interface NDArray<T extends TypedArray = TypedArray> {
  data: T;
  shape: number[];
}

export type Kind = "geometry" | "raster" | "dataset" | "crs" | "transformer" | "transform" | "repr";

export interface Payload {
  kind: Kind;
  name: string;
  data: Record<string, any>;
  meta: Record<string, any>;
}

interface BufferDesc {
  dtype: "float32" | "uint32" | "int32" | "uint8";
  shape: number[];
  offset: number;
  length: number;
}

const CTORS = { float32: Float32Array, uint32: Uint32Array, int32: Int32Array, uint8: Uint8Array };

export function decodeFrame(buffer: ArrayBuffer): Payload {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  const arrays: NDArray[] = (header.buffers as BufferDesc[]).map((d) => {
    const Ctor = CTORS[d.dtype];
    return { data: new Ctor(buffer, d.offset, d.length / Ctor.BYTES_PER_ELEMENT), shape: d.shape };
  });
  const resolve = (value: any): any => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      if ("$buf" in value && Object.keys(value).length === 1) return arrays[value.$buf];
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = resolve(v);
      return out;
    }
    return value;
  };
  return { kind: header.kind, name: header.name, data: resolve(header.data), meta: header.meta };
}

// ---- JSON control messages (server → client)
export type ServerMessage =
  | { type: "hello" }
  | { type: "status"; state: "busy" | "idle" | "starting" }
  | { type: "stream"; name: "stdout" | "stderr"; text: string }
  | { type: "error"; ename: string; evalue: string; traceback: string }
  | { type: "error_line"; line: number }
  | { type: "result"; text: string }
  | { type: "execute_started"; msg_id: string }
  | { type: "execute_done"; msg_id: string; status: string; execution_count: number }
  | { type: "remove"; names: string[] }
  | { type: "restarted" }
  | {
      type: "complete_reply";
      request_id: number;
      matches: string[];
      cursor_start: number;
      cursor_end: number;
      types: string[];
    };
