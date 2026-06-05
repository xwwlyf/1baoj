# 打印机耗材报价检索系统

基于 Cloudflare Free Tier 的在线报价查询系统，用于销售人员快速查询打印机耗材报价。

## 技术架构

```
┌─────────────────────┐
│   Cloudflare Pages  │  ← 前端静态站点 (HTML5 + CSS3 + Vanilla JS)
└────────┬────────────┘
         │ /api/*
┌────────▼────────────┐
│  Cloudflare Worker  │  ← API 后端 (JavaScript)
└────────┬────────────┘
         │
┌────────▼────────────┐
│   Cloudflare D1     │  ← SQLite 数据库
└─────────────────────┘
```

## 项目结构

```
报价系统/
├── frontend/                    # 前端（Cloudflare Pages）
│   ├── index.html               # 搜索页
│   ├── admin.html               # 管理后台
│   ├── sample-generator.html    # 测试数据生成器
│   ├── _redirects               # Pages 路由代理
│   ├── css/
│   │   └── style.css            # 全局样式
│   └── js/
│       ├── api.js               # API 工具
│       ├── search.js            # 搜索逻辑
│       └── admin.js             # 管理后台逻辑
├── worker/                      # 后端（Cloudflare Worker）
│   ├── package.json
│   ├── wrangler.toml
│   └── src/
│       └── index.js             # Worker 代码
└── database/
    └── schema.sql               # D1 数据库 Schema
```

## 快速部署

### 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com)（免费套餐）
- [Node.js](https://nodejs.org) 18+
- [GitHub](https://github.com) 账号

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create quotation_db
```

记录输出的 database_id，填入 `worker/wrangler.toml` 中替换 `PLACEHOLDER_DB_ID`。

### 3. 初始化 D1 表结构

```bash
cd worker
npm install
wrangler d1 execute quotation_db --file=../database/schema.sql
```

### 4. 部署 Worker

```bash
cd worker
wrangler deploy
```

记录 Worker 域名（如 `https://quotation-system.xxx.workers.dev`）。

### 5. 部署前端到 Cloudflare Pages

#### 方式一：GitHub 自动部署

1. 将项目推送到 GitHub
2. 在 Cloudflare Dashboard → Workers & Pages → Create → Pages
3. 连接 GitHub 仓库
4. 构建设置：
   - **构建输出目录**: `frontend/`
   - **构建命令**: 留空（纯静态）
5. 设置 `_redirects` 中的 Worker URL 为实际地址

#### 方式二：手动部署

```bash
cd frontend
# 编辑 _redirects，将 YOUR_SUBDOMAIN 替换为实际 Worker 子域名
wrangler pages deploy .
```

### 6. 设置环境变量

在 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Variables：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_FILE_SIZE_MB` | 上传文件大小限制(MB) | `10` |

### 7. 生成测试数据

打开 `sample-generator.html`，一键生成测试用 Excel 文件（科思特报价、格之格报价、天威报价）。

然后在管理后台上传这些文件进行测试。

## 使用说明

### 报价查询（普通用户）

1. 打开首页
2. 输入型号关键词（如 `388`、`278A`、`CRG`）
3. 点击搜索按钮
4. 结果按 **文件名 → 分类 → 原始表格** 层级展示
5. 支持折叠展开、横向滚动

### 管理后台（管理员）

1. 打开管理后台，输入管理员密码登录
2. 上传 Excel 文件（支持拖拽）
3. 管理文件：导出、更新、删除
4. 查看统计信息

## Excel 文件格式要求

系统自动识别 Excel 中的：

- **文件名**：从上传文件名获取
- **分类区域**：仅第一列有内容的行识别为分类名
- **表头行**：包含"型号""规格""品名"等关键词的行
- **数据行**：多列均有内容的行

### 示例格式

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| **HP系列** | | | | | | |
| 型号 | 适用机型 | 页产量 | 标准版 | 商务版 | 旗舰版 | 至尊版 |
| 388A | M1136 | 1500 | 35 | 42 | 48 | 55 |
| 278A | M1536 | 1600 | 32 | 39 | 45 | 52 |

## Cloudflare Free Tier 限制

| 资源 | 免费额度 | 说明 |
|------|----------|------|
| Worker 请求 | 10万次/天 | 本系统每搜索一次 ≈ 1-2 次请求 |
| D1 读行 | 500万行/天 | 搜索操作为读操作 |
| D1 写行 | 10万行/天 | 仅上传/更新时写入 |
| D1 存储 | 5 GB | 约可存储 200万+ 条报价记录 |
| Pages 带宽 | 无限 | 静态资源 |

本系统在免费额度内可轻松支持 **10 万+** 条报价记录、**10-20** 个报价文件的日常使用。

## 开发红线（已遵守）

- ✅ 搜索结果完整保留文件名称 → 分类 → 表头 → 列顺序 → 整行数据
- ✅ 数据库使用 JSON 存储动态列，不固定字段模式
- ✅ 仅点击搜索按钮才执行搜索，无实时搜索
- ✅ 兼容 Cloudflare Free Tier 所有限制
- ✅ 不使用 Node 服务器 / VPS / MySQL / IndexedDB / LocalStorage
- ✅ 支持无限新增报价文件
