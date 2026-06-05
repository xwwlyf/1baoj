// GET /api/search?q=388&file_id=1
import { json, groupResults } from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const fileId = parseInt(url.searchParams.get('file_id')) || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 200, 1000);
    const offset = parseInt(url.searchParams.get('offset')) || 0;

    const db = env.DB;
    let rows;

    if (q) {
      if (fileId) {
        const { results } = await db.prepare(
          'SELECT * FROM quotation_rows WHERE file_id = ? AND model LIKE ? ORDER BY file_name, category_order, row_order LIMIT ? OFFSET ?'
        ).bind(fileId, `%${q}%`, limit, offset).all();
        rows = results;
      } else {
        const { results } = await db.prepare(
          'SELECT * FROM quotation_rows WHERE model LIKE ? OR row_data LIKE ? ORDER BY file_name, category_order, row_order LIMIT ? OFFSET ?'
        ).bind(`%${q}%`, `%${q}%`, limit, offset).all();
        rows = results;
      }
    } else {
      if (fileId) {
        const { results } = await db.prepare(
          'SELECT * FROM quotation_rows WHERE file_id = ? ORDER BY file_name, category_order, row_order LIMIT ? OFFSET ?'
        ).bind(fileId, limit, offset).all();
        rows = results;
      } else {
        const { results } = await db.prepare(
          'SELECT * FROM quotation_rows ORDER BY file_name, category_order, row_order LIMIT ? OFFSET ?'
        ).bind(limit, offset).all();
        rows = results;
      }
    }

    // Count
    let countResult;
    if (q) {
      if (fileId) {
        const { results } = await db.prepare('SELECT COUNT(*) as total FROM quotation_rows WHERE file_id = ? AND model LIKE ?').bind(fileId, `%${q}%`).all();
        countResult = results;
      } else {
        const { results } = await db.prepare('SELECT COUNT(*) as total FROM quotation_rows WHERE model LIKE ? OR row_data LIKE ?').bind(`%${q}%`, `%${q}%`).all();
        countResult = results;
      }
    } else {
      const { results } = await db.prepare('SELECT COUNT(*) as total FROM quotation_rows').all();
      countResult = results;
    }

    return json({
      query: q,
      total: countResult[0]?.total || 0,
      results: groupResults(rows || []),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
