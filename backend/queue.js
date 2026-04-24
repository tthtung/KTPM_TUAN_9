// =========================================================
//  queue.js – Message Queue mô phỏng (in-memory EventEmitter)
//  Giả lập read-mq và write-mq trong sơ đồ kiến trúc
// =========================================================
const { EventEmitter } = require('events');

class MessageQueue extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.queue = [];
    this.processed = 0;
    this.failed = 0;
    this.processing = false;
  }

  // Producer: đẩy message vào queue
  enqueue(payload) {
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      payload,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    };
    this.queue.push(msg);
    console.log(`[${this.name}] ⬆ Enqueued #${msg.id} | Queue size: ${this.queue.length}`);
    this.emit('message', msg);
    return msg.id;
  }

  // Lấy kích thước queue
  size() { return this.queue.length; }

  stats() {
    return {
      name: this.name,
      pending: this.queue.length,
      processed: this.processed,
      failed: this.failed,
    };
  }
}

const writeQueue = new MessageQueue('write-mq');
const readQueue  = new MessageQueue('read-mq');

module.exports = { writeQueue, readQueue };
