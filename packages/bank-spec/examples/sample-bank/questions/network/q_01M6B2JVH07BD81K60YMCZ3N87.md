---
id: q_01M6B2JVH07BD81K60YMCZ3N87
title: HTTPS 的 TLS 握手过程是怎样的？TLS 1.3 做了哪些改进？
type: concept
difficulty: hard
importance: 3
category: network
tags: [network, http, tls]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3", url: "https://www.rfc-editor.org/rfc/rfc8446" }
reviewedAt: 2026-11-05
estimatedMinutes: 6
---

## 一句话
握手用非对称密码协商出会话密钥并验证服务器证书，之后用对称加密传输；TLS 1.3 把完整握手缩短到 1-RTT，并只保留前向安全的密钥交换。

## 要点
- [kp1|2] ClientHello / ServerHello 协商版本、密码套件并交换随机数
- [kp2|3] 服务器出示证书，客户端校验证书链、有效期与域名
- [kp3|3] 用 (EC)DHE 交换密钥参数，双方各自算出相同的会话密钥
- [kp4|2] TLS 1.2 完整握手需 2-RTT，TLS 1.3 只需 1-RTT
- [kp5] TLS 1.3 移除 RSA 密钥交换等不安全算法，默认前向安全

## 详解
### TLS 1.2（ECDHE）完整握手
1. 客户端发送 ClientHello：支持的版本、密码套件、客户端随机数；
2. 服务器回复 ServerHello、Certificate、ServerKeyExchange（ECDHE 公钥，带签名）、ServerHelloDone；
3. 客户端校验证书，发送 ClientKeyExchange（自己的 ECDHE 公钥）、ChangeCipherSpec、Finished；
4. 服务器回复 ChangeCipherSpec、Finished。

双方由 ECDHE 共享秘密和两个随机数推导出会话密钥，第 2 个往返结束后才能发送应用数据。

### TLS 1.3 的改进
- 客户端在 ClientHello 里直接带上 key_share（猜测服务器支持的曲线），服务器一次回复即可完成密钥协商，**1-RTT**；
- 证书等握手消息在 ServerHello 之后就已加密；
- 支持 0-RTT 会话恢复（early data），但 early data 可能被重放，只适合幂等请求；
- 删除静态 RSA 与静态 DH 密钥交换、CBC 模式套件、压缩等，只保留 AEAD 套件。

### 前向安全
用静态 RSA 交换密钥时，服务器私钥一旦泄露，之前录下的流量都能被解密。(EC)DHE 每次握手生成临时密钥，私钥只用于签名，泄露不影响历史会话。

## 示例
```bash
openssl s_client -connect example.com:443 -tls1_3 -brief
```

## 易错点
- 以为全部数据都用非对称加密；非对称只用于认证与密钥协商
- 以为证书里的公钥直接用来加密会话密钥；ECDHE 下证书私钥只用于签名
- 把 0-RTT 当成无代价的优化，忽略重放风险

## 追问
### [f1] 客户端如何验证证书可信？
沿证书链逐级用上级公钥验证签名，直到本地信任的根证书；同时检查有效期、域名（SAN）是否匹配，以及是否被吊销（OCSP / CRL）。

### [f2] 会话恢复有哪些方式？
TLS 1.2 有 Session ID 与 Session Ticket；TLS 1.3 统一为 PSK，服务器在握手后下发 NewSessionTicket，客户端下次带上 PSK 即可跳过证书验证，还可以选择 0-RTT。
