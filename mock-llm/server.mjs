import { createServer } from "node:http";

const state = { callCount: 0, latencyMs: 0, failNext: 0 };

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function chatResponse(userContent) {
  const snippet = userContent.trim().replaceAll("\n", " ").slice(0, 160);
  const content = `Mock AI summary (not a real model). Based on what you sent: "${snippet}"`;
  const promptTokens = Math.max(1, Math.floor(userContent.length / 4));
  const completionTokens = Math.max(1, Math.floor(content.length / 4));
  return {
    id: `mock-chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-llm",
    choices: [{ index: 0, message: { role: "assistant", content }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/control/stats") {
    send(res, 200, { callCount: state.callCount });
    return;
  }
  if (req.method === "GET" && path === "/health") {
    send(res, 200, { status: "ok" });
    return;
  }
  if (req.method !== "POST") {
    send(res, 404, { error: "not found" });
    return;
  }
  const body = await readJson(req);
  if (path === "/control/configure") {
    if ("latencyMs" in body) state.latencyMs = Number(body.latencyMs);
    if ("failNext" in body) state.failNext = Number(body.failNext);
    send(res, 200, { ok: true, state: { ...state } });
    return;
  }
  if (path === "/control/reset") {
    state.callCount = 0;
    state.latencyMs = 0;
    state.failNext = 0;
    send(res, 200, { ok: true, state: { ...state } });
    return;
  }
  if (path !== "/v1/chat/completions") {
    send(res, 404, { error: "not found" });
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === "user");
  const shouldFail = state.failNext > 0;
  if (shouldFail) state.failNext -= 1;
  if (state.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, state.latencyMs));
  if (shouldFail) {
    send(res, 500, { error: { message: "mock-llm-server: injected failure", type: "mock_failure" } });
    return;
  }
  state.callCount += 1;
  send(res, 200, chatResponse(String(user?.content ?? "")));
});

const port = Number(process.env.PORT ?? 4001);
server.listen(port, "0.0.0.0", () => {
  console.log(`Mock LLM server listening on :${port} (POST /v1/chat/completions)`);
});
