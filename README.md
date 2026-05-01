# turntf-js

`turntf-js` 是 turntf 的 Node.js / TypeScript SDK，面向 Node.js 20+ 运行时，提供：

- Bearer Token 驱动的 HTTP JSON 客户端 `HTTPClient`
- 密码首帧登录的 WS-first 长连接客户端 `Client`
- 密码处理辅助函数、类型安全的数据模型与 protobuf 访问入口 `proto`

SDK 里的 64 位整数 ID 一律以十进制字符串暴露，例如 `nodeId`、`userId`、`seq`、`packetId`，避免 JavaScript `number` 精度丢失。

## 文档导航

- [SDK 接入指南](docs/sdk-guide.md)
- [开发、测试与发布](docs/development.md)

## 模块定位

| 入口 | 认证方式 | 连接形态 | 适合场景 | 主要能力 |
| --- | --- | --- | --- | --- |
| `HTTPClient` | HTTP 登录换取 Bearer Token | 无状态请求 | 管理脚本、批处理、简单查询、只走 HTTP 的后端任务 | 登录、创建用户、附件/黑名单管理、列消息、发持久消息、发瞬时包、在线节点查询 |
| `Client` | WebSocket 首帧用密码登录 | 长连接 | 在线消息消费、自动重连、消息游标、瞬时包、会话定向发送 | `MessagePushed` / `PacketPushed`、自动 ack、`CursorStore`、WS RPC、`resolveUserSessions()`、`sessionRef` |

几个容易混淆的点：

- `Client` 是 WS-first 高级入口，但它仍然暴露 `client.http`，方便在同一个实例里混用 HTTP 能力。
- `HTTPClient.login()` / `loginWithPassword()` 同时支持旧 `nodeId + userId + password` 和新 `login_name + password` 两种登录方式。
- `ClientOptions.credentials` 也支持两种选择器：`{ nodeId, userId, password }` 或 `{ loginName, password }`。
- `Client.login()` / `Client.loginWithPassword()` 只是透传到内部 `HTTPClient`，用于获取 HTTP Token；真正的 WebSocket 登录发生在 `connect()` 里。
- 当前 SDK 里，`resolveUserSessions()` 与按会话定向的 `sendPacket(..., { targetSession })` 只在 `Client` 上提供。

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

```ts
import {
  HTTPClient,
  plainPasswordSync,
  type CreateUserRequest,
  type UserRef
} from "@tursom/turntf-js";

const client = new HTTPClient("http://127.0.0.1:8080");

const token = await client.loginWithPassword(
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

const user = await client.createUser(token, request);

const target: UserRef = { nodeId: user.nodeId, userId: user.userId };
const messages = await client.listMessages(token, target, 20);
console.log(messages.length);
```

### `Client`

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

class Handler extends NopHandler {
  override onLogin(info: LoginInfo): void {
    console.log("login ok", info.user.userId, info.sessionRef.sessionId);
  }

  override onMessage(message: Message): void {
    console.log("message", message.seq, Buffer.from(message.body).toString("utf8"));
  }

  override onPacket(packet: Packet): void {
    console.log("packet", packet.packetId, packet.targetSession?.sessionId);
  }
}

const client = new Client({
  baseUrl: "http://127.0.0.1:8080",
  credentials: {
    loginName: "alice.login",
    password: plainPasswordSync("alice-password")
  },
  cursorStore: new MemoryCursorStore(),
  handler: new Handler()
});

await client.connect();
console.log(client.sessionRef);

await client.sendMessage(
  { nodeId: "4096", userId: "1025" },
  Buffer.from("hello")
);

const target = { nodeId: "8192", userId: "1025" };
const resolved = await client.resolveUserSessions(target);
const session = resolved.sessions.find((item) => item.transientCapable)?.session;

if (session) {
  await client.sendPacket(
    target,
    Buffer.from("hello from one session to another"),
    DeliveryMode.RouteRetry,
    { targetSession: session }
  );
}

await client.close();
```

## 关键行为摘要

- `Client` 收到持久消息时，会按 `saveMessage -> saveCursor -> 可选 ack -> handler.onMessage` 的顺序处理。
- `sendMessage()` 返回的 `Message` 也会走同一套持久化与回调流程；如果业务已经在 `handler.onMessage` 里消费，就不要再把 `sendMessage()` 的返回值当成第二次投递。
- `PacketPushed` 是瞬时包，不会自动写入 `CursorStore`，也不参与 `AckMessage` 或重连补发。
- `sessionRef` 会同时出现在 `handler.onLogin(info).sessionRef` 和 `client.sessionRef`；断线后会被清空。

## Proto 访问

可以直接使用生成的 protobuf 类型与编解码器：

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

关于 `HTTPClient` / `Client` 的职责分工、`CursorStore`、自动重连、`sessionRef`、`resolveUserSessions()`、错误模型、测试与发布流程，见上面的两份详细文档。
