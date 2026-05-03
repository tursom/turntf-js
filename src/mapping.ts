import {
  AttachmentType as ProtoAttachmentType,
  type Attachment as ProtoAttachment,
  ClientDeliveryMode,
  type ClusterNode as ProtoClusterNode,
  type Event as ProtoEvent,
  type LoggedInUser as ProtoLoggedInUser,
  type Message as ProtoMessage,
  type MessageCursor as ProtoMessageCursor,
  type OnlineNodePresence as ProtoOnlineNodePresence,
  type OperationsStatus as ProtoOperationsStatus,
  type Packet as ProtoPacket,
  type PeerOriginStatus as ProtoPeerOriginStatus,
  type PeerStatus as ProtoPeerStatus,
  type ProjectionStatus as ProtoProjectionStatus,
  type ResolveUserSessionsResponse as ProtoResolveUserSessionsResponse,
  type ResolvedSession as ProtoResolvedSession,
  type ScanUserMetadataResponse as ProtoScanUserMetadataResponse,
  type SessionRef as ProtoSessionRef,
  type TransientAccepted as ProtoTransientAccepted,
  type UserMetadata as ProtoUserMetadata,
  type User as ProtoUser,
  type UserRef as ProtoUserRef
} from "./generated/client";
import { ProtocolError } from "./errors";
import {
  AttachmentType,
  type Attachment,
  DeliveryMode,
  type BlacklistEntry,
  type ClusterNode,
  type Event,
  type LoggedInUser,
  type Message,
  type MessageCursor,
  type MessageTrimStatus,
  type OnlineNodePresence,
  type OperationsStatus,
  type Packet,
  type PeerOriginStatus,
  type PeerStatus,
  type ProjectionStatus,
  type ResolveUserSessionsResult,
  type RelayAccepted,
  type ResolvedSession,
  type SessionRef,
  type Subscription,
  type UserMetadata,
  type UserMetadataScanResult,
  type User,
  type UserRef
} from "./types";
import { cloneBytes } from "./utils";

const zeroUserRef: UserRef = { nodeId: "0", userId: "0" };

/**
 * 将 UserRef（领域模型）转换为 Protobuf UserRef。
 *
 * @param ref - 用户引用对象
 * @returns Protobuf 格式的用户引用
 */
export function userRefToProto(ref: UserRef): ProtoUserRef {
  return { nodeId: ref.nodeId, userId: ref.userId };
}

/**
 * 将 SessionRef（领域模型）转换为 Protobuf SessionRef。
 *
 * @param ref - 会话引用对象
 * @returns Protobuf 格式的会话引用
 */
export function sessionRefToProto(ref: SessionRef): ProtoSessionRef {
  return { servingNodeId: ref.servingNodeId, sessionId: ref.sessionId };
}

/**
 * 将 MessageCursor（领域模型）转换为 Protobuf MessageCursor。
 *
 * @param cursor - 消息游标对象
 * @returns Protobuf 格式的消息游标
 */
export function cursorToProto(cursor: MessageCursor): ProtoMessageCursor {
  return { nodeId: cursor.nodeId, seq: cursor.seq };
}

/**
 * 将 Protobuf MessageCursor 转换为领域模型 MessageCursor。
 * 如果传入 undefined，则返回默认值（nodeId="0", seq="0"）。
 *
 * @param cursor - Protobuf 格式的消息游标，可选
 * @returns 领域模型的消息游标
 */
export function cursorFromProto(cursor: ProtoMessageCursor | undefined): MessageCursor {
  return { nodeId: cursor?.nodeId ?? "0", seq: cursor?.seq ?? "0" };
}

/**
 * 将 Protobuf UserRef 转换为领域模型 UserRef。
 * 如果传入 undefined，则返回零值引用（nodeId="0", userId="0"）。
 *
 * @param ref - Protobuf 格式的用户引用，可选
 * @returns 领域模型的用户引用
 */
export function userRefFromProto(ref: ProtoUserRef | undefined): UserRef {
  return ref == null ? { ...zeroUserRef } : { nodeId: ref.nodeId, userId: ref.userId };
}

/**
 * 将 Protobuf SessionRef 转换为领域模型 SessionRef。
 * 如果传入 undefined，则抛出 ProtocolError。
 *
 * @param ref - Protobuf 格式的会话引用，可选
 * @returns 领域模型的会话引用
 * @throws {ProtocolError} 如果引用为 null 或 undefined
 */
