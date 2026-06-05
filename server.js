// ============================================
// 打印机耗材报价检索系统 - 本地开发服务器
// 一条命令启动：node server.js
// ============================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, 'frontend');
const DB_FILE = path.join(__dirname, 'data.json');
const PORT = 3000;
const LOG = path.join(__dirname, 'server_debug.log');

function debug(...args) {
    const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    process.stderr.write(msg);
}

// ========== 数据库 ==========
let DB = { quotation_files: [], quotation_rows: [] };
let nextFileId = 1;
let nextRowId = 1;

if (fs.existsSync(DB_FILE)) {
    try {
        const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        DB = raw.DB || DB;
        nextFileId = raw.nextFileId || 1;
        nextRowId = raw.nextRowId || 1;
    } catch { /* ignore */ }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ DB, nextFileId, nextRowId }, null, 2));
}

// ========== 工具 ==========
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
};

function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
    res.end(JSON.stringify(data, null, 2));
}

function err(res, msg, status = 400) {
    json(res, { error: msg }, status);
}

function readBody(req) {
    return new Promise(resolve => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
}

// ========== 分组 ==========
function groupResults(rows) {
    if (!rows || rows.length === 0) return [];
    const files = new Map();
    for (const row of rows) {
        const fn = row.file_name;
        if (!files.has(fn)) files.set(fn, { file_name: fn, categories: new Map() });
        const file = files.get(fn);
        const catKey = row.category || '未分类';
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

// ========== Multipart 解析（从 Buffer 直接定位边界） ==========

function parseMultipartBody(buf, boundary) {
    const boundaryMarker = Buffer.from('--' + boundary, 'utf-8');
    const crlf = Buffer.from('\r\n', 'utf-8');
    const doubleCrlf = Buffer.from('\r\n\r\n', 'utf-8');
    const parts = [];

    let pos = 0;
    while (pos < buf.length) {
        // 找下一个 boundary
        const bIdx = buf.indexOf(boundaryMarker, pos);
        if (bIdx === -1) break;

        // boundary 后面是 \r\n 还是 --\r\n（结束标记）？
        const afterB = bIdx + boundaryMarker.length;
        if (afterB + 1 >= buf.length) break;
        if (buf[afterB] === 45 && buf[afterB + 1] === 45) break; // '--' 结束

        // 跳过 boundary + \r\n
        let hdrStart = afterB;
        if (buf[hdrStart] === 13) hdrStart++;
        if (buf[hdrStart] === 10) hdrStart++;

        // 找 \r\n\r\n（header 结束）
        const hdrEnd = buf.indexOf(doubleCrlf, hdrStart);
        if (hdrEnd === -1) break;

        const headerBuf = buf.slice(hdrStart, hdrEnd);
        const headerStr = headerBuf.toString('latin1');

        const contentStart = hdrEnd + 4;

        // 找下一个 boundary 作为内容结束
        const nextB = buf.indexOf(boundaryMarker, contentStart);
        let contentEnd = nextB === -1 ? buf.length : nextB;

        // 去掉尾部 \r\n
        if (contentEnd >= 2 && buf[contentEnd - 2] === 13 && buf[contentEnd - 1] === 10) {
            contentEnd -= 2;
        }

        const content = buf.slice(contentStart, contentEnd);

        // 提取 filename
        const fileName = extractFilenameFromBuf(headerBuf);

        if (fileName && content.length > 0) {
            parts.push({ filename: fileName, content });
        }

        pos = contentEnd;
    }

    debug(`  parsed ${parts.length} file part(s) from multipart`);
    if (parts.length > 0) debug(`  filename: "${parts[0].filename}", size: ${parts[0].content.length}`);
    return parts;
}

function extractFilenameFromBuf(headerBuf) {
    // 先在 header buffer 中找 "filename*=UTF-8''" (RFC 5987)
    const rfcMarker = Buffer.from("filename*=UTF-8''", 'ascii');
    const rfcIdx = headerBuf.indexOf(rfcMarker);
    if (rfcIdx >= 0) {
        let start = rfcIdx + rfcMarker.length;
        let end = start;
        while (end < headerBuf.length && headerBuf[end] !== 0x3B && headerBuf[end] !== 0x0D && headerBuf[end] !== 0x0A) end++;
        const encoded = headerBuf.slice(start, end).toString('ascii');
        try { return decodeURIComponent(encoded); } catch { return null; }
    }

    // 在 buffer 中找 filename="
    const fnMarker = Buffer.from('filename="', 'ascii');
    const fnIdx = headerBuf.indexOf(fnMarker);
    if (fnIdx === -1) return null;

    const start = fnIdx + fnMarker.length;
    let end = start;
    while (end < headerBuf.length && headerBuf[end] !== 0x22) end++;
    if (end === start) return null;

    const fnBuf = headerBuf.slice(start, end);
    // 尝试 UTF-8 解码
    let result = fnBuf.toString('utf-8');
    // 如果包含替换字符 U+FFFD，尝试用 latin1→utf-8
    if (result.includes('�')) {
        result = Buffer.from(fnBuf.toString('latin1'), 'latin1').toString('utf-8');
    }
    return result;
}

// ========== Excel 解析 ==========
let XLSX = null;

async function loadXLSX() {
    if (XLSX) return XLSX;
    XLSX = await import('xlsx');
    return XLSX;
}

function parseWorkbook(workbook) {
    const sheets = [];
    for (let si = 0; si < workbook.SheetNames.length; si++) {
        const sheet = workbook.Sheets[workbook.SheetNames[si]];
        if (!sheet) continue;
        const aoa = sheetToArray(sheet);
        if (aoa && aoa.length > 0) {
            sheets.push({ name: workbook.SheetNames[si], data: aoa });
        }
    }

    const categories = [];
    const modelKeywords = ['型号', '规格', '品名', '型号规格', '商品名称', '产品型号', '物料编码',
        'MODEL', 'Model', 'model', 'part', 'Part Number'];

    for (const { name: sheetName, data: aoa } of sheets) {
        let currentCat = null;

        for (const rawRow of aoa) {
            const row = rawRow.map(c => (c == null) ? '' : String(c).trim());
            if (row.every(c => c === '')) continue;

            const firstCol = row[0];
            const hasOtherCols = row.slice(1).some(c => c !== '');

            if (!hasOtherCols) {
                // 单列行 → 可能是分类标题或备注
                // 超长单列行（>50字）是备注说明，不是分类，跳过
                if (firstCol.length > 50) continue;
                // 纯数字单列行也跳过
                if (/^\d+$/.test(firstCol)) continue;

                currentCat = { name: firstCol, order: categories.length, headers: [], rows: [] };
                categories.push(currentCat);
            } else if (currentCat && currentCat.headers.length === 0 && currentCat.rows.length === 0) {
                // 分类后的第一个多列行 → 一定是表头
                currentCat.headers = row;
                currentCat.modelCol = findModelColumn(row, modelKeywords);
            } else if (currentCat && currentCat.headers.length > 0) {
                // 表头已确定 → 数据行
                const data = [...row];
                while (data.length < currentCat.headers.length) data.push('');
                const model = getModel(data, currentCat.modelCol);
                currentCat.rows.push({ model, data, order: currentCat.rows.length });
            } else if (!currentCat) {
                // 没有分类行，直接开始
                // 第一个多列行当作表头（即使不完全像表头，也比"列1""列2"好）
                currentCat = {
                    name: sheetName !== 'Sheet1' ? sheetName : '默认分类',
                    order: categories.length,
                    headers: row,
                    rows: [],
                };
                currentCat.modelCol = findModelColumn(row, modelKeywords);
                categories.push(currentCat);
            }
        }
    }

    return { categories: categories.filter(c => c.rows.length > 0) };
}

// 在表头中找到型号列索引
function findModelColumn(headers, keywords) {
    for (let i = 0; i < headers.length; i++) {
        const h = headers[i].toLowerCase();
        if (keywords.some(kw => h.includes(kw.toLowerCase()))) {
            return i;
        }
    }
    // 回退：找第一个包含字母数字组合且长度>=3的列（如 Q2612A）
    for (let i = 0; i < headers.length; i++) {
        if (/[A-Za-z0-9\-/]+/.test(headers[i]) && headers[i].length >= 3) return i;
    }
    return 0;
}

// 从数据行取型号值
function getModel(data, modelCol) {
    if (modelCol >= 0 && modelCol < data.length) {
        const v = data[modelCol];
        if (v && v.length > 0) return v;
    }
    return data[0] || '';
}

function sheetToArray(sheet) {
    // raw: false → 取格式化后的显示文字（如 v=30.434, 格式为整数 → "30"）
    // defval: '' → 空单元格返回空字符串
    try {
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        if (raw && raw.length > 0) return raw;
    } catch { /* fallback */ }
    // fallback：手动解析
    const range = decodeRange(sheet['!ref']);
    if (!range) return [];
    const result = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[encodeCell(r, c)];
            if (!cell) { row.push(''); continue; }
            const val = (cell.w !== undefined && cell.w !== null) ? String(cell.w) : (cell.v !== undefined && cell.v !== null) ? String(cell.v) : '';
            row.push(val);
        }
        result.push(row);
    }
    return result;
}

function decodeRange(ref) {
    if (!ref) return null;
    const m = ref.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!m) return null;
    return { s: { r: parseInt(m[2]) - 1, c: colToNum(m[1]) }, e: { r: parseInt(m[4]) - 1, c: colToNum(m[3]) } };
}

