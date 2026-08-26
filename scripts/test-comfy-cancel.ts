import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { ComfyClient } from "../bridge/comfy-client.js";

let runningIds: string[] = [];
let pendingIds: string[] = [];
const calls: Array<{ path: string; body: unknown }> = [];

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/queue") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      queue_running: runningIds.map((id, index) => [index, id]),
      queue_pending: pendingIds.map((id, index) => [index, id]),
    }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  calls.push({ path: request.url ?? "", body: text ? JSON.parse(text) : null });
  response.statusCode = 200;
  response.end();
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const comfy = new ComfyClient(`http://127.0.0.1:${address.port}`, 2_000);

pendingIds = ["target-pending", "unrelated-pending"];
await comfy.cancelPrompts(["target-pending"]);
assert.deepEqual(calls.at(-1), {
  path: "/queue",
  body: { delete: ["target-pending"] },
});

runningIds = ["target-running"];
pendingIds = [];
await comfy.cancelPrompts(["target-running"]);
assert.equal(calls.at(-1)?.path, "/interrupt");

const callCount = calls.length;
runningIds = ["target-running", "unrelated-running"];
await assert.rejects(
  comfy.cancelPrompts(["target-running"]),
  /prompt estraneo/i,
);
assert.equal(calls.length, callCount);

server.close();
await once(server, "close");
console.log("ComfyUI scoped cancellation: OK");
