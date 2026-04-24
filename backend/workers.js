// =========================================================
//  workers.js – Write-Worker & Read-Worker
//  Lắng nghe queue, xử lý bất đồng bộ, ghi/đọc DB
// =========================================================
const db    = require('./db');
const cache = require('./cache');
const { writeQueue, readQueue } = require('./queue');

// Giả lập độ trễ DB (ms)
const DB_DELAY = 50;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── WRITE WORKER ──────────────────────────────────────────
// Lắng nghe write-mq → ghi vào SQLite → xóa cache liên quan
writeQueue.on('message', async (msg) => {
  const { action, data } = msg.payload;
  await sleep(DB_DELAY); // mô phỏng latency DB

  try {
    if (action === 'INSERT') {
      db.prepare(`
        INSERT INTO products (id, name, price, category, stock)
        VALUES (@id, @name, @price, @category, @stock)
      `).run(data);
      cache.del('all_products');
      console.log(`[write-services] ✅ INSERT product ${data.id}`);
    }

    else if (action === 'UPDATE') {
      db.prepare(`
        UPDATE products
        SET name=@name, price=@price, category=@category, stock=@stock,
            updated_at=datetime('now','localtime')
        WHERE id=@id
      `).run(data);
      cache.del('all_products');
      cache.del(`product_${data.id}`);
      console.log(`[write-services] ✅ UPDATE product ${data.id}`);
    }

    else if (action === 'DELETE') {
      db.prepare('DELETE FROM products WHERE id=?').run(data.id);
      cache.del('all_products');
      cache.del(`product_${data.id}`);
      console.log(`[write-services] ✅ DELETE product ${data.id}`);
    }

    // Log event vào DB
    db.prepare(`INSERT INTO event_log (event_type, payload, source) VALUES (?,?,?)`)
      .run(action, JSON.stringify(data), 'write-services');

    writeQueue.processed++;
  } catch (err) {
    writeQueue.failed++;
    console.error(`[write-services] ❌ FAIL: ${err.message}`);
  }

  // Xóa khỏi queue
  const idx = writeQueue.queue.findIndex(m => m.id === msg.id);
  if (idx !== -1) writeQueue.queue.splice(idx, 1);
});

// ── READ WORKER ───────────────────────────────────────────
// Lắng nghe read-mq → đọc DB → lưu vào cache → resolve callback
readQueue.on('message', async (msg) => {
  const { key, query, resolve } = msg.payload;
  await sleep(DB_DELAY);

  try {
    let result;
    if (query.type === 'getAll') {
      result = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    } else if (query.type === 'getById') {
      result = db.prepare('SELECT * FROM products WHERE id=?').get(query.id);
    }

    if (result !== undefined) {
      cache.set(key, result, 30);
      console.log(`[read-services] ✅ DB query done → cached key="${key}"`);
    }

    if (resolve) resolve(result);
    readQueue.processed++;
  } catch (err) {
    readQueue.failed++;
    if (msg.payload.resolve) msg.payload.resolve(null);
    console.error(`[read-services] ❌ FAIL: ${err.message}`);
  }

  const idx = readQueue.queue.findIndex(m => m.id === msg.id);
  if (idx !== -1) readQueue.queue.splice(idx, 1);
});

console.log('[Workers] write-services & read-services đang lắng nghe queue...');
