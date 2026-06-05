-- ============================================
-- 打印机耗材报价检索系统 - D1 数据库 Schema
-- ============================================

-- 报价文件表：存储每个上传的 Excel 文件信息
CREATE TABLE IF NOT EXISTS quotation_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name   TEXT    NOT NULL,                     -- 文件名（如：科思特报价.xlsx）
    file_hash   TEXT    NOT NULL,                     -- SHA256 文件指纹，用于去重
    row_count   INTEGER NOT NULL DEFAULT 0,           -- 数据行数
    cat_count   INTEGER NOT NULL DEFAULT 0,           -- 分类数
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qf_file_name ON quotation_files(file_name);
CREATE INDEX IF NOT EXISTS idx_qf_file_hash ON quotation_files(file_hash);

-- 报价数据行表：存储每个 Excel 中每一行的原始数据
CREATE TABLE IF NOT EXISTS quotation_rows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id       INTEGER NOT NULL,                   -- 关联 quotation_files.id
    file_name     TEXT    NOT NULL,                   -- 冗余文件名，加速搜索
    category      TEXT    NOT NULL DEFAULT '',        -- 分类名（如：HP系列）
    category_order INTEGER NOT NULL DEFAULT 0,        -- 分类在文件中的顺序
    model         TEXT    NOT NULL DEFAULT '',        -- 型号（第一列值，用于搜索）
    header_data   TEXT    NOT NULL DEFAULT '[]',      -- JSON: 表头数组，保持原始顺序
    row_data      TEXT    NOT NULL DEFAULT '[]',      -- JSON: 该行数据值数组，与表头一一对应
    row_order     INTEGER NOT NULL DEFAULT 0,         -- 行在分类中的顺序
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES quotation_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qr_file_id    ON quotation_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_qr_model      ON quotation_rows(model);
CREATE INDEX IF NOT EXISTS idx_qr_file_name  ON quotation_rows(file_name);
CREATE INDEX IF NOT EXISTS idx_qr_category   ON quotation_rows(file_id, category);

-- 全文搜索虚拟表（加速模糊搜索）
CREATE VIRTUAL TABLE IF NOT EXISTS quotation_fts USING fts5(
    model,
    category,
    file_name,
    content='quotation_rows',
    content_rowid='id'
);

-- 触发器：自动同步 FTS 索引
CREATE TRIGGER IF NOT EXISTS qr_ai AFTER INSERT ON quotation_rows BEGIN
    INSERT INTO quotation_fts(rowid, model, category, file_name)
    VALUES (new.id, new.model, new.category, new.file_name);
END;

CREATE TRIGGER IF NOT EXISTS qr_ad AFTER DELETE ON quotation_rows BEGIN
    INSERT INTO quotation_fts(quotation_fts, rowid, model, category, file_name)
    VALUES ('delete', old.id, old.model, old.category, old.file_name);
END;

CREATE TRIGGER IF NOT EXISTS qr_au AFTER UPDATE ON quotation_rows BEGIN
    INSERT INTO quotation_fts(quotation_fts, rowid, model, category, file_name)
    VALUES ('delete', old.id, old.model, old.category, old.file_name);
    INSERT INTO quotation_fts(rowid, model, category, file_name)
    VALUES (new.id, new.model, new.category, new.file_name);
END;
