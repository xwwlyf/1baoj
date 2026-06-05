// ============================================
// 打印机耗材报价检索系统 - 搜索页面逻辑
// ============================================

let currentResults = null;
let currentQuery = '';
let allFiles = [];          // 全部文件列表 {id, file_name, row_count}
let fileCheckStates = {};   // 文件勾选状态 {fileId: true/false}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
    loadFileCheckboxes();
});

// --- 加载文件勾选框 ---
async function loadFileCheckboxes() {
    try {
        allFiles = await getFiles();
        renderCheckboxes();
    } catch (e) {
        console.error('加载文件列表失败:', e);
    }
}

function renderCheckboxes() {
    const container = document.getElementById('fileCheckList');
    if (allFiles.length === 0) {
        document.getElementById('fileFilter').classList.add('hidden');
        return;
    }

    // 初始化勾选状态（默认全选）
    allFiles.forEach(f => {
        if (!(f.id in fileCheckStates)) fileCheckStates[f.id] = true;
    });

    let html = '';
    allFiles.forEach(f => {
        const checked = fileCheckStates[f.id] ? 'checked' : '';
        html += `
        <label class="file-check-item">
            <input type="checkbox" value="${f.id}" ${checked} onchange="onFileCheckChange()">
            <span class="file-check-name">${escapeHtml(f.file_name)}</span>
            <span class="file-check-count">${f.row_count} 条</span>
        </label>`;
    });

    container.innerHTML = html;
    document.getElementById('fileFilter').classList.remove('hidden');
}

function toggleAllFiles(select) {
    allFiles.forEach(f => { fileCheckStates[f.id] = select; });
    renderCheckboxes();
    if (currentQuery) doSearch();
}

function onFileCheckChange() {
    // 同步勾选状态
    document.querySelectorAll('#fileCheckList input[type=checkbox]').forEach(cb => {
        fileCheckStates[parseInt(cb.value)] = cb.checked;
    });
    if (currentQuery) doSearch();
}

function getSelectedFileIds() {
    return allFiles.filter(f => fileCheckStates[f.id]).map(f => f.id);
}

