# turntf-js

`turntf-js` 是 turntf 的 Node.js SDK，提供两类客户端能力：

- WebSocket + Protobuf 长连接客户端
- HTTP JSON 管理与查询客户端
- 密码处理辅助方法
- 类型安全的 turntf 数据模型
- 由 `proto/client.proto` 生成的 protobuf 类型与编解码对象

## 安装

### 从 GitHub Packages 安装

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
  password: plainPasswordSync("alice-password"),
  role: "user"
};

const user = await client.createUser(token, request);

const target: UserRef = { nodeId: user.nodeId, userId: user.userId };
await client.listMessages(token, target, 20);
```

### `Client`

`Client` 是新的 WS-first 高级入口：

- HTTP 登录仍走 `client.login()` / `client.loginWithPassword()` 或 `client.http`
- 长连接登录、消息推送、自动 ack、自动重连、WS RPC 全部由 `Client` 负责

```ts
import {
  Client,
  DeliveryMode,
  MemoryCursorStore,
  NopHandler,
  plainPasswordSync,
  type LoginInfo,
  type Message
} from "@tursom/turntf-js";

class Handler extends NopHandler {
  override onLogin(info: LoginInfo): void {
    console.log("login ok", info.user.userId, info.protocolVersion, info.sessionRef.sessionId);
  }

  override onMessage(message: Message): void {
    console.log("message", message.seq, Buffer.from(message.body).toString("utf8"));
  }
}

const client = new Client({
  baseUrl: "http://127.0.0.1:8080",
  credentials: {
    nodeId: "4096",
    userId: "1025",
    password: plainPasswordSync("alice-password")
  },
  cursorStore: new MemoryCursorStore(),
  handler: new Handler()
});

await client.connect();
await client.sendMessage(
  { nodeId: "4096", userId: "1025" },
  Buffer.from("hello")
);
await client.close();
```

连接成功后，SDK 会同时暴露当前登录会话：

- `handler.onLogin(info)` 里的 `info.sessionRef`
- `client.sessionRef`

如果你要做会话定向的瞬时点对点发送，可以先解析目标用户当前在线会话，再把选中的 `targetSession` 传给 `sendPacket()`：

```ts
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
```

`Client` 公开的方法包括：

- 连接与基础能力：`connect()`、`close()`、`ping()`
- 实时发送：`sendMessage()` / `postMessage()`、`sendPacket()` / `postPacket()`；其中 `sendPacket()` 支持 `options.targetSession`
- WS RPC：`createUser()`、`getUser()`、`updateUser()`、`deleteUser()`、`subscribeChannel()`、`listMessages()`、`listEvents()`、`listClusterNodes()`、`listNodeLoggedInUsers()`、`resolveUserSessions()`、`metrics()` 等
- HTTP 直通：`client.http`

## CursorStore

`CursorStore` 是 SDK 与业务侧消息持久化之间的接缝：

```ts
interface CursorStore {
  loadSeenMessages(): Promise<MessageCursor[]> | MessageCursor[];
  saveMessage(message: Message): Promise<void> | void;
  saveCursor(cursor: MessageCursor): Promise<void> | void;
}
```

`MessagePushed` 和持久化的 `SendMessageResponse.message` 到达后，SDK 会按固定顺序执行：

1. `saveMessage`
2. `saveCursor`
3. 发送 `AckMessage`
4. 调用 `handler.onMessage`

如果只是本地测试，可以直接使用 `MemoryCursorStore`。

如果你需要直接使用生成的 protobuf 类型，可以从 `proto` 命名空间访问：

```ts
import { proto } from "@tursom/turntf-js";

const envelope = proto.ClientEnvelope.create({
  body: {
    oneofKind: "ping",
    ping: {}
  }
});
```

原始 proto 文件也会一起发布：

```ts
import protoPath from "@tursom/turntf-js/proto/client.proto";
```

## 发布流程

仓库已经附带 GitHub Actions：

- `CI`：在 `master` 分支 push / PR 时执行 `typecheck`、`test`、`build`、`pack:check`
- `Publish`：在推送 `v*` tag 时自动发布到 GitHub Packages，并创建 GitHub Release

推荐发布步骤：

```bash
npm version patch
git push origin master --follow-tags
```

工作流会校验 tag 和 `package.json` 里的版本号是否一致，例如 `v0.1.1` 对应 `0.1.1`。

如果你想手动发布到 GitHub Packages，也可以直接运行：

```bash
npm publish
```

默认会使用 `publishConfig.registry` 指向 `https://npm.pkg.github.com`。如果以后要改为发布到 npmjs.com，可以显式覆盖：

```bash
npm publish --registry https://registry.npmjs.org
```
