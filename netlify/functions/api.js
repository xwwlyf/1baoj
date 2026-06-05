// ============================================
// 打印机耗材报价检索系统 - Netlify Functions API
// 使用 Netlify Blobs 持久化存储
// ============================================

import { getStore } from "@netlify/blobs";

const BLOB_KEY = "quotation-db";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ========== 数据库 ==========
async function loadDB() {
  const store = getStore("quotation-db");
  const raw = await store.get(BLOB_KEY, { consistency: "strong" });
  if (raw) {
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }
  return { files: [], rows: [], nextFileId: 1, nextRowId: 1 };
}

async function saveDB(db) {
  const store = getStore("quotation-db");
  await store.set(BLOB_KEY, JSON.stringify(db));
}

// ========== 分组 ==========
function groupResults(rows) {
  if (!rows || rows.length === 0) return [];
  const files = new Map();
  for (const row of rows) {
    const fn = row.file_name;
    if (!files.has(fn)) files.set(fn, { file_name: fn, categories: new Map() });
    const file = files.get(fn);
    const catKey = row.category || "未分类";
    if (!file.categories.has(catKey)) {
      file.categories.set(catKey, {
        category: catKey, category_order: row.category_order,
        header_data: safeJsonParse(row.header_data, []), rows: [],
      });
    }
    file.categories.get(catKey).rows.push({
      id: row.id, model: row.model,
      row_data: safeJsonParse(row.row_data, []), row_order: row.row_order,
    });
  }
  const result = [];
  for (const [, file] of files) {
    const cats = [];
    for (const [, cat] of file.categories) {
      cats.push({
        category: cat.category, category_order: cat.category_order,
        header_data: cat.header_data,
        rows: cat.rows.sort((a, b) => a.row_order - b.row_order),
      });
    }
    cats.sort((a, b) => a.category_order - b.category_order);
    result.push({ file_name: file.file_name, categories: cats });
  }
  return result;
}

