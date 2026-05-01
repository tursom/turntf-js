# API 参考

本文档列出 `turntf-js` SDK 的所有公开类型、方法和常量。

## 包入口

```ts
import {
  // 客户端
  Client,
  HTTPClient,
  ClientOptions,

  // 回调
  Handler,
  NopHandler,
  LoginInfo,

  // 存储
  CursorStore,
  MemoryCursorStore,

  // 密码
  PasswordInput,
  PasswordSource,
  hashPassword,
  plainPassword,
  plainPasswordSync,
  hashedPassword,
  validatePassword,
  passwordWireValue,

  // 类型
  Credentials,
  UserRef,
  SessionRef,
  MessageCursor,
  User,
  Message,
  Packet,
  RelayAccepted,
  DeliveryMode,
  AttachmentType,
  Attachment,
  UserMetadata,
  UserMetadataScanResult,
  Subscription,
  BlacklistEntry,
  Event,
  ClusterNode,
  LoggedInUser,
  OnlineNodePresence,
  ResolvedSession,
  ResolveUserSessionsResult,
  OperationsStatus,
  PeerStatus,
  PeerOriginStatus,
  MessageTrimStatus,
  ProjectionStatus,
  DeleteUserResult,
  CreateUserRequest,
  UpdateUserRequest,
  UpsertUserMetadataRequest,
  ScanUserMetadataRequest,
  RequestOptions,
  SendPacketOptions,
  SendMessageInput,
  SendPacketInput,

  // 错误
  TurntfError,
  ServerError,
  ProtocolError,
  ConnectionError,
  NotConnectedError,
  DisconnectedError,
  ClosedError,

  // 工具
  proto,
  assertDecimalString,
  assertRequiredDecimalString,
  validateUserRef,
  validateSessionRef,
  validateDeliveryMode,
  validateUserMetadataKey,
  cursorForMessage
} from "@tursom/turntf-js";
```

---

## 客户端类

### `Client`

WebSocket 长连接客户端。

#### 构造函数

```ts
new Client(options: ClientOptions)
```

#### ClientOptions

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `baseUrl` | `string` | 必填 | 服务端地址，自动处理协议转换 |
| `credentials` | `Credentials` | 必填 | `{ nodeId: string; userId: string; password: PasswordInput }` |
| `cursorStore` | `CursorStore` | `MemoryCursorStore` | 消息游标持久化存储 |
| `handler` | `Handler` | `NopHandler` | 回调接收器 |
| `fetch` | `typeof fetch` | `globalThis.fetch` | 仅用于内部 HTTPClient |
| `reconnect` | `boolean` | `true` | 是否自动重连 |
| `initialReconnectDelayMs` | `number` | `1000` | 首次重连延迟（毫秒） |
| `maxReconnectDelayMs` | `number` | `30000` | 重连退避上限（毫秒） |
| `pingIntervalMs` | `number` | `30000` | Ping 间隔（毫秒） |
| `requestTimeoutMs` | `number` | `10000` | 默认 RPC 超时（毫秒） |
| `ackMessages` | `boolean` | `true` | 是否自动 Ack |
| `transientOnly` | `boolean` | `false` | 仅需瞬时包 |
| `realtimeStream` | `boolean` | `false` | 使用实时流路径 |

#### 属性

| 名称 | 类型 | 说明 |
|---|---|---|
| `http` | `HTTPClient` | 内置 HTTP 客户端 |
| `baseUrl` | `string` | 当前 base URL（只读） |
| `sessionRef` | `SessionRef \| undefined` | 当前会话引用，断线后为 undefined |

#### 方法

**生命周期**

```ts
connect(options?: RequestOptions): Promise<void>
close(): Promise<void>
```

**协议**

```ts
ping(options?: RequestOptions): Promise<void>
```

**消息**

```ts
sendMessage(target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message>
postMessage(target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message>
sendPacket(target: UserRef, body: Uint8Array, deliveryMode: DeliveryMode, options?: SendPacketOptions): Promise<RelayAccepted>
postPacket(target: UserRef, body: Uint8Array, deliveryMode: DeliveryMode, options?: SendPacketOptions): Promise<RelayAccepted>
```

**用户管理**

```ts
createUser(request: CreateUserRequest, options?: RequestOptions): Promise<User>
createChannel(request: Omit<CreateUserRequest, "role"> & Partial<Pick<CreateUserRequest, "role">>, options?: RequestOptions): Promise<User>
getUser(target: UserRef, options?: RequestOptions): Promise<User>
updateUser(target: UserRef, request: UpdateUserRequest, options?: RequestOptions): Promise<User>
deleteUser(target: UserRef, options?: RequestOptions): Promise<DeleteUserResult>
```

