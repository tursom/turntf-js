# turntf-js

`turntf-js` 是 turntf 的 Node.js / TypeScript SDK，面向 Node.js 20+ 运行时，提供与 turntf 服务端通信的全套能力。

SDK 里的 64 位整数 ID 一律以十进制字符串暴露，例如 `nodeId`、`userId`、`seq`、`packetId`，避免 JavaScript `number` 精度丢失。

## 安装

先配置 `.npmrc`：

```ini
@tursom:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

然后安装：

```bash
npm install @tursom/turntf-js
```

## 快速开始

### `HTTPClient`

`HTTPClient` 是无状态的 REST API 客户端，适合管理脚本、批处理、简单查询等场景。

```ts
import {
  HTTPClient,
  plainPasswordSync,
  type CreateUserRequest,
  type UserRef
} from "@tursom/turntf-js";

// 创建客户端，指定服务器基础 URL
const client = new HTTPClient("http://127.0.0.1:8080");

// 使用 (loginName, password) 登录获取 token
const token = await client.loginWithPassword(
  "admin",
  plainPasswordSync("root-password")
);

// 或使用 (nodeId, userId, password) 方式登录
// const token = await client.loginWithPassword(
//   "4096", "1",
//   plainPasswordSync("root-password")
// );

// 创建新用户
const request: CreateUserRequest = {
  username: "alice",
  loginName: "alice.login",
  password: plainPasswordSync("alice-password"),
  role: "user"
};
const user = await client.createUser(token, request);

// 查询用户消息列表
const target: UserRef = { nodeId: user.nodeId, userId: user.userId };
const messages = await client.listMessages(token, target, 20);
console.log(messages.length);

// 发送持久化消息
const sent = await client.postMessage(token, target, new TextEncoder().encode("hello"));
console.log("message seq:", sent.seq);

// 获取集群节点信息
const nodes = await client.listClusterNodes(token);
console.log("cluster nodes:", nodes.length);
```

### `Client`

`Client` 是基于 WebSocket 的长连接客户端，支持实时消息消费、自动重连、消息游标去重、会话定向发送等高级特性。

```ts
import {
  Client,
  DeliveryMode,
  MemoryCursorStore,
  NopHandler,
  plainPasswordSync,
  type LoginInfo,
  type Message,
  type Packet
} from "@tursom/turntf-js";

// 自定义事件处理器，继承 NopHandler 并重写需要的回调
class Handler extends NopHandler {
  override onLogin(info: LoginInfo): void {
    console.log("登录成功", info.user.userId, info.sessionRef.sessionId);
  }

  override onMessage(message: Message): void {
    const text = new TextDecoder().decode(message.body);
    console.log("收到消息", message.seq, text);
  }

  override onPacket(packet: Packet): void {
    console.log("收到瞬态包", packet.packetId, packet.targetSession?.sessionId);
  }

  override onError(error: unknown): void {
    console.error("发生错误", error);
  }

  override onDisconnect(error: unknown): void {
    console.warn("连接断开", error);
  }
}

// 创建 WebSocket 客户端
const client = new Client({
  baseUrl: "http://127.0.0.1:8080",
  credentials: {
    loginName: "alice.login",
    password: plainPasswordSync("alice-password")
  },
  cursorStore: new MemoryCursorStore(), // 消息去重游标存储
  handler: new Handler(),
  reconnect: true,                         // 启用自动重连（默认）
  ackMessages: true,                       // 自动回复消息确认（默认）
  pingIntervalMs: 30_000                   // 心跳间隔
});

// 建立 WebSocket 连接
await client.connect();
console.log("当前会话:", client.sessionRef);

// 发送持久化消息
const message = await client.sendMessage(
  { nodeId: "4096", userId: "1025" },
  new TextEncoder().encode("hello")
);
console.log("消息已发送，seq:", message.seq);

// 解析目标用户的会话信息
const target = { nodeId: "8192", userId: "1025" };
const resolved = await client.resolveUserSessions(target);
const session = resolved.sessions.find((item) => item.transientCapable)?.session;

// 向指定会话发送瞬态数据包（Packet）
if (session) {
  const result = await client.sendPacket(
    target,
    new TextEncoder().encode("hello from one session to another"),
    DeliveryMode.RouteRetry,
    { targetSession: session }
  );
  console.log("包已中转，packetId:", result.packetId);
}