function colToNum(col) { let n = 0; for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64); return n - 1; }

function encodeCell(r, c) {
    let col = '', t = c;
    do { col = String.fromCharCode(65 + (t % 26)) + col; t = Math.floor(t / 26) - 1; } while (t >= 0);
    return col + (r + 1);
}

// ========== 文件导入 ==========
async function importFileToDB(fileName, fileBuffer, oldFileId) {
    const XLSX_mod = await loadXLSX();
    const workbook = XLSX_mod.read(new Uint8Array(fileBuffer), { type: 'array' });
    const parsed = parseWorkbook(workbook);

    if (!parsed || parsed.categories.length === 0) {
        return { error: 'Excel文件中未找到有效数据。请确保文件包含分类行（如"HP系列"）、表头行（含"型号"等）和数据行。' };
    }

    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (!oldFileId) {
        const dup = DB.quotation_files.find(f => f.file_hash === hash);
        if (dup) return { error: `文件"${dup.file_name}"已存在，内容完全相同` };
    }

    // 删旧
    if (oldFileId) {
        DB.quotation_rows = DB.quotation_rows.filter(r => r.file_id !== oldFileId);
        const idx = DB.quotation_files.findIndex(f => f.id === oldFileId);
        if (idx >= 0) DB.quotation_files.splice(idx, 1);
    }

    // 去同名
    const sameNameIdx = DB.quotation_files.findIndex(f => f.file_name === fileName);
    if (sameNameIdx >= 0) {
        DB.quotation_rows = DB.quotation_rows.filter(r => r.file_id !== DB.quotation_files[sameNameIdx].id);
        DB.quotation_files.splice(sameNameIdx, 1);
    }

    const fileId = oldFileId || nextFileId++;
    const totalRows = parsed.categories.reduce((sum, c) => sum + c.rows.length, 0);
    const now = new Date().toISOString();

    if (oldFileId) {
        const f = DB.quotation_files.find(x => x.id === oldFileId);
        if (f) {
            f.file_name = fileName; f.file_hash = hash;
            f.row_count = totalRows; f.cat_count = parsed.categories.length;
            f.updated_at = now;
        }
    } else {
        DB.quotation_files.push({
            id: fileId, file_name: fileName, file_hash: hash,
            row_count: totalRows, cat_count: parsed.categories.length,
            created_at: now, updated_at: now,
        });
    }

    for (const cat of parsed.categories) {
        for (const row of cat.rows) {
            DB.quotation_rows.push({
                id: nextRowId++, file_id: fileId, file_name: fileName,
                category: cat.name, category_order: cat.order,
                model: row.model,
                header_data: JSON.stringify(cat.headers),
                row_data: JSON.stringify(row.data),
                row_order: row.order, created_at: now,
            });
        }
    }

    saveDB();
    return { success: true, file_id: fileId, file_name: fileName, row_count: totalRows, cat_count: parsed.categories.length };
}

