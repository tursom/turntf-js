# turntf-js 接入指南

## 1. 模块定位

`turntf-js` 是 turntf 的 Node.js / TypeScript SDK，定位是“服务端进程里的 turntf 客户端”，而不是浏览器 SDK。

当前实现有几个基础约束：

- 运行时要求 Node.js 20+。
- WebSocket 依赖 `ws` 包，因此默认面向 Node 环境。
- 对外暴露的 64 位整数 ID 都使用十进制字符串，避免 JS 精度问题。
- SDK 同时覆盖两条协议线：
  - HTTP JSON 管理与查询接口
  - WebSocket + protobuf 实时接口

如果你要做的是在线消息消费、自动重连、消息游标、瞬时包定向发送，优先使用 `Client`。如果你只需要一次性 HTTP 管理请求，优先使用 `HTTPClient`。

## 2. 入口与职责分工

### `HTTPClient`

`HTTPClient` 是无状态 HTTP 封装，使用 Bearer Token 认证，适合：

- 管理脚本
- 后台任务
- 不需要在线回调的批量查询
- 只走 HTTP JSON 的简单接入

当前封装的方法主要包括：

- 登录：`login()`、`loginWithPassword()`
- 用户创建：`createUser()`、`createChannel()`
- 消息查询与发送：`listMessages()`、`postMessage()`、`postPacket()`
- 附件能力：`createSubscription()`、`upsertAttachment()`、`deleteAttachment()`、`listAttachments()`
- 黑名单能力：`blockUser()`、`unblockUser()`、`listBlockedUsers()`
- 在线态查询：`listClusterNodes()`、`listNodeLoggedInUsers()`

要点：

- `HTTPClient` 目前不是服务端 HTTP API 的“全量镜像”。
- `login()` / `loginWithPassword()` 同时支持旧 `nodeId + userId + password` 和新 `login_name + password`。
- `resolveUserSessions()`、`operationsStatus()`、`metrics()`、按 `targetSession` 定向的瞬时包发送，不在 `HTTPClient` 上。
- `HTTPClientOptions.fetch` 只影响 HTTP 请求，适合测试注入或自定义代理。

### `Client`

`Client` 是 WS-first 的高级入口，负责：

- WebSocket 连接建立与首帧密码登录
- `MessagePushed` / `PacketPushed` 回调分发
- `CursorStore` 驱动的持久消息恢复
- 可选 `AckMessage`
- 自动 ping
- 自动重连
- 请求级 WS RPC
- `resolveUserSessions()` 与按会话定向 `sendPacket()`

`Client` 同时还内置了一个 `client.http: HTTPClient`，用于：

- 获取 HTTP Token
- 混合场景下补充少量 HTTP 请求

注意：

- `Client.login()` / `Client.loginWithPassword()` 只是 `client.http` 的快捷代理，不会建立 WebSocket。
- 真正的 WebSocket 认证发生在 `await client.connect()` 里，认证材料来自 `ClientOptions.credentials`。
- `ClientOptions.credentials` 支持 `{ nodeId, userId, password }` 和 `{ loginName, password }` 两种写法，但只能二选一。

## 3. 安装

先配置 `.npmrc`：

```ini
@tursom:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

安装：

```bash
npm install @tursom/turntf-js
```

## 4. `HTTPClient` 使用方式

```ts
import {
  HTTPClient,
  plainPasswordSync,
  type CreateUserRequest
} from "@tursom/turntf-js";

const http = new HTTPClient("http://127.0.0.1:8080");

const token = await http.loginWithPassword(
  "4096",
  "1",
  plainPasswordSync("root-password")
);

const request: CreateUserRequest = {
  username: "alice",
  loginName: "alice.login",
  password: plainPasswordSync("alice-password"),
  role: "user"
};

const user = await http.createUser(token, request);
await http.postMessage(
  token,
  { nodeId: user.nodeId, userId: user.userId },
  Buffer.from("hello")
);
```

几个实现细节值得提前知道：

- `baseUrl` 会去掉结尾的 `/`，所以传 `http://127.0.0.1:8080/` 也能正常工作。
- `RequestOptions.timeoutMs` 与 `signal` 同时适用于 HTTP 与 WS RPC。
- HTTP JSON 里的大整数会用 `json-bigint` 解析，再转换成 SDK 里的十进制字符串。
- `postPacket()` 只负责发瞬时包，不会解析在线会话；如果你要按具体会话定向发包，需要切换到 `Client.resolveUserSessions()` + `Client.sendPacket(..., { targetSession })`。

