// ============================================
// 打印机耗材报价检索系统 - Cloudflare Worker API
// ============================================

import * as XLSX from 'xlsx';

// --- CORS 配置 ---
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
};

// --- JSON 响应助手 ---
function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    });
}

function error(msg, status = 400) {
    return json({ error: msg }, status);
}

// --- 路由 ---
async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // CORS 预检
    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
        // ========== 公开 API ==========

        // 搜索型号
        if (method === 'GET' && path === '/api/search') {
            return await searchModel(request, env, url);
        }

        // 获取文件列表（公开只读）
        if (method === 'GET' && path === '/api/files') {
            return await listFiles(env, url);
        }

        // 获取单个文件详情（公开只读）
        if (method === 'GET' && path.startsWith('/api/files/') && !path.includes('/export')) {
            const fileId = parseInt(path.split('/')[3]);
            if (!fileId) return error('无效的文件ID', 400);
            return await getFileDetail(env, fileId);
        }

        // ========== 管理 API ==========

        // 上传 Excel 文件
        if (method === 'POST' && path === '/api/admin/upload') {
            return await uploadExcel(request, env);
        }

        // 删除文件
        if (method === 'DELETE' && path.startsWith('/api/admin/files/')) {
            const fileId = parseInt(path.split('/')[4]);
            if (!fileId) return error('无效的文件ID', 400);
            return await deleteFile(env, fileId);
        }

        // 更新文件（重新上传同名文件）
        if (method === 'PUT' && path.startsWith('/api/admin/files/')) {
            const fileId = parseInt(path.split('/')[4]);
            if (!fileId) return error('无效的文件ID', 400);
            return await updateFile(request, env, fileId);
        }

        // 导出 Excel
        if (method === 'GET' && path.startsWith('/api/admin/export/')) {
            const fileId = parseInt(path.split('/')[4]);
            if (!fileId) return error('无效的文件ID', 400);
            return await exportExcel(env, fileId);
        }

        // 获取统计信息
        if (method === 'GET' && path === '/api/admin/stats') {
            return await getStats(env);
        }

        // 404
        return error('未找到路由', 404);

    } catch (e) {
        console.error('Worker Error:', e);
        return error(`服务器内部错误: ${e.message}`, 500);
    }
}

// ========== 搜索型号 ==========
async function searchModel(request, env, url) {
    const q = (url.searchParams.get('q') || '').trim();
    const fileId = parseInt(url.searchParams.get('file_id')) || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 200, 1000);
    const offset = parseInt(url.searchParams.get('offset')) || 0;

    if (!q) {
        // 不传 q 则返回全部，按文件+分类分组
        const db = env.DB;
        let sql, params;

        if (fileId) {
            sql = `SELECT qr.*, qf.file_name as qf_file_name
                   FROM quotation_rows qr
                   JOIN quotation_files qf ON qr.file_id = qf.id
                   WHERE qr.file_id = ?
                   ORDER BY qr.file_name, qr.category_order, qr.row_order
                   LIMIT ? OFFSET ?`;
            params = [fileId, limit, offset];
        } else {
            sql = `SELECT qr.*, qf.file_name as qf_file_name
                   FROM quotation_rows qr
                   JOIN quotation_files qf ON qr.file_id = qf.id
                   ORDER BY qr.file_name, qr.category_order, qr.row_order
                   LIMIT ? OFFSET ?`;
            params = [limit, offset];
        }

        const { results } = await db.prepare(sql).bind(...params).all();
        return json(groupResults(results));
    }

    // 模糊搜索：先用 FTS 查，再回表
    const db = env.DB;

    // FTS 搜索模式：支持部分匹配
    let ftsQuery = q.replace(/[^\w一-鿿\-]/g, ' ').trim().split(/\s+/).map(t => `"${t}"`).join(' OR ');
    if (!ftsQuery) ftsQuery = `"${q}"`;

    let sql, params;
    if (fileId) {
        // 指定文件内搜索
        sql = `
            SELECT qr.*, qf.file_name as qf_file_name
            FROM quotation_rows qr
            JOIN quotation_files qf ON qr.file_id = qf.id
            WHERE qr.file_id = ? AND qr.model LIKE ?
            ORDER BY qr.file_name, qr.category_order, qr.row_order
            LIMIT ? OFFSET ?
        `;
        params = [fileId, `%${q}%`, limit, offset];
    } else {
        sql = `
            SELECT qr.*, qf.file_name as qf_file_name
            FROM quotation_rows qr
            JOIN quotation_files qf ON qr.file_id = qf.id
            WHERE qr.model LIKE ?
            ORDER BY qr.file_name, qr.category_order, qr.row_order
            LIMIT ? OFFSET ?
        `;
        params = [`%${q}%`, limit, offset];
    }

    const { results } = await db.prepare(sql).bind(...params).all();

    // 总数
    let countSql, countParams;
    if (fileId) {
        countSql = 'SELECT COUNT(*) as total FROM quotation_rows WHERE file_id = ? AND model LIKE ?';
        countParams = [fileId, `%${q}%`];
    } else {
        countSql = 'SELECT COUNT(*) as total FROM quotation_rows WHERE model LIKE ?';
        countParams = [`%${q}%`];
    }
    const { results: countResult } = await db.prepare(countSql).bind(...countParams).all();

    return json({
        query: q,
        total: countResult[0]?.total || 0,
        results: groupResults(results),
    });
}

