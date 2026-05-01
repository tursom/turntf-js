# WebSocket 实时客户端流程

本文档详细说明 `Client` 的完整生命周期，包括连接建立、消息处理、自动重连与关闭流程。

## 1. 客户端状态机

`Client` 内部维护以下状态：

```
[初始态] --> connect() --> [连接中] --> 登录成功 --> [已连接]
                                              |
                                         断开连接 --> [已断开] --> 自动重连 or close()
                                              |                        |
                                          close()                  [已连接]
                                              |
                                          [已关闭]
```

关键状态指示器：
- `client.sessionRef` — 只有 `[已连接]` 态下存在；断开后被清空
- `client.connect()` — 返回的 Promise 只有在 `[已连接]` 态才 resolve
- `close()` — 将客户端置于 `[已关闭]` 态，所有 pending RPC 失败

## 2. 连接建立流程

### 2.1 `connect()` 调用顺序

```
connect() 被调用
  │
  ├─ 检查 closed 标志，若已关闭则抛出 ClosedError
  ├─ 检查是否已连接，若已连接则直接返回
  ├─ 创建 connectWaiter Deferred
  ├─ 启动 runLoop（如果尚未启动）
  │     └─ runLoop 进入连接循环
  └─ 等待 connectWaiter 被 resolve 或 reject
```

### 2.2 单次连接尝试 (`connectAndServe()`)

```
connectAndServe()
  │
  ├─ 1. 调用 cursorStore.loadSeenMessages() 加载已确认游标
  │
  ├─ 2. dial()：创建 WebSocket 连接
  │     ├─ 根据 baseUrl 自动转换协议：http->ws, https->wss
  │     ├─ 连接路径：/ws/client（默认）或 /ws/realtime（realtimeStream=true）
  │     └─ 等待 WebSocket 握手完成
  │
  ├─ 3. 发送首帧 LoginRequest（protobuf ClientEnvelope）
  │     ├─ user = { nodeId, userId }
  │     ├─ password = bcrypt 哈希值
  │     ├─ seen_messages = 从 CursorStore 加载的游标列表
  │     └─ transient_only = ClientOptions.transientOnly
  │
  ├─ 4. 等待并读取首帧 ServerEnvelope
  │     ├─ loginResponse → 登录成功
  │     │     ├─ 设置 client.sessionRef
  │     │     ├─ 标记 connected = true
  │     │     ├─ 调用 handler.onLogin(loginInfo)
  │     │     └─ resolve connectWaiter
  │     └─ error (code=unauthorized) → 设置 stopReconnect
  │                       (其他 code) → 抛出 ServerError，触发重连
  │
  ├─ 5. 启动后台 pingLoop（每 pingIntervalMs 发一次 Ping）
  │
  └─ 6. 进入 readLoop
        └─ 循环读取 ServerEnvelope 并分发给 handleServerEnvelope
```

### 2.3 登录帧详情

`LoginRequest` 包含以下字段：

| 字段 | 来源 | 说明 |
|---|---|---|
| `user` | `ClientOptions.credentials` | 节点 ID + 用户 ID |
| `password` | `passwordWireValue(credentials.password)` | bcrypt 哈希的密码值 |
| `seen_messages` | `cursorStore.loadSeenMessages()` | 已确认落盘的消息游标数组 |
| `transient_only` | `ClientOptions.transientOnly` | 是否仅需要瞬时流量 |

登录成功后的 `LoginResponse` 包含：

- `user`：服务端返回的完整用户信息
- `protocol_version`：协议版本标识（如 `"client-v1alpha1"`）
- `session_ref`：当前会话引用（`servingNodeId` + `sessionId`）

## 3. 消息处理循环

### 3.1 readLoop 消息分发

