require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 3000,

  redis: {
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 30,
  },
};
