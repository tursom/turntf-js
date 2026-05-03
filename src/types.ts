import type { PasswordInput } from "./password";

/**
 * 消息投递模式常量。
 * - Unspecified: 未指定（默认值）
 * - BestEffort: 尽力投递模式，不保证一定送达
 * - RouteRetry: 路由重试模式，会进行多次重试尝试投递
 */
export const DeliveryMode = {
  Unspecified: "",
  BestEffort: "best_effort",
  RouteRetry: "route_retry"
} as const;

/**
 * 消息投递模式类型。
 * 从 DeliveryMode 常量中提取的联合类型。
 */
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

/**
 * 用户凭据，通过 nodeId 和 userId 标识用户。
 * 与 LoginNameCredentials 互斥，只能选择一种凭据方式。
 */
export interface UserCredentials {
  /** 节点 ID */
  nodeId: string;
  /** 用户 ID */
  userId: string;
  /** 登录名（此模式下不需要） */
  loginName?: never;
  /** 密码输入 */
  password: PasswordInput;
}

/**
 * 登录名凭据，通过登录名标识用户。
 * 与 UserCredentials 互斥，只能选择一种凭据方式。
 */
export interface LoginNameCredentials {
  /** 节点 ID（此模式下不需要） */
  nodeId?: never;
  /** 用户 ID（此模式下不需要） */
  userId?: never;
  /** 登录名 */
  loginName: string;
  /** 密码输入 */
  password: PasswordInput;
}

/**
 * 联合凭据类型，可以是 UserCredentials 或 LoginNameCredentials。
 */
export type Credentials = UserCredentials | LoginNameCredentials;

/**
 * 用户引用，用于在 API 调用中唯一标识一个用户。
 * 包含用户所属的节点 ID 和用户 ID。
 */
export interface UserRef {
  /** 节点 ID */
  nodeId: string;
  /** 用户 ID */
  userId: string;
}

/**
 * 会话引用，用于在 API 调用中唯一标识一个会话。
 * 包含提供服务的目标节点 ID 和会话 ID。
 */
export interface SessionRef {
  /** 服务节点 ID */
  servingNodeId: string;
  /** 会话 ID */
  sessionId: string;
}

/**
 * 消息游标，用于定位消息在特定节点中的位置。
 * 在消息拉取和去重场景中使用。
 */
export interface MessageCursor {
  /** 节点 ID */
  nodeId: string;
  /** 序列号 */
  seq: string;
}

/**
 * 用户信息，包含用户的所有公开属性。
 */
export interface User {
  /** 节点 ID */
  nodeId: string;
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 登录名。普通用户查看他人时，服务端可能返回空字符串 */
  loginName: string;
  /** 角色 */
  role: string;
  /** 用户配置文件的 JSON 字节数组 */
  profileJson: Uint8Array;
  /** 是否为系统保留用户 */
  systemReserved: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 来源节点 ID */
  originNodeId: string;
}

/**
 * 消息对象，表示一条持久化消息。
 * 消息会被存储在目标节点上，接收方可以通过拉取或推送方式获取。
 */
export interface Message {
  /** 接收者引用 */
  recipient: UserRef;
  /** 消息所在节点 ID */
  nodeId: string;
  /** 消息序列号 */
  seq: string;
  /** 发送者引用 */
  sender: UserRef;
  /** 消息体（字节数组） */
  body: Uint8Array;
  /** 创建时间的 HLC（混合逻辑时钟）时间戳 */
  createdAtHlc: string;
}

/**
 * 数据包对象，表示一条瞬态消息。
 * 与 Message 不同，Packet 不会持久化存储，投递失败后不会重试。
 * 适用于实时通信场景，如即时消息、状态更新等。
 */
export interface Packet {
  /** 数据包 ID */
  packetId: string;
  /** 源节点 ID */
  sourceNodeId: string;
  /** 目标节点 ID */
  targetNodeId: string;
  /** 接收者引用 */
  recipient: UserRef;
  /** 发送者引用 */
  sender: UserRef;
  /** 数据包体（字节数组） */
  body: Uint8Array;
  /** 投递模式 */
  deliveryMode: DeliveryMode;
  /** 目标会话（可选，指定后只投递到特定会话） */
  targetSession?: SessionRef;
}

/**
 * 中转确认对象，表示服务器已接受瞬态消息（数据包）的中转请求。
 * 仅表示服务器已接收消息，不代表消息已送达目标用户。
 */
