# ⚡ High-Throughput Architecture Demo — v2 (Real Redis + RabbitMQ)

Mô phỏng kiến trúc hệ thống chịu tải cao với **Redis thật + RabbitMQ thật + SQLite**.

---

## 🏗️ Kiến trúc hệ thống

```
UI / Postman
     │
     ▼
 Backend (BE)  ◄─────────────────────────────────┐
     │   │                                        │
     │   └──► Redis (ioredis) ── Cache HIT ───────┤
     │             Cache MISS                     │
     ├──────────────────────────────────────────  │
     │                                            │
     ├──► write-mq (RabbitMQ) ──► write-services  │
     │                                │           │
     └──► read-mq  (RabbitMQ) ──► read-services   │
                                      │    reply  │
                                      ▼           │
                                  SQLite DB ──────┘
                              (lưu vào Redis cache)
```

### Luồng hoạt động

| Loại | Chi tiết |
|------|----------|
| **READ** | BE → `cache.get()` Redis → **HIT**: trả ngay / **MISS**: publish `read-mq` → read-worker đọc DB → lưu Redis → RPC reply → BE trả client |
| **WRITE** | BE → publish `write-mq` → trả **202** ngay → write-worker ghi DB → xóa Redis cache |

---

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu
- [Node.js](https://nodejs.org/) v18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (để chạy Redis & RabbitMQ)

---

### Bước 1 — Khởi động Redis & RabbitMQ bằng Docker

```bash
# Chạy từ thư mục Tuan9/
docker-compose up -d
```

Kiểm tra đã chạy:
```bash
docker-compose ps
```

| Service | Port | Dùng để |
|---------|------|---------|
| Redis | `localhost:6379` | Cache layer |
| RabbitMQ AMQP | `localhost:5672` | Message Queue |
| RabbitMQ UI | `localhost:15672` | Quản lý queue trực quan |

> **RabbitMQ Management UI**: mở http://localhost:15672  
> Login: `admin` / `admin`

---

### Bước 2 — Cài dependencies Node.js

```bash
cd backend
npm install
```

---

### Bước 3 — Tạo file .env

```bash
# Copy file mẫu
copy .env.example .env
```

Nội dung mặc định (không cần sửa nếu dùng docker-compose):

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

RABBITMQ_URL=amqp://admin:admin@localhost:5672

PORT=3000
```

---

### Bước 4 — Chạy server

```bash
node server.js
```

Kết quả mong đợi:

```
[DB] Đã tạo 5 sản phẩm mẫu
[Redis] ✅ Connected to Redis server
[RabbitMQ] ✅ Connected | Queues: write-mq, read-mq
[write-services] 👂 Đang lắng nghe write-mq...
[read-services]  👂 Đang lắng nghe read-mq...

╔══════════════════════════════════════════════════════╗
║  ⚡ High-Throughput Architecture Demo API  v2        ║
║  🚀 http://localhost:3000  |  Redis ✅  RabbitMQ ✅  ║
╚══════════════════════════════════════════════════════╝
```

---

## 📬 Test bằng Postman

### Import Collection
1. Mở **Postman** → **Import**
2. Chọn file `ArchitectureDemo.postman_collection.json`

---

## 📋 Danh sách API Endpoints

### `GET /api/products`
Lấy tất cả sản phẩm — Cache-Aside với **Redis thật**.

```json
// Lần 1 → Cache MISS → đọc DB qua RabbitMQ
{ "success": true, "source": "database", "count": 5, "data": [...] }

// Lần 2 → Cache HIT → đọc thẳng Redis
{ "success": true, "source": "cache", "count": 5, "data": [...] }
```

---

### `GET /api/products/:id`
Lấy sản phẩm theo ID.  
ID mẫu: `p001` `p002` `p003` `p004` `p005`

---

### `POST /api/products`
Thêm sản phẩm — publish vào **RabbitMQ write-mq**, trả **202** ngay.

```json
// Body
{
  "name": "MacBook Pro M3",
  "price": 52990000,
  "category": "Electronics",
  "stock": 5
}

// Response 202
{
  "success": true,
  "message": "Yêu cầu đã vào write-mq → write-services đang xử lý",
  "messageId": "a1b2c3d4"
}
```

> ⏳ Đợi ~100ms → `GET /api/products` thấy sản phẩm mới

---

### `PUT /api/products/:id`
Cập nhật sản phẩm qua **write-mq**. Cache `all_products` và `product_<id>` tự xóa sau khi worker xử lý.

```json
{
  "name": "MacBook Pro M3 (Updated)",
  "price": 49990000,
  "category": "Electronics",
  "stock": 3
}
```

---

### `DELETE /api/products/:id`
Xóa sản phẩm qua **write-mq**.

---

### `GET /api/stats`
Thống kê thực tế từ Redis + RabbitMQ + DB.

```json
{
  "cache": {
    "keys": 2,
    "hits": 15,
    "misses": 3,
    "hitRate": "83.3%"
  },
  "writeQueue": { "name": "write-mq", "enqueued": 12, "processed": 12, "failed": 0 },
  "readQueue":  { "name": "read-mq",  "enqueued": 8,  "processed": 8,  "failed": 0 },
  "database":   { "products": 17, "eventLogs": 12 }
}
```

---

### `POST /api/cache/flush`
Xóa toàn bộ **Redis** cache (flushdb).

---

### `GET /api/logs?limit=20`
Xem event log ghi bởi write-services.

---

### `POST /api/flood`
Flood N requests vào RabbitMQ.

```json
{ "count": 100 }
```

---

## 🧪 Kịch bản test gợi ý

### Kịch bản 1 — Cache-Aside với Redis thật
```
1. POST /api/cache/flush          → Xóa Redis
2. GET  /api/products             → source: "database" (Cache MISS → RabbitMQ → DB)
3. GET  /api/products             → source: "cache"    (Cache HIT ← Redis) ✅
4. GET  /api/stats                → Xem hitRate Redis
```

### Kịch bản 2 — Async Write qua RabbitMQ
```
1. POST /api/products  { name: "Test SP", price: 999000, ... }
   → Nhận 202 ngay ✅ (message đang trong RabbitMQ write-mq)
2. Mở http://localhost:15672 → Vào Queues → write-mq → thấy message
3. Đợi ~100ms (worker tiêu thụ message)
4. GET  /api/products  → thấy "Test SP" ✅
5. GET  /api/logs      → thấy event INSERT ✅
```

### Kịch bản 3 — Cache Invalidation
```
1. GET  /api/products/p001  → source: "cache"
2. PUT  /api/products/p001  { name: "Updated", price: 100, ... }
3. Đợi ~100ms
4. GET  /api/products/p001  → source: "database" (worker đã xóa Redis key) ✅
```

### Kịch bản 4 — Flood Test
```
1. POST /api/flood { "count": 100 }
2. Mở http://localhost:15672 → theo dõi queue xử lý real-time
3. GET  /api/stats  → processed tăng lên ✅
```

---

## 🖥️ Theo dõi RabbitMQ Management UI

Mở **http://localhost:15672** (admin/admin) để xem:
- **Queues**: `write-mq`, `read-mq` — số message pending/processed
- **Connections**: xem server đang kết nối
- **Exchanges**: cấu hình routing

---

## 📂 Cấu trúc thư mục

```
Tuan9/
├── README.md
├── docker-compose.yml                       ← Redis + RabbitMQ
├── index.html                               ← Visualizer animation
├── ArchitectureDemo.postman_collection.json
└── backend/
    ├── server.js     ← Express API entry point
    ├── config.js     ← Cấu hình từ .env
    ├── cache.js      ← Redis (ioredis)
    ├── queue.js      ← RabbitMQ producer + RPC reply
    ├── workers.js    ← RabbitMQ consumers (write & read)
    ├── db.js         ← SQLite + seed data
    ├── .env          ← Biến môi trường (tự tạo từ .env.example)
    ├── .env.example
    ├── data.sqlite   ← DB file (tự sinh)
    └── package.json
```

---

## 🛠️ Công nghệ sử dụng

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Cache | **Redis** (ioredis) | Thực tế, TTL 30s |
| Message Queue | **RabbitMQ** (amqplib) | Thực tế, durable queue |
| Read Pattern | **RPC qua RabbitMQ** | correlationId + replyTo |
| Database | SQLite (better-sqlite3) | Demo; thay bằng PostgreSQL/MySQL thực tế |
| API Server | Express.js | |
| Infrastructure | Docker Compose | Redis 7, RabbitMQ 3 |

---

## 🛑 Dừng hệ thống

```bash
# Dừng server: Ctrl+C

# Dừng Docker
docker-compose down

# Dừng Docker và xóa data
docker-compose down -v
```
