// =========================================================
//  db.js – SQLite database (tự tạo file khi chạy lần đầu)
// =========================================================
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.sqlite'), { verbose: null });

// Khởi tạo bảng
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    price     REAL NOT NULL,
    category  TEXT,
    stock     INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS event_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    payload    TEXT,
    source     TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Seed dữ liệu mẫu nếu bảng rỗng
const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (count.c === 0) {
  const insert = db.prepare('INSERT INTO products (id, name, price, category, stock) VALUES (?,?,?,?,?)');
  const seed = [
    ['p001', 'Laptop Dell XPS 13', 28990000, 'Electronics', 15],
    ['p002', 'Chuột Logitech MX Master 3', 1890000, 'Accessories', 50],
    ['p003', 'Bàn phím Keychron K2', 2490000, 'Accessories', 30],
    ['p004', 'Màn hình LG 27" 4K', 12500000, 'Electronics', 8],
    ['p005', 'Tai nghe Sony WH-1000XM5', 7990000, 'Electronics', 20],
  ];
  seed.forEach(s => insert.run(...s));
  console.log('[DB] Đã tạo 5 sản phẩm mẫu');
}

module.exports = db;
