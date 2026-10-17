import { useStore } from "../state/store";
import { decodeFrame, type ServerMessage } from "./protocol";

type CompletionReply = Extract<ServerMessage, { type: "complete_reply" }>;

let socket: WebSocket | null = null;
let retry = 0;
let requestId = 0;
const completions = new Map<number, (r: CompletionReply) => void>();

/** Count of execute messages sent; e2e tests use it to prove styling never re-runs code. */
export const stats = { executes: 0 };
(window as any).__geosandbox = stats;

export function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  socket = ws;
  useStore.getState().setKernel("connecting");

  ws.onopen = () => {
    retry = 0;
    useStore.getState().setKernel("idle");
    send({ type: "resync" });
  };
  ws.onclose = () => {
    useStore.getState().setKernel("disconnected");
    socket = null;
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      useStore.getState().upsert(decodeFrame(ev.data));
    } else {
      handle(JSON.parse(ev.data) as ServerMessage);
    }
  };
}

function handle(msg: ServerMessage): void {
  const s = useStore.getState();
  switch (msg.type) {
    case "hello":
      s.clearGhosts();
      break;
    case "status":
      s.setKernel(msg.state === "busy" ? "busy" : "idle");
      break;
    case "stream":
      s.log(msg.name, msg.text);
      break;
    case "result":
      s.log("result", msg.text);
      break;
    case "error":
      s.log("error", msg.traceback || `${msg.ename}: ${msg.evalue}`);
      s.setPendingError(`${msg.ename}: ${msg.evalue}`);
      s.setConsoleOpen(true);
      break;
    case "error_line":
      s.setErrorLine({ line: msg.line, message: useStore.getState().pendingError ?? "Error" });
      break;
    case "execute_started":
      s.clearGhosts();
      s.setErrorLine(null);
      s.setPendingError(null);
      break;
    case "execute_done":
      break;
    case "remove":
      s.remove(msg.names);
      break;
    case "restarted":
      s.clearAll();
      s.setErrorLine(null);
      s.log("info", "Kernel restarted — namespace cleared.");
      s.setKernel("idle");
      break;
    case "complete_reply": {
      const cb = completions.get(msg.request_id);
      completions.delete(msg.request_id);
      cb?.(msg);
      break;
    }
  }
}

export function send(msg: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

export function execute(code: string, lineOffset: number, label: string): void {
  if (!code.trim()) return;
  const s = useStore.getState();
  if (!send({ type: "execute", code, line_offset: lineOffset })) {
    s.log("stderr", "Not connected to the kernel.\n");
    return;
  }
  stats.executes++;
  s.log("run", label);
  s.setKernel("busy");
}

export function interrupt(): void {
  send({ type: "interrupt" });
}

export function restart(): void {
  useStore.getState().setKernel("restarting");
  send({ type: "restart" });
}

export function complete(code: string, cursorPos: number): Promise<CompletionReply | null> {
  const id = ++requestId;
  return new Promise((resolve) => {
    if (!send({ type: "complete", code, cursor_pos: cursorPos, request_id: id })) return resolve(null);
    completions.set(id, resolve);
    setTimeout(() => {
      if (completions.delete(id)) resolve(null);
    }, 4000);
  });
}