## 5. `Client` 生命周期

最常见的接入方式是自定义 `Handler`，再配一个业务自己的 `CursorStore`。

```ts
import {
  Client,
  NopHandler,
  plainPasswordSync,
  type LoginInfo,
  type Message,
  type Packet
} from "@tursom/turntf-js";

class Handler extends NopHandler {
  override onLogin(info: LoginInfo): void {
    console.log("session", info.sessionRef);
  }

  override onMessage(message: Message): void {
    console.log("persistent", message.seq);
  }

  override onPacket(packet: Packet): void {
    console.log("transient", packet.packetId);
  }
}

const client = new Client({
  baseUrl: "http://127.0.0.1:8080",
  credentials: {
    loginName: "alice.login",
    password: plainPasswordSync("alice-password")
  },
  handler: new Handler()
});

await client.connect();
await client.close();
```

生命周期要点：

- `connect()` 会启动后台 run loop，并等待一次成功登录。
- 默认连接路径是 `/ws/client`。
- 如果 `realtimeStream: true`，连接路径会切换为 `/ws/realtime`。
- 登录成功后，`client.sessionRef` 与 `handler.onLogin(info).sessionRef` 都会拿到当前会话引用。
- 连接断开时，`client.sessionRef` 会被清空，后续成功重连后再刷新。
- `close()` 可重复调用；关闭后所有 pending RPC 都会失败，并停止自动重连。

## 6. `ClientOptions` 参考

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | 无 | 必填，支持 `http(s)://`，也接受 `ws(s)://` |
| `credentials` | 无 | 必填，使用 `{ nodeId, userId, password }` 或 `{ loginName, password }` 二选一 |
| `cursorStore` | `new MemoryCursorStore()` | 持久消息游标存储，生产环境建议替换 |
| `handler` | `new NopHandler()` | 回调接收器 |
| `fetch` | `globalThis.fetch` | 只用于内部 `HTTPClient` |
| `reconnect` | `true` | 断线后是否自动重连 |
| `initialReconnectDelayMs` | `1000` | 首次重试延迟 |
| `maxReconnectDelayMs` | `30000` | 指数退避上限 |
| `pingIntervalMs` | `30000` | 自动 ping 间隔 |
| `requestTimeoutMs` | `10000` | 默认 RPC 超时 |
| `ackMessages` | `true` | 收到持久消息后是否自动发 `AckMessage` |
| `transientOnly` | `false` | 首帧登录时声明“只需要瞬时包，不需要持久消息补发/持续推送” |
| `realtimeStream` | `false` | 使用 `/ws/realtime` 实时流入口 |

说明：

- 对于所有数值型超时/延迟参数，若传入非正数或非有限值，SDK 会回退到默认值。
- `credentials.password` 需要是 `plainPasswordSync()`、`plainPassword()` 或 `hashedPassword()` 生成的 `PasswordInput`。
- 用户更新时，`loginName` 缺席表示不修改，传空串表示解绑当前登录名。

## 7. `Handler` 与 `CursorStore`

### `Handler` 回调语义

`Handler` 接口有五个回调：

- `onLogin(info)`：登录成功后调用，此时 `client.sessionRef` 已经可读。
- `onMessage(message)`：持久消息完成本地持久化后调用。
- `onPacket(packet)`：收到瞬时包时调用。
- `onError(error)`：用于报告请求级错误、重连前错误、ack/ping 过程中的异常等。
- `onDisconnect(error)`：当前已建立连接被读循环判定结束后调用。

重要行为：

- SDK 会吞掉 `Handler` 自己抛出的异常，不会因为你的回调报错而把客户端打崩。
- 这意味着如果你需要报警或中断上层流程，应该在回调内部自己记录日志、打点或转发到业务侧的错误通道。

### `CursorStore` 契约

`CursorStore` 是 SDK 与业务持久化层之间的接缝：

```ts
interface CursorStore {
  loadSeenMessages(): Promise<MessageCursor[]> | MessageCursor[];
  saveMessage(message: Message): Promise<void> | void;
  saveCursor(cursor: MessageCursor): Promise<void> | void;
}
```

推荐把它实现成业务真实的落盘逻辑，例如：

- `saveMessage()` 写消息表
- `saveCursor()` 写游标表
- `loadSeenMessages()` 从游标表加载已经确认落盘的 `(nodeId, seq)` 集合

SDK 对持久消息的处理顺序是固定的：

1. `saveMessage(message)`
2. `saveCursor({ nodeId, seq })`
3. 如果 `ackMessages = true`，发送 `AckMessage`
4. `handler.onMessage(message)`