// ========== 结果分组（文件 → 分类 → 行） ==========
function groupResults(rows) {
    if (!rows || rows.length === 0) return [];

    const files = new Map();

    for (const row of rows) {
        const fn = row.qf_file_name || row.file_name;

        if (!files.has(fn)) {
            files.set(fn, { file_name: fn, categories: new Map() });
        }

        const file = files.get(fn);
        const catKey = row.category || '未分类';
        if (!file.categories.has(catKey)) {
            file.categories.set(catKey, {
                category: catKey,
                category_order: row.category_order,
                header_data: safeJsonParse(row.header_data, []),
                rows: [],
            });
        }

        file.categories.get(catKey).rows.push({
            id: row.id,
            model: row.model,
            row_data: safeJsonParse(row.row_data, []),
            row_order: row.row_order,
        });
    }

    // 转换为数组格式
    const result = [];
    for (const [fn, file] of files) {
        const cats = [];
        for (const [cn, cat] of file.categories) {
            cats.push({
                category: cat.category,
                category_order: cat.category_order,
                header_data: cat.header_data,
                rows: cat.rows.sort((a, b) => a.row_order - b.row_order),
            });
        }
        cats.sort((a, b) => a.category_order - b.category_order);
        result.push({ file_name: fn, categories: cats });
    }

    return result;
}

function safeJsonParse(str, fallback) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

// ========== 文件列表 ==========
async function listFiles(env, url) {
    const { results } = await env.DB.prepare(
        'SELECT id, file_name, row_count, cat_count, created_at, updated_at FROM quotation_files ORDER BY file_name'
    ).all();

    return json(results);
}

// ========== 文件详情 ==========
async function getFileDetail(env, fileId) {
    const file = await env.DB.prepare(
        'SELECT id, file_name, row_count, cat_count, created_at, updated_at FROM quotation_files WHERE id = ?'
    ).bind(fileId).first();

    if (!file) return error('文件不存在', 404);

    const { results: rows } = await env.DB.prepare(
        'SELECT * FROM quotation_rows WHERE file_id = ? ORDER BY category_order, row_order'
    ).bind(fileId).all();

    return json({ file, rows: groupResults(rows.map(r => ({ ...r, qf_file_name: r.file_name }))) });
}