export interface RelayAccepted {
  /** 数据包 ID */
  packetId: string;
  /** 源节点 ID */
  sourceNodeId: string;
  /** 目标节点 ID */
  targetNodeId: string;
  /** 接收者引用 */
  recipient: UserRef;
  /** 投递模式 */
  deliveryMode: DeliveryMode;
  /** 目标会话（可选） */
  targetSession?: SessionRef;
}

/**
 * 附件类型常量。
 * - ChannelManager: 频道管理员
 * - ChannelWriter: 频道写入者
 * - ChannelSubscription: 频道订阅
 * - UserBlacklist: 用户黑名单
 */
export const AttachmentType = {
  ChannelManager: "channel_manager",
  ChannelWriter: "channel_writer",
  ChannelSubscription: "channel_subscription",
  UserBlacklist: "user_blacklist"
} as const;

/**
 * 附件类型，从 AttachmentType 常量中提取的联合类型。
 */
export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType];

/**
 * 附件对象，表示用户之间的一种关联关系。
 * 用于实现频道管理、频道订阅、用户黑名单等功能。
 * 每个附件包含所有者、主体和类型，以及可选的配置信息。
 */
export interface Attachment {
  /** 附件所有者引用 */
  owner: UserRef;
  /** 附件主体引用 */
  subject: UserRef;
  /** 附件类型 */
  attachmentType: AttachmentType;
  /** 配置信息的 JSON 字节数组 */
  configJson: Uint8Array;
  /** 附件创建时间 */
  attachedAt: string;
  /** 附件删除时间 */
  deletedAt: string;
  /** 来源节点 ID */
  originNodeId: string;
}

/**
 * 用户元数据，与特定用户关联的键值对。
 * 支持设置过期时间，过期后自动删除。
 * 键名只能包含字母、数字、点、下划线、冒号和短横线，最长 128 个字符。
 * 该类型用于 WebSocket/protobuf 和通用 raw-bytes 场景；HTTP JSON 的 typed_value 视图见 HTTPUserMetadata。
 */
export interface UserMetadata {
  /** 元数据所有者引用 */
  owner: UserRef;
  /** 元数据键名 */
  key: string;
  /** 元数据值（字节数组） */
  value: Uint8Array;
  /** 最后更新时间 */
  updatedAt: string;
  /** 删除时间 */
  deletedAt: string;
  /** 过期时间 */
  expiresAt: string;
  /** 来源节点 ID */
  originNodeId: string;
}

/**
 * 系统保留的 metadata key 常量。
 */
export const SystemUserMetadataKey = {
  /** 控制普通用户在 listUsers 结果里是否能看到该用户或频道。 */
  VisibleToOthers: "system.visible_to_others"
} as const;

/**
 * HTTP metadata typed_value：原始 bytes 视图。
 * 请求时使用 base64 写入；响应端通常不会稳定返回 bytes 视图，但 SDK 会兼容解析。
 */
export interface HTTPUserMetadataBytesTypedValue {
  kind: "bytes";
  bytesValue: Uint8Array;
}

/**
 * HTTP metadata typed_value：布尔视图。
 * 适用于 `system.visible_to_others` 等布尔语义键。
 */
export interface HTTPUserMetadataBoolTypedValue {
  kind: "bool";
  boolValue: boolean;
}

/**
 * HTTP metadata typed_value：字符串视图。
 */
export interface HTTPUserMetadataStringTypedValue {
  kind: "string";
  stringValue: string;
}

/**
 * HTTP metadata typed_value：数字视图。
 * `numberValue` 允许 `string`，用于保留超出 JavaScript 安全整数范围或需要精确文本表示的 JSON 数字。
 */
export interface HTTPUserMetadataNumberTypedValue {
  kind: "number";
  numberValue: number | bigint | string;
}

/**
 * HTTP metadata typed_value：JSON 视图。
 * SDK 会按 JSON 语义序列化/反序列化该值。
 */
export interface HTTPUserMetadataJSONTypedValue {
  kind: "json";
  jsonValue: unknown;
}

/**
 * HTTP metadata typed_value 联合类型。
 */
export type HTTPUserMetadataTypedValue =
  | HTTPUserMetadataBytesTypedValue
  | HTTPUserMetadataBoolTypedValue
  | HTTPUserMetadataStringTypedValue
  | HTTPUserMetadataNumberTypedValue
  | HTTPUserMetadataJSONTypedValue;