// ========== 导入分类数据（浏览器端预解析的 JSON） ==========
function importCategoriesToDB(db, fileName, categories, oldFileId) {
  if (!categories || categories.length === 0) {
    return { error: "未检测到有效数据" };
  }

  const contentStr = JSON.stringify({ fileName, categories });
  // 简单哈希（Node crypto 不可用，使用 JS 内置）
  let hash = 0;
  for (let i = 0; i < contentStr.length; i++) {
    const ch = contentStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  const hashStr = Math.abs(hash).toString(16).padStart(8, "0") + contentStr.length.toString(16);

  // 去重
  if (!oldFileId) {
    const dup = db.files.find(f => f.file_hash === hashStr);
    if (dup) return { error: `文件"${dup.file_name}"已存在，内容完全相同` };
  }

  // 删旧
  if (oldFileId) {
    db.rows = db.rows.filter(r => r.file_id !== oldFileId);
    const idx = db.files.findIndex(f => f.id === oldFileId);
    if (idx >= 0) db.files.splice(idx, 1);
  }

  // 去同名
  const sameNameIdx = db.files.findIndex(f => f.file_name === fileName);
  if (sameNameIdx >= 0) {
    db.rows = db.rows.filter(r => r.file_id !== db.files[sameNameIdx].id);
    db.files.splice(sameNameIdx, 1);
  }

  const fileId = oldFileId || db.nextFileId++;
  const totalRows = categories.reduce((sum, c) => sum + (c.rows || []).length, 0);
  const now = new Date().toISOString();

  if (oldFileId) {
    const f = db.files.find(x => x.id === oldFileId);
    if (f) {
      f.file_name = fileName; f.file_hash = hashStr;
      f.row_count = totalRows; f.cat_count = categories.length;
      f.updated_at = now;
    }
  } else {
    db.files.push({
      id: fileId, file_name: fileName, file_hash: hashStr,
      row_count: totalRows, cat_count: categories.length,
      created_at: now, updated_at: now,
    });
  }

  for (const cat of categories) {
    for (const row of (cat.rows || [])) {
      db.rows.push({
        id: db.nextRowId++, file_id: fileId, file_name: fileName,
        category: cat.name, category_order: cat.order,
        model: row.model,
        header_data: JSON.stringify(cat.headers || []),
        row_data: JSON.stringify(row.data || []),
        row_order: row.order, created_at: now,
      });
    }
  }

  return { success: true, file_id: fileId, file_name: fileName, row_count: totalRows, cat_count: categories.length };
}

// ========== 主路由 ==========
async function handleRoute(method, pathname, searchParams, body) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  // OPTIONS
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const db = await loadDB();

    // GET /api/search
    if (method === "GET" && parts[1] === "search") {
      const q = (searchParams.get("q") || "").trim();
      const fid = parseInt(searchParams.get("file_id")) || null;
      const limit = Math.min(parseInt(searchParams.get("limit")) || 200, 1000);
      const offset = parseInt(searchParams.get("offset")) || 0;

      let rows = db.rows.filter(r => {
        if (fid && r.file_id !== fid) return false;
        if (q) {
          const modelMatch = r.model.toLowerCase().includes(q.toLowerCase());
          const rowDataMatch = (r.row_data || "").toLowerCase().includes(q.toLowerCase());
          if (!modelMatch && !rowDataMatch) return false;
        }
        return true;
      });
      rows.sort((a, b) => a.file_name.localeCompare(b.file_name) || a.category_order - b.category_order || a.row_order - b.row_order);

      const total = rows.length;
      return json({ query: q, total, results: groupResults(rows.slice(offset, offset + limit)) });
    }

    // GET /api/files
    if (method === "GET" && parts[1] === "files" && parts.length === 2) {
      const files = db.files.sort((a, b) => a.file_name.localeCompare(b.file_name))
        .map(f => ({ id: f.id, file_name: f.file_name, row_count: f.row_count, cat_count: f.cat_count, created_at: f.created_at, updated_at: f.updated_at }));
      return json(files);
    }

    // GET /api/files/:id
    if (method === "GET" && parts[1] === "files" && parts.length === 3) {
      const file = db.files.find(f => f.id === parseInt(parts[2]));
      if (!file) return err("文件不存在", 404);
      const rows = db.rows.filter(r => r.file_id === file.id)
        .sort((a, b) => a.category_order - b.category_order || a.row_order - b.row_order);
      return json({ file, rows: groupResults(rows) });
    }

    // POST /api/admin/upload
    if (method === "POST" && parts[1] === "admin" && parts[2] === "upload") {
      if (!body) return err("请求体为空", 400);
      const { fileName, categories } = body;
      if (!fileName || !categories) return err("数据格式错误，缺少 fileName 或 categories", 400);
      const result = importCategoriesToDB(db, fileName, categories, null);
      if (result.error) return err(result.error);
      await saveDB(db);
      return json(result, 201);
    }

    // DELETE /api/admin/files/:id
    if (method === "DELETE" && parts[1] === "admin" && parts[2] === "files") {
      const fid = parseInt(parts[3]);
      const idx = db.files.findIndex(f => f.id === fid);
      if (idx === -1) return err("文件不存在", 404);
      db.rows = db.rows.filter(r => r.file_id !== fid);
      db.files.splice(idx, 1);
      await saveDB(db);
      return json({ success: true, message: "文件已删除" });
    }

    // PUT /api/admin/files/:id
    if (method === "PUT" && parts[1] === "admin" && parts[2] === "files") {
      const fid = parseInt(parts[3]);
      if (!db.files.find(f => f.id === fid)) return err("文件不存在", 404);
      if (!body) return err("请求体为空", 400);
      const { fileName, categories } = body;
      if (!fileName || !categories) return err("数据格式错误", 400);
      const result = importCategoriesToDB(db, fileName, categories, fid);
      if (result.error) return err(result.error);
      await saveDB(db);
      return json(result);
    }

    // GET /api/admin/export/:id
    if (method === "GET" && parts[1] === "admin" && parts[2] === "export") {
      const fid = parseInt(parts[3]);
      const file = db.files.find(f => f.id === fid);
      if (!file) return err("文件不存在", 404);
      const rows = db.rows.filter(r => r.file_id === fid)
        .sort((a, b) => a.category_order - b.category_order || a.row_order - b.row_order);
      if (rows.length === 0) return err("文件中无数据", 404);

      // 使用 xlsx 库生成 Excel
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const catMap = new Map();
      for (const row of rows) {
        const cat = row.category || "未分类";
        if (!catMap.has(cat)) catMap.set(cat, { headers: safeJsonParse(row.header_data, []), rows: [] });
        catMap.get(cat).rows.push(safeJsonParse(row.row_data, []));
      }

      if (catMap.size === 1) {
        const [cn, d] = [...catMap.entries()][0];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[cn], d.headers, ...d.rows]), "报价");
      } else {
        for (const [cn, d] of catMap) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([d.headers, ...d.rows]), cn.substring(0, 31));
        }
      }

      const xbuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new Response(xbuf, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
        },
      });
    }

    // GET /api/admin/stats
    if (method === "GET" && parts[1] === "admin" && parts[2] === "stats") {
      const est = db.rows.reduce((s, r) => s + (r.row_data?.length || 0) + (r.header_data?.length || 0), 0);
      return json({ file_count: db.files.length, row_count: db.rows.length, estimated_bytes: est });
    }

    return err(`未找到路由: ${method} /${parts.join("/")}`, 404);
  } catch (e) {
    console.error("API Error:", e);
    return err(`服务器内部错误: ${e.message}`, 500);
  }
}

