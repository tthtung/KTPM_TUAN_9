// =========================================================
//  server.js – Express API Server
//  Mô phỏng đúng kiến trúc: BE → Cache/Queue → Worker → DB
// =========================================================
const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const cache  = require('./cache');
const { writeQueue, readQueue } = require('./queue');
require('./workers'); // Khởi động workers

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper: đọc từ Queue (async, chờ worker xử lý)
function readFromQueue(key, query) {
  return new Promise((resolve) => {
    const cached = cache.get(key);
    if (cached !== null) {
      console.log(`[BE] Cache HIT → key="${key}"`);
      return resolve({ source: 'cache', data: cached });
    }
    console.log(`[BE] Cache MISS → đẩy vào read-mq, key="${key}"`);
    readQueue.enqueue({ key, query, resolve: (data) => resolve({ source: 'database', data }) });
  });
}

// ─────────────────────────────────────────────────────────
// GET /                  Health check
// ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '⚡ High-Throughput Architecture Demo API',
    version: '1.0.0',
    endpoints: {
      'GET    /api/products':        'Lấy tất cả sản phẩm (Cache-Aside)',
      'GET    /api/products/:id':    'Lấy sản phẩm theo ID (Cache-Aside)',
      'POST   /api/products':        'Thêm sản phẩm (qua write-mq)',
      'PUT    /api/products/:id':    'Sửa sản phẩm (qua write-mq)',
      'DELETE /api/products/:id':    'Xóa sản phẩm (qua write-mq)',
      'GET    /api/stats':           'Xem thống kê hệ thống',
      'POST   /api/cache/flush':     'Xóa toàn bộ cache',
      'GET    /api/logs':            'Xem event log từ DB',
      'POST   /api/flood':           'Mô phỏng flood N requests',
    }
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/products      Lấy tất cả (Cache-Aside Pattern)
// ─────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const result = await readFromQueue('all_products', { type: 'getAll' });
    res.json({
      success: true,
      source: result.source,   // "cache" hoặc "database"
      count: result.data ? result.data.length : 0,
      data: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/products/:id  Lấy theo ID (Cache-Aside)
// ─────────────────────────────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const key = `product_${id}`;
  try {
    const result = await readFromQueue(key, { type: 'getById', id });
    if (!result.data) return res.status(404).json({ success: false, error: 'Không tìm thấy sản phẩm' });
    res.json({ success: true, source: result.source, data: result.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/products     Thêm sản phẩm qua write-mq
// ─────────────────────────────────────────────────────────
app.post('/api/products', (req, res) => {
  const { name, price, category, stock } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu trường name hoặc price' });
  }

  const product = {
    id:       uuidv4().slice(0, 8),
    name,
    price:    parseFloat(price),
    category: category || 'General',
    stock:    parseInt(stock) || 0,
  };

  const msgId = writeQueue.enqueue({ action: 'INSERT', data: product });
  console.log(`[BE] ✏️  Đã đẩy INSERT vào write-mq, msgId=${msgId}`);

  // Trả về ngay (async - không chờ worker)
  res.status(202).json({
    success: true,
    message: 'Yêu cầu đã được đẩy vào write-mq, đang xử lý bất đồng bộ',
    messageId: msgId,
    product,
    note: 'Dùng GET /api/products sau ~100ms để thấy kết quả',
  });
});

// ─────────────────────────────────────────────────────────
// PUT /api/products/:id  Cập nhật qua write-mq
// ─────────────────────────────────────────────────────────
app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, category, stock } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu trường name hoặc price' });
  }

  const data = { id, name, price: parseFloat(price), category: category || 'General', stock: parseInt(stock) || 0 };
  const msgId = writeQueue.enqueue({ action: 'UPDATE', data });

  res.status(202).json({
    success: true,
    message: 'Yêu cầu UPDATE đã vào write-mq',
    messageId: msgId,
    data,
  });
});

// ─────────────────────────────────────────────────────────
// DELETE /api/products/:id  Xóa qua write-mq
// ─────────────────────────────────────────────────────────
app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const msgId = writeQueue.enqueue({ action: 'DELETE', data: { id } });

  res.status(202).json({
    success: true,
    message: `Yêu cầu DELETE product ${id} đã vào write-mq`,
    messageId: msgId,
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/stats         Thống kê toàn hệ thống
// ─────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = require('./db');
  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const totalEvents   = db.prepare('SELECT COUNT(*) as c FROM event_log').get().c;

  res.json({
    success: true,
    cache:      cache.stats(),
    writeQueue: writeQueue.stats(),
    readQueue:  readQueue.stats(),
    database: {
      products: totalProducts,
      eventLogs: totalEvents,
    },
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/cache/flush  Xóa toàn bộ cache
// ─────────────────────────────────────────────────────────
app.post('/api/cache/flush', (req, res) => {
  cache.flush();
  res.json({ success: true, message: 'Cache đã được xóa sạch' });
});

// ─────────────────────────────────────────────────────────
// GET /api/logs          Xem event log
// ─────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const db   = require('./db');
  const limit = parseInt(req.query.limit) || 20;
  const logs  = db.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ success: true, count: logs.length, data: logs });
});

// ─────────────────────────────────────────────────────────
// POST /api/flood        Mô phỏng flood N requests
// ─────────────────────────────────────────────────────────
app.post('/api/flood', (req, res) => {
  const n       = Math.min(parseInt(req.body.count) || 20, 200);
  const results = { writes: 0, reads: 0 };

  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.4) {
      writeQueue.enqueue({
        action: 'INSERT',
        data: {
          id:       uuidv4().slice(0, 8),
          name:     `Flood Product ${i}`,
          price:    Math.floor(Math.random() * 5000000) + 100000,
          category: 'Flood',
          stock:    Math.floor(Math.random() * 100),
        }
      });
      results.writes++;
    } else {
      // Gửi read request vào queue (fire-and-forget)
      readQueue.enqueue({ key: 'all_products', query: { type: 'getAll' }, resolve: () => {} });
      results.reads++;
    }
  }

  res.json({
    success: true,
    message: `Đã flood ${n} requests`,
    breakdown: results,
    queueStatus: { write: writeQueue.stats(), read: readQueue.stats() },
  });
});

// ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ⚡ High-Throughput Architecture Demo API       ║');
  console.log(`║   🚀 Server running → http://localhost:${PORT}      ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  GET    /api/products        Lấy tất cả SP       ║');
  console.log('║  GET    /api/products/:id    Lấy SP theo ID      ║');
  console.log('║  POST   /api/products        Thêm SP (async)     ║');
  console.log('║  PUT    /api/products/:id    Sửa SP (async)      ║');
  console.log('║  DELETE /api/products/:id    Xóa SP (async)      ║');
  console.log('║  GET    /api/stats           Thống kê hệ thống   ║');
  console.log('║  POST   /api/cache/flush     Xóa cache           ║');
  console.log('║  GET    /api/logs            Event log           ║');
  console.log('║  POST   /api/flood           Flood test          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