// ========== 上传 Excel ==========
async function uploadExcel(request, env) {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
        return error('请上传Excel文件', 400);
    }

    // 检查文件大小
    const maxSize = (env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
    if (file.size > maxSize) {
        return error(`文件大小超过限制（最大${env.MAX_FILE_SIZE_MB || 10}MB）`, 413);
    }

    // 读取并解析 Excel
    const arrayBuffer = await file.arrayBuffer();
    let workbook;
    try {
        workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    } catch (e) {
        return error(`Excel解析失败: ${e.message}`, 400);
    }

    // 解析 Excel 结构
    const parsed = parseWorkbook(workbook);
    if (!parsed || parsed.categories.length === 0) {
        return error('Excel文件中未找到有效数据', 400);
    }

    // 计算文件 hash（简单去重）
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 检查是否已存在同名同内容文件
    const existing = await env.DB.prepare(
        'SELECT id, file_hash FROM quotation_files WHERE file_name = ? OR file_hash = ?'
    ).bind(file.name, fileHash).first();

    if (existing && existing.file_hash === fileHash) {
        return error('已存在完全相同的文件', 409);
    }

    // 写入数据库
    const db = env.DB;
    let fileId;

    // 如果同名文件存在但内容不同，先删除旧的
    if (existing) {
        await db.prepare('DELETE FROM quotation_files WHERE id = ?').bind(existing.id).run();
    }

    // 插入文件记录
    const totalRows = parsed.categories.reduce((sum, c) => sum + c.rows.length, 0);
    const result = await db.prepare(
        'INSERT INTO quotation_files (file_name, file_hash, row_count, cat_count) VALUES (?, ?, ?, ?)'
    ).bind(file.name, fileHash, totalRows, parsed.categories.length).run();
    fileId = result.meta.last_row_id;

    // 批量插入数据行
    const stmt = db.prepare(
        'INSERT INTO quotation_rows (file_id, file_name, category, category_order, model, header_data, row_data, row_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const batch = [];
    for (const cat of parsed.categories) {
        for (const row of cat.rows) {
            batch.push(stmt.bind(
                fileId,
                file.name,
                cat.name,
                cat.order,
                row.model,
                JSON.stringify(cat.headers),
                JSON.stringify(row.data),
                row.order
            ));
        }
    }

    // D1 批量写入（分批，每批最多100条）
    for (let i = 0; i < batch.length; i += 100) {
        const chunk = batch.slice(i, i + 100);
        await db.batch(chunk);
    }

    return json({
        success: true,
        file_id: fileId,
        file_name: file.name,
        row_count: totalRows,
        cat_count: parsed.categories.length,
    }, 201);
}

// ========== 删除文件 ==========
async function deleteFile(env, fileId) {
    const file = await env.DB.prepare('SELECT id FROM quotation_files WHERE id = ?').bind(fileId).first();
    if (!file) return error('文件不存在', 404);

    await env.DB.batch([
        env.DB.prepare('DELETE FROM quotation_rows WHERE file_id = ?').bind(fileId),
        env.DB.prepare('DELETE FROM quotation_files WHERE id = ?').bind(fileId),
    ]);

    return json({ success: true, message: '文件已删除' });
}

// ========== 更新文件 ==========
async function updateFile(request, env, fileId) {
    const file = await env.DB.prepare('SELECT id FROM quotation_files WHERE id = ?').bind(fileId).first();
    if (!file) return error('文件不存在', 404);

    // 先删除旧数据，再插入新数据
    await env.DB.prepare('DELETE FROM quotation_rows WHERE file_id = ?').bind(fileId).run();

    // 复用上传逻辑
    const formData = await request.formData();
    const uploadFile = formData.get('file');
    if (!uploadFile) return error('请上传Excel文件', 400);

    const arrayBuffer = await uploadFile.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const parsed = parseWorkbook(workbook);

    if (!parsed || parsed.categories.length === 0) {
        return error('Excel文件中未找到有效数据', 400);
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const totalRows = parsed.categories.reduce((sum, c) => sum + c.rows.length, 0);

    await env.DB.prepare(
        'UPDATE quotation_files SET file_name = ?, file_hash = ?, row_count = ?, cat_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(uploadFile.name, fileHash, totalRows, parsed.categories.length, fileId).run();

    const stmt = env.DB.prepare(
        'INSERT INTO quotation_rows (file_id, file_name, category, category_order, model, header_data, row_data, row_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const batch = [];
    for (const cat of parsed.categories) {
        for (const row of cat.rows) {
            batch.push(stmt.bind(
                fileId, uploadFile.name, cat.name, cat.order,
                row.model, JSON.stringify(cat.headers), JSON.stringify(row.data), row.order
            ));
        }
    }

    for (let i = 0; i < batch.length; i += 100) {
        await env.DB.batch(batch.slice(i, i + 100));
    }

    return json({ success: true, file_id: fileId, row_count: totalRows, cat_count: parsed.categories.length });
}

// ========== 导出 Excel ==========
async function exportExcel(env, fileId) {
    const file = await env.DB.prepare('SELECT * FROM quotation_files WHERE id = ?').bind(fileId).first();
    if (!file) return error('文件不存在', 404);

    const { results: rows } = await env.DB.prepare(
        'SELECT * FROM quotation_rows WHERE file_id = ? ORDER BY category_order, row_order'
    ).bind(fileId).all();

    if (rows.length === 0) return error('文件中无数据', 404);

    // 重建 Excel 结构
    const workbook = XLSX.utils.book_new();

    // 按分类分 Sheet
    const catMap = new Map();
    for (const row of rows) {
        const cat = row.category || '未分类';
        if (!catMap.has(cat)) {
            catMap.set(cat, {
                headers: safeJsonParse(row.header_data, []),
                rows: [],
            });
        }
        catMap.get(cat).rows.push(safeJsonParse(row.row_data, []));
    }

    // 如果只有一个分类，放在 "Sheet1" 中；否则每个分类一个 Sheet
    if (catMap.size === 1) {
        const [catName, data] = [...catMap.entries()][0];
        const sheetData = [
            [catName], // 分类名作为标题行
            data.headers,
            ...data.rows,
        ];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(workbook, ws, '报价');
    } else {
        for (const [catName, data] of catMap) {
            const sheetName = catName.substring(0, 31); // Excel Sheet 名最长 31 字符
            const sheetData = [data.headers, ...data.rows];
            const ws = XLSX.utils.aoa_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, ws, sheetName);
        }
    }

    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    return new Response(buffer, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
            ...CORS_HEADERS,
        },
    });
}

// ========== 获取统计 ==========
async function getStats(env) {
    const db = env.DB;
    const [
        { results: files },
        { results: rows },
    ] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM quotation_files').all(),
        db.prepare('SELECT COUNT(*) as count FROM quotation_rows').all(),
    ]);

    // 估算存储大小
    const { results: sizeEst } = await db.prepare(
        'SELECT SUM(LENGTH(row_data) + LENGTH(header_data)) as est FROM quotation_rows'
    ).all();

    return json({
        file_count: files[0]?.count || 0,
        row_count: rows[0]?.count || 0,
        estimated_bytes: sizeEst[0]?.est || 0,
    });
}