// --- 执行搜索 ---
async function doSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (!query) {
        document.getElementById('emptyState').classList.remove('hidden');
        return;
    }

    currentQuery = query;
    showLoading(true);
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('resultsSection').classList.add('hidden');

    try {
        // 搜索所有勾选的文件，合并结果
        const selectedIds = getSelectedFileIds();
        if (selectedIds.length === 0) {
            showToast('请至少勾选一个文件', 'warning');
            showLoading(false);
            return;
        }

        // 对每个选中文件搜索
        const allResults = [];
        let total = 0;

        for (const fid of selectedIds) {
            const data = await searchModel(query, fid);
            total += data.total;
            allResults.push(...data.results);
        }

        // 去重合并（按文件名分组合并）
        const merged = mergeResults(allResults);
        currentResults = { query, total, results: merged };
        renderResults(currentResults);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 合并多个搜索结果为按文件名聚合
function mergeResults(results) {
    const map = new Map();
    for (const r of results) {
        if (!map.has(r.file_name)) {
            map.set(r.file_name, { file_name: r.file_name, categories: [] });
        }
        map.get(r.file_name).categories.push(...r.categories);
    }
    return [...map.values()];
}

// --- 渲染结果 ---
function renderResults(data) {
    const container = document.getElementById('resultsContainer');
    const section = document.getElementById('resultsSection');
    const summary = document.getElementById('resultSummary');

    if (!data.results || data.results.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <div class="empty-text">未找到匹配 "${escapeHtml(data.query || '')}" 的报价记录</div>
                <div class="empty-hint">请尝试其他型号关键词</div>
            </div>`;
        section.classList.remove('hidden');
        summary.classList.add('hidden');
        return;
    }

    let totalRows = 0;
    data.results.forEach(f => f.categories.forEach(c => { totalRows += c.rows.length; }));

    summary.innerHTML = `🔍 搜索 "<strong>${escapeHtml(data.query)}</strong>" — 共 <strong>${totalRows}</strong> 条记录，<strong>${data.results.length}</strong> 个文件`;
    summary.classList.remove('hidden');

    let html = '';
    data.results.forEach((file, fileIdx) => {
        let fileRows = 0;
        file.categories.forEach(c => { fileRows += c.rows.length; });

        html += `<div class="result-file">
            <div class="result-file-header expanded" onclick="toggleResultFile(this)">
                <span class="icon">▶</span>
                <span class="file-name-label">${escapeHtml(file.file_name)}</span>
                <span class="text-secondary">（${fileRows} 条）</span>
            </div>
            <div class="result-file-body expanded">`;

        file.categories.forEach((cat) => {
            const headers = cat.header_data || [];
            html += `<div class="result-category">
                <div class="result-category-header expanded" onclick="toggleResultCategory(this)">
                    <span class="icon">▶</span>
                    <span class="cat-name-label">${escapeHtml(cat.category)}</span>
                    <span class="text-secondary">（${cat.rows.length} 行）</span>
                </div>
                <div class="result-category-body expanded">
                    <div class="table-wrapper">
                    <table class="data-table">
                        <thead><tr>${headers.map(h => `<th title="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join('')}</tr></thead>
                        <tbody>${cat.rows.map(row => renderRow(row, headers, currentQuery)).join('')}</tbody>
                    </table>
                    </div>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
    section.classList.remove('hidden');

    // 绑定双击展开长文本
    document.querySelectorAll('.cell-truncated').forEach(cell => {
        cell.addEventListener('dblclick', (e) => {
            showCellDetail(cell);
            e.stopPropagation();
        });
    });
}

function renderRow(row, headers, query) {
    const data = row.row_data || [];
    const cells = data.map((cell, i) => {
        let val = String(cell ?? '');
        const highlight = query && val.toLowerCase().includes(query.toLowerCase());
        const long = val.length > 30;
        let display = val;
        let cls = '';
        if (long) {
            display = val.substring(0, 30) + '…';
            cls = (highlight ? 'highlight ' : '') + 'cell-truncated';
        } else if (highlight) {
            cls = 'highlight';
        }
        return `<td class="${cls}" title="${long ? '双击查看完整内容' : ''}" data-full="${escapeHtml(val)}">${escapeHtml(display)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
}

// --- 双击展开长文本 ---
function showCellDetail(cell) {
    const old = document.querySelector('.cell-detail-popup');
    if (old) old.remove();

    const fullText = cell.getAttribute('data-full') || cell.textContent;
    const headerCell = cell.closest('table').querySelectorAll('thead th')[cell.cellIndex];
    const headerName = headerCell ? (headerCell.getAttribute('title') || headerCell.textContent) : '';

    const popup = document.createElement('div');
    popup.className = 'cell-detail-popup';
    popup.innerHTML = `
        <div class="cell-detail-backdrop" onclick="this.parentElement.remove()"></div>
        <div class="cell-detail-card">
            <div class="cell-detail-header">
                <strong>${escapeHtml(headerName)}</strong>
                <button class="cell-detail-close" onclick="this.closest('.cell-detail-popup').remove()">✕</button>
            </div>
            <div class="cell-detail-body">${escapeHtml(fullText)}</div>
            <div class="cell-detail-hint">点击空白处或 ✕ 关闭</div>
        </div>`;
    document.body.appendChild(popup);
    popup.querySelector('.cell-detail-backdrop').addEventListener('click', () => popup.remove());
}

// --- 折叠/展开 ---
function toggleResultFile(h) { h.classList.toggle('expanded'); h.nextElementSibling.classList.toggle('expanded'); }
function toggleResultCategory(h) { h.classList.toggle('expanded'); h.nextElementSibling.classList.toggle('expanded'); }

// --- UI ---
function showLoading(s) { document.getElementById('loadingIndicator').classList.toggle('hidden', !s); }

// --- 转义 ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
