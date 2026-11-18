// web/app-sdk/engine-host.mjs
import { createInterface } from "node:readline";
async function createHostEngine(input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity })[Symbol.asyncIterator]();
  async function read() {
    const line = await lines.next();
    if (line.done || Buffer.byteLength(line.value) > 16 * 1024 * 1024) throw Error("Missing or oversized host frame");
    return JSON.parse(line.value);
  }
  const request = await read();
  if (request.protocol !== 1 || request.framing !== "host-jsonl-v1" || !request.arguments || Array.isArray(request.arguments) || !request.context || !Array.isArray(request.context.hostOperations)) throw Error("Unsupported host-call request");
  let id = 0, busy = false, finished = false;
  function send(value) {
    const body = JSON.stringify(value);
    if (body === void 0 || Buffer.byteLength(body) > 16 * 1024 * 1024) throw Error("Oversized engine frame");
    output.write(body + "\n");
  }
  return {
    request,
    async call(operation, args) {
      if (finished || busy || !request.context.hostOperations.includes(operation) || ++id > (request.context.maxHostCalls ?? 256)) throw Error("Undeclared, concurrent or excessive host call");
      busy = true;
      try {
        send({ type: "hostCall", id, operation, arguments: args });
        const reply = await read();
        if (reply.type !== "hostResult" || reply.id !== id || !reply.result) throw Error("Mismatched host reply");
        if (!reply.result.success) {
          const error = Error(reply.result.error?.message ?? "Host capability failed");
          error.code = reply.result.error?.code;
          error.sourceException = reply.result.sourceException;
          throw error;
        }
        return reply.result.data;
      } finally {
        busy = false;
      }
    },
    finish(result) {
      if (finished || busy) throw Error("Engine result already sent or call pending");
      finished = true;
      send({ type: "result", result });
    },
    close() {
      lines.return?.();
      input.pause?.();
    }
  };
}

// web/charts/runtime/report.mjs
var engine = await createHostEngine();
try {
  const { request } = engine;
  if (request.context.appId !== "easysellput.charts" || !["get_bars", "get_chart_analysis", "get_market_events", "get_chart_drawings", "add_chart_drawing", "update_chart_drawing", "delete_chart_drawing", "clear_chart_drawings"].includes(request.operation)) {
    engine.finish({ $appError: { code: "invalid_arguments", message: "Unsupported chart operation" } });
  } else {
    try {
      engine.finish(await engine.call(request.operation, request.arguments));
    } catch (error) {
      engine.finish({ $appError: { code: error.code ?? "invalid_data", message: String(error.message ?? "Source failed").slice(0, 1e3) } });
    }
  }
} finally {
  engine.close();
}
