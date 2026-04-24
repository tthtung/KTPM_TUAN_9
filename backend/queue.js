// =========================================================
//  queue.js – Real RabbitMQ via amqplib
//
//  WRITE: fire-and-forget  →  publish to write-mq
//  READ:  RPC pattern      →  publish to read-mq với replyTo
//         kết quả trả về qua exclusive reply queue
// =========================================================
const amqp   = require('amqplib');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const WRITE_QUEUE = 'write-mq';
const READ_QUEUE  = 'read-mq';

let connection, channel, replyQueue;

// Map lưu callback đang chờ (correlationId → resolve)
const pendingReads = new Map();

// Counters
const counters = {
  write: { enqueued: 0, processed: 0, failed: 0 },
  read:  { enqueued: 0, processed: 0, failed: 0 },
};

// ── Connect ───────────────────────────────────────────────
async function connect() {
  connection = await amqp.connect(config.rabbitmq.url);
  channel    = await connection.createChannel();

  // Khai báo queue bền vững (write) và tạm (read)
  await channel.assertQueue(WRITE_QUEUE, { durable: true });
  await channel.assertQueue(READ_QUEUE,  { durable: false });

  // Tạo exclusive reply queue cho RPC pattern
  const { queue } = await channel.assertQueue('', { exclusive: true });
  replyQueue = queue;

  // Lắng nghe kết quả từ read-services trả về
  channel.consume(replyQueue, (msg) => {
    if (!msg) return;
    const correlationId = msg.properties.correlationId;
    const pending       = pendingReads.get(correlationId);
    if (pending) {
      pendingReads.delete(correlationId);
      pending.resolve(JSON.parse(msg.content.toString()));
      counters.read.processed++;
    }
  }, { noAck: true });

  console.log('[RabbitMQ] ✅ Connected | Queues: write-mq, read-mq | ReplyTo:', replyQueue);

  // Xử lý ngắt kết nối
  connection.on('close', () => console.warn('[RabbitMQ] ⚠️  Connection closed'));
  connection.on('error', (e) => console.error('[RabbitMQ] ❌', e.message));
}

// ── Producer: Write (fire-and-forget) ────────────────────
function publishWrite(action, data) {
  const msgId   = uuidv4().slice(0, 8);
  const payload  = JSON.stringify({ action, data });

  channel.sendToQueue(
    WRITE_QUEUE,
    Buffer.from(payload),
    { persistent: true, messageId: msgId }
  );

  counters.write.enqueued++;
  console.log(`[write-mq] ⬆ Enqueued ${action} | msgId=${msgId}`);
  return msgId;
}

// ── Producer: Read (RPC – chờ kết quả trả về) ────────────
function publishRead(key, query) {
  return new Promise((resolve, reject) => {
    const correlationId = uuidv4();
    pendingReads.set(correlationId, { resolve, key });

    // Timeout 5s nếu worker không trả về
    const timer = setTimeout(() => {
      if (pendingReads.has(correlationId)) {
        pendingReads.delete(correlationId);
        reject(new Error(`Read timeout for key="${key}"`));
      }
    }, 5000);

    // Bọc resolve để clear timer
    const originalResolve = resolve;
    pendingReads.set(correlationId, {
      resolve: (data) => { clearTimeout(timer); originalResolve(data); },
      key,
    });

    channel.sendToQueue(
      READ_QUEUE,
      Buffer.from(JSON.stringify({ key, query })),
      { correlationId, replyTo: replyQueue }
    );

    counters.read.enqueued++;
    console.log(`[read-mq] ⬆ Enqueued read | key="${key}" | corr=${correlationId.slice(0, 8)}`);
  });
}

function incrementFail(type) { counters[type].failed++; }

function getStats() {
  return {
    writeQueue: { name: WRITE_QUEUE, pending: pendingReads.size, ...counters.write },
    readQueue:  { name: READ_QUEUE,  pending: pendingReads.size, ...counters.read  },
  };
}

function getChannel() { return channel; }

module.exports = { connect, publishWrite, publishRead, getStats, getChannel, incrementFail, WRITE_QUEUE, READ_QUEUE };
