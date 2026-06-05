// ============================================
// 打印机耗材报价检索系统 - 管理后台逻辑
// ============================================

let currentUpdateFileId = null;

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadFileList();
    initDragDrop();
});

// --- 统计数据 ---
async function loadStats() {
    try {
        const stats = await getStats();
        document.getElementById('statFiles').textContent = stats.file_count;
        document.getElementById('statRows').textContent = stats.row_count.toLocaleString();
        document.getElementById('statSize').textContent = formatBytes(stats.estimated_bytes);
    } catch (e) {
        console.error('加载统计失败:', e);
    }
}

// --- 文件列表 ---
async function loadFileList() {
    const container = document.getElementById('fileListContainer');
    container.innerHTML = '<div class="loading"></div>';

    try {
        const files = await getFiles();

        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">暂无报价文件</div>
                    <div class="empty-hint">请上传 Excel 报价文件</div>
                </div>
            `;
            return;
        }

        let html = '<ul class="file-list">';
        files.forEach(f => {
            html += `
            <li class="file-item">
                <div class="file-info">
                    <div class="file-name">📁 ${escapeHtml(f.file_name)}</div>
                    <div class="file-meta">
                        ${f.row_count} 条记录 · ${f.cat_count} 个分类 · 更新于 ${formatDate(f.updated_at)}
                    </div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-outline btn-sm" onclick="downloadFile(${f.id}, '${escapeHtml(f.file_name)}')" title="导出Excel">
                        📥 导出
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="triggerUpdate(${f.id})" title="更新文件">
                        🔄 更新
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDelete(${f.id}, '${escapeHtml(f.file_name)}')" title="删除文件">
                        🗑️ 删除
                    </button>
                </div>
            </li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><div class="empty-text">加载失败: ${escapeHtml(e.message)}</div></div>`;
    }
}

// --- 上传 ---
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    doUpload(file);
    event.target.value = '';
}

async function doUpload(file) {
    if (!file.name.match(/\.xlsx?$/i)) {
        showToast('请选择 Excel 文件 (.xlsx)', 'error');
        return;
    }

    const progressDiv = document.getElementById('uploadProgress');
    const resultP = document.getElementById('uploadResult');
    progressDiv.classList.remove('hidden');
    document.getElementById('uploadLoading').classList.remove('hidden');
    resultP.textContent = '';

    try {
        const data = await uploadFile(file);
        resultP.innerHTML = `<span style="color:var(--success)">✅ "${escapeHtml(data.file_name)}" 上传成功！${data.row_count} 条记录，${data.cat_count} 个分类</span>`;
        showToast(`上传成功：${data.row_count} 条记录`, 'success');
        loadStats();
        loadFileList();
    } catch (e) {
        resultP.innerHTML = `<span style="color:var(--danger)">❌ 上传失败：${escapeHtml(e.message)}</span>`;
        showToast(`上传失败：${e.message}`, 'error');
    } finally {
        document.getElementById('uploadLoading').classList.add('hidden');
    }
}

// --- 删除 ---
function confirmDelete(fileId, fileName) {
    if (confirm(`确定要删除 "${fileName}" 吗？\n\n此操作不可恢复，文件中的所有报价数据将被删除。`)) {
        doDelete(fileId, fileName);
    }
}

async function doDelete(fileId, fileName) {
    try {
        await deleteFile(fileId);
        showToast(`"${fileName}" 已删除`, 'success');
        loadStats();
        loadFileList();
    } catch (e) {
        showToast(`删除失败：${e.message}`, 'error');
    }
}

// --- 更新 ---
function triggerUpdate(fileId) {
    currentUpdateFileId = fileId;
    document.getElementById('updateFileInput').click();
}

async function handleUpdateFile(event) {
    const file = event.target.files[0];
    if (!file || !currentUpdateFileId) return;
    event.target.value = '';

    if (!confirm(`确定要用 "${file.name}" 替换当前文件吗？\n\n文件中的所有报价数据将被替换。`)) {
        currentUpdateFileId = null;
        return;
    }

    try {
        const data = await updateFile(currentUpdateFileId, file);
        showToast(`更新成功：${data.row_count} 条记录`, 'success');
        loadStats();
        loadFileList();
    } catch (e) {
        showToast(`更新失败：${e.message}`, 'error');
    } finally {
        currentUpdateFileId = null;
    }
}

// --- 导出 ---
async function downloadFile(fileId, fileName) {
    try {
        const blob = await exportFile(fileId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`"${fileName}" 导出成功`, 'success');
    } catch (e) {
        showToast(`导出失败：${e.message}`, 'error');
    }
}

// --- 拖拽上传 ---
function initDragDrop() {
    const zone = document.getElementById('uploadZone');
    if (!zone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        zone.addEventListener(eventName, () => zone.classList.add('drag-over'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, () => zone.classList.remove('drag-over'));
    });

    zone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) doUpload(file);
    });
}

// --- 工具 ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
