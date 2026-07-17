const { randomUUID } = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "love-page-photos";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "gallery_photos";
const SUPABASE_ROOT = SUPABASE_URL ? SUPABASE_URL.replace(/\/$/, "") : "";

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 503,
      message: "Supabase 还没有配置好",
    };
  }

  return { ok: true };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

const mimeExtensionMap = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-m4v": ".m4v",
};

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov", ".avi", ".m4v"]);

function normalizeMimeType(mimeType = "") {
  return String(mimeType).split(";")[0].trim().toLowerCase();
}

function getFileExtension(fileName = "") {
  const nameMatch = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  if (nameMatch) {
    const ext = nameMatch[0];
    if (ext.length <= 6) return ext;
  }

  return "";
}

function getMediaType(fileName = "", mimeType = "") {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (normalizedMimeType.startsWith("image/")) return "photo";
  if (normalizedMimeType.startsWith("video/")) return "video";

  const ext = getFileExtension(fileName);
  if (imageExtensions.has(ext)) return "photo";
  if (videoExtensions.has(ext)) return "video";

  return "";
}

function getExtension(fileName = "", mimeType = "", mediaType = "photo") {
  const ext = getFileExtension(fileName);
  if (imageExtensions.has(ext) || videoExtensions.has(ext)) return ext;

  const mappedExt = mimeExtensionMap[normalizeMimeType(mimeType)];
  if (mappedExt) return mappedExt;

  return mediaType === "video" ? ".mp4" : ".jpg";
}

function createMediaRecord(fileId, fileName, storagePath, ownerToken, mediaType) {
  return {
    id: fileId,
    name: fileName || (mediaType === "video" ? "上传的视频" : "上传的照片"),
    storage_path: storagePath,
    owner_token: ownerToken,
  };
}

function toPublicRecord(row, mediaType = "") {
  return {
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    publicUrl: `${SUPABASE_ROOT}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeObjectPath(row.storage_path)}`,
    mediaType: mediaType || getMediaType(row.storage_path || row.name || ""),
    createdAt: row.created_at || new Date().toISOString(),
    isOwner: true,
  };
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function readBodyJson(request) {
  try {
    const text = (await readRawBody(request)).toString("utf8");
    return text ? JSON.parse(text) : {};
  } catch (error) {
    return {};
  }
}

async function queryPhotos(ownerToken) {
  const url = new URL(`${SUPABASE_ROOT}/rest/v1/${SUPABASE_TABLE}`);
  url.searchParams.set("select", "id,name,storage_path,created_at,owner_token");
  url.searchParams.set("order", "created_at.asc");

  const response = await fetch(url, {
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`读取照片列表失败: ${text}`);
  }

  const rows = await response.json();
  return rows.map((row) => ({
    ...toPublicRecord(row),
    isOwner: ownerToken && row.owner_token === ownerToken,
  }));
}

async function insertPhotoRecord(row, mediaType) {
  const insertResponse = await fetch(`${SUPABASE_ROOT}/rest/v1/${SUPABASE_TABLE}`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(row),
  });

  if (!insertResponse.ok) {
    const text = await insertResponse.text();
    return {
      ok: false,
      error: `保存照片记录失败: ${text}`,
    };
  }

  const rows = await insertResponse.json();
  return {
    ok: true,
    record: toPublicRecord(rows[0] || row, mediaType),
  };
}

async function createSignedUpload(request, bodyOverride) {
  const body = bodyOverride || await readBodyJson(request);
  const ownerToken = String(request.headers["x-photo-owner-token"] || body.ownerToken || "").trim();
  const fileName = String(body.name || "").trim();
  const fileType = String(body.type || "application/octet-stream").trim();
  const mediaType = getMediaType(fileName, fileType);

  if (!ownerToken) {
    return jsonResponse(400, { error: "缺少上传标识" });
  }

  if (mediaType !== "video") {
    return jsonResponse(400, { error: "直传地址只用于视频文件" });
  }

  const fileId = randomUUID();
  const ext = getExtension(fileName, fileType, mediaType);
  const storagePath = `gallery/${fileId}${ext}`;
  const signUrl = `${SUPABASE_ROOT}/storage/v1/object/upload/sign/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`;

  const signResponse = await fetch(signUrl, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ upsert: false }),
  });

  if (!signResponse.ok) {
    const text = await signResponse.text();
    return jsonResponse(500, { error: `创建视频上传地址失败: ${text}` });
  }

  const signed = await signResponse.json();
  const signedPath = signed.url || signed.signedUrl;
  if (!signedPath) {
    return jsonResponse(500, { error: "创建视频上传地址失败: 响应缺少上传地址" });
  }

  const signedUrl = signedPath.startsWith("http")
    ? signedPath
    : `${SUPABASE_ROOT}${signedPath.startsWith("/storage/v1/") ? "" : "/storage/v1"}${signedPath}`;

  return jsonResponse(200, {
    id: fileId,
    name: fileName || "上传的视频",
    storagePath,
    signedUrl,
    publicUrl: `${SUPABASE_ROOT}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`,
    mediaType,
  });
}