export function sessionRefFromProto(ref: ProtoSessionRef | undefined): SessionRef {
  if (ref == null) {
    throw new ProtocolError("missing session_ref");
  }
  return { servingNodeId: ref.servingNodeId, sessionId: ref.sessionId };
}

/**
 * 可选地将 Protobuf SessionRef 转换为领域模型 SessionRef。
 * 与 sessionRefFromProto 不同，传入 undefined 时返回 undefined，不会抛出异常。
 *
 * @param ref - Protobuf 格式的会话引用，可选
 * @returns 领域模型的会话引用，如果输入为 null 则返回 undefined
 */
export function optionalSessionRefFromProto(ref: ProtoSessionRef | undefined): SessionRef | undefined {
  if (ref == null) {
    return undefined;
  }
  return { servingNodeId: ref.servingNodeId, sessionId: ref.sessionId };
}

/**
 * 将 Protobuf User 转换为领域模型 User。
 * 对 profileJson 字节数组进行克隆以防引用共享。
 *
 * @param user - Protobuf 格式的用户对象，可选
 * @returns 领域模型的用户对象
 * @throws {ProtocolError} 如果用户对象为 null 或 undefined
 */
export function userFromProto(user: ProtoUser | undefined): User {
  if (user == null) {
    throw new ProtocolError("missing user");
  }
  return {
    nodeId: user.nodeId,
    userId: user.userId,
    username: user.username,
    loginName: user.loginName,
    role: user.role,
    profileJson: cloneBytes(user.profileJson),
    systemReserved: user.systemReserved,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    originNodeId: user.originNodeId
  };
}

/**
 * 将 Protobuf Message 转换为领域模型 Message。
 * 对 body 字节数组进行克隆以防引用共享。
 *
 * @param message - Protobuf 格式的消息对象，可选
 * @returns 领域模型的消息对象
 * @throws {ProtocolError} 如果消息对象为 null 或 undefined
 */
export function messageFromProto(message: ProtoMessage | undefined): Message {
  if (message == null) {
    throw new ProtocolError("missing message");
  }
  return {
    recipient: userRefFromProto(message.recipient),
    nodeId: message.nodeId,
    seq: message.seq,
    sender: userRefFromProto(message.sender),
    body: cloneBytes(message.body),
    createdAtHlc: message.createdAtHlc
  };
}

/**
 * 将 Protobuf Packet 转换为领域模型 Packet。
 * 包含可选的 targetSession 字段转换。
 *
 * @param packet - Protobuf 格式的数据包对象，可选
 * @returns 领域模型的数据包对象
 * @throws {ProtocolError} 如果数据包对象为 null 或 undefined
 */
export function packetFromProto(packet: ProtoPacket | undefined): Packet {
  if (packet == null) {
    throw new ProtocolError("missing packet");
  }
  const mapped: Packet = {
    packetId: packet.packetId,
    sourceNodeId: packet.sourceNodeId,
    targetNodeId: packet.targetNodeId,
    recipient: userRefFromProto(packet.recipient),
    sender: userRefFromProto(packet.sender),
    body: cloneBytes(packet.body),
    deliveryMode: deliveryModeFromProto(packet.deliveryMode)
  };
  const targetSession = optionalSessionRefFromProto(packet.targetSession);
  if (targetSession != null) {
    mapped.targetSession = targetSession;
  }
  return mapped;
}

/**
 * 将 Protobuf TransientAccepted 转换为领域模型 RelayAccepted。
 * 表示服务器已接受瞬态消息（数据包）的中转。
 *
 * @param accepted - Protobuf 格式的中转确认对象，可选
 * @returns 领域模型的中转确认对象
 * @throws {ProtocolError} 如果确认对象为 null 或 undefined
 */
export function relayAcceptedFromProto(accepted: ProtoTransientAccepted | undefined): RelayAccepted {
  if (accepted == null) {
    throw new ProtocolError("missing transient_accepted");
  }
  const mapped: RelayAccepted = {
    packetId: accepted.packetId,
    sourceNodeId: accepted.sourceNodeId,
    targetNodeId: accepted.targetNodeId,
    recipient: userRefFromProto(accepted.recipient),
    deliveryMode: deliveryModeFromProto(accepted.deliveryMode)
  };
  const targetSession = optionalSessionRefFromProto(accepted.targetSession);
  if (targetSession != null) {
    mapped.targetSession = targetSession;
  }
  return mapped;
}

