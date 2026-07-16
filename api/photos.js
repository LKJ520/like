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

function getExtension(fileName = "", mimeType = "") {
  const nameMatch = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  if (nameMatch) {
    const ext = nameMatch[0];
    if (ext.length <= 6) return ext;
  }

  const mimeMap = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };

  return mimeMap[mimeType.toLowerCase()] || ".jpg";
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
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    publicUrl: `${SUPABASE_ROOT}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeObjectPath(row.storage_path)}`,
    createdAt: row.created_at,
    isOwner: ownerToken && row.owner_token === ownerToken,
  }));
}

async function uploadPhoto(request) {
  const ownerToken = String(request.headers["x-photo-owner-token"] || "").trim();
  const rawFileName = String(request.headers["x-file-name"] || "").trim();
  const fileName = rawFileName ? decodeURIComponent(rawFileName) : "";
  const fileType = String(request.headers["content-type"] || "application/octet-stream").trim();
  const fileBuffer = await readRawBody(request);

  if (!fileBuffer.length) {
    return jsonResponse(400, { error: "缺少图片文件" });
  }

  if (!ownerToken) {
    return jsonResponse(400, { error: "缺少上传标识" });
  }

  const fileId = randomUUID();
  const ext = getExtension(fileName || "", fileType || "");
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

  const row = {
    id: fileId,
    name: fileName || "上传的照片",
    storage_path: storagePath,
    owner_token: ownerToken,
  };

  const insertResponse = await fetch(`${SUPABASE_ROOT}/rest/v1/${SUPABASE_TABLE}`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(row),
  });

  if (!insertResponse.ok) {
    await fetch(`${SUPABASE_ROOT}/storage/v1/object/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    const text = await insertResponse.text();
    return jsonResponse(500, { error: `保存照片记录失败: ${text}` });
  }

  return jsonResponse(200, {
    id: fileId,
    name: row.name,
    storagePath,
    publicUrl: `${SUPABASE_ROOT}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeObjectPath(storagePath)}`,
    createdAt: new Date().toISOString(),
    isOwner: true,
  });
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