这个顺序的意义是：只有在本地已经持久化成功后，SDK 才会 ack 并交给上层消费，避免“先 ack 后落盘”导致的断线丢消息。

### `MemoryCursorStore` 的定位

`MemoryCursorStore` 适合：

- 单元测试
- 本地 demo
- 不需要进程重启恢复的临时场景

不适合：

- 生产环境持久消息消费
- 需要跨进程、跨重启恢复的在线客户端

它还会对 `loadSeenMessages()` 返回值做拷贝，避免调用方篡改内部状态。

## 8. 自动重连、`transientOnly` 与消息可靠性

### 自动重连

`Client` 默认开启自动重连，行为如下：

- 断线后使用指数退避，从 `initialReconnectDelayMs` 开始，直到 `maxReconnectDelayMs`
- 每次重连前重新调用 `cursorStore.loadSeenMessages()`
- 重新登录时，把这些游标写入 `LoginRequest.seen_messages`
- 如果登录失败返回 `ServerError` 且 `code === "unauthorized"`，SDK 会停止重连

断线后的 pending RPC 会统一失败为 `DisconnectedError`，不会被“带到下一条连接”继续等待。

### `AckMessage` 的真实边界

`AckMessage` 在当前协议里只是连接内的去重提示，不是服务端持久化状态。

这意味着真正可靠的恢复依赖的是：

- 你已经把消息与游标写入自己的持久化层
- 下次登录时通过 `seen_messages` 重新告诉服务端哪些消息已经安全落盘

如果 `saveMessage()` 或 `saveCursor()` 抛错：

- SDK 不会继续 ack
- `handler.onMessage()` 也不会被调用
- 对于 `sendMessage()` 自己发送出来的持久消息，返回 Promise 也会失败

这是刻意保守的行为，目的是让“没有可靠落盘的消息”在之后仍有机会被补发。

### `sendMessage()` 的双重可见性

`sendMessage()` / `postMessage()` 的返回值是服务端确认后的持久消息对象，但 SDK 内部还会把这条响应消息走一遍完整的持久化与回调流程。

因此如果你同时：

- `await client.sendMessage(...)`
- 又在 `handler.onMessage()` 里消费消息

那么同一条逻辑消息会在两个位置都可见。推荐做法是：

- 把 `sendMessage()` 的返回值当作发送确认或读取服务端生成的 `seq`
- 把真正的入站消费逻辑统一放在 `handler.onMessage()`

### `PacketPushed` 的边界

瞬时包与持久消息的语义不同：

- `PacketPushed` 不写 `CursorStore`
- 不参与 `AckMessage`
- 不会在重连后补发
- 如需断线恢复或跨重启去重，需要业务层自行按 `packetId` 建表或缓存

### `transientOnly`

`transientOnly: true` 会让登录帧带上 `transient_only = true`。结合当前服务端行为，它表示：

- 当前会话不需要持久消息历史补发
- 当前会话不需要持续的持久消息推送
- 但仍然可以收发瞬时包，并继续使用允许的 RPC

只有当你的连接确实只服务于瞬时流量时，才建议开启它。否则会错过持久消息的补发与在线推送。

### `realtimeStream`

`realtimeStream: true` 会把连接路径从 `/ws/client` 切换到 `/ws/realtime`。

结合当前服务端实现，这条实时流入口更适合“在线会话发现 + 瞬时包”场景：

- 允许 `sendPacket()` / transient `sendMessage`
- 允许 `resolveUserSessions()`
- 允许 `listClusterNodes()`、`listNodeLoggedInUsers()`、`ping()`
- 不允许持久消息发送与大部分管理/查询 RPC；服务端会返回 `invalid_request`

纯瞬时业务通常会把 `realtimeStream: true` 与 `transientOnly: true` 一起使用。

## 9. `sessionRef`、`resolveUserSessions()` 与按会话定向 `sendPacket()`

### `sessionRef` 从哪里来

登录成功后，SDK 会同时暴露当前会话引用：

- `handler.onLogin(info).sessionRef`
- `client.sessionRef`

它的结构是：

```ts
interface SessionRef {
  servingNodeId: string;
  sessionId: string;
}
```

其中：

- `servingNodeId` 表示当前连接挂在哪个服务节点上
- `sessionId` 表示该服务节点上的具体在线会话

### `resolveUserSessions()`

如果你要给某个在线用户的特定会话发瞬时包，先调用：

```ts
const resolved = await client.resolveUserSessions({
  nodeId: "8192",
  userId: "1025"
});
```

