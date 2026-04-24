// =========================================================
//  cache.js – Real Redis via ioredis
// =========================================================
const Redis  = require('ioredis');
const config = require('./config');

const client = new Redis(config.redis);
let hits = 0, misses = 0;

client.on('connect', () => console.log('[Redis] ✅ Connected to Redis server'));
client.on('error',   (e) => console.error('[Redis] ❌ Error:', e.message));

async function get(key) {
  const raw = await client.get(key);
  if (raw !== null) {
    hits++;
    return JSON.parse(raw);
  }
  misses++;
  return null;
}

async function set(key, value, ttl = config.cache.ttl) {
  await client.setex(key, ttl, JSON.stringify(value));
}

async function del(...keys) {
  if (keys.length) await client.del(...keys);
}

async function flush() {
  await client.flushdb();
  hits = 0;
  misses = 0;
  console.log('[Redis] 🗑  Cache flushed');
}

async function stats() {
  const keyCount = await client.dbsize();
  const total    = hits + misses;
  return {
    keys:    keyCount,
    hits,
    misses,
    hitRate: total ? ((hits / total) * 100).toFixed(1) + '%' : '0%',
  };
}

module.exports = { get, set, del, flush, stats, client };