**消息查询**

```ts
listMessages(target: UserRef, limit?: number, options?: RequestOptions): Promise<Message[]>
listEvents(after?: string, limit?: number, options?: RequestOptions): Promise<Event[]>
```

**集群**

```ts
listClusterNodes(options?: RequestOptions): Promise<ClusterNode[]>
listNodeLoggedInUsers(nodeId: string, options?: RequestOptions): Promise<LoggedInUser[]>
```

**会话**

```ts
resolveUserSessions(user: UserRef, options?: RequestOptions): Promise<ResolveUserSessionsResult>
```

**运维**

```ts
operationsStatus(options?: RequestOptions): Promise<OperationsStatus>
metrics(options?: RequestOptions): Promise<string>
```

**用户元数据**

```ts
getUserMetadata(owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata>
upsertUserMetadata(owner: UserRef, key: string, request: UpsertUserMetadataRequest, options?: RequestOptions): Promise<UserMetadata>
deleteUserMetadata(owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata>
scanUserMetadata(owner: UserRef, request?: ScanUserMetadataRequest, options?: RequestOptions): Promise<UserMetadataScanResult>
```

**附件（黑名单 / 订阅）**

```ts
upsertAttachment(owner: UserRef, subject: UserRef, attachmentType: AttachmentType, configJson?: Uint8Array, options?: RequestOptions): Promise<Attachment>
deleteAttachment(owner: UserRef, subject: UserRef, attachmentType: AttachmentType, options?: RequestOptions): Promise<Attachment>
listAttachments(owner: UserRef, attachmentType?: AttachmentType, options?: RequestOptions): Promise<Attachment[]>
subscribeChannel(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription>
createSubscription(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription>
unsubscribeChannel(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription>
listSubscriptions(subscriber: UserRef, options?: RequestOptions): Promise<Subscription[]>
blockUser(owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry>
unblockUser(owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry>
listBlockedUsers(owner: UserRef, options?: RequestOptions): Promise<BlacklistEntry[]>
```

---

### `HTTPClient`

无状态 HTTP JSON 客户端。使用 Bearer Token 认证。

#### 构造函数

```ts
new HTTPClient(baseUrl: string, options?: HTTPClientOptions)
```

#### HTTPClientOptions

```ts
interface HTTPClientOptions {
  fetch?: typeof fetch;  // 仅用于测试注入或代理
}
```

#### 属性

| 名称 | 类型 | 说明 |
|---|---|---|
| `baseUrl` | `string` | 当前 base URL（只读） |

#### 方法

```ts
login(nodeId: string, userId: string, password: string, options?: RequestOptions): Promise<string>
loginWithPassword(nodeId: string, userId: string, password: PasswordInput, options?: RequestOptions): Promise<string>

createUser(token: string, request: CreateUserRequest, options?: RequestOptions): Promise<User>
createChannel(token: string, request: Omit<CreateUserRequest, "role"> & Partial<Pick<CreateUserRequest, "role">>, options?: RequestOptions): Promise<User>
createSubscription(token: string, user: UserRef, channel: UserRef, options?: RequestOptions): Promise<void>

listMessages(token: string, target: UserRef, limit?: number, options?: RequestOptions): Promise<Message[]>
postMessage(token: string, target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message>

postPacket(token: string, targetNodeId: string, relayTarget: UserRef, body: Uint8Array, mode: DeliveryMode, options?: RequestOptions): Promise<void>

listClusterNodes(token: string, options?: RequestOptions): Promise<ClusterNode[]>
listNodeLoggedInUsers(token: string, nodeId: string, options?: RequestOptions): Promise<LoggedInUser[]>

blockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry>
unblockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry>
listBlockedUsers(token: string, owner: UserRef, options?: RequestOptions): Promise<BlacklistEntry[]>

getUserMetadata(token: string, owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata>
upsertUserMetadata(token: string, owner: UserRef, key: string, request: UpsertUserMetadataRequest, options?: RequestOptions): Promise<UserMetadata>
deleteUserMetadata(token: string, owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata>
scanUserMetadata(token: string, owner: UserRef, request?: ScanUserMetadataRequest, options?: RequestOptions): Promise<UserMetadataScanResult>
```

