const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
loadLocalEnv(path.join(root, ".env.local"));

const port = Number(process.env.PORT || process.argv[2] || 3001);
if (typeof global.fetch !== "function") {
  global.fetch = require(path.join(root, ".tools", "fetch-polyfill.js"));
}
const apiPhotosHandler = require(path.join(root, "api", "photos.js"));

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  });
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function createApiResponse(res) {
  const headers = {};
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      headers[name] = value;
      res.setHeader(name, value);
      return this;
    },
    json(body) {
      if (!res.getHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(body));
    },
    send(body) {
      if (Buffer.isBuffer(body) || typeof body === "string") {
        res.end(body);
        return;
      }
      res.end(String(body));
    },
  };
}

function createRequestHandler() {
  return (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    if (pathname === "/api/photos") {
      apiPhotosHandler(req, createApiResponse(res));
      return;
    }

    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root)) {
      send(res, 403, "Forbidden");
      return;
    }

    fs.stat(target, (statError, stat) => {
      if (statError || !stat.isFile()) {
        send(res, 404, "Not found");
        return;
      }

      const type = types[path.extname(target).toLowerCase()] || "application/octet-stream";
      const isAsset = target.includes(`${path.sep}assets${path.sep}`);
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": isAsset ? "public, max-age=86400" : "no-store"
      });
      fs.createReadStream(target).pipe(res);
    });
  };
}

function listenOnPort(portCandidate) {
  const server = http.createServer(createRequestHandler());

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listenOnPort(portCandidate + 1);
      return;
    }

    throw error;
  });

  server.listen(portCandidate, "127.0.0.1", () => {
    console.log(`Static server listening on http://127.0.0.1:${portCandidate}`);
  });
}

listenOnPort(port);