返回结果里有两层信息：

- `presence`：按服务节点聚合的在线概况，例如某节点上有多少条会话、传输提示是什么
- `sessions`：具体会话列表，每项都包含 `session`、`transport`、`transientCapable`

推荐选择方式：

- 优先挑 `transientCapable === true` 的会话
- 如果业务端自己理解不同 `transport` 的语义，也可以按传输类型进一步过滤

### 按会话定向发包

```ts
import { DeliveryMode } from "@tursom/turntf-js";

const target = { nodeId: "8192", userId: "1025" };
const resolved = await client.resolveUserSessions(target);
const session = resolved.sessions.find((item) => item.transientCapable)?.session;

if (session) {
  const accepted = await client.sendPacket(
    target,
    Buffer.from("hello"),
    DeliveryMode.RouteRetry,
    { targetSession: session }
  );

  console.log(accepted.targetSession);
}
```

相关语义：

- `sendPacket()` 只支持瞬时包，`deliveryMode` 必须是 `DeliveryMode.BestEffort` 或 `DeliveryMode.RouteRetry`
- `options.targetSession` 可选；不传时由服务端按目标用户在线态自行路由
- 服务端接受后，`RelayAccepted.targetSession` 会回显实际接受的目标会话
- 接收方在 `Packet.targetSession` 里也能看到目标会话信息

## 10. 错误处理与超时

### 本地参数校验错误

以下错误通常在发请求之前同步抛出，类型是原生 `Error`：

- `nodeId` / `userId` / `seq` 不是合法十进制字符串
- `body` 为空
- `deliveryMode` 非法
- `targetSession` 缺字段
- 密码为空或来源非法

### SDK 自定义错误类型

| 错误类型 | 触发场景 |
| --- | --- |
| `ServerError` | 服务端返回 `ServerEnvelope.error` |
| `ProtocolError` | 收到文本帧、非法 protobuf 帧、或响应体结构不符合预期 |
| `ConnectionError` | HTTP / WebSocket 的拨号、读写、fetch 失败 |
| `NotConnectedError` | 客户端尚未连上就尝试发 WS RPC |
| `DisconnectedError` | 已建立连接中断，导致 pending RPC 失败 |
| `ClosedError` | 客户端已显式关闭后继续操作 |

### `ServerError` 的两种范围

- `requestId !== "0"`：请求级错误，只会拒绝对应 RPC
- `requestId === "0"`：连接级错误，通常意味着登录阶段或无请求上下文的服务端错误

测试已经覆盖了“响应乱序但按 `request_id` 精确路由错误”的行为，因此可以安全并发多个 RPC。

### 超时的真实语义

所有 `RequestOptions.timeoutMs` 都只是“本地等待超时”，不是服务端取消：

- 对 RPC 而言，超时后当前 Promise 会失败；如果服务端稍后才回包，SDK 会因为 pending 已清理而直接忽略那份晚到响应
- 对 `connect()` 而言，超时只会让这次 `await connect()` 失败，但后台 run loop 仍可能继续重连并最终连上

如果你在 `connect({ timeoutMs })` 超时后决定彻底放弃，记得再调用一次 `await client.close()`。

## 11. Proto 访问方式

### 通过 `proto` 命名空间访问生成对象

```ts
import { proto } from "@tursom/turntf-js";

const envelope = proto.ClientEnvelope.create({
  body: {
    oneofKind: "ping",
    ping: { requestId: "1" }
  }
});

const bytes = proto.ClientEnvelope.toBinary(envelope);
const decoded = proto.ClientEnvelope.fromBinary(bytes);
```

### 访问原始 `client.proto`

```ts
import protoPath from "@tursom/turntf-js/proto/client.proto";
```

说明：

- 当前生成脚本使用 `long_type_string`，所以生成出来的 protobuf TypeScript 类型也会尽量把长整数保留为字符串。
- SDK 自己的 `types.ts` 已经把这些字段包装成更适合业务代码的模型类型；除非你在做非常底层的协议扩展，否则优先使用 SDK 暴露的 `Client` / `HTTPClient` / `types`。

## 12. 集成建议

- 生产环境请实现自己的 `CursorStore`，不要依赖 `MemoryCursorStore`。
- 把 `handler.onMessage()` 视为持久消息的统一消费入口。
- 对瞬时包如果需要幂等，请自己按 `packetId` 做短期去重。
- 如果你计划建设“会话级路由”能力，统一使用“先 `resolveUserSessions()`，再 `sendPacket(..., { targetSession })`”的模式，不要猜测目标会话。
