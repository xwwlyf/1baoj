// GET /api/admin/stats
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const db = env.DB;
    const [{ results: files }, { results: rows }, { results: sizeEst }] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM quotation_files').all(),
      db.prepare('SELECT COUNT(*) as count FROM quotation_rows').all(),
      db.prepare('SELECT SUM(LENGTH(row_data) + LENGTH(header_data)) as est FROM quotation_rows').all(),
    ]);

    return json({
      file_count: files[0]?.count || 0,
      row_count: rows[0]?.count || 0,
      estimated_bytes: sizeEst[0]?.est || 0,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
