// SSE roundtrip test: subscribe to /api/creators/<id>/stream → POST a message
// to /api/creators/<id>/render → expect to see the message on the stream.
//
//   node apps/web/scripts/sse-roundtrip-test.mjs [base_url]
//
// Defaults to http://localhost:3000.

const BASE = process.argv[2] ?? "http://localhost:3000";
const CREATOR = "rttest-" + Date.now();
const MESSAGE = "RANDOM-" + Math.random().toString(36).slice(2, 10).toUpperCase();

console.log(`subscribing to ${BASE}/api/creators/${CREATOR}/stream …`);

const ctrl = new AbortController();
const sseRes = await fetch(`${BASE}/api/creators/${CREATOR}/stream`, {
  signal: ctrl.signal,
  headers: { Accept: "text/event-stream" },
});
if (!sseRes.ok || !sseRes.body) {
  console.error(`SSE GET failed: HTTP ${sseRes.status}`);
  process.exit(1);
}

let received = false;
let helloSeen = false;

const readerDone = (async () => {
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted by ctrl.abort() — expected
    }
    const { value, done } = chunk;
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      // Parse SSE frame
      const lines = frame.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event === "hello") {
        console.log(`✓ hello received (${data})`);
        helloSeen = true;
      } else if (event === "render") {
        try {
          const ev = JSON.parse(data);
          console.log(`✓ render received: ${JSON.stringify(ev)}`);
          if (ev.message === MESSAGE) received = true;
        } catch (e) {
          console.log(`! could not parse render data: ${data}`);
        }
      } else if (frame.startsWith(":")) {
        // heartbeat — ignore
      } else {
        console.log(`? unknown frame: ${frame}`);
      }
    }
  }
})();

// Wait briefly for hello to confirm connection is live
await new Promise((r) => setTimeout(r, 300));
if (!helloSeen) console.log("(hello not yet — proceeding anyway)");

console.log(`POSTing message="${MESSAGE}" to ${BASE}/api/creators/${CREATOR}/render …`);
const postRes = await fetch(`${BASE}/api/creators/${CREATOR}/render`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: MESSAGE }),
});
console.log(`POST → HTTP ${postRes.status}`);
const postBody = await postRes.json().catch(() => null);
if (postBody) console.log(`POST body: ${JSON.stringify(postBody)}`);

// Wait up to 5s for the SSE event
for (let i = 0; i < 50 && !received; i++) {
  await new Promise((r) => setTimeout(r, 100));
}

ctrl.abort();
await Promise.race([readerDone, new Promise((r) => setTimeout(r, 500))]);

if (received) {
  console.log("\n🟢 SSE ROUNDTRIP SUCCESS");
  process.exit(0);
} else {
  console.log("\n🔴 SSE ROUNDTRIP FAILED — no matching render event received within 5s");
  process.exit(1);
}