```mermaid
readLoop 收到 ServerEnvelope
  │
  ├─ messagePushed →
  │     persistAndDispatchMessage()
  │       ├─ cursorStore.saveMessage(message)
  │       ├─ cursorStore.saveCursor(cursor)
  │       ├─ 如果 ackMessages=true → 发送 AckMessage
  │       └─ handler.onMessage(message)
  │
  ├─ packetPushed →
  │     handler.onPacket(packet)
  │
  ├─ sendMessageResponse →
  │     handleSendMessageResponse()
  │       ├─ body.message →
  │     │     persistAndDispatchMessage() + resolvePending(requestId, message)
  │       └─ body.transientAccepted →
  │             resolvePending(requestId, relayAccepted)
  │
  ├─ pong → resolvePending(requestId)
  │
  ├─ createUserResponse → resolvePending(requestId, user)
  ├─ getUserResponse → resolvePending(requestId, user)
  ├─ updateUserResponse → resolvePending(requestId, user)
  ├─ deleteUserResponse → resolvePending(requestId, deleteUserResult)
  ├─ listMessagesResponse → resolvePending(requestId, messages)
  ├─ listEventsResponse → resolvePending(requestId, events)
  ├─ listClusterNodesResponse → resolvePending(requestId, nodes)
  ├─ listNodeLoggedInUsersResponse → resolvePending(requestId, users)
  ├─ resolveUserSessionsResponse → resolvePending(requestId, result)
  ├─ operationsStatusResponse → resolvePending(requestId, status)
  ├─ metricsResponse → resolvePending(requestId, text)
  ├─ 用户元数据相关 → resolvePending(requestId, metadata)
  ├─ 附件相关 → resolvePending(requestId, attachment(s))
  │
  ├─ error →
  │     ├─ requestId !== "0" → rejectPending(requestId, ServerError)
  │     └─ requestId === "0" → 抛出连接级 ServerError
  │
  └─ 未知类型 → throw ProtocolError
```

### 3.2 持久消息处理顺序（`persistAndDispatchMessage`）

SDK 处理持久消息的顺序是固定的，这是 SDK 的可靠性核心：

1. `await cursorStore.saveMessage(message)` — 将完整消息写入业务持久化层
2. `await cursorStore.saveCursor(cursor)` — 写入游标 `(nodeId, seq)`
3. 如果 `ackMessages = true`，发送 `AckMessage` — 通知服务端已确认
4. `await handler.onMessage(message)` — 交给业务回调消费

**如果 `saveMessage()` 或 `saveCursor()` 抛错**：
- 不会继续 ack
- `handler.onMessage()` 不会被调用
- 如果是 `sendMessage()` 响应的消息，Promise 也会失败

这个顺序确保"先落盘，后 ack"，避免先 ack 后掉电导致的丢消息。

### 3.3 瞬时包处理

`PacketPushed` 的处理比持久消息简单：

- 不写 `CursorStore`
- 不参与 `AckMessage`
- 不会在重连后补发
- 直接调用 `handler.onPacket(packet)`

如果需要断线恢复或跨重启去重，业务层需自行按 `packetId` 建表或缓存。

### 3.4 sendMessage() 的双重可见性

`sendMessage()` 的返回值是服务端确认后的 `Message` 对象。但 SDK 内部还会把这条消息**走完一遍完整的 `persistAndDispatchMessage` 流程**，这意味着：

- `handler.onMessage()` 也会同时收到这条消息
- `CursorStore` 也会持久化它

推荐做法：
- 把 `sendMessage()` 的返回值当作发送确认（获取 `seq` 等信息）
- 真正的入站消费集中在 `handler.onMessage()`

### 3.5 RPC 请求路由

所有 RPC（`sendMessage`、`createUser`、`listMessages` 等）共享同一个机制：

1. 生成自增 `requestId`（从 `0n` 开始的 BigInt）
2. 创建 Deferred 并注册到 `pending` Map
3. 将请求帧序列化写入 WebSocket
4. 等待 Deferred 被 resolve（收到对应 `requestId` 的响应）或超时
5. 超时后若服务端晚回包，SDK 会因为 pending 已清理而忽略该响应

`requestId` 是 64 位递增整数，以字符串形式在 protobuf 中传输。测试已验证支持乱序响应。

## 4. 自动 Ping

`Client` 在登录成功后启动后台 pingLoop：

```
pingLoop:
  循环:
    1. sleep(pingIntervalMs, lifecycleAbort.signal)
    2. 如果 closed 或 disconnected，退出
    3. 发送 Ping RPC（超时 = requestTimeoutMs）
    4. 如果 Ping 失败（非 NotConnectedError / ClosedError / DisconnectedError），
       调用 handler.onError(error)
```

默认 `pingIntervalMs = 30000`（30 秒）。ping 超时后不会触发主动断开——ping 失败不会中断连接，仅通过 `onError` 报告。

## 5. 自动重连

### 5.1 重连触发条件

当 `readLoop` 因以下原因退出时，触发重连：

- WebSocket 连接被远程关闭
- 网络错误导致读操作失败
- 服务端发送 `error`（`requestId === "0"`）

