// ============================================
// 打印机耗材报价检索系统 - API 工具
// ============================================

const API_BASE = (window.API_BASE_URL || '/api').replace(/\/+$/, '');

// file:// 检测
if (window.location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', () => {
        const b = document.createElement('div');
        b.style.cssText = 'background:#d93025;color:#fff;text-align:center;padding:12px;font-size:14px;font-weight:bold;position:sticky;top:0;z-index:9999';
        b.innerHTML = '❌ 请通过 http://localhost:3000 访问，不要直接双击HTML文件打开！';
        document.body.insertBefore(b, document.body.firstChild);
    });
}

async function api(method, path, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try { res = await fetch(API_BASE + path, opts); }
    catch (e) { throw new Error('无法连接服务器'); }

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/vnd.openxmlformats')) {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
    }

    let data;
    try { data = await res.json(); }
    catch { throw new Error(`服务器返回异常 (${res.status})`); }
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
}

// --- 公开 API ---
async function searchModel(query, fileId, limit = 200, offset = 0) {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (fileId) p.set('file_id', fileId);
    p.set('limit', limit); p.set('offset', offset);
    return api('GET', `/search?${p}`);
}
async function getFiles() { return api('GET', '/files'); }
async function getFileDetail(fileId) { return api('GET', `/files/${fileId}`); }

// --- 管理 API ---
// 上传：现在发送浏览器端解析好的 JSON
async function uploadFile(fileName, categories) {
    return api('POST', '/admin/upload', { fileName, categories });
}
async function deleteFile(fileId) { return api('DELETE', `/admin/files/${fileId}`); }
async function updateFile(fileId, fileName, categories) {
    return api('PUT', `/admin/files/${fileId}`, { fileName, categories });
}
async function getStats() { return api('GET', '/admin/stats'); }

// --- Toast ---
function showToast(msg, type) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// --- 格式化 ---
function formatBytes(b) {
    if (!b) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatDate(d) { if (!d) return '--'; return new Date(d + 'Z').toLocaleString('zh-CN'); }
