// Build script: 将 frontend/ 下所有静态文件打包进 Worker
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(__dirname, 'frontend');

function walk(dir, base) {
    const files = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            Object.assign(files, walk(full, base));
        } else {
            const key = full.replace(base, '').replace(/\\/g, '/');
            files[key] = fs.readFileSync(full, 'utf-8');
        }
    }
    return files;
}

const files = walk(frontend, frontend);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
};

let out = '// Auto-generated static files for Worker\n';
out += 'export const STATIC_FILES = new Map([\n';
for (const [fp, content] of Object.entries(files)) {
    const ext = path.extname(fp).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    out += '  [' + JSON.stringify(fp) + ', { ct: ' + JSON.stringify(ct) + ', body: ' + JSON.stringify(content) + ' }],\n';
}
out += ']);\n\n';

out += 'export function serveStatic(pathname) {\n';
out += '  let p = pathname;\n';
out += '  if (p === "/" || p === "") p = "/index.html";\n';
out += '  const f = STATIC_FILES.get(p);\n';
out += '  if (!f) return null;\n';
out += '  return new Response(f.body, { headers: { "Content-Type": f.ct, "Cache-Control": "public, max-age=3600" } });\n';
out += '}\n';

fs.writeFileSync(path.join(__dirname, 'worker/src/static-files.js'), out);
console.log('OK: ' + Object.keys(files).length + ' files -> worker/src/static-files.js');
for (const fp of Object.keys(files)) console.log('  ' + fp);