// ========== Netlify Function Handler ==========
export default async function handler(event) {
  const { httpMethod: method, rawUrl, path, queryStringParameters, body: rawBody, headers: reqHeaders } = event;

  // CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // 使用 rawUrl（原始请求路径）解析路由，因为 Netlify rewrite 会改变 path
  const url = new URL(rawUrl || path, "http://localhost");
  const searchParams = url.searchParams;

  // 合并 queryStringParameters（Netlify 把 ?q=xxx 放到 queryStringParameters）
  if (queryStringParameters) {
    for (const [k, v] of Object.entries(queryStringParameters)) {
      if (!searchParams.has(k)) searchParams.set(k, v);
    }
  }

  // 解析 body
  let parsedBody = null;
  if (rawBody) {
    const ct = (reqHeaders || {})["content-type"] || "";
    if (ct.includes("application/json")) {
      try { parsedBody = JSON.parse(rawBody); } catch { /* ignore */ }
    } else if (ct.includes("multipart/form-data")) {
      // Netlify 会自动解析 multipart，但我们用 JSON 模式不需要
      // 如果需要 raw buffer，检查 event.isBase64Encoded
      try { parsedBody = JSON.parse(rawBody); } catch { /* ignore */ }
    }
  }

  try {
    const response = await handleRoute(method, path, searchParams, parsedBody);
    // 将 Response 对象转换为 Netlify 格式
    const statusCode = response.status;
    const respHeaders = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });

    let respBody;
    if (response.headers.get("Content-Type")?.includes("application/vnd.openxmlformats")) {
      // Excel 二进制：Netlify 需要 base64
      const buf = await response.arrayBuffer();
      respBody = Buffer.from(buf).toString("base64");
      respHeaders["Content-Transfer-Encoding"] = "base64";
      return { statusCode, headers: respHeaders, body: respBody, isBase64Encoded: true };
    }

    respBody = await response.text();
    return { statusCode, headers: respHeaders, body: respBody };
  } catch (e) {
    console.error("Handler error:", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
}
