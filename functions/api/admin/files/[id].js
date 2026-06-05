// DELETE /api/admin/files/:id  —  删除文件
// PUT   /api/admin/files/:id  —  更新文件（接收 JSON，同 upload 格式）
import { json } from '../../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'DELETE,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });

  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/');
  const fid = parseInt(parts[parts.length - 1]);
  if (!fid) return json({ error: '无效的文件ID' }, 400);

  try {
    const db = env.DB;
    const file = await db.prepare('SELECT id FROM quotation_files WHERE id = ?').bind(fid).first();
    if (!file) return json({ error: '文件不存在' }, 404);

    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM quotation_rows WHERE file_id = ?').bind(fid),
        db.prepare('DELETE FROM quotation_files WHERE id = ?').bind(fid),
      ]);
      return json({ success: true, message: '文件已删除' });
    }

    if (method === 'PUT') {
      const { fileName, categories } = await request.json();
      if (!fileName || !categories) return json({ error: '数据格式错误' }, 400);

      // 删旧数据
      await db.prepare('DELETE FROM quotation_rows WHERE file_id = ?').bind(fid).run();

      const totalRows = categories.reduce((sum, c) => sum + c.rows.length, 0);
      const now = new Date().toISOString();

      await db.prepare(
        'UPDATE quotation_files SET file_name = ?, row_count = ?, cat_count = ?, updated_at = ? WHERE id = ?'
      ).bind(fileName, totalRows, categories.length, now, fid).run();

      const stmt = db.prepare(
        'INSERT INTO quotation_rows (file_id, file_name, category, category_order, model, header_data, row_data, row_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );

      const batch = [];
      for (const cat of categories) {
        for (const row of cat.rows) {
          batch.push(stmt.bind(fid, fileName, cat.name, cat.order, row.model || '', JSON.stringify(cat.headers), JSON.stringify(row.data), row.order, now));
        }
      }

      for (let i = 0; i < batch.length; i += 100) {
        await db.batch(batch.slice(i, i + 100));
      }

      return json({ success: true, file_id: fid, row_count: totalRows, cat_count: categories.length });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
