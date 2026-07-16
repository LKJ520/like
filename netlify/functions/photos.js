const { Readable } = require("stream");
const photosHandler = require("../../api/photos");

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function createRequest(event) {
  const bodyBuffer = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
    : Buffer.alloc(0);

  const request = Readable.from(bodyBuffer);
  request.method = event.httpMethod;
  request.headers = normalizeHeaders(event.headers);
  return request;
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = payload == null ? "" : String(payload);
      return this;
    },
  };
}

exports.handler = async function handler(event) {
  const request = createRequest(event);
  const response = createResponse();

  await photosHandler(request, response);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
  };
};
