// =========================================================
//  server.js – Express API (v2 — Real Redis + RabbitMQ)
// =========================================================
const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const config  = require('./config');
const cache   = require('./cache');
const queue   = require('./queue');
const { startWriteWorker, startReadWorker } = require('./workers');

const app = express();
app.use(cors());
app.use(express.json());

// ── Cache-Aside helper ────────────────────────────────────
async function readWithCache(key, query) {
  // 1. Thử đọc cache (Redis)
  const cached = await cache.get(key);
  if (cached !== null) {
    console.log(`[BE] ✅ Cache HIT → key="${key}"`);
    return { source: 'cache', data: cached };
  }

  // 2. Cache MISS → đẩy vào read-mq, chờ kết quả từ read-services
  console.log(`[BE] ⚡ Cache MISS → read-mq | key="${key}"`);
  const data = await queue.publishRead(key, query);
  return { source: 'database', data };
}

// ─────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '⚡ High-Throughput Architecture Demo API (v2 — Real Redis + RabbitMQ)',
    endpoints: {
      'GET    /api/products':      'Cache-Aside: Redis → read-mq → DB',
      'GET    /api/products/:id':  'Cache-Aside theo ID',
      'POST   /api/products':      'Ghi async qua write-mq → write-services',
      'PUT    /api/products/:id':  'Cập nhật async qua write-mq',
      'DELETE /api/products/:id':  'Xóa async qua write-mq',
      'GET    /api/stats':         'Thống kê: Redis + RabbitMQ + DB',
      'POST   /api/cache/flush':   'Xóa toàn bộ Redis cache',
      'GET    /api/logs':          'Event log từ write-services',
      'POST   /api/flood':         'Flood N requests',
    },
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/products
// ─────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const result = await readWithCache('all_products', { type: 'getAll' });
    res.json({ success: true, source: result.source, count: result.data?.length ?? 0, data: result.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/products/:id
// ─────────────────────────────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await readWithCache(`product_${id}`, { type: 'getById', id });
    if (!result.data) return res.status(404).json({ success: false, error: 'Không tìm thấy sản phẩm' });
    res.json({ success: true, source: result.source, data: result.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/products
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

  const msgId = queue.publishWrite('INSERT', product);
  res.status(202).json({
    success:   true,
    message:   'Yêu cầu đã vào write-mq → write-services đang xử lý',
    messageId: msgId,
    product,
    note:      'Gọi GET /api/products sau ~100ms để thấy kết quả',
  });
});

// ─────────────────────────────────────────────────────────
// PUT /api/products/:id
// ─────────────────────────────────────────────────────────
app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, category, stock } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu trường name hoặc price' });
  }

  const data  = { id, name, price: parseFloat(price), category: category || 'General', stock: parseInt(stock) || 0 };
  const msgId = queue.publishWrite('UPDATE', data);
  res.status(202).json({ success: true, message: 'UPDATE đã vào write-mq', messageId: msgId, data });
});

// ─────────────────────────────────────────────────────────
// DELETE /api/products/:id
// ─────────────────────────────────────────────────────────
app.delete('/api/products/:id', (req, res) => {
  const { id }  = req.params;
  const msgId   = queue.publishWrite('DELETE', { id });
  res.status(202).json({ success: true, message: `DELETE ${id} đã vào write-mq`, messageId: msgId });
});

// ─────────────────────────────────────────────────────────
// GET /api/stats
// ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const db           = require('./db');
  const totalProduct = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const totalEvents  = db.prepare('SELECT COUNT(*) as c FROM event_log').get().c;
  const cacheStats   = await cache.stats();
  const queueStats   = queue.getStats();

  res.json({
    success: true,
    cache:   cacheStats,
    ...queueStats,
    database: { products: totalProduct, eventLogs: totalEvents },
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/cache/flush
// ─────────────────────────────────────────────────────────
app.post('/api/cache/flush', async (req, res) => {
  await cache.flush();
  res.json({ success: true, message: 'Redis cache đã được xóa sạch' });
});

// ─────────────────────────────────────────────────────────
// GET /api/logs
// ─────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const db    = require('./db');
  const limit = parseInt(req.query.limit) || 20;
  const logs  = db.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ success: true, count: logs.length, data: logs });
});

// ─────────────────────────────────────────────────────────
// POST /api/flood
// ─────────────────────────────────────────────────────────
app.post('/api/flood', (req, res) => {
  const n = Math.min(parseInt(req.body.count) || 20, 200);
  const results = { writes: 0, reads: 0 };

  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.4) {
      queue.publishWrite('INSERT', {
        id:       uuidv4().slice(0, 8),
        name:     `Flood Product #${i}`,
        price:    Math.floor(Math.random() * 5_000_000) + 100_000,
        category: 'Flood',
        stock:    Math.floor(Math.random() * 100),
      });
      results.writes++;
    } else {
      queue.publishRead('all_products', { type: 'getAll' }).catch(() => {});
      results.reads++;
    }
  }

  res.json({
    success:  true,
    message:  `Đã flood ${n} requests vào RabbitMQ`,
    breakdown: results,
    tip:      'Gọi GET /api/stats sau vài giây để thấy queue processed tăng lên',
  });
});

// ─────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Kết nối Redis
    await cache.client.connect();
    console.log('[Boot] Redis connected ✅');
  } catch (e) {
    console.error('[Boot] Redis ERROR:', e.message);
    process.exit(1);
  }

  try {
    // Kết nối RabbitMQ
    await queue.connect();
    // Khởi động workers
    await startWriteWorker();
    await startReadWorker();
    console.log('[Boot] RabbitMQ + Workers ready ✅');
  } catch (e) {
    console.error('[Boot] RabbitMQ ERROR:', e.message);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  ⚡ High-Throughput Architecture Demo API  v2        ║');
    console.log(`║  🚀 http://localhost:${config.port}  |  Redis ✅  RabbitMQ ✅  ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
  });
}

bootstrap();
