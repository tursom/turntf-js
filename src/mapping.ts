import {
  ClientDeliveryMode,
  type BlacklistEntry as ProtoBlacklistEntry,
  type ClusterNode as ProtoClusterNode,
  type Event as ProtoEvent,
  type LoggedInUser as ProtoLoggedInUser,
  type Message as ProtoMessage,
  type MessageCursor as ProtoMessageCursor,
  type OperationsStatus as ProtoOperationsStatus,
  type Packet as ProtoPacket,
  type PeerOriginStatus as ProtoPeerOriginStatus,
  type PeerStatus as ProtoPeerStatus,
  type ProjectionStatus as ProtoProjectionStatus,
  type Subscription as ProtoSubscription,
  type TransientAccepted as ProtoTransientAccepted,
  type User as ProtoUser,
  type UserRef as ProtoUserRef
} from "./generated/client";
import { ProtocolError } from "./errors";
import {
  DeliveryMode,
  type BlacklistEntry,
  type ClusterNode,
  type Event,
  type LoggedInUser,
  type Message,
  type MessageCursor,
  type MessageTrimStatus,
  type OperationsStatus,
  type Packet,
  type PeerOriginStatus,
  type PeerStatus,
  type ProjectionStatus,
  type RelayAccepted,
  type Subscription,
  type User,
  type UserRef
} from "./types";
import { cloneBytes } from "./utils";

const zeroUserRef: UserRef = { nodeId: "0", userId: "0" };

export function userRefToProto(ref: UserRef): ProtoUserRef {
  return { nodeId: ref.nodeId, userId: ref.userId };
}

export function cursorToProto(cursor: MessageCursor): ProtoMessageCursor {
  return { nodeId: cursor.nodeId, seq: cursor.seq };
}

export function cursorFromProto(cursor: ProtoMessageCursor | undefined): MessageCursor {
  return { nodeId: cursor?.nodeId ?? "0", seq: cursor?.seq ?? "0" };
}

export function userRefFromProto(ref: ProtoUserRef | undefined): UserRef {
  return ref == null ? { ...zeroUserRef } : { nodeId: ref.nodeId, userId: ref.userId };
}

export function userFromProto(user: ProtoUser | undefined): User {
  if (user == null) {
    throw new ProtocolError("missing user");
  }
  return {
    nodeId: user.nodeId,
    userId: user.userId,
    username: user.username,
    role: user.role,
    profileJson: cloneBytes(user.profileJson),
    systemReserved: user.systemReserved,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    originNodeId: user.originNodeId
  };
}

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

export function packetFromProto(packet: ProtoPacket | undefined): Packet {
  if (packet == null) {
    throw new ProtocolError("missing packet");
  }
  return {
    packetId: packet.packetId,
    sourceNodeId: packet.sourceNodeId,
    targetNodeId: packet.targetNodeId,
    recipient: userRefFromProto(packet.recipient),
    sender: userRefFromProto(packet.sender),
    body: cloneBytes(packet.body),
    deliveryMode: deliveryModeFromProto(packet.deliveryMode)
  };
}

export function relayAcceptedFromProto(accepted: ProtoTransientAccepted | undefined): RelayAccepted {
  if (accepted == null) {
    throw new ProtocolError("missing transient_accepted");
  }
  return {
    packetId: accepted.packetId,
    sourceNodeId: accepted.sourceNodeId,
    targetNodeId: accepted.targetNodeId,
    recipient: userRefFromProto(accepted.recipient),
    deliveryMode: deliveryModeFromProto(accepted.deliveryMode)
  };
}

export function subscriptionFromProto(subscription: ProtoSubscription | undefined): Subscription {
  if (subscription == null) {
    throw new ProtocolError("missing subscription");
  }
  return {
    subscriber: userRefFromProto(subscription.subscriber),
    channel: userRefFromProto(subscription.channel),
    subscribedAt: subscription.subscribedAt,
    deletedAt: subscription.deletedAt,
    originNodeId: subscription.originNodeId
  };
}

export function blacklistEntryFromProto(entry: ProtoBlacklistEntry | undefined): BlacklistEntry {
  if (entry == null) {
    throw new ProtocolError("missing blacklist entry");
  }
  return {
    owner: userRefFromProto(entry.owner),
    blocked: userRefFromProto(entry.blocked),
    blockedAt: entry.blockedAt,
    deletedAt: entry.deletedAt,
    originNodeId: entry.originNodeId
  };
}

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

export function loggedInUserFromProto(user: ProtoLoggedInUser | undefined): LoggedInUser {
  if (user == null) {
    throw new ProtocolError("missing logged-in user");
  }
  return {
    nodeId: user.nodeId,
    userId: user.userId,
    username: user.username
  };
}

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

function messageTrimStatusFromProto(status: ProtoOperationsStatus["messageTrim"]): MessageTrimStatus {
  return {
    trimmedTotal: status?.trimmedTotal ?? "0",
    lastTrimmedAt: status?.lastTrimmedAt ?? ""
  };
}

function projectionStatusFromProto(status: ProtoProjectionStatus | undefined): ProjectionStatus {
  return {
    pendingTotal: status?.pendingTotal ?? "0",
    lastFailedAt: status?.lastFailedAt ?? ""
  };
}

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

export function messagesFromProto(items: ProtoMessage[]): Message[] {
  return items.map(messageFromProto);
}

export function subscriptionsFromProto(items: ProtoSubscription[]): Subscription[] {
  return items.map(subscriptionFromProto);
}

export function blacklistEntriesFromProto(items: ProtoBlacklistEntry[]): BlacklistEntry[] {
  return items.map(blacklistEntryFromProto);
}

export function eventsFromProto(items: ProtoEvent[]): Event[] {
  return items.map(eventFromProto);
}

export function clusterNodesFromProto(items: ProtoClusterNode[]): ClusterNode[] {
  return items.map(clusterNodeFromProto);
}

export function loggedInUsersFromProto(items: ProtoLoggedInUser[]): LoggedInUser[] {
  return items.map(loggedInUserFromProto);
}

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
