# turntf-js 代理指南

## 项目概览

`turntf-js` 是 turntf 分布式通知服务的 Node.js / TypeScript SDK，面向 Node.js 20+ 运行时。SDK 同时覆盖两条协议线：

- **HTTP JSON 管理/查询接口**：通过 `HTTPClient` 提供无状态请求封装，使用 Bearer Token 认证。
- **WebSocket + Protobuf 实时接口**：通过 `Client` 提供长连接客户端，支持首帧密码登录、消息推送、自动重连、游标持久化与瞬时包定向发送。

SDK 中的所有 64 位整数 ID（`nodeId`、`userId`、`seq`、`packetId` 等）一律以十进制字符串暴露，避免 JavaScript `number` 精度丢失。

本仓库以 submodule 形式挂载在 `turntf` monorepo 的 `sdk/turntf-js/` 下，但本身是独立仓库，拥有自己的 CI/CD 流程。

## 构建与测试命令

所有命令在 `turntf-js/` 目录下执行：

```bash
npm ci                     # 安装锁定依赖
npm run typecheck          # tsc --noEmit 类型检查
npm test                   # vitest run 运行测试
npm run build              # tsup 构建：输出 ESM、CJS 与 .d.ts
npm run pack:check         # npm pack --dry-run，检查发布包内容
npm run prepublishOnly     # 发布前自动执行：typecheck + test + build
```

### 构建产出

- `dist/index.mjs` — ESM 入口
- `dist/index.cjs` — CJS 入口
- `dist/index.d.ts` — 类型声明
- 对应 `.js.map` sourcemap

打包配置详见 `tsup.config.ts`，使用 `tsup` 构建，target 为 `node20`。

### 测试

测试框架：`vitest` 2.x，配置见 `vitest.config.ts`。

测试文件位于 `test/` 目录：

- `test/smoke.test.ts` — 入口导出与基础 smoke 测试，验证核心符号是否导出、`proto` 命名空间是否可用、`MemoryCursorStore` 状态隔离
- `test/client.test.ts` — 1388 行，是主要测试文件，覆盖：
  - WebSocket 连接、首帧登录、`sessionRef` 暴露
  - `MessagePushed` 的自动 ack 与 `CursorStore` 持久化顺序
  - `sendMessage()` 返回的持久消息落 `CursorStore`
  - `ping()` / `pong`
  - `transientOnly` 与 `realtimeStream`
  - `unauthorized` 登录失败后停止重连
  - 重连时从 `loadSeenMessages()` 恢复 `seen_messages`
  - 常见管理/查询 RPC
  - `resolveUserSessions()` 与按 `targetSession` 定向 `sendPacket()`
  - 请求乱序时按 `request_id` 精确路由
  - 独立请求超时
  - 非二进制帧与非法 protobuf 帧的 `ProtocolError`
- `test/http.test.ts` — HTTPClient 的单元测试，使用 mock fetch 验证 metadata 编解码

### 使用完整后端测试

`test/client.test.ts` 的 `TestServer` 是一个集成在测试文件中的本地 WebSocket 服务端模拟器，使用 `node:http` + `ws` 库在随机端口启动。它模拟服务端行为并在测试间隔离。添加新协议支持时，需要同时在 `TestServer` 中注册对应的 ServerEnvelope 发送逻辑。

## Proto 生成

### 触发生成

```bash
npm run gen:proto
```

### 流程

1. `protoc` 调用 `@protobuf-ts/plugin`，读取 `proto/client.proto`，生成 `src/generated/client.ts`
2. 运行 `scripts/postprocess-generated.mjs` 做后处理，给 MessageType 方法添加 `override` 关键字，修复索引访问类型的非空断言

### 前提条件

- 机器上需安装 `protoc`（protobuf 编译器）
- `@protobuf-ts/plugin` 在 devDependencies 中（v2.11.1）

### 生成参数

- `long_type_string`：所有 `int64`/`uint64` 字段生成为 `string` 类型，与 SDK 的十进制字符串策略一致
- 输出目录：`src/generated/`

### 修改 proto 的注意事项

