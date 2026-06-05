// ============================================
// 打印机耗材报价检索系统 - 管理后台逻辑
// ============================================

let currentUpdateFileId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadFileList();
    initDragDrop();
});

async function loadStats() {
    try {
        const stats = await getStats();
        document.getElementById('statFiles').textContent = stats.file_count;
        document.getElementById('statRows').textContent = stats.row_count.toLocaleString();
        document.getElementById('statSize').textContent = formatBytes(stats.estimated_bytes);
    } catch (e) { console.error(e); }
}

async function loadFileList() {
    const container = document.getElementById('fileListContainer');
    container.innerHTML = '<div class="loading"></div>';
    try {
        const files = await getFiles();
        if (files.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无报价文件</div><div class="empty-hint">请拖拽或点击上传 Excel 报价文件</div></div>`;
            return;
        }
        let html = '<ul class="file-list">';
        files.forEach(f => {
            html += `<li class="file-item">
                <div class="file-info"><div class="file-name">📁 ${escapeHtml(f.file_name)}</div><div class="file-meta">${f.row_count} 条 · ${f.cat_count} 个分类 · ${formatDate(f.updated_at)}</div></div>
                <div class="file-actions">
                    <button class="btn btn-outline btn-sm" onclick="downloadFile(${f.id}, '${escapeHtml(f.file_name)}')">📥 导出</button>
                    <button class="btn btn-outline btn-sm" onclick="triggerUpdate(${f.id})">🔄 更新</button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDelete(${f.id}, '${escapeHtml(f.file_name)}')">🗑️ 删除</button>
                </div></li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><div class="empty-text">加载失败: ${escapeHtml(e.message)}</div></div>`;
    }
}

// ========== 浏览器端 Excel 解析 ==========
async function loadXLSX() {
    if (typeof XLSX !== 'undefined') return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('加载 Excel 解析库失败'));
        document.head.appendChild(s);
    });
}

function parseExcelInBrowser(workbook) {
    const categories = [];
    const modelKeywords = ['型号', '规格', '品名', '型号规格', '商品名称', '产品型号', '物料编码', 'MODEL', 'Model', 'model'];

    for (let si = 0; si < workbook.SheetNames.length; si++) {
        const sheet = workbook.Sheets[workbook.SheetNames[si]];
        if (!sheet) continue;
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        if (!aoa || aoa.length === 0) continue;

        let currentCat = null;
        for (const rawRow of aoa) {
            const row = rawRow.map(c => (c == null) ? '' : String(c).trim());
            if (row.every(c => c === '')) continue;
            const firstCol = row[0];
            const hasOtherCols = row.slice(1).some(c => c !== '');

            if (!hasOtherCols) {
                if (firstCol.length > 50) continue;
                if (/^\d+$/.test(firstCol)) continue;
                currentCat = { name: firstCol, order: categories.length, headers: [], rows: [] };
                categories.push(currentCat);
            } else if (currentCat && currentCat.headers.length === 0 && currentCat.rows.length === 0) {
                currentCat.headers = row;
                currentCat.modelCol = findModelCol(row, modelKeywords);
            } else if (currentCat && currentCat.headers.length > 0) {
                const data = [...row];
                while (data.length < currentCat.headers.length) data.push('');
                currentCat.rows.push({ model: getModelVal(data, currentCat.modelCol), data, order: currentCat.rows.length });
            } else if (!currentCat) {
                currentCat = { name: workbook.SheetNames[si] !== 'Sheet1' ? workbook.SheetNames[si] : '默认分类', order: categories.length, headers: row, rows: [] };
                currentCat.modelCol = findModelCol(row, modelKeywords);
                categories.push(currentCat);
            }
        }
    }
    return categories.filter(c => c.rows.length > 0);
}

function findModelCol(headers, keywords) {
    for (let i = 0; i < headers.length; i++) {
        if (keywords.some(kw => headers[i].toLowerCase().includes(kw.toLowerCase()))) return i;
    }
    for (let i = 0; i < headers.length; i++) {
        if (/[A-Za-z0-9\-/]+/.test(headers[i]) && headers[i].length >= 3) return i;
    }
    return 0;
}

function getModelVal(data, col) {
    if (col >= 0 && col < data.length && data[col]) return data[col];
    return data[0] || '';
}

// ========== 上传 ==========
function handleFileSelect(e) { const f = e.target.files[0]; if (f) doUpload(f); e.target.value = ''; }

async function doUpload(file) {
    if (!file.name.match(/\.xlsx?$/i)) { showToast('请选择 .xlsx 文件', 'error'); return; }
    const pd = document.getElementById('uploadProgress');
    const rp = document.getElementById('uploadResult');
    const ul = document.getElementById('uploadLoading');
    pd.classList.remove('hidden'); ul.classList.remove('hidden');
    rp.textContent = '正在解析 Excel...';
    try {
        await loadXLSX();
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const categories = parseExcelInBrowser(wb);
        if (!categories || categories.length === 0) throw new Error('未找到有效数据');
        const total = categories.reduce((s, c) => s + c.rows.length, 0);
        rp.textContent = `解析完成：${total} 条，正在上传...`;
        const data = await uploadFile(file.name, categories);
        rp.innerHTML = `<span style="color:var(--success)">✅ "${escapeHtml(data.file_name)}" 上传成功！${data.row_count} 条，${data.cat_count} 个分类</span>`;
        showToast(`上传成功：${data.row_count} 条`, 'success');
        loadStats(); loadFileList();
    } catch (e) {
        rp.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtml(e.message)}</span>`;
        showToast(e.message, 'error');
    } finally { ul.classList.add('hidden'); }
}

// ========== 删除 ==========
function confirmDelete(id, name) { if (confirm(`确定删除 "${name}"？`)) doDelete(id, name); }
async function doDelete(id, name) {
    try { await deleteFile(id); showToast(`"${name}" 已删除`, 'success'); loadStats(); loadFileList(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ========== 更新 ==========
function triggerUpdate(id) { currentUpdateFileId = id; document.getElementById('updateFileInput').click(); }
async function handleUpdateFile(e) {
    const file = e.target.files[0]; if (!file || !currentUpdateFileId) return; e.target.value = '';
    if (!confirm(`用 "${file.name}" 替换？`)) { currentUpdateFileId = null; return; }
    try {
        await loadXLSX();
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const categories = parseExcelInBrowser(wb);
        const data = await updateFile(currentUpdateFileId, file.name, categories);
        showToast(`更新成功：${data.row_count} 条`, 'success');
        loadStats(); loadFileList();
    } catch (e) { showToast(e.message, 'error'); }
    finally { currentUpdateFileId = null; }
}

// ========== 导出（浏览器端） ==========
async function downloadFile(fileId, fileName) {
    try {
        showToast('准备导出...', 'warning');
        const data = await getFileDetail(fileId);
        const allRows = [];
        for (const f of (data.rows || [])) {
            for (const cat of (f.categories || [])) {
                for (const row of cat.rows) {
                    allRows.push({ h: cat.header_data, d: row.row_data, c: cat.category });
                }
            }
        }
        if (allRows.length === 0) { showToast('无数据', 'error'); return; }
        await loadXLSX();
        const wb = XLSX.utils.book_new();
        const catMap = new Map();
        for (const r of allRows) {
            if (!catMap.has(r.c)) catMap.set(r.c, []);
            catMap.get(r.c).push(r);
        }
        if (catMap.size === 1) {
            const [cn, rs] = [...catMap.entries()][0];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[cn], rs[0].h, ...rs.map(r => r.d)]), '报价');
        } else {
            for (const [cn, rs] of catMap) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([rs[0].h, ...rs.map(r => r.d)]), cn.substring(0, 31));
            }
        }
        XLSX.writeFile(wb, fileName);
        showToast(`导出成功`, 'success');
    } catch (e) { showToast(`导出失败：${e.message}`, 'error'); }
}

// ========== 拖拽 ==========
function initDragDrop() {
    const zone = document.getElementById('uploadZone');
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, () => zone.classList.add('drag-over')));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('drag-over')));
    zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) doUpload(f); });
}

function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