/** 将 Protobuf 附件类型转换为领域模型附件类型 */
function attachmentTypeFromProto(type: ProtoAttachmentType): AttachmentType {
  switch (type) {
    case ProtoAttachmentType.CHANNEL_MANAGER:
      return AttachmentType.ChannelManager;
    case ProtoAttachmentType.CHANNEL_WRITER:
      return AttachmentType.ChannelWriter;
    case ProtoAttachmentType.CHANNEL_SUBSCRIPTION:
      return AttachmentType.ChannelSubscription;
    case ProtoAttachmentType.USER_BLACKLIST:
      return AttachmentType.UserBlacklist;
    default:
      throw new ProtocolError(`unsupported attachment type ${ProtoAttachmentType[type] ?? type}`);
  }
}

/**
 * 将领域模型附件类型转换为 Protobuf 附件类型。
 *
 * @param type - 领域模型的附件类型
 * @returns Protobuf 格式的附件类型
 */
export function attachmentTypeToProto(type: AttachmentType): ProtoAttachmentType {
  switch (type) {
    case AttachmentType.ChannelManager:
      return ProtoAttachmentType.CHANNEL_MANAGER;
    case AttachmentType.ChannelWriter:
      return ProtoAttachmentType.CHANNEL_WRITER;
    case AttachmentType.ChannelSubscription:
      return ProtoAttachmentType.CHANNEL_SUBSCRIPTION;
    case AttachmentType.UserBlacklist:
      return ProtoAttachmentType.USER_BLACKLIST;
    default:
      return ProtoAttachmentType.UNSPECIFIED;
  }
}

/**
 * 将 Protobuf Attachment 转换为领域模型 Attachment。
 *
 * @param attachment - Protobuf 格式的附件对象，可选
 * @returns 领域模型的附件对象
 * @throws {ProtocolError} 如果附件对象为 null 或 undefined
 */
export function attachmentFromProto(attachment: ProtoAttachment | undefined): Attachment {
  if (attachment == null) {
    throw new ProtocolError("missing attachment");
  }
  return {
    owner: userRefFromProto(attachment.owner),
    subject: userRefFromProto(attachment.subject),
    attachmentType: attachmentTypeFromProto(attachment.attachmentType),
    configJson: cloneBytes(attachment.configJson),
    attachedAt: attachment.attachedAt,
    deletedAt: attachment.deletedAt,
    originNodeId: attachment.originNodeId
  };
}

/**
 * 将 Protobuf UserMetadata 转换为领域模型 UserMetadata。
 *
 * @param metadata - Protobuf 格式的用户元数据对象，可选
 * @returns 领域模型的用户元数据对象
 * @throws {ProtocolError} 如果元数据对象为 null 或 undefined
 */
export function userMetadataFromProto(metadata: ProtoUserMetadata | undefined): UserMetadata {
  if (metadata == null) {
    throw new ProtocolError("missing metadata");
  }
  // WebSocket/protobuf 仍只携带 raw bytes；HTTP typed_value 视图不会在这里推导。
  return {
    owner: userRefFromProto(metadata.owner),
    key: metadata.key,
    value: cloneBytes(metadata.value),
    updatedAt: metadata.updatedAt,
    deletedAt: metadata.deletedAt,
    expiresAt: metadata.expiresAt,
    originNodeId: metadata.originNodeId
  };
}

/**
 * 将 Protobuf ScanUserMetadataResponse 转换为领域模型 UserMetadataScanResult。
 *
 * @param response - Protobuf 格式的扫描响应对象，可选
 * @returns 领域模型的元数据扫描结果对象
 * @throws {ProtocolError} 如果响应对象为 null 或 undefined
 */
export function userMetadataScanResultFromProto(
  response: ProtoScanUserMetadataResponse | undefined
): UserMetadataScanResult {
  if (response == null) {
    throw new ProtocolError("missing scan_user_metadata_response");
  }
  return {
    items: response.items.map(userMetadataFromProto),
    count: response.count,
    nextAfter: response.nextAfter
  };
}

/**
 * 将 Protobuf Attachment（频道订阅类型）转换为领域模型 Subscription。
 * 实质是将 Attachment 的 owner 映射为 subscriber，subject 映射为 channel。
 *
 * @param subscription - Protobuf 格式的附件对象（频道订阅），可选
 * @returns 领域模型的订阅对象
 * @throws {ProtocolError} 如果附件对象为 null 或 undefined
 */
