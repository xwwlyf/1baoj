// POST /api/admin/upload — 接收浏览器端解析好的 JSON 数据
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { fileName, categories } = await request.json();
    if (!fileName || !categories || categories.length === 0) {
      return json({ error: '数据格式错误' }, 400);
    }

    const db = env.DB;
    const totalRows = categories.reduce((sum, c) => sum + c.rows.length, 0);

    // 简单去重（基于文件名）
    const existing = await db.prepare('SELECT id FROM quotation_files WHERE file_name = ?').bind(fileName).first();
    if (existing) {
      // 删除旧数据
      await db.batch([
        db.prepare('DELETE FROM quotation_rows WHERE file_id = ?').bind(existing.id),
        db.prepare('DELETE FROM quotation_files WHERE id = ?').bind(existing.id),
      ]);
    }

    // 插入文件
    const now = new Date().toISOString();
    const fileResult = await db.prepare(
      'INSERT INTO quotation_files (file_name, file_hash, row_count, cat_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(fileName, now, totalRows, categories.length, now, now).run();
    const fileId = fileResult.meta.last_row_id;

    // 批量插入行
    const stmt = db.prepare(
      'INSERT INTO quotation_rows (file_id, file_name, category, category_order, model, header_data, row_data, row_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const batch = [];
    for (const cat of categories) {
      for (const row of cat.rows) {
        batch.push(stmt.bind(
          fileId, fileName, cat.name, cat.order,
          row.model || '',
          JSON.stringify(cat.headers),
          JSON.stringify(row.data),
          row.order,
          now
        ));
      }
    }

    // D1 batch 限制 100 条
    for (let i = 0; i < batch.length; i += 100) {
      await db.batch(batch.slice(i, i + 100));
    }

    return json({
      success: true, file_id: fileId, file_name: fileName,
      row_count: totalRows, cat_count: categories.length,
    }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