// ========== Excel 解析逻辑 ==========
// 解析规则：
//   1. 第一列非空且后续列为空 → 分类行
//   2. 第一列类似"型号"、"规格"等关键词且后续列非空 → 表头行
//   3. 第一列和后续列都非空 → 数据行
//   4. 跳过完全空的行
function parseWorkbook(workbook) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return null;

    // 转为二维数组
    const aoa = sheetToArray(firstSheet);
    if (!aoa || aoa.length === 0) return null;

    const categories = [];
    let currentCat = null;

    // 表头关键词
    const headerKeywords = ['型号', '规格', '品名', '名称', '型号规格', '商品名称', '产品型号',
        'MODEL', 'Model', 'model', 'part', 'Part Number', '描述', 'Description'];

    for (let i = 0; i < aoa.length; i++) {
        const rawRow = aoa[i];
        // 去掉首尾空格
        const row = rawRow.map(c => (c === undefined || c === null) ? '' : String(c).trim());

        // 跳过完全空行
        if (row.every(c => c === '')) continue;

        const firstCol = row[0];
        const hasOtherCols = row.slice(1).some(c => c !== '');

        if (!hasOtherCols) {
            // 只有第一列有内容 → 分类行
            currentCat = {
                name: firstCol,
                order: categories.length,
                headers: [],
                rows: [],
            };
            categories.push(currentCat);
        } else if (currentCat && currentCat.headers.length === 0 && isHeaderRow(firstCol, headerKeywords)) {
            // 第一列像是表头且当前分类还没有表头 → 表头行
            // 过滤空列，保留完整列顺序
            currentCat.headers = row;
        } else if (currentCat && currentCat.headers.length > 0) {
            // 有表头了 → 数据行
            // 确保数据列数与表头一致（不足补空，超出保留）
            const data = [...row];
            while (data.length < currentCat.headers.length) data.push('');
            currentCat.rows.push({
                model: firstCol,
                data: data,
                order: currentCat.rows.length,
            });
        } else if (currentCat && currentCat.headers.length === 0) {
            // 有分类但没有表头，第一列非关键词 → 可能是无表头的纯数据
            // 把第一行作为表头
            if (currentCat.rows.length === 0 && row.length > 1) {
                // 生成默认表头
                currentCat.headers = row.map((_, idx) => `列${idx + 1}`);
                currentCat.rows.push({
                    model: firstCol,
                    data: row,
                    order: 0,
                });
            } else {
                currentCat.rows.push({
                    model: firstCol,
                    data: row,
                    order: currentCat.rows.length,
                });
            }
        } else if (!currentCat) {
            // 没有分类直接数据：自动创建默认分类
            currentCat = {
                name: '默认分类',
                order: 0,
                headers: isHeaderRow(firstCol, headerKeywords) ? row : [],
                rows: [],
            };
            categories.push(currentCat);
            if (currentCat.headers.length === 0) {
                // 把第一行数据作为表头的基础
                if (hasOtherCols) {
                    currentCat.headers = row.map((_, idx) => `列${idx + 1}`);
                    currentCat.rows.push({
                        model: firstCol,
                        data: row,
                        order: 0,
                    });
                }
            }
        }
    }

    // 过滤空分类
    return { categories: categories.filter(c => c.rows.length > 0 || c.headers.length > 0) };
}

function isHeaderRow(firstCol, keywords) {
    return keywords.some(kw => firstCol.includes(kw) || kw.includes(firstCol));
}

// Sheet 转二维数组
function sheetToArray(sheet) {
    const range = decodeRange(sheet['!ref']);
    if (!range) return [];

    const result = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[encodeCell(r, c)];
            row.push(cell ? cell.v ?? cell.w ?? '' : '');
        }
        result.push(row);
    }
    return result;
}

function decodeRange(ref) {
    if (!ref) return null;
    const m = ref.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!m) return null;
    return {
        s: { r: parseInt(m[2]) - 1, c: colToNum(m[1]) },
        e: { r: parseInt(m[4]) - 1, c: colToNum(m[3]) },
    };
}

function colToNum(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) {
        n = n * 26 + (col.charCodeAt(i) - 64);
    }
    return n - 1;
}

function encodeCell(r, c) {
    let col = '';
    let t = c;
    do {
        col = String.fromCharCode(65 + (t % 26)) + col;
        t = Math.floor(t / 26) - 1;
    } while (t >= 0);
    return col + (r + 1);
}

// ========== 入口 ==========
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },
};