export function subscriptionFromProto(subscription: ProtoAttachment | undefined): Subscription {
  const attachment = attachmentFromProto(subscription);
  return {
    subscriber: attachment.owner,
    channel: attachment.subject,
    subscribedAt: attachment.attachedAt,
    deletedAt: attachment.deletedAt,
    originNodeId: attachment.originNodeId
  };
}

/**
 * 将 Protobuf Attachment（用户黑名单类型）转换为领域模型 BlacklistEntry。
 * 实质是将 Attachment 的 owner 映射为黑名单所有者，subject 映射为被屏蔽用户。
 *
 * @param entry - Protobuf 格式的附件对象（黑名单条目），可选
 * @returns 领域模型的黑名单条目对象
 * @throws {ProtocolError} 如果附件对象为 null 或 undefined
 */
export function blacklistEntryFromProto(entry: ProtoAttachment | undefined): BlacklistEntry {
  const attachment = attachmentFromProto(entry);
  return {
    owner: attachment.owner,
    blocked: attachment.subject,
    blockedAt: attachment.attachedAt,
    deletedAt: attachment.deletedAt,
    originNodeId: attachment.originNodeId
  };
}

/**
 * 将 Protobuf Event 转换为领域模型 Event。
 *
 * @param event - Protobuf 格式的事件对象，可选
 * @returns 领域模型的事件对象
 * @throws {ProtocolError} 如果事件对象为 null 或 undefined
 */
export function eventFromProto(event: ProtoEvent | undefined): Event {
  if (event == null) {
    throw new ProtocolError("missing event");
  }
  return {
    sequence: event.sequence,
    eventId: event.eventId,
    eventType: event.eventType,
    aggregate: event.aggregate,
    aggregateNodeId: event.aggregateNodeId,
    aggregateId: event.aggregateId,
    hlc: event.hlc,
    originNodeId: event.originNodeId,
    eventJson: cloneBytes(event.eventJson)
  };
}

/**
 * 将 Protobuf ClusterNode 转换为领域模型 ClusterNode。
 *
 * @param node - Protobuf 格式的集群节点对象，可选
 * @returns 领域模型的集群节点对象
 * @throws {ProtocolError} 如果节点对象为 null 或 undefined
 */
export function clusterNodeFromProto(node: ProtoClusterNode | undefined): ClusterNode {
  if (node == null) {
    throw new ProtocolError("missing cluster node");
  }
  return {
    nodeId: node.nodeId,
    isLocal: node.isLocal,
    configuredUrl: node.configuredUrl,
    source: node.source
  };
}

/**
 * 将 Protobuf LoggedInUser 转换为领域模型 LoggedInUser。
 *
 * @param user - Protobuf 格式的已登录用户对象，可选
 * @returns 领域模型的已登录用户对象
 * @throws {ProtocolError} 如果用户对象为 null 或 undefined
 */
export function loggedInUserFromProto(user: ProtoLoggedInUser | undefined): LoggedInUser {
  if (user == null) {
    throw new ProtocolError("missing logged-in user");
  }
  return {
    nodeId: user.nodeId,
    userId: user.userId,
    username: user.username,
    loginName: user.loginName
  };
}

/**
 * 将 Protobuf OnlineNodePresence 转换为领域模型 OnlineNodePresence。
 *
 * @param item - Protobuf 格式的在线节点状态对象，可选
 * @returns 领域模型的在线节点状态对象
 * @throws {ProtocolError} 如果状态对象为 null 或 undefined
 */
export function onlineNodePresenceFromProto(item: ProtoOnlineNodePresence | undefined): OnlineNodePresence {
  if (item == null) {
    throw new ProtocolError("missing online node presence");
  }
  return {
    servingNodeId: item.servingNodeId,
    sessionCount: item.sessionCount,
    transportHint: item.transportHint
  };
}

/**
 * 将 Protobuf ResolvedSession 转换为领域模型 ResolvedSession。
 *
 * @param item - Protobuf 格式的已解析会话对象，可选
 * @returns 领域模型的已解析会话对象
 * @throws {ProtocolError} 如果会话对象为 null 或 undefined
 */
export function resolvedSessionFromProto(item: ProtoResolvedSession | undefined): ResolvedSession {
  if (item == null) {
    throw new ProtocolError("missing resolved session");
  }
  return {
    session: sessionRefFromProto(item.session),
    transport: item.transport,
    transientCapable: item.transientCapable
  };
}

