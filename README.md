# ⚡ High-Throughput Architecture Demo

Mô phỏng kiến trúc hệ thống chịu tải cao với **Redis Cache + Message Queue + Worker Pattern**.

---

## 🏗️ Kiến trúc hệ thống

```
UI/Postman
    │
    ▼
 Backend (BE)  ◄──────────────────────┐
    │   │                             │
    │   └──► Redis Cache (node-cache) │
    │                                 │
    ├──► write-mq ──► write-services ─┤
    │                       │         │
    └──► read-mq  ──► read-services   │
                       │              │
                       ▼              │
                   Database ──────────┘
                  (SQLite)
```

### Luồng hoạt động

| Loại | Luồng |
|------|-------|
| **READ** | BE → kiểm tra Cache → **Cache HIT**: trả ngay / **Cache MISS**: đẩy read-mq → read-services đọc DB → lưu cache → trả về |
| **WRITE** | BE → đẩy write-mq → trả 202 ngay → write-services ghi DB bất đồng bộ → xóa cache |

---

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu
- [Node.js](https://nodejs.org/) v18 trở lên

### Bước 1 — Cài dependencies

```bash
cd backend
npm install
```

### Bước 2 — Chạy server

```bash
node server.js
```

Kết quả mong đợi:

```
[DB] Đã tạo 5 sản phẩm mẫu
[Workers] write-services & read-services đang lắng nghe queue...

╔══════════════════════════════════════════════════╗
║   ⚡ High-Throughput Architecture Demo API       ║
║   🚀 Server running → http://localhost:3000      ║
╚══════════════════════════════════════════════════╝
```

> Server chạy tại **http://localhost:3000**  
> File database `backend/data.sqlite` tự động tạo với 5 sản phẩm mẫu.

---

## 📬 Test bằng Postman

### Import Collection

1. Mở **Postman**
2. Nhấn **Import**
3. Chọn file `ArchitectureDemo.postman_collection.json`
4. Nhấn **Import**

> Biến `{{base_url}}` đã được set sẵn là `http://localhost:3000`

---

## 📋 Danh sách API Endpoints

### `GET /`
Health check, xem danh sách tất cả endpoints.

---

### `GET /api/products`
Lấy tất cả sản phẩm — áp dụng **Cache-Aside Pattern**.

**Response mẫu (Cache HIT):**
```json
{
  "success": true,
  "source": "cache",
  "count": 5,
  "data": [ ... ]
}
```

**Response mẫu (Cache MISS → DB):**
```json
{
  "success": true,
  "source": "database",
  "count": 5,
  "data": [ ... ]
}
```

> 💡 Gọi lần 1 → `source: "database"` | Gọi lần 2 → `source: "cache"`

---

### `GET /api/products/:id`
Lấy sản phẩm theo ID.

**Ví dụ:** `GET /api/products/p001`

ID mẫu có sẵn: `p001` `p002` `p003` `p004` `p005`

---

### `POST /api/products`
Thêm sản phẩm mới — đẩy vào **write-mq**, xử lý bất đồng bộ.

**Body (JSON):**
```json
{
  "name": "MacBook Pro M3",
  "price": 52990000,
  "category": "Electronics",
  "stock": 5
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Yêu cầu đã được đẩy vào write-mq, đang xử lý bất đồng bộ",
  "messageId": "1714024800000-abc12",
  "product": { "id": "a1b2c3d4", ... }
}
```

> ⏳ Đợi ~100ms rồi gọi `GET /api/products` để thấy sản phẩm mới.

---

### `PUT /api/products/:id`
Cập nhật sản phẩm — đẩy vào **write-mq**.

**Body (JSON):**
```json
{
  "name": "Laptop Dell XPS 13 (Updated)",
  "price": 26990000,
  "category": "Electronics",
  "stock": 10
}
```

---

### `DELETE /api/products/:id`
Xóa sản phẩm — đẩy vào **write-mq**.

**Ví dụ:** `DELETE /api/products/p001`

---

### `GET /api/stats`
Xem thống kê toàn hệ thống.

**Response mẫu:**
```json
{
  "success": true,
  "cache": {
    "keys": 2,
    "hits": 15,
    "misses": 3,
    "hitRate": "83.3%"
  },
  "writeQueue": {
    "name": "write-mq",
    "pending": 0,
    "processed": 12,
    "failed": 0
  },
  "readQueue": {
    "name": "read-mq",
    "pending": 0,
    "processed": 8,
    "failed": 0
  },
  "database": {
    "products": 17,
    "eventLogs": 12
  }
}
```

---

### `POST /api/cache/flush`
Xóa toàn bộ cache. Request tiếp theo sẽ phải đọc lại từ DB.

**Không cần Body.**

---

### `GET /api/logs?limit=20`
Xem lịch sử các thao tác ghi (INSERT/UPDATE/DELETE) được write-services thực thi.

**Query param:** `limit` — số lượng log muốn lấy (mặc định 20).

---

### `POST /api/flood`
Mô phỏng flood nhiều requests đồng thời (tối đa 200).

**Body (JSON):**
```json
{
  "count": 50
}
```

**Response mẫu:**
```json
{
  "success": true,
  "message": "Đã flood 50 requests",
  "breakdown": { "writes": 19, "reads": 31 },
  "queueStatus": {
    "write": { "pending": 19, "processed": 0 },
    "read":  { "pending": 31, "processed": 0 }
  }
}
```

> Gọi `GET /api/stats` sau vài giây để thấy queue đã xử lý xong.

---

## 🧪 Kịch bản test gợi ý

### Kịch bản 1: Kiểm tra Cache-Aside
```
1. POST /api/cache/flush          → Xóa cache sạch
2. GET  /api/products             → source: "database" (Cache MISS)
3. GET  /api/products             → source: "cache"    (Cache HIT) ✅
4. GET  /api/stats                → Xem hitRate tăng lên
```

### Kịch bản 2: Async Write
```
1. POST /api/products  { name: "Test", price: 999000, category: "Test", stock: 1 }
   → Nhận 202 ngay lập tức ✅
2. Đợi 100ms
3. GET  /api/products  → Thấy sản phẩm "Test" đã có trong DB ✅
4. GET  /api/logs      → Thấy event INSERT được ghi lại ✅
```

### Kịch bản 3: Cache Invalidation
```
1. GET  /api/products/p001        → source: "database"
2. GET  /api/products/p001        → source: "cache"
3. PUT  /api/products/p001  { name: "Updated", price: 100, category: "X", stock: 1 }
4. Đợi 100ms
5. GET  /api/products/p001        → source: "database" (cache đã bị xóa) ✅
```

### Kịch bản 4: Flood Test
```
1. POST /api/flood { "count": 100 }
2. GET  /api/stats  → Xem queue pending đang xử lý
3. Đợi 5 giây
4. GET  /api/stats  → Queue processed = 100, pending = 0 ✅
```

---

## 📂 Cấu trúc thư mục

```
Tuan9/
├── README.md                              ← File này
├── index.html                             ← Visualizer animation (mở bằng trình duyệt)
├── ArchitectureDemo.postman_collection.json ← Import vào Postman
└── backend/
    ├── server.js    ← Express API (entry point)
    ├── cache.js     ← Cache layer (mô phỏng Redis)
    ├── queue.js     ← Message Queue (read-mq & write-mq)
    ├── workers.js   ← write-services & read-services
    ├── db.js        ← SQLite setup & seed data
    ├── data.sqlite  ← Database file (tự sinh)
    └── package.json
```

---

## 🛠️ Công nghệ sử dụng

| Thành phần | Trong demo | Thực tế |
|---|---|---|
| Cache | `node-cache` (in-memory) | Redis |
| Message Queue | `EventEmitter` (in-memory) | RabbitMQ / Kafka / Bull |
| Database | SQLite (`better-sqlite3`) | PostgreSQL / MySQL |
| API Server | Express.js | Express / NestJS / FastAPI |
