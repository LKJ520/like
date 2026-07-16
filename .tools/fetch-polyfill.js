const http = require("http");
const https = require("https");

class HeadersShim {
  constructor(headers = {}) {
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );
  }

  get(name) {
    return this.headers[String(name).toLowerCase()] || null;
  }
}

class ResponseShim {
  constructor(status, headers, body) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = new HeadersShim(headers);
    this.body = body;
  }

  async text() {
    return this.body.toString("utf8");
  }

  async json() {
    return JSON.parse(await this.text());
  }
}

function normalizeBody(body) {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body));
}

function fetchPolyfill(input, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(String(input));
    const body = normalizeBody(options.body);
    const transport = target.protocol === "http:" ? http : https;
    const headers = { ...(options.headers || {}) };

    if (body && headers["Content-Length"] === undefined && headers["content-length"] === undefined) {
      headers["Content-Length"] = String(body.length);
    }

    const request = transport.request(
      target,
      {
        method: options.method || "GET",
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve(new ResponseShim(
            response.statusCode || 0,
            response.headers,
            Buffer.concat(chunks)
          ));
        });
      }
    );

    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

module.exports = fetchPolyfill;