- 修改 `proto/client.proto` 后必须重新生成，并确保生成的 TypeScript 代码与 SDK 公开类型同步更新
- `src/types.ts` 中的业务类型与 `src/generated/client.ts` 中的 protobuf 类型之间通过 `src/mapping.ts` 做转换层，避免上层代码直接依赖生成代码
- 涉及 `sessionRef`、`AckMessage`、`resolveUserSessions`、`targetSession`、`transientOnly`、`realtimeStream` 的协议改动，应同时核对服务端文档和其他 SDK

### 原始 proto 发布

原始 `.proto` 文件会随包一起发布，可以通过以下方式在业务代码中访问：

```ts
import protoPath from "@tursom/turntf-js/proto/client.proto";
```

## 模块结构

```
turntf-js/
├── proto/
│   └── client.proto              # Protobuf 协议定义（package notifier.client.v1）
├── src/
│   ├── index.ts                  # 包入口，re-export 所有公开符号
│   ├── client.ts                 # WebSocket 长连接客户端 Client
│   ├── http.ts                   # HTTP JSON 客户端 HTTPClient
│   ├── types.ts                  # 对业务友好的公开类型定义
│   ├── mapping.ts                # Protobuf 类型 <-> SDK 业务类型 转换函数
│   ├── password.ts               # 密码处理：bcrypt 哈希、PasswordInput 包装
│   ├── store.ts                  # CursorStore 接口与 MemoryCursorStore 实现
│   ├── errors.ts                 # 自定义错误类型层次
│   ├── validation.ts             # 参数校验：十进制字符串、UserRef、DeliveryMode 等
│   ├── utils.ts                  # 工具函数：JSON BigInt、Base64、UTF-8、Deferred、Abort 合并
│   └── generated/
│       └── client.ts             # 由 protoc + @protobuf-ts/plugin 自动生成
├── scripts/
│   └── postprocess-generated.mjs # 生成代码后处理
├── test/
│   ├── client.test.ts            # Client 集成测试
│   ├── http.test.ts              # HTTPClient 单元测试
│   └── smoke.test.ts             # 入口导出 smoke 测试
├── dist/                         # 构建产出（不提交）
├── .github/workflows/
│   ├── ci.yml                    # 每次 push master / PR 时跑验证
│   └── publish.yml               # 推送 v* tag 时触发发布
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## 关键 API 表面

### `Client`（入口：`src/client.ts`）

WebSocket 长连接客户端。封装了连接管理、自动重连、消息持久化、ping、RPC 调用等全部实时通信能力。

**构造参数**（`ClientOptions`）：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `baseUrl` | 必填 | 服务端地址，支持 `http://` / `https://` / `ws://` / `wss://` |
| `credentials` | 必填 | 包含 `nodeId`、`userId`、`password: PasswordInput` |
| `cursorStore` | `MemoryCursorStore` | 持久消息游标存储 |
| `handler` | `NopHandler` | 回调接收器 |
| `fetch` | `globalThis.fetch` | 内部 HTTPClient 的 fetch 实现 |
| `reconnect` | `true` | 是否自动重连 |
| `initialReconnectDelayMs` | `1000` | 首次重连延迟（毫秒） |
| `maxReconnectDelayMs` | `30000` | 重连指数退避上限（毫秒） |
| `pingIntervalMs` | `30000` | 自动 ping 间隔（毫秒） |
| `requestTimeoutMs` | `10000` | 默认 RPC 超时（毫秒） |
| `ackMessages` | `true` | 收到持久消息后是否自动发 AckMessage |
| `transientOnly` | `false` | 首帧声明仅需瞬时包 |
| `realtimeStream` | `false` | 使用 `/ws/realtime` 路径 |

**核心方法**：