HTTPClient 不提供的方法（需使用 `Client`）：
- `resolveUserSessions()`
- `operationsStatus()`
- `metrics()`
- 按 `targetSession` 定向的瞬时包发送

---

## Handler 接口

```ts
interface Handler {
  onLogin(info: LoginInfo): void | Promise<void>;
  onMessage(message: Message): void | Promise<void>;
  onPacket(packet: Packet): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
  onDisconnect(error: unknown): void | Promise<void>;
}
```

- `NopHandler` 提供了所有方法的空实现，推荐继承它

---

## CursorStore 接口

```ts
interface CursorStore {
  loadSeenMessages(): Promise<MessageCursor[]> | MessageCursor[];
  saveMessage(message: Message): Promise<void> | void;
  saveCursor(cursor: MessageCursor): Promise<void> | void;
}
```

### MemoryCursorStore

内存实现，额外提供：

```ts
class MemoryCursorStore implements CursorStore {
  hasCursor(cursor: MessageCursor): boolean;
  message(cursor: MessageCursor): Message | undefined;
}
```

---

## 数据模型

### 基础类型

```ts
interface UserRef {
  nodeId: string;    // 十进制字符串
  userId: string;    // 十进制字符串
}

interface SessionRef {
  servingNodeId: string;  // 十进制字符串
  sessionId: string;      // 服务端分配的会话 ID
}

interface MessageCursor {
  nodeId: string;   // 十进制字符串
  seq: string;      // 十进制字符串
}

interface Credentials {
  nodeId: string;
  userId: string;
  password: PasswordInput;
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface SendPacketOptions extends RequestOptions {
  targetSession?: SessionRef;
}
```

### 用户

```ts
interface User {
  nodeId: string;
  userId: string;
  username: string;
  role: string;               // "user" | "channel" | "admin"
  profileJson: Uint8Array;    // JSON profile 的原始字节
  systemReserved: boolean;
  createdAt: string;          // HLC 时间戳
  updatedAt: string;          // HLC 时间戳
  originNodeId: string;       // 十进制字符串
}

interface CreateUserRequest {
  username: string;
  password?: PasswordInput;
  profileJson?: Uint8Array;
  role: string;
}

interface UpdateUserRequest {
  username?: string;
  password?: PasswordInput;
  profileJson?: Uint8Array;
  role?: string;
}

interface DeleteUserResult {
  status: string;
  user: UserRef;
}

interface LoginInfo {
  user: User;
  protocolVersion: string;
  sessionRef: SessionRef;
}
```

### 消息

```ts
interface Message {
  recipient: UserRef;
  nodeId: string;          // 十进制字符串
  seq: string;             // 十进制字符串
  sender: UserRef;
  body: Uint8Array;
  createdAtHlc: string;    // HLC 时间戳
}

interface Packet {
  packetId: string;             // 十进制字符串
  sourceNodeId: string;         // 十进制字符串
  targetNodeId: string;         // 十进制字符串
  recipient: UserRef;
  sender: UserRef;
  body: Uint8Array;
  deliveryMode: DeliveryMode;
  targetSession?: SessionRef;
}

interface RelayAccepted {
  packetId: string;             // 十进制字符串
  sourceNodeId: string;         // 十进制字符串
  targetNodeId: string;         // 十进制字符串
  recipient: UserRef;
  deliveryMode: DeliveryMode;
  targetSession?: SessionRef;
}

interface SendMessageInput {
  target: UserRef;
  body: Uint8Array;
}

interface SendPacketInput {
  target: UserRef;
  body: Uint8Array;
  deliveryMode: DeliveryMode;
  targetSession?: SessionRef;
}
```

### 附件、订阅与黑名单

```ts
interface Attachment {
  owner: UserRef;
  subject: UserRef;
  attachmentType: AttachmentType;
  configJson: Uint8Array;
  attachedAt: string;
  deletedAt: string;        // 空字符串表示未删除
  originNodeId: string;     // 十进制字符串
}

interface Subscription {
  subscriber: UserRef;
  channel: UserRef;
  subscribedAt: string;
  deletedAt: string;
  originNodeId: string;
}

interface BlacklistEntry {
  owner: UserRef;
  blocked: UserRef;
  blockedAt: string;
  deletedAt: string;
  originNodeId: string;
}
```

### 用户元数据

