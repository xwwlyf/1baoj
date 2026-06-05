// Pages Functions 公共工具

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// 搜索结果分组：文件 → 分类 → 行
export function groupResults(rows) {
  if (!rows || rows.length === 0) return [];
  const files = new Map();
  for (const row of rows) {
    const fn = row.file_name;
    if (!files.has(fn)) files.set(fn, { file_name: fn, categories: new Map() });
    const f = files.get(fn);
    const ck = row.category || '未分类';
    if (!f.categories.has(ck)) {
      f.categories.set(ck, {
        category: ck, category_order: row.category_order,
        header_data: safeJsonParse(row.header_data, []), rows: [],
      });
    }
    f.categories.get(ck).rows.push({
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