- `connect(options?)` — 建立 WebSocket 连接并等待首帧登录成功
- `close()` — 关闭客户端，可重复调用
- `ping(options?)` — 发送 Ping RPC
- `sendMessage(target, body, options?)` — 发送持久消息
- `sendPacket(target, body, deliveryMode, options?)` — 发送瞬时包，支持 `targetSession` 定向
- `postMessage(target, body, options?)` — `sendMessage` 别名
- `postPacket(target, body, deliveryMode, options?)` — `sendPacket` 别名
- `resolveUserSessions(user, options?)` — 解析目标用户的在线会话
- `createUser(request, options?)` — 创建用户
- `createChannel(request, options?)` — 创建频道
- `getUser(target, options?)` — 查询用户
- `updateUser(target, request, options?)` — 更新用户
- `deleteUser(target, options?)` — 删除用户
- `listMessages(target, limit?, options?)` — 列出持久消息
- `listEvents(after?, limit?, options?)` — 列出事件
- `listClusterNodes(options?)` — 列出集群节点
- `listNodeLoggedInUsers(nodeId, options?)` — 列出节点上已登录用户
- `operationsStatus(options?)` — 查询运维状态
- `metrics(options?)` — 获取 Metrics 文本
- `getUserMetadata(owner, key, options?)` — 查询用户元数据
- `upsertUserMetadata(owner, key, request, options?)` — 写入用户元数据
- `deleteUserMetadata(owner, key, options?)` — 删除用户元数据
- `scanUserMetadata(owner, request?, options?)` — 扫描用户元数据
- `upsertAttachment(owner, subject, type, config?, options?)` — 写入附件关系
- `deleteAttachment(owner, subject, type, options?)` — 删除附件关系
- `listAttachments(owner, type?, options?)` — 列出附件关系
- `subscribeChannel(subscriber, channel, options?)` — 订阅频道
- `createSubscription(subscriber, channel, options?)` — `subscribeChannel` 别名
- `unsubscribeChannel(subscriber, channel, options?)` — 取消订阅
- `listSubscriptions(subscriber, options?)` — 列出订阅
- `blockUser(owner, blocked, options?)` — 拉黑用户
- `unblockUser(owner, blocked, options?)` — 取消拉黑
- `listBlockedUsers(owner, options?)` — 列出黑名单

**属性**：

- `http: HTTPClient` — 内置 HTTP 客户端，用于混合场景
- `baseUrl: string` — 当前 base URL
- `sessionRef: SessionRef | undefined` — 当前会话引用，断线后清空

### `HTTPClient`（入口：`src/http.ts`）

无状态 HTTP JSON 客户端，使用 Bearer Token 认证。

**构造参数**：

- `baseUrl: string` — 服务端地址
- `options.fetch?` — 自定义 fetch 实现（测试注入或代理）

**核心方法**：

- `login(nodeId, userId, password, options?)` — 密码登录获取 token（内部调用 `loginWithPassword`）
- `loginWithPassword(nodeId, userId, password, options?)` — 使用 PasswordInput 登录
- `createUser(token, request, options?)` — 创建用户
- `createChannel(token, request, options?)` — 创建频道
- `createSubscription(token, user, channel, options?)` — 创建订阅
- `listMessages(token, target, limit?, options?)` — 列出消息
- `postMessage(token, target, body, options?)` — 发送持久消息
- `postPacket(token, targetNodeId, relayTarget, body, mode, options?)` — 发送瞬时包
- `listClusterNodes(token, options?)` — 列出集群节点
- `listNodeLoggedInUsers(token, nodeId, options?)` — 列出节点登录用户
- `blockUser(token, owner, blocked, options?)` — 拉黑
- `unblockUser(token, owner, blocked, options?)` — 取消拉黑
- `listBlockedUsers(token, owner, options?)` — 列出黑名单
- `getUserMetadata(token, owner, key, options?)` — 查询元数据
- `upsertUserMetadata(token, owner, key, request, options?)` — 写入元数据
- `deleteUserMetadata(token, owner, key, options?)` — 删除元数据
- `scanUserMetadata(token, owner, request?, options?)` — 扫描元数据

### `Handler` 接口

```ts
interface Handler {
  onLogin(info: LoginInfo): void | Promise<void>;
  onMessage(message: Message): void | Promise<void>;
  onPacket(packet: Packet): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
  onDisconnect(error: unknown): void | Promise<void>;
}
```

`NopHandler` 提供所有方法的空实现，推荐继承它而非直接实现接口。