### 5.2 重连行为

```
readLoop 退出
  │
  ├─ 标记 connected = false，清空 sessionRef
  ├─ failAllPending(new DisconnectedError())：所有待处理 RPC 失败
  ├─ handler.onDisconnect(error)
  └─ close WebSocket
  │
  └─ shouldRetry(error) 判断：
        ├─ closed？→ 不重试
        ├─ stopReconnect（unauthorized）？→ 不重试
        ├─ reconnect=false？→ 不重试
        └─ 其他 → 开始重连

重连流程（指数退避）：
  delay = initialReconnectDelayMs（默认 1000ms）
  循环:
    1. 如果 closed，return
    2. connectAndServe()
    3. 如果连接成功 → delay 重置为 initialReconnectDelayMs
    4. 如果不需要重试 → return
    5. handler.onError(error)
    6. sleep(delay)
    7. delay = min(delay * 2, maxReconnectDelayMs)（上限 30000ms）
    8. 继续循环
```

### 5.3 重连时的消息恢复

每次重连前，SDK 重新调用 `cursorStore.loadSeenMessages()`，然后在新的 `LoginRequest.seen_messages` 中发送这些游标。这是真正的可靠恢复机制（`AckMessage` 只是连接内的去重提示，不持久化）。

### 5.4 停止重连的条件

- `client.close()` 被调用
- 登录失败且 `ServerError.code === "unauthorized"`
- `ClientOptions.reconnect = false`

## 6. 连接关闭

`close()` 可重复调用，行为如下：

```
close()
  ├─ 如果已 closed → wait runTask 完成，return
  ├─ 设置 closed = true, stopReconnect = true
  ├─ lifecycleAbort.abort(new ClosedError()) → 中断所有等待循环
  ├─ rejectConnectWaiter(new ClosedError())
  ├─ failAllPending(new ClosedError()) → 所有 pending RPC 失败
  ├─ 断开 socket 和 connectingSocket
  ├─ 清空 sessionRef, connected
  └─ await runTask 完成
```

关闭后：
- 所有 `connect()` 的调用立即抛出 `ClosedError`
- 任何尝试 WS RPC 的操作抛出 `ClosedError`
- 自动重连完全停止

## 7. QueuedWebSocket——帧序列化适配层

`QueuedWebSocket` 是 SDK 内部对原生 `ws` WebSocket 的封装，提供：

- **读队列**：收到的帧先放入队列，由 `read()` 拉取；如果没有可用帧，`read()` 返回的 Promise 会等待
- **写串行化**：通过 `writeChain` 保证帧写入顺序，避免并发写入导致的帧错乱
- **优雅关闭**：先正常 `close()`，200ms 超时后强制 `terminate()`
- **错误闭包**：`close` 事件触发后，所有等待的 `read()` 统一 reject

## 8. Handler 回调时序

| 事件 | 回调 | 调用时机 |
|---|---|---|
| 登录成功 | `onLogin(LoginInfo)` | 刚设置完 `sessionRef`，resolve `connect()` 之前 |
| 持久消息 | `onMessage(Message)` | `saveMessage` + `saveCursor` + ack 完成后 |
| 瞬时包 | `onPacket(Packet)` | 收到后立即 |
| 错误 | `onError(error)` | 重连前、ping 失败、ack 异常、readLoop 内 handle 异常 |
| 断线 | `onDisconnect(error)` | readLoop 退出后，failAllPending、关闭 socket 之后 |

所有回调的异常都会被 SDK 吞掉（`safeHandlerCall`），不会打崩客户端。

## 9. 连接路径

```
realtimeStream=false（默认）→ ws://host:port/ws/client
realtimeStream=true            → ws://host:port/ws/realtime
```

URL 转换规则（`websocketUrl()` 函数）：
- `http://` → `ws://`
- `https://` → `wss://`
- `ws://` / `wss://` 保持不变
- 路径结尾的 `/` 被去掉
- 保留 `baseUrl` 的 path 前缀

## 10. 已关闭状态保护

`Client` 通过多个保护机制确保已关闭状态不会被绕过：

- `connect()` 入口检查 `this.closed`
- `sendEnvelope()` 检查 `this.closed` 和 socket 状态
- `registerPending()` 检查 `this.closed`
- `run()` 循环检查 `this.closed`
- `lifecycleAbort` 在 `close()` 时 abort，中断所有 `sleep()` 和 `waitForPromise()`