// ========== 路由 ==========
async function route(method, pathname, query, body, req) {
    const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const ct = req.headers['content-type'] || '';
    debug(`${method} ${pathname} [${ct}] body=${body ? body.length : 0}b`);

    // GET /api/search
    if (method === 'GET' && parts[1] === 'search') {
        const q = (query.get('q') || '').trim();
        const fid = parseInt(query.get('file_id')) || null;
        const limit = Math.min(parseInt(query.get('limit')) || 200, 1000);
        const offset = parseInt(query.get('offset')) || 0;

        let rows = DB.quotation_rows.filter(r => {
            if (fid && r.file_id !== fid) return false;
            if (q) {
                // 搜索 model 字段和 row_data JSON（所有列）
                const modelMatch = r.model.toLowerCase().includes(q.toLowerCase());
                const rowDataMatch = (r.row_data || '').toLowerCase().includes(q.toLowerCase());
                if (!modelMatch && !rowDataMatch) return false;
            }
            return true;
        });
        rows.sort((a, b) => a.file_name.localeCompare(b.file_name) || a.category_order - b.category_order || a.row_order - b.row_order);

        const total = rows.length;
        return { data: { query: q, total, results: groupResults(rows.slice(offset, offset + limit)) } };
    }

    // GET /api/files
    if (method === 'GET' && parts[1] === 'files' && parts.length === 2) {
        const files = DB.quotation_files.sort((a, b) => a.file_name.localeCompare(b.file_name))
            .map(f => ({ id: f.id, file_name: f.file_name, row_count: f.row_count, cat_count: f.cat_count, created_at: f.created_at, updated_at: f.updated_at }));
        return { data: files };
    }

    // GET /api/files/:id
    if (method === 'GET' && parts[1] === 'files' && parts.length === 3) {
        const file = DB.quotation_files.find(f => f.id === parseInt(parts[2]));
        if (!file) return { error: '文件不存在', status: 404 };
        const rows = DB.quotation_rows.filter(r => r.file_id === file.id)
            .sort((a, b) => a.category_order - b.category_order || a.row_order - b.row_order);
        return { data: { file, rows: groupResults(rows) } };
    }

    // POST /api/admin/upload
    if (method === 'POST' && parts[1] === 'admin' && parts[2] === 'upload') {
        if (!body || body.length === 0) return { error: '请求体为空', status: 400 };

        const boundary = ct.match(/boundary="?([^";\s]+)"?/)?.[1];
        if (!boundary) {
            // 尝试其他方式：也许不是 multipart
            debug('  WARN: no boundary found, trying raw buffer as xlsx');
            // 假设整个 body 就是文件（fallback for simple POST）
            const result = await importFileToDB('uploaded.xlsx', body, null);
            if (result.success) return { data: result, status: 201 };
            return { error: '无法识别上传格式，请通过页面拖拽上传', status: 400 };
        }

        debug(`  boundary: "${boundary}"`);
        const parts = parseMultipartBody(body, boundary);
        if (parts.length === 0) {
            return { error: '未检测到上传文件，请拖拽 .xlsx 文件到上传区域', status: 400 };
        }

        const { filename, content } = parts[0];
        if (!filename.match(/\.xlsx?$/i)) {
            return { error: `仅支持 .xlsx 文件，当前文件: ${filename}`, status: 400 };
        }

        const result = await importFileToDB(filename, content, null);
        if (result.error) return result;
        return { data: result, status: 201 };
    }

    // DELETE /api/admin/files/:id
    if (method === 'DELETE' && parts[1] === 'admin' && parts[2] === 'files') {
        const fid = parseInt(parts[3]);
        const idx = DB.quotation_files.findIndex(f => f.id === fid);
        if (idx === -1) return { error: '文件不存在', status: 404 };
        DB.quotation_rows = DB.quotation_rows.filter(r => r.file_id !== fid);
        DB.quotation_files.splice(idx, 1);
        saveDB();
        return { data: { success: true, message: '文件已删除' } };
    }

    // PUT /api/admin/files/:id
    if (method === 'PUT' && parts[1] === 'admin' && parts[2] === 'files') {
        const fid = parseInt(parts[3]);
        if (!DB.quotation_files.find(f => f.id === fid)) return { error: '文件不存在', status: 404 };
        if (!body || body.length === 0) return { error: '请求体为空', status: 400 };

        const boundary = ct.match(/boundary="?([^";\s]+)"?/)?.[1];
        if (!boundary) return { error: '无法识别上传格式', status: 400 };

        const parts = parseMultipartBody(body, boundary);
        if (parts.length === 0) return { error: '未检测到上传文件', status: 400 };

        const { filename, content } = parts[0];
        const result = await importFileToDB(filename, content, fid);
        if (result.error) return result;
        return { data: result };
    }

    // GET /api/admin/export/:id
    if (method === 'GET' && parts[1] === 'admin' && parts[2] === 'export') {
        const fid = parseInt(parts[3]);
        const file = DB.quotation_files.find(f => f.id === fid);
        if (!file) return { error: '文件不存在', status: 404 };

        const rows = DB.quotation_rows.filter(r => r.file_id === fid)
            .sort((a, b) => a.category_order - b.category_order || a.row_order - b.row_order);
        if (rows.length === 0) return { error: '文件中无数据', status: 404 };

        const XLSX_mod = await loadXLSX();
        const wb = XLSX_mod.utils.book_new();
        const catMap = new Map();
        for (const row of rows) {
            const cat = row.category || '未分类';
            if (!catMap.has(cat)) catMap.set(cat, { headers: safeJsonParse(row.header_data, []), rows: [] });
            catMap.get(cat).rows.push(safeJsonParse(row.row_data, []));
        }

        if (catMap.size === 1) {
            const [cn, d] = [...catMap.entries()][0];
            XLSX_mod.utils.book_append_sheet(wb, XLSX_mod.utils.aoa_to_sheet([[cn], d.headers, ...d.rows]), '报价');
        } else {
            for (const [cn, d] of catMap) {
                XLSX_mod.utils.book_append_sheet(wb, XLSX_mod.utils.aoa_to_sheet([d.headers, ...d.rows]), cn.substring(0, 31));
            }
        }

        const xbuf = XLSX_mod.write(wb, { type: 'buffer', bookType: 'xlsx' });
        return {
            _raw: true, status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
            },
            body: xbuf,
        };
    }

    // GET /api/admin/stats
    if (method === 'GET' && parts[1] === 'admin' && parts[2] === 'stats') {
        const est = DB.quotation_rows.reduce((s, r) => s + (r.row_data?.length || 0) + (r.header_data?.length || 0), 0);
        return { data: { file_count: DB.quotation_files.length, row_count: DB.quotation_rows.length, estimated_bytes: est } };
    }

    return { error: `未找到路由: ${method} ${pathname}`, status: 404 };
}