/**
 * HTTP metadata 响应对象。
 * 始终保留 raw bytes 的 `value`，并在服务端能够稳定解释时附加 `typedValue` 视图。
 */
export interface HTTPUserMetadata extends UserMetadata {
  /** 服务端可稳定解释时返回的 typed_value 视图。 */
  typedValue?: HTTPUserMetadataTypedValue;
}

/**
 * 用户元数据扫描结果，包含匹配的元数据列表以及用于分页的游标。
 */
export interface UserMetadataScanResult {
  /** 匹配的元数据项列表 */
  items: UserMetadata[];
  /** 结果总数 */
  count: number;
  /** 下一页游标值 */
  nextAfter: string;
}

/**
 * HTTP 用户元数据扫描结果。
 * 与 UserMetadataScanResult 相同，但条目支持可选的 typed_value 视图。
 */
export interface HTTPUserMetadataScanResult {
  /** 匹配的元数据项列表 */
  items: HTTPUserMetadata[];
  /** 结果总数 */
  count: number;
  /** 下一页游标值 */
  nextAfter: string;
}

/**
 * 订阅对象，表示一个用户对某个频道的订阅关系。
 */
export interface Subscription {
  /** 订阅者引用 */
  subscriber: UserRef;
  /** 频道引用 */
  channel: UserRef;
  /** 订阅时间 */
  subscribedAt: string;
  /** 取消订阅时间 */
  deletedAt: string;
  /** 来源节点 ID */
  originNodeId: string;
}

/**
 * 黑名单条目，表示一个用户将另一个用户加入黑名单。
 */
export interface BlacklistEntry {
  /** 黑名单所有者引用 */
  owner: UserRef;
  /** 被屏蔽的用户引用 */
  blocked: UserRef;
  /** 屏蔽时间 */
  blockedAt: string;
  /** 解除屏蔽时间 */
  deletedAt: string;
  /** 来源节点 ID */
  originNodeId: string;
}

/**
 * 事件对象，表示系统中的一个领域事件。
 * 用于事件溯源和集群间数据同步。
 */
export interface Event {
  /** 事件序列号 */
  sequence: string;
  /** 事件 ID */
  eventId: string;
  /** 事件类型 */
  eventType: string;
  /** 聚合名称 */
  aggregate: string;
  /** 聚合所在节点 ID */
  aggregateNodeId: string;
  /** 聚合 ID */
  aggregateId: string;
  /** HLC（混合逻辑时钟）时间戳 */
  hlc: string;
  /** 来源节点 ID */
  originNodeId: string;
  /** 事件数据的 JSON 字节数组 */
  eventJson: Uint8Array;
}

/**
 * 集群节点信息，表示集群中的一个节点。
 */
export interface ClusterNode {
  /** 节点 ID */
  nodeId: string;
  /** 是否为本地节点 */
  isLocal: boolean;
  /** 配置的 URL */
  configuredUrl: string;
  /** 节点来源 */
  source: string;
}

/**
 * 已登录用户信息，表示某个集群节点上已登录的用户。
 */
export interface LoggedInUser {
  /** 节点 ID */
  nodeId: string;
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 登录名 */
  loginName: string;
}

/**
 * 在线节点状态，表示用户在某个服务节点上的在线情况。
 */
export interface OnlineNodePresence {
  /** 服务节点 ID */
  servingNodeId: string;
  /** 会话数量 */
  sessionCount: number;
  /** 传输方式提示 */
  transportHint: string;
}

/**
 * 已解析的会话信息，包含会话引用和连接方式。
 */
export interface ResolvedSession {
  /** 会话引用 */
  session: SessionRef;
  /** 传输协议 */
  transport: string;
  /** 是否支持瞬态消息 */
  transientCapable: boolean;
}

/**
 * 用户会话解析结果，包含用户在集群中的在线状态和活跃会话列表。
 */
export interface ResolveUserSessionsResult {
  /** 用户引用 */
  user: UserRef;
  /** 在线节点状态列表 */
  presence: OnlineNodePresence[];
  /** 已解析的会话列表 */
  sessions: ResolvedSession[];
}

/**
 * 消息裁剪状态，表示旧消息的清理情况。
 */
export interface MessageTrimStatus {
  /** 已裁剪的消息总数 */
  trimmedTotal: string;
  /** 最后裁剪时间 */
  lastTrimmedAt: string;
}

