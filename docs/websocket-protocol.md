# WebSocket 协议详情

本文档说明 `turntf-js` SDK 使用的 WebSocket + Protobuf 协议细节，包括帧格式、Envelope 结构、RPC 语义和会话管理。

## 1. 协议概览

`turntf-js` SDK 通过 WebSocket 连接与服务端通信，所有消息以 protobuf 编码的二进制帧传输。

- **传输层**：WebSocket（`ws` 库）
- **序列化**：Protocol Buffers（proto3）
- **包名**：`notifier.client.v1`
- **协议版本**：`client-v1alpha1`
- **帧格式**：二进制帧（`opcode = 2`），文本帧被视为协议错误

## 2. Envelope 结构

所有通信通过 `ClientEnvelope`（客户端 -> 服务端）和 `ServerEnvelope`（服务端 -> 客户端）两个顶级消息完成。

### 2.1 ClientEnvelope（客户端发出）

```protobuf
message ClientEnvelope {
  oneof body {
    LoginRequest login = 1;
    SendMessageRequest send_message = 2;
    AckMessage ack_message = 3;
    Ping ping = 4;
    CreateUserRequest create_user = 5;
    GetUserRequest get_user = 6;
    UpdateUserRequest update_user = 7;
    DeleteUserRequest delete_user = 8;
    ListMessagesRequest list_messages = 9;
    UpsertUserAttachmentRequest upsert_user_attachment = 10;
    DeleteUserAttachmentRequest delete_user_attachment = 11;
    ListUserAttachmentsRequest list_user_attachments = 12;
    ListEventsRequest list_events = 13;
    OperationsStatusRequest operations_status = 14;
    MetricsRequest metrics = 15;
    ListClusterNodesRequest list_cluster_nodes = 16;
    ListNodeLoggedInUsersRequest list_node_logged_in_users = 17;
    ResolveUserSessionsRequest resolve_user_sessions = 18;
    GetUserMetadataRequest get_user_metadata = 19;
    UpsertUserMetadataRequest upsert_user_metadata = 20;
    DeleteUserMetadataRequest delete_user_metadata = 21;
    ScanUserMetadataRequest scan_user_metadata = 22;
  }
}
```

### 2.2 ServerEnvelope（服务端发出）

```protobuf
message ServerEnvelope {
  oneof body {
    LoginResponse login_response = 1;
    MessagePushed message_pushed = 2;
    SendMessageResponse send_message_response = 3;
    Error error = 4;
    Pong pong = 5;
    PacketPushed packet_pushed = 6;
    CreateUserResponse create_user_response = 7;
    GetUserResponse get_user_response = 8;
    UpdateUserResponse update_user_response = 9;
    DeleteUserResponse delete_user_response = 10;
    ListMessagesResponse list_messages_response = 11;
    UpsertUserAttachmentResponse upsert_user_attachment_response = 12;
    DeleteUserAttachmentResponse delete_user_attachment_response = 13;
    ListUserAttachmentsResponse list_user_attachments_response = 14;
    ListEventsResponse list_events_response = 15;
    OperationsStatusResponse operations_status_response = 16;
    MetricsResponse metrics_response = 17;
    ListClusterNodesResponse list_cluster_nodes_response = 18;
    ListNodeLoggedInUsersResponse list_node_logged_in_users_response = 19;
    ResolveUserSessionsResponse resolve_user_sessions_response = 20;
    GetUserMetadataResponse get_user_metadata_response = 21;
    UpsertUserMetadataResponse upsert_user_metadata_response = 22;
    DeleteUserMetadataResponse delete_user_metadata_response = 23;
    ScanUserMetadataResponse scan_user_metadata_response = 24;
  }
}
```

## 3. 连接生命周期

### 3.1 握手阶段

```
客户端                            服务端
  |                                |
  |--- WebSocket 握手 ------------>|
  |<-- 101 Switching Protocols ----|
  |                                |
  |--- ClientEnvelope.login ---->|  (首帧必须是 login)
  |<-- ServerEnvelope.login_response -- 或 -- ServerEnvelope.error
  |                                |
  |--- ... 正常通信 ... ---------->|
```

### 3.2 登录请求

`LoginRequest` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `user` | `UserRef` | 登录用户标识（nodeId + userId） |
| `password` | `string` | bcrypt 哈希后的密码值 |
| `seen_messages` | `repeated MessageCursor` | 已确认落盘的消息游标列表 |
| `transient_only` | `bool` | 是否仅接受瞬时包（跳过持久消息补发和推送） |

`UserRef` 结构：

```protobuf
message UserRef {
  int64 node_id = 1;
  int64 user_id = 2;
}
```

`MessageCursor` 结构：

```protobuf
message MessageCursor {
  int64 node_id = 1;
  int64 seq = 2;
}
```

