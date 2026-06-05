// ============================================
// 打印机耗材报价检索系统 - API 工具
// ============================================

// API 基础路径
// - 开发/本地测试时设为 Worker 完整地址：'https://quotation-system.xxx.workers.dev/api'
// - Cloudflare Pages 部署时使用相对路径：'/api'（配合 _redirects 代理到 Worker）
const API_BASE = (window.API_BASE_URL || '/api').replace(/\/+$/, '');

// 检测 file:// 协议（直接双击 HTML 打开），给出明确提示
if (window.location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', () => {
        const body = document.body;
        if (body) {
            const banner = document.createElement('div');
            banner.style.cssText = 'background:#d93025;color:#fff;text-align:center;padding:12px 16px;font-size:14px;font-weight:bold;position:sticky;top:0;z-index:9999';
            banner.innerHTML = '❌ 请通过 <code style="background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:3px">http://localhost:3000</code> 访问，不要直接双击HTML文件打开！';
            body.insertBefore(banner, body.firstChild);
        }
    });
}

// --- HTTP 请求封装 ---
async function api(method, path, body = null, isFormData = false) {
    const headers = {};

    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }

    const opts = { method, headers };
    if (body) {
        opts.body = isFormData ? body : JSON.stringify(body);
    }

    let res;
    try {
        res = await fetch(API_BASE + path, opts);
    } catch (e) {
        throw new Error('无法连接服务器。请确保已启动本地服务：node server.js，并通过 http://localhost:3000 访问');
    }

    // 处理文件下载
    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('application/vnd.openxmlformats')) {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
    }

    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error(`服务器返回了非JSON响应 (${res.status})`);
    }

    if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`);
    }

    return data;
}

// --- 公开 API ---

/**
 * 搜索型号
 * @param {string} query - 搜索关键词
 * @param {number|null} fileId - 可选：限定文件
 * @param {number} limit - 返回条数
 * @param {number} offset - 偏移量
 */
async function searchModel(query, fileId = null, limit = 200, offset = 0) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (fileId) params.set('file_id', fileId);
    params.set('limit', limit);
    params.set('offset', offset);
    return api('GET', `/search?${params.toString()}`);
}

/**
 * 获取文件列表
 */
async function getFiles() {
    return api('GET', '/files');
}

// --- 管理 API ---

/**
 * 上传 Excel 文件
 * @param {File} file
 */
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return api('POST', '/admin/upload', formData, true);
}

/**
 * 删除文件
 */
async function deleteFile(fileId) {
    return api('DELETE', `/admin/files/${fileId}`);
}

/**
 * 更新文件
 */
async function updateFile(fileId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return api('PUT', `/admin/files/${fileId}`, formData, true);
}

/**
 * 导出文件
 */
async function exportFile(fileId) {
    return api('GET', `/admin/export/${fileId}`);
}

/**
 * 获取统计数据
 */
async function getStats() {
    return api('GET', '/admin/stats');
}

// --- Toast 通知 ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 格式化工具 ---
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr + 'Z');
    return d.toLocaleString('zh-CN');
}
