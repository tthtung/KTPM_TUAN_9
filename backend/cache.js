// =========================================================
//  cache.js – In-memory cache mô phỏng Redis
//  TTL mặc định: 30 giây
// =========================================================
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 30, checkperiod: 10 });

let hits = 0;
let misses = 0;

module.exports = {
  get(key) {
    const val = cache.get(key);
    if (val !== undefined) { hits++; return val; }
    misses++;
    return null;
  },
  set(key, value, ttl) {
    return ttl ? cache.set(key, value, ttl) : cache.set(key, value);
  },
  del(key) { return cache.del(key); },
  flush() { cache.flushAll(); hits = 0; misses = 0; },
  stats() {
    return { keys: cache.keys().length, hits, misses, hitRate: hits + misses ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : '0%' };
  }
};