### `CursorStore` 接口

```ts
interface CursorStore {
  loadSeenMessages(): Promise<MessageCursor[]> | MessageCursor[];
  saveMessage(message: Message): Promise<void> | void;
  saveCursor(cursor: MessageCursor): Promise<void> | void;
}
```

`MemoryCursorStore` 提供内存实现，仅适合测试和 demo。生产环境应自行实现落盘逻辑。

### 公开类型（`src/types.ts`）

- `UserRef` — `{ nodeId: string; userId: string }`
- `SessionRef` — `{ servingNodeId: string; sessionId: string }`
- `MessageCursor` — `{ nodeId: string; seq: string }`
- `User` — 用户完整信息
- `Message` — 持久消息
- `Packet` — 瞬时包
- `RelayAccepted` — 瞬时包路由确认
- `Attachment` — 附件关系
- `Subscription` — 频道订阅
- `BlacklistEntry` — 黑名单条目
- `Event` — 事件
- `ClusterNode` — 集群节点
- `LoggedInUser` — 在线用户
- `OnlineNodePresence` — 在线节点概况
- `ResolvedSession` — 解析出的在线会话
- `ResolveUserSessionsResult` — 会话解析结果
- `OperationsStatus` — 运维状态（含集群 Peer 详情）
- `PeerStatus` / `PeerOriginStatus` — 节点互联状态
- `MessageTrimStatus` / `ProjectionStatus` — 消息修剪/投影状态
- `UserMetadata` — 用户 KV 元数据
- `UserMetadataScanResult` — 元数据扫描结果
- `LoginInfo` — 登录响应信息
- `DeliveryMode` — 瞬时包投递模式（`BestEffort` / `RouteRetry`）
- `AttachmentType` — 附件类型常量（`ChannelManager` / `ChannelWriter` / `ChannelSubscription` / `UserBlacklist`）
- `Credentials` — 登录凭证
- `CreateUserRequest` / `UpdateUserRequest` — 用户创建/更新请求
- `UpsertUserMetadataRequest` / `ScanUserMetadataRequest` — 元数据请求
- `RequestOptions` — `{ signal?: AbortSignal; timeoutMs?: number }`
- `SendPacketOptions` — `RequestOptions` 扩展 `{ targetSession?: SessionRef }`
- `SendMessageInput` / `SendPacketInput` — 消息/包输入
- `DeleteUserResult` — 删除用户结果

### 错误类型（`src/errors.ts`）

所有错误继承自 `TurntfError`（继承 `Error`）：

| 类型 | 说明 |
|---|---|
| `ServerError` | 服务端返回 `ServerEnvelope.error`，含 `code`、`serverMessage`、`requestId` |
| `ProtocolError` | 协议层错误：文本帧、非法 protobuf、响应结构不符合预期 |
| `ConnectionError` | 网络连接错误（HTTP fetch / WebSocket 拨号/读写） |
| `NotConnectedError` | 客户端未连接时尝试 WS RPC |
| `DisconnectedError` | 已建立连接中断导致 pending RPC 失败 |
| `ClosedError` | 客户端已显式关闭后继续操作 |

### 密码辅助（`src/password.ts`）

- `plainPassword(plain: string): Promise<PasswordInput>` — 异步 bcrypt 哈希
- `plainPasswordSync(plain: string): PasswordInput` — 同步 bcrypt 哈希
- `hashedPassword(hash: string): PasswordInput` — 直接使用已有哈希
- `passwordWireValue(password: PasswordInput): string` — 获取线上传输值
- `validatePassword(password: PasswordInput): void` — 校验格式

### Proto 命名空间

通过 `import { proto } from "@tursom/turntf-js"` 访问所有 protobuf 生成类型，包括 `ClientEnvelope`、`ServerEnvelope`、枚举编码器、MessageType `create`/`toBinary`/`fromBinary` 等方法。

## 发布流程

### 发布目标

GitHub Packages（`@tursom/turntf-js`）：