### 3.3 登录响应

成功时，服务端返回 `LoginResponse`：

```protobuf
message LoginResponse {
  User user = 1;
  string protocol_version = 2;
  SessionRef session_ref = 3;
}

message SessionRef {
  int64 serving_node_id = 1;
  string session_id = 2;
}
```

失败时，返回 `Error`：

```protobuf
message Error {
  string code = 1;
  string message = 2;
  uint64 request_id = 3;
}
```

常见错误 code：
- `unauthorized`：认证失败，SDK 会停止重连
- `invalid_request`：请求格式问题，在 `realtimeStream` 模式下调用不支持的操作时返回

## 4. RPC 请求-响应模型

### 4.1 通用模式

所有 RPC 遵循相同的请求-响应模式：

1. 客户端指定 `request_id`（uint64），自增序列号
2. 服务端在处理完成后发送对应类型的响应消息，携带相同的 `request_id`
3. 响应可以是成功响应，也可以是 `Error`（通过 `Error.request_id` 匹配到原始请求）
4. `request_id = 0` 的 `Error` 是连接级错误，不属于任何具体 RPC

### 4.2 支持的操作列表

| 操作 | 请求 | 成功响应 |
|---|---|---|
| 发送持久消息 | `SendMessageRequest(delivery_kind=PERSISTENT)` | `SendMessageResponse.body.message` |
| 发送瞬时包 | `SendMessageRequest(delivery_kind=TRANSIENT)` | `SendMessageResponse.body.transient_accepted` |
| Ack | `AckMessage` | 无响应（fire-and-forget） |
| Ping | `Ping` | `Pong` |
| CreateUser | `CreateUserRequest` | `CreateUserResponse` |
| GetUser | `GetUserRequest` | `GetUserResponse` |
| UpdateUser | `UpdateUserRequest` | `UpdateUserResponse` |
| DeleteUser | `DeleteUserRequest` | `DeleteUserResponse` |
| ListMessages | `ListMessagesRequest` | `ListMessagesResponse` |
| ListEvents | `ListEventsRequest` | `ListEventsResponse` |
| ListClusterNodes | `ListClusterNodesRequest` | `ListClusterNodesResponse` |
| ListNodeLoggedInUsers | `ListNodeLoggedInUsersRequest` | `ListNodeLoggedInUsersResponse` |
| ResolveUserSessions | `ResolveUserSessionsRequest` | `ResolveUserSessionsResponse` |
| OperationsStatus | `OperationsStatusRequest` | `OperationsStatusResponse` |
| Metrics | `MetricsRequest` | `MetricsResponse` |
| 用户元数据 | 见 protobuf 定义 | 对应 Response |
| 附件操作 | 见 protobuf 定义 | 对应 Response |

### 4.3 SendMessageRequest 详解

```protobuf
message SendMessageRequest {
  uint64 request_id = 1;
  UserRef target = 2;
  bytes body = 3;
  ClientDeliveryKind delivery_kind = 4;
  ClientDeliveryMode delivery_mode = 5;
  ClientMessageSyncMode sync_mode = 6;
  SessionRef target_session = 7;
}

enum ClientDeliveryKind {
  CLIENT_DELIVERY_KIND_UNSPECIFIED = 0;
  CLIENT_DELIVERY_KIND_PERSISTENT = 1;   // 持久消息
  CLIENT_DELIVERY_KIND_TRANSIENT = 2;    // 瞬时包
}

enum ClientDeliveryMode {
  CLIENT_DELIVERY_MODE_UNSPECIFIED = 0;
  CLIENT_DELIVERY_MODE_BEST_EFFORT = 1;  // 尽最大努力
  CLIENT_DELIVERY_MODE_ROUTE_RETRY = 2;  // 路由重试
}
```

- `delivery_kind = PERSISTENT` 时，消息持久化存储，`sendMessage()` 使用此模式
- `delivery_kind = TRANSIENT` 时，消息不持久化，`sendPacket()` 使用此模式
- `delivery_mode` 仅在 `TRANSIENT` 时有意义，`PERSISTENT` 时忽略
- `target_session` 可选，指定向用户的特定会话投递瞬时包

### 4.4 推送消息

服务端可以在没有对应请求的情况下主动推送消息：

- `MessagePushed`：持久消息推送。客户端需按 `persistAndDispatchMessage` 流程处理
- `PacketPushed`：瞬时包推送。客户端直接通过 `handler.onPacket` 消费

## 5. 服务端推送消息

### 5.1 MessagePushed

接收到 `MessagePushed` 时，`Message` 对象包含：