// 优雅关闭连接
await client.close();
```

## API 概览

### `HTTPClient`

REST API 客户端，所有方法均返回 `Promise`，支持通过 `RequestOptions` 设置超时和取消。

| 方法 | 说明 |
| --- | --- |
| `constructor(baseUrl, options?)` | 创建实例，`baseUrl` 例如 `http://localhost:8080` |
| `login(nodeId, userId, password)` / `login(loginName, password)` | 明文密码登录（自动哈希），返回 token |
| `loginWithPassword(nodeId, userId, password)` / `loginWithPassword(loginName, password)` | 使用 `PasswordInput` 对象登录，返回 token |
| `createUser(token, request)` | 创建新用户 |
| `createChannel(token, request)` | 创建频道（角色为 `channel` 的特殊用户） |
| `createSubscription(token, user, channel)` | 创建用户对频道的订阅关系 |
| `postMessage(token, target, body)` | 发送持久化消息 |
| `postPacket(token, targetNodeId, relayTarget, body, mode)` | 发送瞬态数据包 |
| `listUsers(token, request?)` | 获取当前用户可通讯的活跃用户列表，支持 `name` / `uid` 过滤 |
| `listMessages(token, target, limit?)` | 获取用户消息列表 |
| `listClusterNodes(token)` | 获取集群节点列表 |
| `listNodeLoggedInUsers(token, nodeId)` | 获取节点上已登录用户列表 |
| `blockUser(token, owner, blocked)` | 将用户加入黑名单 |
| `unblockUser(token, owner, blocked)` | 将用户移出黑名单 |
| `listBlockedUsers(token, owner)` | 获取用户黑名单列表 |
| `getUserMetadata(token, owner, key)` | 获取用户元数据 |
| `upsertUserMetadata(token, owner, key, request)` | 创建或更新用户元数据 |
| `deleteUserMetadata(token, owner, key)` | 删除用户元数据 |
| `scanUserMetadata(token, owner, request?)` | 扫描用户元数据（支持前缀过滤和分页） |
| `upsertAttachment(token, owner, subject, type, config)` | 创建或更新附件关系 |
| `deleteAttachment(token, owner, subject, type)` | 删除附件关系 |
| `listAttachments(token, owner, type?)` | 获取附件列表 |

### `Client`

WebSocket 长连接客户端，支持自动重连、消息去重、消息持久化与瞬态投递。

**构造选项：**

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `string` | — | 服务器基础 URL（必填） |
| `credentials` | `Credentials` | — | 登录凭据，支持 `{ nodeId, userId, password }` 或 `{ loginName, password }` |
| `cursorStore` | `CursorStore` | `MemoryCursorStore` | 消息游标存储器，用于重连去重 |
| `handler` | `Handler` | `NopHandler` | 事件处理器 |
| `fetch` | `typeof fetch` | `globalThis.fetch` | 自定义 fetch 函数 |
| `reconnect` | `boolean` | `true` | 是否启用自动重连 |
| `initialReconnectDelayMs` | `number` | `1000` | 初始重连延迟（毫秒） |
| `maxReconnectDelayMs` | `number` | `30000` | 最大重连延迟（毫秒） |
| `pingIntervalMs` | `number` | `30000` | WebSocket 心跳间隔（毫秒） |
| `requestTimeoutMs` | `number` | `10000` | RPC 请求超时（毫秒） |
| `ackMessages` | `boolean` | `true` | 是否自动回复消息确认 |
| `transientOnly` | `boolean` | `false` | 是否仅接收瞬态消息 |
| `realtimeStream` | `boolean` | `false` | 是否使用实时流模式连接 |

**属性：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `http` | `HTTPClient` | HTTP 客户端实例，可在同一实例中混用 HTTP 能力 |
| `baseUrl` | `string` | 服务器基础 URL（只读） |
| `sessionRef` | `SessionRef \| undefined` | 当前会话引用，断线后被清空 |

**方法：**

