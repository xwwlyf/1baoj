// GET /api/files  and  GET /api/files/:id
import { json, groupResults, safeJsonParse } from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, '').split('/');
    const db = env.DB;

    // /api/files/:id
    if (parts.length === 4 && parts[3]) {
      const fid = parseInt(parts[3]);
      const file = await db.prepare('SELECT * FROM quotation_files WHERE id = ?').bind(fid).first();
      if (!file) return json({ error: '文件不存在' }, 404);
      const { results: rows } = await db.prepare('SELECT * FROM quotation_rows WHERE file_id = ? ORDER BY category_order, row_order').bind(fid).all();
      return json({ file, rows: groupResults(rows) });
    }

    // /api/files
    const { results } = await db.prepare('SELECT id, file_name, row_count, cat_count, created_at, updated_at FROM quotation_files ORDER BY file_name').all();
    return json(results);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
