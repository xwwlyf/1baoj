# 🖨️ 打印机耗材报价检索系统

在线报价查询系统，用于销售人员快速查询打印机耗材报价。

**核心功能：**
- 📤 上传 Excel 报价文件（浏览器端解析 + 服务端存储）
- 🔍 按型号关键词搜索所有报价文件
- 📊 结果按文件→分类→数据行层级展示
- 📥 导出 Excel（服务端 + 浏览器端双重支持）
- ⚙️ 管理后台（上传、更新、删除报价文件）

---

## 🚀 一键部署到 Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/你的用户名/报价系统)

1. 点击上方按钮，或 Fork 本仓库后在 Netlify 中导入
2. Netlify 自动识别 `netlify.toml` 配置，无需额外设置
3. 部署完成即可使用！

> **注意：** 数据存储在 [Netlify Blobs](https://docs.netlify.com/blobs/overview/) 中，免费额度内可存储大量报价数据。

---

## 💻 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动本地开发服务器
npm run dev
```

浏览器访问：
- 搜索页：`http://localhost:3000/index.html`
- 管理后台：`http://localhost:3000/admin.html`

本地服务器使用 `data.json` 存储数据，无需配置数据库。

---

## 📁 项目结构

```
报价系统/
├── index.html              # 搜索页面
├── admin.html              # 管理后台
├── sample-generator.html   # 测试数据生成器
├── css/style.css           # 全局样式
├── js/
│   ├── api.js              # API 调用工具
│   ├── search.js           # 搜索页面逻辑
│   └── admin.js            # 管理后台逻辑
├── server.js               # 本地开发服务器 (Node.js)
├── data.json               # 本地数据库（自动生成）
├── netlify/
│   └── functions/
│       └── api.js          # Netlify Functions（生产环境 API）
├── functions/              # Cloudflare Pages Functions（备选方案）
├── database/schema.sql     # D1 数据库 Schema（Cloudflare 备选方案）
├── netlify.toml            # Netlify 部署配置
├── package.json            # 项目依赖
└── test_quote.xlsx         # 测试用 Excel 文件
```

## 🏗️ 技术架构

| 环境 | 前端 | API | 数据库 |
|------|------|-----|--------|
| **Netlify** | 静态站点 | Netlify Functions | Netlify Blobs |
| **本地开发** | 静态页面 | Node.js server.js | data.json |
| **Cloudflare**（备选） | Pages | Pages Functions | D1 |

---

## 🔧 部署到 Cloudflare Pages（备选方案）

如果偏好 Cloudflare 生态：

### 前置条件
- [Cloudflare 账号](https://dash.cloudflare.com)
- [Node.js](https://nodejs.org) 18+
- Wrangler CLI: `npm install -g wrangler`

### 部署步骤

```bash
# 1. 登录
wrangler login

# 2. 创建 D1 数据库
wrangler d1 create quotation_db

# 3. 初始化 Schema（将输出的 database_id 替换到 functions/ 配置中）
wrangler d1 execute quotation_db --file=database/schema.sql

# 4. 部署到 Cloudflare Pages
wrangler pages deploy . --branch main
```

---

## 📝 Excel 文件格式要求

上传的 Excel 文件需符合以下结构：

```
HP系列              ← 分类标题行（单列）
序号  | 产品型号 | 适用机型 | 页产量 | 标准版 | 商务版  ← 表头行
1    | CC388A  | HP M1136 | 1500  | 35    | 42     ← 数据行
2    | Q2612A  | HP 1020  | 2000  | 28    | 35     ← 数据行
Canon系列           ← 下一个分类...
序号  | 产品型号 | 适用机型 | ...
...
```

系统会自动识别：
- **分类行**：单列文本行（如"HP系列"）
- **表头行**：分类后的第一个多列行
- **型号列**：表头中包含"型号""规格""品名"等关键词的列