| 方法 | 说明 |
| --- | --- |
| `connect(options?)` | 建立 WebSocket 连接 |
| `close()` | 优雅关闭客户端连接，取消所有待处理 RPC 请求 |
| `ping(options?)` | 发送心跳 ping 请求 |
| `login(nodeId, userId, password)` / `login(loginName, password)` | 明文密码 HTTP 登录（透传至 `client.http`） |
| `loginWithPassword(...)` | 使用 `PasswordInput` 对象 HTTP 登录 |
| `sendMessage(target, body, options?)` | 发送持久化消息 |
| `postMessage(target, body, options?)` | `sendMessage` 的别名 |
| `sendPacket(target, body, deliveryMode, options?)` | 发送瞬态数据包 |
| `postPacket(target, body, deliveryMode, options?)` | `sendPacket` 的别名 |
| `createUser(request, options?)` | 创建用户 |
| `createChannel(request, options?)` | 创建频道 |
| `getUser(target, options?)` | 获取用户信息 |
| `listUsers(request?, options?)` | 获取当前用户可通讯的活跃用户列表，支持 `name` / `uid` 过滤 |
| `updateUser(target, request, options?)` | 更新用户信息 |
| `deleteUser(target, options?)` | 删除用户 |
| `getUserMetadata(owner, key, options?)` | 获取用户元数据 |
| `upsertUserMetadata(owner, key, request, options?)` | 创建或更新用户元数据 |
| `deleteUserMetadata(owner, key, options?)` | 删除用户元数据 |
| `scanUserMetadata(owner, request?, options?)` | 扫描用户元数据 |
| `upsertAttachment(owner, subject, type, config?, options?)` | 创建或更新附件关系 |
| `deleteAttachment(owner, subject, type, options?)` | 删除附件关系 |
| `listAttachments(owner, type?, options?)` | 获取附件列表 |
| `subscribeChannel(subscriber, channel, options?)` | 订阅频道 |
| `createSubscription(subscriber, channel, options?)` | `subscribeChannel` 的别名 |
| `unsubscribeChannel(subscriber, channel, options?)` | 取消订阅频道 |
| `listSubscriptions(subscriber, options?)` | 获取订阅的频道列表 |
| `blockUser(owner, blocked, options?)` | 将用户加入黑名单 |
| `unblockUser(owner, blocked, options?)` | 将用户移出黑名单 |
| `listBlockedUsers(owner, options?)` | 获取黑名单列表 |
| `listMessages(target, limit?, options?)` | 获取消息列表 |
| `listEvents(after?, limit?, options?)` | 获取事件列表 |
| `listClusterNodes(options?)` | 获取集群节点列表 |
| `listNodeLoggedInUsers(nodeId, options?)` | 获取节点上已登录用户列表 |
| `resolveUserSessions(user, options?)` | 解析用户在所有集群节点上的会话信息 |
| `operationsStatus(options?)` | 获取当前连接节点的运行状态 |
| `metrics(options?)` | 获取集群节点的性能指标文本 |

### `Handler`

事件处理器接口，所有方法均支持同步和异步形式。

| 回调方法 | 参数 | 说明 |
| --- | --- | --- |
| `onLogin(info)` | `LoginInfo` | 登录成功后的回调 |
| `onMessage(message)` | `Message` | 收到新的持久化消息 |
| `onPacket(packet)` | `Packet` | 收到新的瞬态数据包 |
| `onError(error)` | `unknown` | 发生错误 |
| `onDisconnect(error)` | `unknown` | 连接断开 |

`NopHandler` 提供上述接口的空实现，继承并重写需要的回调方法即可。

### 密码处理

| 函数 | 说明 |
| --- | --- |
| `hashPassword(plain)` | 对明文密码进行 bcrypt 哈希（10 轮 salt） |
| `plainPassword(plain)` | 异步创建 `PasswordInput` 对象（自动哈希） |
| `plainPasswordSync(plain)` | 同步创建 `PasswordInput` 对象 |
| `hashedPassword(hash)` | 从已有 bcrypt 哈希值创建 `PasswordInput` 对象 |
| `passwordWireValue(password)` | 获取密码的线格式值（带验证） |

### 错误类型

| 类 | 说明 |
| --- | --- |
| `TurntfError` | 所有 turntf 错误的基类 |
| `ClosedError` | 客户端已关闭时抛出 |
| `NotConnectedError` | 客户端未连接时抛出 |
| `DisconnectedError` | WebSocket 连接意外断开时抛出 |
| `ServerError` | 服务器返回错误响应时抛出（含 `code`、`requestId`） |
| `ProtocolError` | 协议解析错误时抛出 |
| `ConnectionError` | 网络连接错误时抛出（含 `op`、`cause`） |