/**
 * 将 Protobuf ResolveUserSessionsResponse 转换为领域模型 ResolveUserSessionsResult。
 *
 * @param response - Protobuf 格式的解析会话响应对象，可选
 * @returns 领域模型的用户会话解析结果
 * @throws {ProtocolError} 如果响应对象为 null 或 undefined
 */
export function resolveUserSessionsFromProto(
  response: ProtoResolveUserSessionsResponse | undefined
): ResolveUserSessionsResult {
  if (response == null) {
    throw new ProtocolError("missing resolve_user_sessions_response");
  }
  return {
    user: userRefFromProto(response.user),
    presence: response.presence.map(onlineNodePresenceFromProto),
    sessions: response.items.map(resolvedSessionFromProto)
  };
}

/**
 * 将 Protobuf OperationsStatus 转换为领域模型 OperationsStatus。
 *
 * @param status - Protobuf 格式的操作状态对象，可选
 * @returns 领域模型的操作状态对象
 * @throws {ProtocolError} 如果状态对象为 null 或 undefined
 */
export function operationsStatusFromProto(status: ProtoOperationsStatus | undefined): OperationsStatus {
  if (status == null) {
    throw new ProtocolError("missing operations status");
  }
  return {
    nodeId: status.nodeId,
    messageWindowSize: status.messageWindowSize,
    lastEventSequence: status.lastEventSequence,
    writeGateReady: status.writeGateReady,
    conflictTotal: status.conflictTotal,
    messageTrim: messageTrimStatusFromProto(status.messageTrim),
    projection: projectionStatusFromProto(status.projection),
    peers: status.peers.map(peerStatusFromProto)
  };
}

/** 将 Protobuf 消息裁剪状态转换为领域模型 */
function messageTrimStatusFromProto(status: ProtoOperationsStatus["messageTrim"]): MessageTrimStatus {
  return {
    trimmedTotal: status?.trimmedTotal ?? "0",
    lastTrimmedAt: status?.lastTrimmedAt ?? ""
  };
}

/** 将 Protobuf 投影状态转换为领域模型 */
function projectionStatusFromProto(status: ProtoProjectionStatus | undefined): ProjectionStatus {
  return {
    pendingTotal: status?.pendingTotal ?? "0",
    lastFailedAt: status?.lastFailedAt ?? ""
  };
}

/** 将 Protobuf 对等节点来源状态转换为领域模型 */
function peerOriginStatusFromProto(status: ProtoPeerOriginStatus): PeerOriginStatus {
  return {
    originNodeId: status.originNodeId,
    ackedEventId: status.ackedEventId,
    appliedEventId: status.appliedEventId,
    unconfirmedEvents: status.unconfirmedEvents,
    cursorUpdatedAt: status.cursorUpdatedAt,
    remoteLastEventId: status.remoteLastEventId,
    pendingCatchup: status.pendingCatchup
  };
}

/** 将 Protobuf 对等节点状态转换为领域模型 */
function peerStatusFromProto(status: ProtoPeerStatus): PeerStatus {
  return {
    nodeId: status.nodeId,
    configuredUrl: status.configuredUrl,
    source: status.source,
    discoveredUrl: status.discoveredUrl,
    discoveryState: status.discoveryState,
    lastDiscoveredAt: status.lastDiscoveredAt,
    lastConnectedAt: status.lastConnectedAt,
    lastDiscoveryError: status.lastDiscoveryError,
    connected: status.connected,
    sessionDirection: status.sessionDirection,
    origins: status.origins.map(peerOriginStatusFromProto),
    pendingSnapshotPartitions: status.pendingSnapshotPartitions,
    remoteSnapshotVersion: status.remoteSnapshotVersion,
    remoteMessageWindowSize: status.remoteMessageWindowSize,
    clockOffsetMs: status.clockOffsetMs,
    lastClockSync: status.lastClockSync,
    snapshotDigestsSentTotal: status.snapshotDigestsSentTotal,
    snapshotDigestsReceivedTotal: status.snapshotDigestsReceivedTotal,
    snapshotChunksSentTotal: status.snapshotChunksSentTotal,
    snapshotChunksReceivedTotal: status.snapshotChunksReceivedTotal,
    lastSnapshotDigestAt: status.lastSnapshotDigestAt,
    lastSnapshotChunkAt: status.lastSnapshotChunkAt
  };
}