```protobuf
message Message {
  UserRef recipient = 1;  // 接收方
  int64 node_id = 3;      // 消息所属节点
  int64 seq = 4;          // 消息序列号
  UserRef sender = 5;     // 发送方
  bytes body = 6;         // 消息体
  string created_at_hlc = 7;  // HLC 时间戳
}
```

处理流程（SDK 自动完成）：
1. `cursorStore.saveMessage(message)`
2. `cursorStore.saveCursor(cursor)`
3. 可选发送 `AckMessage`（由 `ackMessages` 选项控制）
4. `handler.onMessage(message)`

### 5.2 PacketPushed

`Packet` 对象包含：

```protobuf
message Packet {
  uint64 packet_id = 1;
  int64 source_node_id = 2;
  int64 target_node_id = 3;
  UserRef recipient = 4;
  UserRef sender = 5;
  bytes body = 6;
  ClientDeliveryMode delivery_mode = 7;
  SessionRef target_session = 8;  // 可选，目标会话
}
```

处理流程：直接调用 `handler.onPacket(packet)`，不涉及游标持久化。

## 6. AckMessage 机制

`AckMessage` 是客户端通知服务端"我已处理完某条消息"的信号：

```protobuf
message AckMessage {
  MessageCursor cursor = 1;
}
```

**注意**：在当前协议实现中，`AckMessage` 只是连接内的去重提示，**不是服务端的持久化确认**。真正的可靠恢复依赖 `LoginRequest.seen_messages` 机制——客户端在每次登录时告诉服务端已确认的游标列表。

## 7. 瞬时包与会话定向

### 7.1 会话解析

`ResolveUserSessionsRequest` 用于查询目标用户的在线会话信息：

```protobuf
message ResolveUserSessionsRequest {
  uint64 request_id = 1;
  UserRef user = 2;         // 目标用户
}

message ResolveUserSessionsResponse {
  uint64 request_id = 1;
  UserRef user = 2;
  repeated OnlineNodePresence presence = 3;  // 按节点的会话概况
  repeated ResolvedSession items = 4;         // 具体会话列表
  int32 count = 5;
}
```

`OnlineNodePresence` 描述某服务节点上的整体在线情况：

```protobuf
message OnlineNodePresence {
  int64 serving_node_id = 1;
  int32 session_count = 2;
  string transport_hint = 3;
}
```

`ResolvedSession` 描述一个具体的在线会话：

```protobuf
message ResolvedSession {
  SessionRef session = 1;
  string transport = 2;
  bool transient_capable = 3;  // 是否支持瞬时包
}
```

### 7.2 定向投递

通过 `SendMessageRequest.target_session` 字段指定目标会话。当不指定时，服务端自行按目标用户在线态路由。

路由确认通过 `TransientAccepted` 返回：

```protobuf
message TransientAccepted {
  uint64 packet_id = 1;
  int64 source_node_id = 2;
  int64 target_node_id = 3;
  UserRef recipient = 4;
  ClientDeliveryMode delivery_mode = 5;
  SessionRef target_session = 6;  // 实际接受的目标会话
}
```

## 8. realtimeStream 模式

当 `ClientOptions.realtimeStream = true` 时，连接使用 `/ws/realtime` 路径。

结合当前服务端实现，该模式的行为限制：

- 允许：`sendPacket()` / transient `sendMessage`
- 允许：`resolveUserSessions()`
- 允许：`ping()` / `listClusterNodes()` / `listNodeLoggedInUsers()`
- 不允许：持久消息发送、大部分管理/查询 RPC（服务端返回 `invalid_request`）

## 9. 错误协议

所有服务端错误通过 `Error` 消息传递：

```protobuf
message Error {
  string code = 1;
  string message = 2;
  uint64 request_id = 3;
}
```

两种范围：

| `requestId` | 含义 | 客户端行为 |
|---|---|---|
| `"0"` | 连接级错误 | SD 抛出 `ServerError`，readLoop 退出，触发重连（除非 code=unauthorized） |
| 非 `"0"` | 请求级错误 | SDK 通过 `rejectPending(requestId, ServerError)` 精确拒绝对应的 RPC |

## 10. 帧排序与并发

- SDK 通过 `writeChain` 保证**写入顺序**：所有写入操作串行执行
- 服务端和 SDK 都通过 `request_id` 匹配请求和响应，因此**响应可以乱序到达**
- `readLoop` 中收到的每个帧都立即按 `request_id` 路由到对应的 pending Deferred

## 11. transientOnly 模式

当 `transientOnly = true`，首帧 `LoginRequest.transient_only = true`。

根据当前服务端实现，这表示：
- 当前会话不需要持久消息历史补发
- 当前会话不需要持续的持久消息推送
- 仍然可以收发瞬时包
- 仍然可以使用非消息类的 RPC

适合纯瞬时流量场景，通常会结合 `realtimeStream: true` 使用。
