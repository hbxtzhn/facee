---
id: q_01M6B2MP40WM52PJV40MZJ9T5J
title: HTTP 缓存中强缓存和协商缓存有什么区别？
type: concept
difficulty: easy
importance: 3
category: network
tags: [network, http, cache]
related: [q_01M6B2JVH07BD81K60YMCZ3N87]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "RFC 9111: HTTP Caching", url: "https://www.rfc-editor.org/rfc/rfc9111" }
  - { title: "MDN: HTTP caching", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching" }
reviewedAt: 2026-11-05
estimatedMinutes: 3
---

## 一句话
强缓存在有效期内直接使用本地副本、不发请求；过期后用协商缓存向服务器验证，未变化则返回 304。

## 要点
- [kp1|3] 强缓存由 Cache-Control: max-age 控制，优先级高于 Expires
- [kp2|3] 协商缓存用 ETag / If-None-Match 或 Last-Modified / If-Modified-Since
- [kp3|2] 资源未变时服务器返回 304 Not Modified，不带响应体
- [kp4] no-cache 表示每次都要验证，no-store 才是完全不缓存

## 详解
### 强缓存
- `Cache-Control: max-age=3600`：响应生成后 3600 秒内视为新鲜；
- `Expires`：绝对时间，受客户端时钟影响，同时存在时以 `max-age` 为准；
- 命中时浏览器直接使用本地副本，开发者工具里显示 from memory cache / from disk cache。

### 协商缓存
缓存过期（或带 `no-cache`）时，浏览器带上验证字段请求：

- `If-None-Match: "<ETag>"`：服务器比较资源当前的 ETag；
- `If-Modified-Since: <Last-Modified>`：按修改时间比较，精度只到秒。

两者同时存在时，服务器应优先使用 ETag。未变化返回 `304`，浏览器继续使用本地副本并更新其新鲜度。

### 常见实践
- 带内容哈希的静态资源（如 `app.3f2a1c.js`）：`Cache-Control: max-age=31536000, immutable`；
- HTML 入口：`Cache-Control: no-cache`，每次验证，保证能拿到新的资源引用。

## 示例
```http
HTTP/1.1 200 OK
Cache-Control: max-age=600
ETag: "5f8e1a"

GET /api/config HTTP/1.1
If-None-Match: "5f8e1a"

HTTP/1.1 304 Not Modified
```

## 易错点
- 把 no-cache 理解为不缓存
- 以为 304 也会返回完整资源
- 修改静态资源内容却不改文件名，用户长期拿到旧版本

## 追问
### [f1] 有了 Last-Modified 为什么还需要 ETag？
Last-Modified 精度只到秒，一秒内多次修改无法区分；文件内容没变但修改时间变了（如重新部署）会导致不必要的重新下载。ETag 基于内容或版本生成，更精确。