/**
 * 投影（Projection）状态，表示事件溯源的投影进度。
 */
export interface ProjectionStatus {
  /** 待处理的投影总数 */
  pendingTotal: string;
  /** 最后失败的投影时间 */
  lastFailedAt: string;
}

/**
 * 对等节点来源（Origin）同步状态。
 * 表示集群中对等节点上某个数据来源的同步进度。
 */
export interface PeerOriginStatus {
  /** 来源节点 ID */
  originNodeId: string;
  /** 已确认的最新事件 ID */
  ackedEventId: string;
  /** 已应用的最新事件 ID */
  appliedEventId: string;
  /** 未确认的事件数量 */
  unconfirmedEvents: string;
  /** 游标更新时间 */
  cursorUpdatedAt: string;
  /** 对端最新事件 ID */
  remoteLastEventId: string;
  /** 是否正在追赶同步 */
  pendingCatchup: boolean;
}

/**
 * 对等节点状态，表示集群中与其他节点的连接和数据同步状态。
 * 包含节点的连接信息、发现状态、时钟同步、快照传输等详细信息。
 */
export interface PeerStatus {
  /** 节点 ID */
  nodeId: string;
  /** 配置的 URL */
  configuredUrl: string;
  /** 节点来源 */
  source: string;
  /** 自动发现的 URL */
  discoveredUrl: string;
  /** 发现状态 */
  discoveryState: string;
  /** 最后发现时间 */
  lastDiscoveredAt: string;
  /** 最后连接时间 */
  lastConnectedAt: string;
  /** 最后发现错误 */
  lastDiscoveryError: string;
  /** 是否已连接 */
  connected: boolean;
  /** 会话方向 */
  sessionDirection: string;
  /** 来源同步状态列表 */
  origins: PeerOriginStatus[];
  /** 待处理的快照分区数 */
  pendingSnapshotPartitions: number;
  /** 对端快照版本 */
  remoteSnapshotVersion: string;
  /** 对端消息窗口大小 */
  remoteMessageWindowSize: number;
  /** 时钟偏移（毫秒） */
  clockOffsetMs: string;
  /** 最后时钟同步时间 */
  lastClockSync: string;
  /** 已发送的快照摘要总数 */
  snapshotDigestsSentTotal: string;
  /** 已接收的快照摘要总数 */
  snapshotDigestsReceivedTotal: string;
  /** 已发送的快照块总数 */
  snapshotChunksSentTotal: string;
  /** 已接收的快照块总数 */
  snapshotChunksReceivedTotal: string;
  /** 最后发送快照摘要的时间 */
  lastSnapshotDigestAt: string;
  /** 最后发送快照块的时间 */
  lastSnapshotChunkAt: string;
}

/**
 * 操作状态，表示集群节点当前的运行状态。
 * 包含消息窗口、事件序列、写入门控、冲突统计、消息裁剪、投影和对等节点状态。
 */
export interface OperationsStatus {
  /** 节点 ID */
  nodeId: string;
  /** 消息窗口大小 */
  messageWindowSize: number;
  /** 最后事件序列号 */
  lastEventSequence: string;
  /** 写入门控是否就绪 */
  writeGateReady: boolean;
  /** 冲突总数 */
  conflictTotal: string;
  /** 消息裁剪状态 */
  messageTrim: MessageTrimStatus;
  /** 投影状态 */
  projection: ProjectionStatus;
  /** 对等节点状态列表 */
  peers: PeerStatus[];
}

/**
 * 删除用户操作的结果。
 */
export interface DeleteUserResult {
  /** 操作状态 */
  status: string;
  /** 被删除的用户引用 */
  user: UserRef;
}

/**
 * 登录成功信息，包含用户详情、协议版本和当前会话引用。
 */
export interface LoginInfo {
  /** 用户信息 */
  user: User;
  /** 协议版本号 */
  protocolVersion: string;
  /** 当前会话引用 */
  sessionRef: SessionRef;
}

/**
 * 发送消息的输入参数。
 */
export interface SendMessageInput {
  /** 目标用户引用 */
  target: UserRef;
  /** 消息体（字节数组） */
  body: Uint8Array;
}

/**
 * 发送数据包（瞬态消息）的输入参数。
 */
export interface SendPacketInput {
  /** 目标用户引用 */
  target: UserRef;
  /** 消息体（字节数组） */
  body: Uint8Array;
  /** 投递模式 */
  deliveryMode: DeliveryMode;
  /** 目标会话（可选） */
  targetSession?: SessionRef;
}