async function finalizeSignedUpload(request, bodyOverride) {
  const body = bodyOverride || await readBodyJson(request);
  const ownerToken = String(request.headers["x-photo-owner-token"] || body.ownerToken || "").trim();
  const fileId = String(body.id || "").trim();
  const storagePath = String(body.storagePath || "").trim();
  const fileName = String(body.name || "").trim();
  const mediaType = getMediaType(storagePath || fileName, body.type || "");

  if (!ownerToken) {
    return jsonResponse(400, { error: "缺少上传标识" });
  }

  if (!fileId || !storagePath) {
    return jsonResponse(400, { error: "缺少视频上传记录" });
  }

  if (mediaType !== "video" || !storagePath.startsWith(`gallery/${fileId}`)) {
    return jsonResponse(400, { error: "视频上传记录不合法" });
  }

  const row = createMediaRecord(fileId, fileName, storagePath, ownerToken, mediaType);
  const inserted = await insertPhotoRecord(row, mediaType);
  if (!inserted.ok) {
    await fetch(`${SUPABASE_ROOT}/storage/v1/object/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    return jsonResponse(500, { error: inserted.error });
  }

  return jsonResponse(200, inserted.record);
}

async function uploadPhoto(request) {
  const ownerToken = String(request.headers["x-photo-owner-token"] || "").trim();
  const rawFileName = String(request.headers["x-file-name"] || "").trim();
  const fileName = rawFileName ? decodeURIComponent(rawFileName) : "";
  const fileType = String(request.headers["content-type"] || "application/octet-stream").trim();
  const fileBuffer = await readRawBody(request);
  const mediaType = getMediaType(fileName, fileType);

  if (!fileBuffer.length) {
    return jsonResponse(400, { error: "缺少上传文件" });
  }

  if (!ownerToken) {
    return jsonResponse(400, { error: "缺少上传标识" });
  }

  if (!mediaType) {
    return jsonResponse(400, { error: "只能上传图片或视频文件" });
  }

  const fileId = randomUUID();
  const ext = getExtension(fileName || "", fileType || "", mediaType);
  const storagePath = `gallery/${fileId}${ext}`;
  const uploadUrl = `${SUPABASE_ROOT}/storage/v1/object/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": fileType || "application/octet-stream",
      "x-upsert": "false",
    }),
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    return jsonResponse(500, { error: `上传文件失败: ${text}` });
  }

  const row = createMediaRecord(fileId, fileName, storagePath, ownerToken, mediaType);
  const inserted = await insertPhotoRecord(row, mediaType);

  if (!inserted.ok) {
    await fetch(`${SUPABASE_ROOT}/storage/v1/object/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    return jsonResponse(500, { error: inserted.error });
  }

  return jsonResponse(200, inserted.record);
}

async function deletePhoto(request) {
  const body = await readBodyJson(request);
  const id = String(body.id || "").trim();
  const ownerToken = String(body.ownerToken || "").trim();

  if (!id) {
    return jsonResponse(400, { error: "缺少照片 ID" });
  }

  const lookupUrl = new URL(`${SUPABASE_ROOT}/rest/v1/${SUPABASE_TABLE}`);
  lookupUrl.searchParams.set("select", "id,storage_path,owner_token");
  lookupUrl.searchParams.set("id", `eq.${id}`);
  lookupUrl.searchParams.set("limit", "1");

  const lookupResponse = await fetch(lookupUrl, {
    headers: supabaseHeaders(),
  });

  if (!lookupResponse.ok) {
    const text = await lookupResponse.text();
    return jsonResponse(500, { error: `读取照片记录失败: ${text}` });
  }

  const rows = await lookupResponse.json();
  const photo = rows[0];
  if (!photo) {
    return jsonResponse(404, { error: "照片不存在" });
  }

  if (photo.owner_token !== ownerToken) {
    return jsonResponse(403, { error: "没有权限删除这张照片" });
  }

  const deleteStorageResponse = await fetch(`${SUPABASE_ROOT}/storage/v1/object/${SUPABASE_BUCKET}/${encodeObjectPath(photo.storage_path)}`, {
    method: "DELETE",
    headers: supabaseHeaders(),
  });

  if (!deleteStorageResponse.ok) {
    const text = await deleteStorageResponse.text();
    return jsonResponse(500, { error: `删除文件失败: ${text}` });
  }

  const deleteRowResponse = await fetch(`${SUPABASE_ROOT}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: supabaseHeaders(),
  });

  if (!deleteRowResponse.ok) {
    const text = await deleteRowResponse.text();
    return jsonResponse(500, { error: `删除记录失败: ${text}` });
  }

  return jsonResponse(200, { ok: true });
}

module.exports = async function handler(request, response) {
  const config = assertConfig();
  if (!config.ok) {
    response.status(config.status).json({ error: config.message });
    return;
  }

  try {
    if (request.method === "GET") {
      const ownerToken = String(request.headers["x-photo-owner-token"] || "").trim();
      const photos = await queryPhotos(ownerToken);
      response.status(200).setHeader("Cache-Control", "no-store").json({ photos });
      return;
    }

    if (request.method === "POST") {
      const contentType = String(request.headers["content-type"] || "");
      if (contentType.includes("application/json")) {
        const body = await readBodyJson(request);
        if (body.action === "createUpload") {
          const result = await createSignedUpload(request, body);
          response
            .status(result.status)
            .setHeader("Content-Type", "application/json; charset=utf-8")
            .setHeader("Cache-Control", "no-store")
            .send(result.body);
          return;
        }

        if (body.action === "finalizeUpload") {
          const result = await finalizeSignedUpload(request, body);
          response
            .status(result.status)
            .setHeader("Content-Type", "application/json; charset=utf-8")
            .setHeader("Cache-Control", "no-store")
            .send(result.body);
          return;
        }
      }

      const result = await uploadPhoto(request);
      response
        .status(result.status)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setHeader("Cache-Control", "no-store")
        .send(result.body);
      return;
    }

    if (request.method === "DELETE") {
      const result = await deletePhoto(request);
      response
        .status(result.status)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setHeader("Cache-Control", "no-store")
        .send(result.body);
      return;
    }

    response
      .status(405)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(JSON.stringify({ error: "Method Not Allowed" }));
  } catch (error) {
    response
      .status(500)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(JSON.stringify({ error: error.message || "照片接口异常" }));
  }
};