```json
{
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### 自动发布（推荐）

推送 `v*` tag 触发 `.github/workflows/publish.yml`：

```bash
npm version patch      # 自动更新 package.json 版本并创建 git tag
git push origin master --follow-tags
```

CI 流程：
1. `npm ci`
2. 校验 tag 去掉 `v` 前缀后与 `package.json.version` 一致
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. `npm publish`
7. 自动创建 GitHub Release

### 手动发布

```bash
npm run typecheck
npm test
npm run build
npm run pack:check
npm version patch
git push origin master --follow-tags
```

如果确实需要手动 `npm publish`，会先触发 `prepublishOnly` 脚本做类型检查、测试和构建。

### 消费者配置

在 `.npmrc` 中配置：

```ini
@tursom:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 发布前自检清单

- `README.md` 和 `docs/` 是否与当前实现一致
- 改动是否影响 `HTTPClient` 与 `Client` 的职责边界
- 如果改了消息可靠性语义，是否覆盖了 `saveMessage -> saveCursor -> ack -> onMessage`
- 如果改了瞬时包能力，是否检查了 `resolveUserSessions()` 与 `targetSession`
- 如果改了 proto，是否重新生成 `src/generated/client.ts` 并更新映射
- `package.json.version` 是否与预期 tag 匹配
- `npm run pack:check` 检查发布包内容是否符合预期

## 代码约定

### 风格与 TypeScript

- 使用严格模式 TypeScript，详见 `tsconfig.json`
- `strict: true`、`noImplicitOverride: true`、`noUncheckedIndexedAccess: true`、`exactOptionalPropertyTypes: true`
- target `ES2022`，module `ESNext`，moduleResolution `Bundler`
- 包格式为 ESM + CJS 双入口，通过 `tsup` 构建

### 命名

- 类名使用 PascalCase
- 接口名使用 PascalCase（无 `I` 前缀）
- 函数、方法、变量使用 camelCase
- 常量（`DeliveryMode`、`AttachmentType` 等）使用 PascalCase 对象 + `as const`
- 私有字段使用普通命名（不要求 `_` 前缀，但语义需清晰）
- protobuf 生成的类型在 `generated/client.ts` 中，不直接对外暴露
- 64 位 ID 字段在业务类型中统一为 `string`

### 模块导入

- 包内导入使用相对路径
- 按类型分层引用：`client.ts` -> `errors.ts` / `http.ts` / `mapping.ts` / `types.ts` 等
- 生成代码（`generated/client.ts`）仅由 `client.ts` 和 `mapping.ts` 引用

### 错误处理

- SDK 内部异常使用自定义错误类型层次（继承 `TurntfError`）
- Handler 回调中的异常会被 SDK 吞掉（`safeHandlerCall`），不会打崩客户端
- RPC 请求级错误通过 `ServerError(requestId !== "0")` 精确路由
- 连接级错误通过 `ServerError(requestId === "0")` 标识
- `ConnectionError` 统一包装底层网络异常

### 异步约定

- public API 全部返回 `Promise`
- 内部使用 `createDeferred<T>()` 实现手动控制的 Promise
- 写操作通过 `writeChain` 串行化，保证帧顺序
- RPC 使用 `requestId` 映射到 Deferred，支持乱序响应

### 测试约定

- 优先在 `test/client.test.ts` 的 `TestServer` 中添加新协议支持
- HTTPClient 测试使用自定义 `fetch` mock，不依赖真实网络
- 测试中使用 `RecordingStore` 和 `RecordingHandler` 验证调用参数与顺序
- 所有超时参数在测试中缩短，避免测试挂起

## 提交约定

- 提交消息使用英文
- 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
  - `feat:` — 新功能
  - `fix:` — 修复
  - `chore:` — 构建/工具/依赖变更
  - `docs:` — 文档变更
  - `test:` — 测试变更
  - `refactor:` — 代码重构
  - `style:` — 代码格式
- 提交作者必须是 `tursom <tursom@foxmail.com>`
- 涉及协议或跨 SDK 共享语义的变更，在提交消息中注明影响范围
- 如果修改 proto，确保生成代码、映射层、公开类型和测试同步更新
- 推送前确保 `npm run typecheck` 和 `npm test` 通过
