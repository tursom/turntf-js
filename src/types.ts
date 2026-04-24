import type { PasswordInput } from "./password";

export const DeliveryMode = {
  Unspecified: "",
  BestEffort: "best_effort",
  RouteRetry: "route_retry"
} as const;

export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

export interface Credentials {
  nodeId: string;
  userId: string;
  password: PasswordInput;
}

export interface UserRef {
  nodeId: string;
  userId: string;
}

export interface MessageCursor {
  nodeId: string;
  seq: string;
}

export interface User {
  nodeId: string;
  userId: string;
  username: string;
  role: string;
  profileJson: Uint8Array;
  systemReserved: boolean;
  createdAt: string;
  updatedAt: string;
  originNodeId: string;
}

export interface Message {
  recipient: UserRef;
  nodeId: string;
  seq: string;
  sender: UserRef;
  body: Uint8Array;
  createdAtHlc: string;
}

export interface Packet {
  packetId: string;
  sourceNodeId: string;
  targetNodeId: string;
  recipient: UserRef;
  sender: UserRef;
  body: Uint8Array;
  deliveryMode: DeliveryMode;
}

export interface RelayAccepted {
  packetId: string;
  sourceNodeId: string;
  targetNodeId: string;
  recipient: UserRef;
  deliveryMode: DeliveryMode;
}

export interface Subscription {
  subscriber: UserRef;
  channel: UserRef;
  subscribedAt: string;
  deletedAt: string;
  originNodeId: string;
}

export interface BlacklistEntry {
  owner: UserRef;
  blocked: UserRef;
  blockedAt: string;
  deletedAt: string;
  originNodeId: string;
}

export interface Event {
  sequence: string;
  eventId: string;
  eventType: string;
  aggregate: string;
  aggregateNodeId: string;
  aggregateId: string;
  hlc: string;
  originNodeId: string;
  eventJson: Uint8Array;
}

export interface ClusterNode {
  nodeId: string;
  isLocal: boolean;
  configuredUrl: string;
  source: string;
}

export interface LoggedInUser {
  nodeId: string;
  userId: string;
  username: string;
}

export interface MessageTrimStatus {
  trimmedTotal: string;
  lastTrimmedAt: string;
}

export interface ProjectionStatus {
  pendingTotal: string;
  lastFailedAt: string;
}

export interface PeerOriginStatus {
  originNodeId: string;
  ackedEventId: string;
  appliedEventId: string;
  unconfirmedEvents: string;
  cursorUpdatedAt: string;
  remoteLastEventId: string;
  pendingCatchup: boolean;
}

export interface PeerStatus {
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

export interface OperationsStatus {
  nodeId: string;
  messageWindowSize: number;
  lastEventSequence: string;
  writeGateReady: boolean;
  conflictTotal: string;
  messageTrim: MessageTrimStatus;
  projection: ProjectionStatus;
  peers: PeerStatus[];
}

export interface DeleteUserResult {
  status: string;
  user: UserRef;
}

export interface LoginInfo {
  user: User;
  protocolVersion: string;
}

export interface SendMessageInput {
  target: UserRef;
  body: Uint8Array;
}

export interface SendPacketInput {
  target: UserRef;
  body: Uint8Array;
  deliveryMode: DeliveryMode;
}

export interface CreateUserRequest {
  username: string;
  password?: PasswordInput;
  profileJson?: Uint8Array;
  role: string;
}

export interface UpdateUserRequest {
  username?: string;
  password?: PasswordInput;
  profileJson?: Uint8Array;
  role?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