```ts
interface UserMetadata {
  owner: UserRef;
  key: string;
  value: Uint8Array;
  updatedAt: string;
  deletedAt: string;
  expiresAt: string;
  originNodeId: string;
}

interface UpsertUserMetadataRequest {
  value: Uint8Array;
  expiresAt?: string;
}

interface ScanUserMetadataRequest {
  prefix?: string;
  after?: string;
  limit?: number;
}

interface UserMetadataScanResult {
  items: UserMetadata[];
  count: number;
  nextAfter: string;
}
```

### 集群相关

```ts
interface ClusterNode {
  nodeId: string;          // 十进制字符串
  isLocal: boolean;
  configuredUrl: string;
  source: string;
}

interface LoggedInUser {
  nodeId: string;          // 十进制字符串
  userId: string;          // 十进制字符串
  username: string;
}
```

### 会话解析

```ts
interface OnlineNodePresence {
  servingNodeId: string;   // 十进制字符串
  sessionCount: number;
  transportHint: string;
}

interface ResolvedSession {
  session: SessionRef;
  transport: string;
  transientCapable: boolean;
}

interface ResolveUserSessionsResult {
  user: UserRef;
  presence: OnlineNodePresence[];
  sessions: ResolvedSession[];
}
```

### 事件

```ts
interface Event {
  sequence: string;             // 十进制字符串
  eventId: string;              // 十进制字符串
  eventType: string;
  aggregate: string;
  aggregateNodeId: string;      // 十进制字符串
  aggregateId: string;          // 十进制字符串
  hlc: string;
  originNodeId: string;         // 十进制字符串
  eventJson: Uint8Array;
}
```

### 运维状态

```ts
interface OperationsStatus {
  nodeId: string;                 // 十进制字符串
  messageWindowSize: number;
  lastEventSequence: string;      // 十进制字符串
  writeGateReady: boolean;
  conflictTotal: string;          // 十进制字符串
  messageTrim: MessageTrimStatus;
  projection: ProjectionStatus;
  peers: PeerStatus[];
}

interface MessageTrimStatus {
  trimmedTotal: string;
  lastTrimmedAt: string;
}

interface ProjectionStatus {
  pendingTotal: string;
  lastFailedAt: string;
}

interface PeerStatus {
  nodeId: string;
  configuredUrl: string;
  source: string;
  discoveredUrl: string;
  discoveryState: string;
  lastDiscoveredAt: string;
  lastConnectedAt: string;
  lastDiscoveryError: string;
  connected: boolean;
  sessionDirection: string;
  origins: PeerOriginStatus[];
  pendingSnapshotPartitions: number;
  remoteSnapshotVersion: string;
  remoteMessageWindowSize: number;
  clockOffsetMs: string;
  lastClockSync: string;
  snapshotDigestsSentTotal: string;
  snapshotDigestsReceivedTotal: string;
  snapshotChunksSentTotal: string;
  snapshotChunksReceivedTotal: string;
  lastSnapshotDigestAt: string;
  lastSnapshotChunkAt: string;
}

interface PeerOriginStatus {
  originNodeId: string;
  ackedEventId: string;
  appliedEventId: string;
  unconfirmedEvents: string;
  cursorUpdatedAt: string;
  remoteLastEventId: string;
  pendingCatchup: boolean;
}
```

---

## 常量

### DeliveryMode

```ts
const DeliveryMode = {
  Unspecified: "",           // 未指定
  BestEffort: "best_effort", // 尽最大努力投递
  RouteRetry: "route_retry"  // 路由重试投递
} as const;
```

仅 `BestEffort` 和 `RouteRetry` 可用于 `sendPacket()`。

### AttachmentType

```ts
const AttachmentType = {
  ChannelManager: "channel_manager",           // 频道管理员
  ChannelWriter: "channel_writer",             // 频道写者
  ChannelSubscription: "channel_subscription", // 频道订阅
  UserBlacklist: "user_blacklist"              // 用户黑名单
} as const;
```

---

## 密码工具

```ts
interface PasswordInput {
  source: PasswordSource;   // "plain" | "hashed"
  encoded: string;          // bcrypt 哈希或已有哈希值
}

type PasswordSource = "plain" | "hashed";

// 异步 bcrypt 哈希（推荐）
function plainPassword(plain: string): Promise<PasswordInput>;

// 同步 bcrypt 哈希
function plainPasswordSync(plain: string): PasswordInput;

// 直接使用已有哈希值
function hashedPassword(hash: string): PasswordInput;

// 获取线上传输值
function passwordWireValue(password: PasswordInput): string;

// 校验格式
function validatePassword(password: PasswordInput): void;

// 异步计算 bcrypt 哈希（底层实现）
function hashPassword(plain: string): Promise<string>;
```