/**
 * 创建用户请求参数。
 */
export interface CreateUserRequest {
  /** 用户名 */
  username: string;
  /** 登录名（可选） */
  loginName?: string;
  /** 密码（可选，不设置密码则无法通过密码登录） */
  password?: PasswordInput;
  /** 用户配置文件的 JSON 字节数组（可选） */
  profileJson?: Uint8Array;
  /** 用户角色 */
  role: string;
}

/**
 * 更新用户请求参数，所有字段均为可选。
 * 只更新指定的字段，未提供的字段保持不变。
 */
export interface UpdateUserRequest {
  /** 用户名（可选） */
  username?: string;
  /** 登录名（可选） */
  loginName?: string;
  /** 密码（可选） */
  password?: PasswordInput;
  /** 用户配置文件的 JSON 字节数组（可选） */
  profileJson?: Uint8Array;
  /** 用户角色（可选） */
  role?: string;
}

/**
 * 用户列表过滤条件。
 * 可同时按名称模糊匹配和用户唯一标识精确匹配。
 */
export interface ListUsersRequest {
  /** 名称过滤，服务端按大小写不敏感子串匹配 */
  name?: string;
  /**
   * 用户唯一标识过滤。
   * WebSocket 协议中，`{ nodeId: "0", userId: "0" }` 与省略该字段等价，表示不按 uid 过滤。
   */
  uid?: UserRef;
}

/**
 * 创建或更新用户元数据的请求参数。
 * 供 WebSocket/protobuf metadata API 使用，始终直接发送原始 bytes。
 */
export interface UpsertUserMetadataRequest {
  /** 元数据值（字节数组） */
  value: Uint8Array;
  /** 过期时间（可选，空字符串表示永不过期） */
  expiresAt?: string;
}

/**
 * HTTP 创建或更新用户元数据的请求参数：使用原始 bytes。
 */
export interface HTTPUpsertUserMetadataValueRequest {
  /** 原始元数据值（字节数组） */
  value: Uint8Array;
  /** HTTP typed_value 视图，与 value 互斥。 */
  typedValue?: never;
  /** 过期时间（可选，空字符串表示永不过期） */
  expiresAt?: string;
}

/**
 * HTTP 创建或更新用户元数据的请求参数：使用 typed_value 视图。
 */
export interface HTTPUpsertUserMetadataTypedValueRequest {
  /** 原始 bytes 视图，与 typedValue 互斥。 */
  value?: never;
  /** typed_value 视图。 */
  typedValue: HTTPUserMetadataTypedValue;
  /** 过期时间（可选，空字符串表示永不过期） */
  expiresAt?: string;
}

/**
 * HTTP 创建或更新用户元数据的请求参数。
 * 必须且只能提供 `value` 或 `typedValue` 其中之一。
 */
export type HTTPUpsertUserMetadataRequest =
  | HTTPUpsertUserMetadataValueRequest
  | HTTPUpsertUserMetadataTypedValueRequest;

/**
 * 扫描用户元数据的请求参数。
 */
export interface ScanUserMetadataRequest {
  /** 键名前缀过滤（可选） */
  prefix?: string;
  /** 分页游标，从指定位置后开始扫描（可选） */
  after?: string;
  /** 返回结果数量限制（可选） */
  limit?: number;
}

/**
 * HTTP 和 WebSocket 请求的通用选项。
 */
