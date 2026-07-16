const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "assets", "music", "huh.mp4");
const output = path.join(root, "assets", "music", "huh.mp3");
const lame = path.join(__dirname, "node_modules", "lamejs", "lame.min.js");
const port = Number(process.argv[2] || 8099);

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

const page = `<!doctype html>
<meta charset="utf-8">
<title>audio converter</title>
<script src="/lame.min.js"></script>
<script>
function floatToInt16(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

async function convert() {
  const source = await fetch("/input");
  const bytes = await source.arrayBuffer();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  const buffer = await context.decodeAudioData(bytes);
  const channels = buffer.numberOfChannels;
  const samples = buffer.length;
  const mono = new Float32Array(samples);
  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < samples; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  const pcm = floatToInt16(mono);
  const encoder = new lamejs.Mp3Encoder(1, buffer.sampleRate, 128);
  const chunks = [];
  const blockSize = 1152;
  for (let i = 0; i < pcm.length; i += blockSize) {
    const block = pcm.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(end);
  const blob = new Blob(chunks, { type: "audio/mpeg" });
  await fetch("/save", { method: "POST", body: blob });
  document.body.textContent = "done";
}

convert().catch(async error => {
  document.body.textContent = error && error.stack ? error.stack : String(error);
  await fetch("/error", { method: "POST", body: document.body.textContent });
});
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    send(res, 200, page, "text/html; charset=utf-8");
    return;
  }

  if (req.url === "/lame.min.js") {
    fs.createReadStream(lame)
      .on("error", () => send(res, 500, "missing lame.min.js", "text/plain; charset=utf-8"))
      .pipe(res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }));
    return;
  }

  if (req.url === "/input") {
    fs.createReadStream(input)
      .on("error", () => send(res, 500, "missing input", "text/plain; charset=utf-8"))
      .pipe(res.writeHead(200, { "Content-Type": "audio/mp4" }));
    return;
  }

  if (req.url === "/save" && req.method === "POST") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      fs.writeFileSync(output, Buffer.concat(chunks));
      send(res, 200, "ok", "text/plain; charset=utf-8");
      console.log(output);
      server.close(() => process.exit(0));
    });
    return;
  }

  if (req.url === "/error" && req.method === "POST") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      console.error(Buffer.concat(chunks).toString("utf8"));
      send(res, 500, "error", "text/plain; charset=utf-8");
      server.close(() => process.exit(1));
    });
    return;
  }

  send(res, 404, "not found", "text/plain; charset=utf-8");
});

server.listen(port, "127.0.0.1", () => {
  console.log("converter listening on http://127.0.0.1:" + port);
});