// ========== HTTP Server ==========
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

    try {
        if (pathname.startsWith('/api/')) {
            let body = null;
            if (method === 'POST' || method === 'PUT') {
                body = await readBody(req);
            }
            const result = await route(method, pathname, url.searchParams, body, req);

            if (!result) { res.writeHead(404, CORS); res.end('Not Found'); return; }
            if (result._raw) {
                res.writeHead(result.status, { ...CORS, ...result.headers }); res.end(result.body); return;
            }
            if (result.error) { err(res, result.error, result.status || 400); return; }
            json(res, result.data, result.status || 200);
            return;
        }

        // 静态文件
        let fp = path.join(FRONTEND, pathname === '/' ? 'index.html' : pathname);
        fp = path.normalize(fp);
        if (!fp.startsWith(FRONTEND)) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
            const idx = path.join(FRONTEND, 'index.html');
            if (fs.existsSync(idx)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(idx)); return; }
            res.writeHead(404); res.end('Not Found'); return;
        }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(fp));
    } catch (e) {
        debug(`ERROR: ${e.message}\n${e.stack}`);
        err(res, `服务器内部错误: ${e.message}`, 500);
    }
}).listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║  🖨️  打印机耗材报价检索系统 - 本地开发  ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  地址: http://localhost:${PORT}              ║`);
    console.log(`  ║  管理: http://localhost:${PORT}/admin.html   ║`);
    console.log(`  ║  搜索: http://localhost:${PORT}/index.html   ║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
});