---

## 错误类型

```ts
class TurntfError extends Error {
  name: string;
}

class ServerError extends TurntfError {
  code: string;           // 服务端错误码
  requestId: string;      // 原始请求 ID，"0" 表示连接级错误
  serverMessage: string;  // 服务端错误描述
  unauthorized(): boolean; // 检查是否是 "unauthorized" 错误
}

class ProtocolError extends TurntfError {
  protocolMessage: string;  // 原始协议错误描述
}

class ConnectionError extends TurntfError {
  op: string;           // 操作名称（"dial" / "read" / "write" / "GET /path" 等）
  cause?: unknown;      // 底层错误原因
}

class NotConnectedError extends TurntfError {}

class DisconnectedError extends TurntfError {}

class ClosedError extends TurntfError {}
```

错误继承关系：

```
Error
 └─ TurntfError
      ├─ ServerError
      ├─ ProtocolError
      ├─ ConnectionError
      ├─ NotConnectedError
      ├─ DisconnectedError
      └─ ClosedError
```

---

## Proto 命名空间

```ts
import { proto } from "@tursom/turntf-js";

// proto 包含所有从 client.proto 生成的消息类型和枚举
proto.ClientEnvelope;        // MessageType<ClientEnvelope>
proto.ServerEnvelope;        // MessageType<ServerEnvelope>
proto.LoginRequest;          // MessageType<LoginRequest>
proto.LoginResponse;         // MessageType<LoginResponse>
proto.SendMessageRequest;    // MessageType<SendMessageRequest>
proto.SendMessageResponse;   // MessageType<SendMessageResponse>
proto.MessagePushed;         // MessageType<MessagePushed>
proto.PacketPushed;          // MessageType<PacketPushed>
proto.AckMessage;            // MessageType<AckMessage>
proto.Ping;                  // MessageType<Ping>
proto.Pong;                  // MessageType<Pong>
proto.Error;                 // MessageType<Error>
proto.UserRef;               // MessageType<UserRef>
proto.User;                  // MessageType<User>
proto.Message;               // MessageType<Message>
proto.Packet;                // MessageType<Packet>
proto.SessionRef;            // MessageType<SessionRef>
proto.Attachment;            // MessageType<Attachment>
proto.UserMetadata;          // MessageType<UserMetadata>
proto.Event;                 // MessageType<Event>
proto.ClusterNode;           // MessageType<ClusterNode>
proto.LoggedInUser;          // MessageType<LoggedInUser>
proto.OperationsStatus;      // MessageType<OperationsStatus>
proto.PeerStatus;            // MessageType<PeerStatus>
// ... 以及其他所有 protobuf 类型

// 枚举
proto.ClientDeliveryKind;     // 枚举：PERSISTENT / TRANSIENT
proto.ClientDeliveryMode;     // 枚举：BEST_EFFORT / ROUTE_RETRY
proto.AttachmentType;         // 枚举：CHANNEL_MANAGER / CHANNEL_WRITER / ...
```

每个 MessageType 提供：
- `create(partial?)` — 创建消息实例
- `toBinary(message)` — 序列化为二进制
- `fromBinary(bytes)` — 从二进制反序列化

---

## 验证函数

```ts
// 十进制字符串校验
function assertDecimalString(value: string, field: string): void;
function assertRequiredDecimalString(value: string, field: string): void;

// 引用校验
function validateUserRef(ref: UserRef, field?: string): void;
function validateSessionRef(ref: SessionRef, field?: string): void;

// 投递模式校验
function validateDeliveryMode(mode: DeliveryMode): void;

// 元数据 key 校验
function validateUserMetadataKey(value: string, field?: string): void;

// 从 Message 提取游标
function cursorForMessage(message: Message): MessageCursor;
```

---

## HTTP JSON 映射

HTTPClient 内部将请求参数映射为以下 JSON 字段命名风格（snake_case），在 `postPacket` 等方法的 JSON body 中：

| SDK 字段 | JSON 字段 |
|---|---|
| `node_id` | 查询/路径参数 |
| `user_id` | 查询/路径参数 |
| `password` | body 中的 `password` |
| `delivery_kind` | body 中的 `"persistent"` / `"transient"` |
| `delivery_mode` | body 中的投递模式字符串 |
| `body` | body 中的 Base64 编码 |
| `trigger_after_commit` | body 中的可选参数 |

HTTP JSON 使用 `json-bigint` 解析，大整数自动转为十进制字符串。