### `Proto` 访问

可以直接使用生成的 Protobuf 类型与编解码器：

```ts
import { proto } from "@tursom/turntf-js";

const envelope = proto.ClientEnvelope.create({
  body: {
    oneofKind: "ping",
    ping: { requestId: "1" }
  }
});
```

原始 proto 文件也会一起发布：

```ts
import protoPath from "@tursom/turntf-js/proto/client.proto";
```

### `CursorStore`

游标存储器接口，用于持久化已接收消息的游标信息，实现重连去重。

| 方法 | 说明 |
| --- | --- |
| `loadSeenMessages()` | 加载所有已接收消息的游标列表 |
| `saveMessage(message)` | 保存收到的消息 |
| `saveCursor(cursor)` | 保存消息游标 |

内置实现：`MemoryCursorStore` —— 基于内存的存储，重启后数据丢失。可根据需要实现接口以接入文件、数据库等持久化后端。

## 模块定位与选型

| 入口 | 认证方式 | 连接形态 | 适合场景 | 主要能力 |
| --- | --- | --- | --- | --- |
| `HTTPClient` | HTTP 登录换取 Bearer Token | 无状态请求 | 管理脚本、批处理、简单查询、只走 HTTP 的后端任务 | 登录、创建用户、附件/黑名单管理、列消息、发持久消息、发瞬时包、在线节点查询、用户元数据管理 |
| `Client` | WebSocket 首帧用密码登录 | 长连接 | 在线消息消费、自动重连、消息游标、瞬时包、会话定向发送 | `MessagePushed` / `PacketPushed`、自动 ack、`CursorStore`、WS RPC、`resolveUserSessions()`、`sessionRef`、`operationsStatus()`、`metrics()` |

几个容易混淆的点：

- `Client` 是 WS-first 高级入口，但它仍然暴露 `client.http`，方便在同一个实例里混用 HTTP 能力。
- `HTTPClient.login()` / `loginWithPassword()` 同时支持旧 `nodeId + userId + password` 和新 `loginName + password` 两种登录方式。
- `ClientOptions.credentials` 也支持两种选择器：`{ nodeId, userId, password }` 或 `{ loginName, password }`。
- `Client.login()` / `Client.loginWithPassword()` 只是透传到内部 `HTTPClient`，用于获取 HTTP Token；真正的 WebSocket 登录发生在 `connect()` 里。
- 当前 SDK 里，`resolveUserSessions()`、`listEvents()`、`operationsStatus()`、`metrics()` 与按会话定向的 `sendPacket(..., { targetSession })` 只在 `Client` 上提供。

## 关键行为摘要

- `Client` 收到持久消息时，会按 `saveMessage -> saveCursor -> 可选 ack -> handler.onMessage` 的顺序处理。
- `sendMessage()` 返回的 `Message` 也会走同一套持久化与回调流程；如果业务已经在 `handler.onMessage` 里消费，就不要再把 `sendMessage()` 的返回值当成第二次投递。
- `PacketPushed` 是瞬时包，不会自动写入 `CursorStore`，也不参与 `AckMessage` 或重连补发。
- `sessionRef` 会同时出现在 `handler.onLogin(info).sessionRef` 和 `client.sessionRef`；断线后会被清空。
- `listUsers()` 返回的是当前用户“可通讯”的活跃用户集合；普通用户查看他人时，`loginName` 可能是空字符串。
- `listUsers({ uid: { nodeId: "0", userId: "0" } })` 在 WebSocket 协议里等价于省略 `uid`；HTTP 侧会直接省略 `uid` 查询参数。

## 文档导航

- [SDK 接入指南](docs/sdk-guide.md) — 完整的接入流程与常用场景
- [API 参考文档](docs/api-reference.md) — 详细的 API 方法说明与参数列表
- [客户端连接流程](docs/client-flow.md) — WebSocket 连接、登录、重连与消息消费流程
- [WebSocket 协议](docs/websocket-protocol.md) — 底层 protobuf 协议定义与编解码
- [开发、测试与发布](docs/development.md) — 本地开发、运行测试与发布流程