/**
 * 批量将 Protobuf Message 数组转换为领域模型 Message 数组。
 *
 * @param items - Protobuf 消息对象数组
 * @returns 领域模型的消息对象数组
 */
export function messagesFromProto(items: ProtoMessage[]): Message[] {
  return items.map(messageFromProto);
}

/**
 * 批量将 Protobuf Attachment 数组转换为领域模型 Attachment 数组。
 *
 * @param items - Protobuf 附件对象数组
 * @returns 领域模型的附件对象数组
 */
export function attachmentsFromProto(items: ProtoAttachment[]): Attachment[] {
  return items.map(attachmentFromProto);
}

/**
 * 批量将 Protobuf Attachment 数组转换为领域模型 Subscription 数组。
 *
 * @param items - Protobuf 附件对象数组（频道订阅）
 * @returns 领域模型的订阅对象数组
 */
export function subscriptionsFromProto(items: ProtoAttachment[]): Subscription[] {
  return items.map(subscriptionFromProto);
}

/**
 * 批量将 Protobuf Attachment 数组转换为领域模型 BlacklistEntry 数组。
 *
 * @param items - Protobuf 附件对象数组（黑名单条目）
 * @returns 领域模型的黑名单条目对象数组
 */
export function blacklistEntriesFromProto(items: ProtoAttachment[]): BlacklistEntry[] {
  return items.map(blacklistEntryFromProto);
}

/**
 * 批量将 Protobuf Event 数组转换为领域模型 Event 数组。
 *
 * @param items - Protobuf 事件对象数组
 * @returns 领域模型的事件对象数组
 */
export function eventsFromProto(items: ProtoEvent[]): Event[] {
  return items.map(eventFromProto);
}

/**
 * 批量将 Protobuf ClusterNode 数组转换为领域模型 ClusterNode 数组。
 *
 * @param items - Protobuf 集群节点对象数组
 * @returns 领域模型的集群节点对象数组
 */
export function clusterNodesFromProto(items: ProtoClusterNode[]): ClusterNode[] {
  return items.map(clusterNodeFromProto);
}

/**
 * 批量将 Protobuf LoggedInUser 数组转换为领域模型 LoggedInUser 数组。
 *
 * @param items - Protobuf 已登录用户对象数组
 * @returns 领域模型的已登录用户对象数组
 */
export function loggedInUsersFromProto(items: ProtoLoggedInUser[]): LoggedInUser[] {
  return items.map(loggedInUserFromProto);
}

/**
 * 批量将 Protobuf OnlineNodePresence 数组转换为领域模型 OnlineNodePresence 数组。
 *
 * @param items - Protobuf 在线节点状态对象数组
 * @returns 领域模型的在线节点状态对象数组
 */
export function onlineNodePresencesFromProto(items: ProtoOnlineNodePresence[]): OnlineNodePresence[] {
  return items.map(onlineNodePresenceFromProto);
}

/**
 * 批量将 Protobuf ResolvedSession 数组转换为领域模型 ResolvedSession 数组。
 *
 * @param items - Protobuf 已解析会话对象数组
 * @returns 领域模型的已解析会话对象数组
 */
export function resolvedSessionsFromProto(items: ProtoResolvedSession[]): ResolvedSession[] {
  return items.map(resolvedSessionFromProto);
}

/**
 * 将领域模型的 DeliveryMode 转换为 Protobuf ClientDeliveryMode。
 *
 * @param mode - 领域模型的投递模式
 * @returns Protobuf 格式的投递模式
 */
export function deliveryModeToProto(mode: DeliveryMode): ClientDeliveryMode {
  switch (mode) {
    case DeliveryMode.BestEffort:
      return ClientDeliveryMode.BEST_EFFORT;
    case DeliveryMode.RouteRetry:
      return ClientDeliveryMode.ROUTE_RETRY;
    default:
      return ClientDeliveryMode.UNSPECIFIED;
  }
}

/**
 * 将 Protobuf ClientDeliveryMode 转换为领域模型的 DeliveryMode。
 *
 * @param mode - Protobuf 格式的投递模式
 * @returns 领域模型的投递模式
 */
export function deliveryModeFromProto(mode: ClientDeliveryMode): DeliveryMode {
  switch (mode) {
    case ClientDeliveryMode.BEST_EFFORT:
      return DeliveryMode.BestEffort;
    case ClientDeliveryMode.ROUTE_RETRY:
      return DeliveryMode.RouteRetry;
    default:
      return DeliveryMode.Unspecified;
  }
}