export interface RequestOptions {
  /** 用于取消请求的 AbortSignal */
  signal?: AbortSignal;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * 发送数据包的选项，继承 RequestOptions。
 */
export interface SendPacketOptions extends RequestOptions {
  /** 目标会话（指定后只投递到特定会话） */
  targetSession?: SessionRef;
}

/**
 * 可靠性等级常量。
 * - BestEffort: 无 ACK，无重传，无去重，无排序。延迟最低，适合实时音视频帧。
 * - AtLeastOnce: ACK + 重传，不保证去重和排序。适合幂等指令。
 * - ReliableOrdered: ACK + 重传 + 去重 + 严格有序。适合文件传输和聊天消息。
 */
export const Reliability = {
  BestEffort: 0,
  AtLeastOnce: 1,
  ReliableOrdered: 2
} as const;

/**
 * 可靠性等级类型。
 */
export type Reliability = (typeof Reliability)[keyof typeof Reliability];

/**
 * Relay 连接状态常量。
 * - Closed: 初始状态或已关闭
 * - Opening: 已发送 OPEN，等待 OPEN_ACK
 * - Open: 连接已建立，可收发数据
 * - Closing: 已发送 CLOSE，等待确认
 */
export const RelayState = {
  Closed: 0,
  Opening: 1,
  Open: 2,
  Closing: 3
} as const;

/**
 * Relay 连接状态类型。
 */
export type RelayState = (typeof RelayState)[keyof typeof RelayState];

/**
 * Relay 协议帧类型常量。
 */
export const RelayKind = {
  Unspecified: 0,
  Open: 1,
  OpenAck: 2,
  Data: 3,
  Ack: 4,
  Close: 5,
  Ping: 6,
  Error: 7
} as const;

/**
 * Relay 协议帧类型。
 */
export type RelayKind = (typeof RelayKind)[keyof typeof RelayKind];

/**
 * Relay 错误码常量。
 */
export const RelayErrorCode = {
  OpenTimeout: "open_timeout",
  AckTimeout: "ack_timeout",
  MaxRetransmit: "max_retransmit",
  IdleTimeout: "idle_timeout",
  RemoteClose: "remote_close",
  ClientClosed: "client_closed",
  Protocol: "protocol_error",
  DuplicateOpen: "duplicate_open",
  NotConnected: "not_connected",
  SendTimeout: "send_timeout",
  ReceiveTimeout: "receive_timeout"
} as const;

/**
 * Relay 错误码类型。
 */
export type RelayErrorCode = (typeof RelayErrorCode)[keyof typeof RelayErrorCode];

/**
 * RelayConnection 配置。
 */
export interface RelayConfig {
  /** 可靠性等级，默认 ReliableOrdered */
  reliability: number;
  /** 发送窗口大小（在途未确认帧数上限），范围 1-256，默认 16。BestEffort 模式下忽略。 */
  windowSize: number;
  /** OPEN 等待 OPEN_ACK 超时毫秒数，默认 10000 */
  openTimeoutMs: number;
  /** CLOSE 等待确认超时毫秒数，默认 5000 */
  closeTimeoutMs: number;
  /** DATA 等待 ACK 超时毫秒数，默认 3000。BestEffort 模式下忽略。 */
  ackTimeoutMs: number;
  /** 最大重传次数，默认 5。BestEffort 模式下忽略。 */
  maxRetransmits: number;
  /** 无数据超时断开毫秒数，0 表示不超时。 */
  idleTimeoutMs: number;
  /** 发送缓冲区字节数，默认 65536 */
  sendBufferSize: number;
  /** Packet 投递模式，默认 RouteRetry */
  deliveryMode: DeliveryMode;
  /** Send 操作超时毫秒数（发送缓冲区满时等待上限），0 表示不超时。 */
  sendTimeoutMs?: number;
  /** Receive 操作超时毫秒数（无数据等待上限），0 表示不超时。 */
  receiveTimeoutMs?: number;
}

/**
 * 返回带默认值的 RelayConfig。
 */
export function defaultRelayConfig(): RelayConfig {
  return {
    reliability: Reliability.ReliableOrdered,
    windowSize: 16,
    openTimeoutMs: 10000,
    closeTimeoutMs: 5000,
    ackTimeoutMs: 3000,
    maxRetransmits: 5,
    idleTimeoutMs: 0,
    sendBufferSize: 65536,
    deliveryMode: DeliveryMode.RouteRetry,
    sendTimeoutMs: 0,
    receiveTimeoutMs: 0
  };
}

/**
 * Relay 协议的帧类型（领域模型），用于在 relay 内部传递。
 * 与 proto RelayEnvelope 对应，但使用领域类型。
 */
export interface RelayEnvelope {
  /** 连接唯一标识 */
  relayId: string;
  /** 帧类型 */
  kind: number;
  /** 发送者会话引用 */
  senderSession: SessionRef;
  /** 目标会话引用 */
  targetSession: SessionRef;
  /** 序列号 */
  seq: string;
  /** ACK 序列号 */
  ackSeq: string;
  /** 载荷字节数组 */
  payload: Uint8Array;
  /** 发送时间戳（毫秒） */
  sentAtMs: string;
}

/**
 * Relay 错误类。
 */
export class RelayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`relay: ${code}: ${message}`);
    this.code = code;
    this.name = "RelayError";
  }
}
