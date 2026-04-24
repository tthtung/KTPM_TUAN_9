// =========================================================
//  workers.js – Consumers đọc từ RabbitMQ
//
//  write-worker: đọc write-mq → ghi SQLite → xóa Redis cache
//  read-worker:  đọc read-mq  → đọc SQLite → lưu Redis cache → reply
// =========================================================
const db     = require('./db');
const cache  = require('./cache');
const { getChannel, WRITE_QUEUE, READ_QUEUE, incrementFail } = require('./queue');

const DB_DELAY = 50; // ms — mô phỏng latency DB
const sleep    = (ms) => new Promise(r => setTimeout(r, ms));

// ── WRITE WORKER ──────────────────────────────────────────
async function startWriteWorker() {
  const ch = getChannel();

  // Mỗi lần chỉ xử lý 1 message (prefetch = 1)
  ch.prefetch(1);

  ch.consume(WRITE_QUEUE, async (msg) => {
    if (!msg) return;

    const { action, data } = JSON.parse(msg.content.toString());
    await sleep(DB_DELAY);

    try {
      if (action === 'INSERT') {
        db.prepare(`
          INSERT INTO products (id, name, price, category, stock)
          VALUES (@id, @name, @price, @category, @stock)
        `).run(data);
        await cache.del('all_products');
        console.log(`[write-services] ✅ INSERT product ${data.id}`);
      }

      else if (action === 'UPDATE') {
        db.prepare(`
          UPDATE products
          SET name=@name, price=@price, category=@category, stock=@stock,
              updated_at=datetime('now','localtime')
          WHERE id=@id
        `).run(data);
        await cache.del('all_products', `product_${data.id}`);
        console.log(`[write-services] ✅ UPDATE product ${data.id}`);
      }

      else if (action === 'DELETE') {
        db.prepare('DELETE FROM products WHERE id=?').run(data.id);
        await cache.del('all_products', `product_${data.id}`);
        console.log(`[write-services] ✅ DELETE product ${data.id}`);
      }

      // Ghi event log
      db.prepare('INSERT INTO event_log (event_type, payload, source) VALUES (?,?,?)')
        .run(action, JSON.stringify(data), 'write-services');

      ch.ack(msg); // Xác nhận đã xử lý xong
    } catch (err) {
      incrementFail('write');
      console.error(`[write-services] ❌ FAIL: ${err.message}`);
      ch.nack(msg, false, false); // Không retry (đưa vào dead-letter)
    }
  });

  console.log('[write-services] 👂 Đang lắng nghe write-mq...');
}

// ── READ WORKER ───────────────────────────────────────────
async function startReadWorker() {
  const ch = getChannel();

  ch.consume(READ_QUEUE, async (msg) => {
    if (!msg) return;

    const { key, query }  = JSON.parse(msg.content.toString());
    const { correlationId, replyTo } = msg.properties;

    await sleep(DB_DELAY);

    try {
      let result;
      if (query.type === 'getAll') {
        result = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
      } else if (query.type === 'getById') {
        result = db.prepare('SELECT * FROM products WHERE id=?').get(query.id);
      }

      // Lưu vào Redis cache
      if (result !== undefined) {
        await cache.set(key, result);
        console.log(`[read-services] ✅ DB query → cached key="${key}"`);
      }

      // Gửi kết quả về reply queue (RPC)
      if (replyTo && correlationId) {
        ch.sendToQueue(
          replyTo,
          Buffer.from(JSON.stringify(result ?? null)),
          { correlationId }
        );
      }

      ch.ack(msg);
    } catch (err) {
      incrementFail('read');
      console.error(`[read-services] ❌ FAIL: ${err.message}`);
      ch.nack(msg, false, false);
    }
  });

  console.log('[read-services]  👂 Đang lắng nghe read-mq...');
}

module.exports = { startWriteWorker, startReadWorker };
