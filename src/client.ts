import WebSocket, { type RawData } from "ws";

import {
  ClientDeliveryKind,
  ClientEnvelope as ProtoClientEnvelope,
  ClientMessageSyncMode,
  ServerEnvelope as ProtoServerEnvelope,
  type UpsertUserMetadataRequest as ProtoUpsertUserMetadataRequest,
  type UpdateUserRequest as ProtoUpdateUserRequest,
  type SendMessageResponse as ProtoSendMessageResponse
} from "./generated/client";
import {
  ConnectionError,
  ClosedError,
  DisconnectedError,
  NotConnectedError,
  ProtocolError,
  ServerError
} from "./errors";
import { HTTPClient } from "./http";
import {
  attachmentFromProto,
  attachmentTypeToProto,
  blacklistEntriesFromProto,
  blacklistEntryFromProto,
  clusterNodesFromProto,
  cursorToProto,
  deliveryModeToProto,
  eventsFromProto,
  loggedInUsersFromProto,
  messageFromProto,
  operationsStatusFromProto,
  packetFromProto,
  relayAcceptedFromProto,
  resolveUserSessionsFromProto,
  sessionRefFromProto,
  sessionRefToProto,
  subscriptionFromProto,
  subscriptionsFromProto,
  userMetadataFromProto,
  userMetadataScanResultFromProto,
  userFromProto,
  userRefToProto
} from "./mapping";
import { passwordWireValue, validatePassword, type PasswordInput } from "./password";
import { CursorStore, MemoryCursorStore } from "./store";
import {
  type Attachment,
  type AttachmentType,
  type BlacklistEntry,
  type ClusterNode,
  type Credentials,
  type CreateUserRequest,
  type DeleteUserResult,
  type DeliveryMode,
  type Event,
  type LoggedInUser,
  type ListUsersRequest,
  type LoginInfo,
  type Message,
  type MessageCursor,
  type OperationsStatus,
  type Packet,
  type ResolveUserSessionsResult,
  type RelayAccepted,
  type RequestOptions,
  type ScanUserMetadataRequest,
  type SendPacketOptions,
  type SessionRef,
  type Subscription,
  type UpsertUserMetadataRequest,
  type UpdateUserRequest,
  type UserMetadata,
  type UserMetadataScanResult,
  type User,
  type UserRef
} from "./types";
import { abortReason, createDeferred, mergeAbortSignals, sleep, type Deferred } from "./utils";
import {
  cursorForMessage,
  isZeroUserRef,
  isLoginNameCredentials,
  normalizeLoginName,
  toRequiredWireInteger,
  toWireInteger,
  validateCredentials,
  validateDeliveryMode,
  validateListUsersRequest,
  validateSessionRef,
  validateUserMetadataKey,
  validateUserMetadataValuePolicy,
  validateUserMetadataScanRequest,
  validateUserRef
} from "./validation";
import { Relay } from "./relay";

/**
 * 事件处理器接口，定义客户端生命周期事件的回调方法。
 * 所有方法都支持同步和异步两种形式。
 * 方法内部的异常会被客户端捕获并安全处理，不会影响客户端的正常运行。
 */
export interface Handler {
  /** 登录成功后的回调，提供登录信息（用户信息、协议版本、会话引用） */
  onLogin(info: LoginInfo): void | Promise<void>;
  /** 收到新的持久化消息时的回调 */
  onMessage(message: Message): void | Promise<void>;
  /** 收到新的瞬态数据包时的回调 */
  onPacket(packet: Packet): void | Promise<void>;
  /** 发生错误时的回调 */
  onError(error: unknown): void | Promise<void>;
  /** 连接断开时的回调，提供断开原因 */
  onDisconnect(error: unknown): void | Promise<void>;
}

/**
 * 空操作（NOP）事件处理器，所有回调方法均为空实现。
 * 作为 Handler 接口的默认实现，避免空值检查。
 * 继承此类并重写需要的方法即可实现自定义处理器。
 */
export class NopHandler implements Handler {
  onLogin(_info: LoginInfo): void {}
  onMessage(_message: Message): void {}
  onPacket(_packet: Packet): void {}
  onError(_error: unknown): void {}
  onDisconnect(_error: unknown): void {}
}

/**
 * WebSocket 客户端选项。
 */
export interface ClientOptions {
  /** 服务器基础 URL，例如 "http://localhost:8080" */
  baseUrl: string;
  /** 登录凭据，支持 (nodeId, userId) 或 loginName 两种方式 */
  credentials: Credentials;
  /** 消息游标存储器，用于消息去重。默认为 MemoryCursorStore */
  cursorStore?: CursorStore;
  /** 事件处理器，处理登录、消息、错误等回调 */
  handler?: Handler;
  /** 自定义 fetch 函数，用于替换全局 fetch */
  fetch?: typeof fetch;
  /** 是否启用自动重连，默认为 true */
  reconnect?: boolean;
  /** 初始重连延迟（毫秒），默认为 1000ms */
  initialReconnectDelayMs?: number;
  /** 最大重连延迟（毫秒），默认为 30000ms */
  maxReconnectDelayMs?: number;
  /** WebSocket 心跳 ping 的间隔（毫秒），默认为 30000ms */
  pingIntervalMs?: number;
  /** RPC 请求超时时间（毫秒），默认为 10000ms */
  requestTimeoutMs?: number;
  /** 是否自动回复消息确认（ACK），默认为 true */
  ackMessages?: boolean;
  /** 是否仅接收瞬态消息，默认为 false */
  transientOnly?: boolean;
  /** 是否使用实时流模式连接，默认为 false */
  realtimeStream?: boolean;
}

interface ServeResult {
  readonly connected: boolean;
  readonly error: unknown;
}

interface Frame {
  readonly data: RawData;
  readonly isBinary: boolean;
}

/**
 * turntf WebSocket 客户端，提供基于 WebSocket 协议的双向通信能力。
 * 支持消息的持久化投递和瞬态投递、自动重连、消息去重、频道订阅等特性。
 * 客户端通过 WebSocket 与服务器建立长连接，支持心跳保活和自动重连。
 *
 * 使用示例：
 * ```ts
 * const client = new Client({
 *   baseUrl: "http://localhost:8080",
 *   credentials: { loginName: "user", password: await plainPassword("pass") }
 * });
 * await client.connect();
 * ```
 */
export class Client {
  /** HTTP 客户端实例，用于 REST API 调用 */
  readonly http: HTTPClient;

  private readonly credentials: Credentials;
  private readonly cursorStore: CursorStore;
  private readonly handler: Handler;
  private readonly reconnectEnabled: boolean;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly pingIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly ackMessages: boolean;
  private readonly transientOnly: boolean;
  private readonly realtimeStream: boolean;

  private readonly lifecycleAbort = new AbortController();
  private readonly pending = new Map<string, Deferred<unknown>>();

  private requestId = 0n;
  private writeChain: Promise<void> = Promise.resolve();
  private socket: QueuedWebSocket | undefined;
  private connectingSocket: QueuedWebSocket | undefined;
  private pingTask: Promise<void> | undefined;
  private runTask: Promise<void> | undefined;
  private connectWaiter: Deferred<void> | undefined;
  private currentSessionRef: SessionRef | undefined;
  private connected = false;
  private closed = false;
  private stopReconnect = false;
  private _relay: Relay | undefined;

  /**
   * 创建 WebSocket 客户端实例。
   * 创建后需要调用 connect() 方法建立 WebSocket 连接。
   * 客户端默认启用自动重连，可通过 reconnect 选项关闭。
   *
   * @param options - 客户端配置选项
   * @throws 如果 baseUrl 为空、凭据不合法或密码无效则抛出错误
   */
  constructor(options: ClientOptions) {
    if (options.baseUrl.trim() === "") {
      throw new Error("baseUrl is required");
    }
    validateCredentials(options.credentials, "credentials");
    validatePassword(options.credentials.password);

    this.http = new HTTPClient(
      options.baseUrl,
      options.fetch == null ? {} : { fetch: options.fetch }
    );
    if (isLoginNameCredentials(options.credentials)) {
      this.credentials = {
        loginName: normalizeLoginName(options.credentials.loginName),
        password: options.credentials.password
      };
    } else {
      this.credentials = {
        nodeId: options.credentials.nodeId,
        userId: options.credentials.userId,
        password: options.credentials.password
      };
    }
    this.cursorStore = options.cursorStore ?? new MemoryCursorStore();
    this.handler = options.handler ?? new NopHandler();
    this.reconnectEnabled = options.reconnect ?? true;
    this.initialReconnectDelayMs = positiveOrDefault(options.initialReconnectDelayMs, 1_000);
    this.maxReconnectDelayMs = positiveOrDefault(options.maxReconnectDelayMs, 30_000);
    this.pingIntervalMs = positiveOrDefault(options.pingIntervalMs, 30_000);
    this.requestTimeoutMs = positiveOrDefault(options.requestTimeoutMs, 10_000);
    this.ackMessages = options.ackMessages ?? true;
    this.transientOnly = options.transientOnly ?? false;
    this.realtimeStream = options.realtimeStream ?? false;
  }

  /** 获取服务器基础 URL */
  get baseUrl(): string {
    return this.http.baseUrl;
  }

  /**
   * 获取当前会话引用。
   * 返回当前连接建立的会话引用副本，包含服务节点 ID 和会话 ID。
   * 如果尚未连接或已断开，返回 undefined。
   */
  get sessionRef(): SessionRef | undefined {
    if (this.currentSessionRef == null) {
      return undefined;
    }
    return { ...this.currentSessionRef };
  }

  /**
   * 获取关联的 Relay 管理器（懒初始化）。
   * Relay 管理器提供点对点连接功能，支持三种可靠性模式。
   */
  relay(): Relay {
    if (this._relay == null) {
      this._relay = new Relay(this);
    }
    return this._relay;
  }

  /**
   * 使用明文密码进行 HTTP 登录（便捷方法，自动处理密码哈希）。
   * 委托给 HTTPClient 的同名方法。
   * 支持两种登录方式：
   * 1. 通过 (nodeId, userId, password) 登录
   * 2. 通过 (loginName, password) 登录
   *
   * @param nodeIdOrLoginName - 节点 ID 或登录名
   * @param userIdOrPassword - 用户 ID 或密码
   * @param passwordOrOptions - 密码或请求选项
   * @param maybeOptions - 请求选项（当使用 nodeId/userId 方式时）
   * @returns 认证令牌字符串
   */
  async login(nodeId: string, userId: string, password: string, options?: RequestOptions): Promise<string>;
  async login(loginName: string, password: string, options?: RequestOptions): Promise<string>;
  async login(
    nodeIdOrLoginName: string,
    userIdOrPassword: string,
    passwordOrOptions?: string | RequestOptions,
    maybeOptions?: RequestOptions
  ): Promise<string> {
    if (typeof passwordOrOptions === "string") {
      return this.http.login(nodeIdOrLoginName, userIdOrPassword, passwordOrOptions, maybeOptions);
    }
    return this.http.login(nodeIdOrLoginName, userIdOrPassword, passwordOrOptions);
  }

  /**
   * 使用 PasswordInput 对象进行 HTTP 登录。
   * 委托给 HTTPClient 的同名方法。
   * 支持两种登录方式：
   * 1. 通过 (nodeId, userId, password) 登录
   * 2. 通过 (loginName, password) 登录
   *
   * @param nodeIdOrLoginName - 节点 ID 或登录名
   * @param userIdOrPassword - 用户 ID 或 PasswordInput
   * @param passwordOrOptions - PasswordInput 或请求选项
   * @param maybeOptions - 请求选项（当使用 nodeId/userId 方式时）
   * @returns 认证令牌字符串
   */
  async loginWithPassword(nodeId: string, userId: string, password: PasswordInput, options?: RequestOptions): Promise<string>;
  async loginWithPassword(loginName: string, password: PasswordInput, options?: RequestOptions): Promise<string>;
  async loginWithPassword(
    nodeIdOrLoginName: string,
    userIdOrPassword: string | PasswordInput,
    passwordOrOptions?: PasswordInput | RequestOptions,
    maybeOptions?: RequestOptions
  ): Promise<string> {
    if (typeof userIdOrPassword === "string") {
      return this.http.loginWithPassword(
        nodeIdOrLoginName,
        userIdOrPassword,
        passwordOrOptions as PasswordInput,
        maybeOptions
      );
    }
    return this.http.loginWithPassword(
      nodeIdOrLoginName,
      userIdOrPassword,
      passwordOrOptions as RequestOptions | undefined
    );
  }

  /**
   * 建立 WebSocket 连接。
   * 如果客户端已连接，则直接返回。
   * 如果客户端已关闭，则抛出 ClosedError。
   * 连接成功后，会触发 handler.onLogin 回调。
   * 连接断开后会自动重连（如果启用了重连选项）。
   *
   * @param options - 可选的请求选项，支持超时和取消
   * @throws {ClosedError} 如果客户端已关闭
   */
  async connect(options?: RequestOptions): Promise<void> {
    if (this.closed) {
      throw new ClosedError();
    }
    if (this.connected && this.socket != null) {
      return;
    }

    const waiter = this.ensureConnectWaiter();
    this.ensureRunLoop();

    const abort = mergeAbortSignals(options);
    try {
      await waitForPromise(waiter.promise, abort.signal);
    } finally {
      abort.cleanup();
    }
  }

  /**
   * 优雅关闭客户端连接。
   * 关闭 WebSocket 连接、取消所有待处理的 RPC 请求、停止重连。
   * 等待所有内部任务完成后返回。
   * 多次调用 close 是安全的。
   */
  async close(): Promise<void> {
    if (this.closed) {
      await this.awaitRunTask();
      return;
    }

    this.closed = true;
    this.stopReconnect = true;
    this.lifecycleAbort.abort(new ClosedError());
    this.rejectConnectWaiter(new ClosedError());
    this.failAllPending(new ClosedError());

    const socket = this.socket;
    const connectingSocket = this.connectingSocket;
    this.socket = undefined;
    this.connectingSocket = undefined;
    this.currentSessionRef = undefined;
    this.connected = false;

    if (socket != null) {
      await socket.close();
    }
    if (connectingSocket != null && connectingSocket !== socket) {
      await connectingSocket.close();
    }
    await this.awaitRunTask();
  }

  /**
   * 发送心跳 ping 请求，用于检测 WebSocket 连接是否正常。
   * 如果连接已断开，会抛出 NotConnectedError。
   * 客户端内部会自动定时发送心跳，通常不需要手动调用。
   *
   * @param options - 可选的请求选项
   * @throws {NotConnectedError} 如果未连接
   */
  async ping(options?: RequestOptions): Promise<void> {
    await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "ping",
          ping: { requestId }
        }
      }),
      options
    );
  }

  /**
   * 向目标用户发送持久化消息。
   * 消息会被持久化存储在服务器上，目标用户可以通过拉取或推送方式接收。
   * 消息会经过游标存储去重处理。
   *
   * @param target - 目标用户引用
   * @param body - 消息体（字节数组），不能为空
   * @param options - 可选的请求选项
   * @returns 发送的消息对象
   * @throws {NotConnectedError} 如果未连接
   * @throws {ClosedError} 如果客户端已关闭
   */
  async sendMessage(target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message> {
    validateUserRef(target, "target");
    if (body.length === 0) {
      throw new Error("body is required");
    }

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "sendMessage",
          sendMessage: {
            requestId,
            target: userRefToProto(target),
            body: new Uint8Array(body),
            deliveryKind: ClientDeliveryKind.PERSISTENT,
            deliveryMode: 0,
            syncMode: ClientMessageSyncMode.UNSPECIFIED
          }
        }
      }),
      options
    );
    if (!isMessage(result)) {
      throw new ProtocolError("missing message in send response");
    }
    return result;
  }

  /**
   * 发送持久化消息（sendMessage 的别名方法）。
   *
   * @param target - 目标用户引用
   * @param body - 消息体（字节数组）
   * @param options - 可选的请求选项
   * @returns 发送的消息对象
   */
  postMessage(target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message> {
    return this.sendMessage(target, body, options);
  }

  /**
   * 向目标用户发送瞬态数据包（Packet）。
   * 与 sendMessage 不同，数据包不会被持久化存储。
   * 支持指定投递模式（BestEffort 或 RouteRetry）和目标会话。
   * 服务器返回 RelayAccepted 仅表示已接受中转，不代表已送达。
   *
   * @param target - 目标用户引用
   * @param body - 数据包体（字节数组），不能为空
   * @param deliveryMode - 投递模式
   * @param options - 可选的发送选项（可指定目标会话）
   * @returns 中转确认对象
   * @throws {NotConnectedError} 如果未连接
   */
  async sendPacket(
    target: UserRef,
    body: Uint8Array,
    deliveryMode: DeliveryMode,
    options?: SendPacketOptions
  ): Promise<RelayAccepted> {
    validateUserRef(target, "target");
    if (body.length === 0) {
      throw new Error("body is required");
    }
    validateDeliveryMode(deliveryMode);
    if (options?.targetSession != null) {
      validateSessionRef(options.targetSession, "options.targetSession");
    }

    const result = await this.rpc(
      (requestId) => {
        const sendMessage = {
          requestId,
          target: userRefToProto(target),
          body: new Uint8Array(body),
          deliveryKind: ClientDeliveryKind.TRANSIENT,
          deliveryMode: deliveryModeToProto(deliveryMode),
          syncMode: ClientMessageSyncMode.UNSPECIFIED
        };
        if (options?.targetSession != null) {
          Object.assign(sendMessage, {
            targetSession: sessionRefToProto(options.targetSession)
          });
        }
        return {
          body: {
            oneofKind: "sendMessage",
            sendMessage
          }
        };
      },
      options
    );
    if (!isRelayAccepted(result)) {
      throw new ProtocolError("missing transient_accepted in send response");
    }
    return result;
  }

  /**
   * 发送瞬态数据包（sendPacket 的别名方法）。
   *
   * @param target - 目标用户引用
   * @param body - 数据包体（字节数组）
   * @param deliveryMode - 投递模式
   * @param options - 可选的发送选项
   * @returns 中转确认对象
   */
  postPacket(
    target: UserRef,
    body: Uint8Array,
    deliveryMode: DeliveryMode,
    options?: SendPacketOptions
  ): Promise<RelayAccepted> {
    return this.sendPacket(target, body, deliveryMode, options);
  }

  /**
   * 创建新用户。
   *
   * @param request - 创建用户请求（用户名、登录名、密码、角色等）
   * @param options - 可选的请求选项
   * @returns 创建的用户信息
   * @throws 如果用户名或角色为空则抛出错误
   */
  async createUser(request: CreateUserRequest, options?: RequestOptions): Promise<User> {
    if (request.username === "") {
      throw new Error("username is required");
    }
    if (request.role === "") {
      throw new Error("role is required");
    }

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "createUser",
          createUser: {
            requestId,
            username: request.username,
            loginName: request.loginName == null ? "" : normalizeLoginName(request.loginName),
            password: request.password == null ? "" : passwordWireValue(request.password),
            profileJson: request.profileJson == null ? new Uint8Array(0) : new Uint8Array(request.profileJson),
            role: request.role
          }
        }
      }),
      options
    );
    if (!isUser(result)) {
      throw new ProtocolError("missing user in create_user_response");
    }
    return result;
  }

  /**
   * 创建频道（Channel）。
   * 频道是一种特殊类型的用户（角色为 "channel"）。
   * 支持频道订阅、频道管理等社交功能。
   *
   * @param request - 创建频道请求（自动设置角色为 "channel"）
   * @param options - 可选的请求选项
   * @returns 创建的频道用户信息
   */
  createChannel(
    request: Omit<CreateUserRequest, "role"> & Partial<Pick<CreateUserRequest, "role">>,
    options?: RequestOptions
  ): Promise<User> {
    return this.createUser({ ...request, role: request.role ?? "channel" }, options);
  }

  /**
   * 获取用户信息。
   *
   * @param target - 目标用户引用
   * @param options - 可选的请求选项
   * @returns 用户信息
   */
  async getUser(target: UserRef, options?: RequestOptions): Promise<User> {
    validateUserRef(target, "target");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "getUser",
          getUser: { requestId, user: userRefToProto(target) }
        }
      }),
      options
    );
    if (!isUser(result)) {
      throw new ProtocolError("missing user in get_user_response");
    }
    return result;
  }

  /**
   * 获取当前用户可通讯的活跃用户列表。
   * 支持按名称子串和用户唯一标识过滤。
   * 普通用户看到的结果会受到目标用户或频道 `system.visible_to_others=false` metadata 的影响，
   * 但这不会阻止调用方在已知 uid 时继续直接发送消息。
   *
   * @param request - 可选过滤条件
   * @param options - 可选的请求选项
   * @returns 用户列表
   */
  async listUsers(request: ListUsersRequest = {}, options?: RequestOptions): Promise<User[]> {
    validateListUsersRequest(request, "request");
    const name = normalizeListUsersName(request.name);

    const result = await this.rpc(
      (requestId) => {
        const listUsers: {
          requestId: string;
          name: string;
          uid?: { nodeId: string; userId: string };
        } = {
          requestId,
          name
        };
        if (request.uid != null) {
          listUsers.uid = listUsersUidToProto(request.uid);
        }
        return {
          body: {
            oneofKind: "listUsers",
            listUsers
          }
        };
      },
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_users_response");
    }
    return result;
  }

  /**
   * 更新用户信息。
   * 所有字段均为可选，只更新提供的字段。
   * 支持更新用户名、登录名、密码、配置文件和角色。
   *
   * @param target - 目标用户引用
   * @param request - 更新请求（所有字段可选）
   * @param options - 可选的请求选项
   * @returns 更新后的用户信息
   */
  async updateUser(target: UserRef, request: UpdateUserRequest, options?: RequestOptions): Promise<User> {
    validateUserRef(target, "target");

    const result = await this.rpc(
      (requestId) => {
        const updateUser: ProtoUpdateUserRequest = {
          requestId,
          user: userRefToProto(target)
        };
        if (request.username != null) {
          updateUser.username = { value: request.username };
        }
        if (request.password != null) {
          updateUser.password = { value: passwordWireValue(request.password) };
        }
        if (request.profileJson != null) {
          updateUser.profileJson = { value: new Uint8Array(request.profileJson) };
        }
        if (request.role != null) {
          updateUser.role = { value: request.role };
        }
        if (request.loginName != null) {
          updateUser.loginName = { value: normalizeLoginName(request.loginName) };
        }
        return {
        body: {
          oneofKind: "updateUser",
          updateUser
        }
      };
      },
      options
    );
    if (!isUser(result)) {
      throw new ProtocolError("missing user in update_user_response");
    }
    return result;
  }

  /**
   * 删除用户。
   * 删除操作不可逆，请谨慎使用。
   *
   * @param target - 目标用户引用
   * @param options - 可选的请求选项
   * @returns 删除结果（包含操作状态和被删除用户的引用）
   */
  async deleteUser(target: UserRef, options?: RequestOptions): Promise<DeleteUserResult> {
    validateUserRef(target, "target");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "deleteUser",
          deleteUser: { requestId, user: userRefToProto(target) }
        }
      }),
      options
    );
    if (!isDeleteUserResult(result)) {
      throw new ProtocolError("missing status in delete_user_response");
    }
    return result;
  }

  /**
   * 获取指定用户的元数据。
   * WebSocket/protobuf metadata API 保持 raw bytes 语义，不提供 HTTP typed_value 视图。
   *
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param options - 可选的请求选项
   * @returns 用户元数据对象
   */
  async getUserMetadata(owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata> {
    validateUserRef(owner, "owner");
    validateUserMetadataKey(key, "key");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "getUserMetadata",
          getUserMetadata: {
            requestId,
            owner: userRefToProto(owner),
            key
          }
        }
      }),
      options
    );
    if (!isUserMetadata(result)) {
      throw new ProtocolError("missing metadata in get_user_metadata_response");
    }
    return result;
  }

  /**
   * 创建或更新用户元数据。
   * 如果键名已存在则更新，不存在则创建。
   * WebSocket/protobuf metadata API 始终直接发送 raw bytes；
   * 对于 `system.visible_to_others`，请传入 UTF-8 `true` / `false`。
   *
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param request - 元数据内容（值和可选的过期时间）
   * @param options - 可选的请求选项
   * @returns 更新后的用户元数据对象
   */
  async upsertUserMetadata(
    owner: UserRef,
    key: string,
    request: UpsertUserMetadataRequest,
    options?: RequestOptions
  ): Promise<UserMetadata> {
    validateUserRef(owner, "owner");
    validateUserMetadataKey(key, "key");
    if (request.value == null) {
      throw new Error("value is required");
    }
    validateUserMetadataValuePolicy(key, request.value, request.expiresAt, "request");

    const result = await this.rpc(
      (requestId) => {
        const upsertUserMetadata: ProtoUpsertUserMetadataRequest = {
          requestId,
          owner: userRefToProto(owner),
          key,
          value: request.value
        };
        if (request.expiresAt != null) {
          upsertUserMetadata.expiresAt = { value: request.expiresAt };
        }
        return {
          body: {
            oneofKind: "upsertUserMetadata",
            upsertUserMetadata
          }
        };
      },
      options
    );
    if (!isUserMetadata(result)) {
      throw new ProtocolError("missing metadata in upsert_user_metadata_response");
    }
    return result;
  }

  /**
   * 删除指定用户元数据。
   *
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param options - 可选的请求选项
   * @returns 被删除的用户元数据对象（包含删除时间）
   */
  async deleteUserMetadata(owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata> {
    validateUserRef(owner, "owner");
    validateUserMetadataKey(key, "key");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "deleteUserMetadata",
          deleteUserMetadata: {
            requestId,
            owner: userRefToProto(owner),
            key
          }
        }
      }),
      options
    );
    if (!isUserMetadata(result)) {
      throw new ProtocolError("missing metadata in delete_user_metadata_response");
    }
    return result;
  }

  /**
   * 扫描用户元数据，支持按前缀过滤和分页。
   * after 参数必须使用与 prefix 相同的前缀。
   *
   * @param owner - 元数据所有者引用
   * @param request - 扫描请求参数（前缀、分页游标、数量限制）
   * @param options - 可选的请求选项
   * @returns 元数据扫描结果（包含匹配项列表和下一页游标）
   */
  async scanUserMetadata(
    owner: UserRef,
    request: ScanUserMetadataRequest = {},
    options?: RequestOptions
  ): Promise<UserMetadataScanResult> {
    validateUserRef(owner, "owner");
    validateUserMetadataScanRequest(request, "request");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "scanUserMetadata",
          scanUserMetadata: {
            requestId,
            owner: userRefToProto(owner),
            prefix: request.prefix ?? "",
            after: request.after ?? "",
            limit: request.limit ?? 0
          }
        }
      }),
      options
    );
    if (!isUserMetadataScanResult(result)) {
      throw new ProtocolError("missing page in scan_user_metadata_response");
    }
    return result;
  }

  /**
   * 创建或更新附件关系。
   * 用于管理频道管理员、频道写入者、频道订阅和用户黑名单等关联关系。
   *
   * @param owner - 附件所有者引用
   * @param subject - 附件主体引用
   * @param attachmentType - 附件类型
   * @param configJson - 配置信息的 JSON 字节数组
   * @param options - 可选的请求选项
   * @returns 附件对象
   */
  async upsertAttachment(owner: UserRef, subject: UserRef, attachmentType: AttachmentType, configJson = new Uint8Array(), options?: RequestOptions): Promise<Attachment> {
    validateUserRef(owner, "owner");
    validateUserRef(subject, "subject");
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "upsertUserAttachment",
          upsertUserAttachment: {
            requestId,
            owner: userRefToProto(owner),
            subject: userRefToProto(subject),
            attachmentType: attachmentTypeToProto(attachmentType),
            configJson
          }
        }
      }),
      options
    );
    if (!isAttachment(result)) {
      throw new ProtocolError("missing attachment in upsert_user_attachment_response");
    }
    return result;
  }

  /**
   * 删除附件关系。
   *
   * @param owner - 附件所有者引用
   * @param subject - 附件主体引用
   * @param attachmentType - 附件类型
   * @param options - 可选的请求选项
   * @returns 被删除的附件对象（包含删除时间）
   */
  async deleteAttachment(owner: UserRef, subject: UserRef, attachmentType: AttachmentType, options?: RequestOptions): Promise<Attachment> {
    validateUserRef(owner, "owner");
    validateUserRef(subject, "subject");
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "deleteUserAttachment",
          deleteUserAttachment: {
            requestId,
            owner: userRefToProto(owner),
            subject: userRefToProto(subject),
            attachmentType: attachmentTypeToProto(attachmentType)
          }
        }
      }),
      options
    );
    if (!isAttachment(result)) {
      throw new ProtocolError("missing attachment in delete_user_attachment_response");
    }
    return result;
  }

  /**
   * 获取附件列表，可选按附件类型过滤。
   *
   * @param owner - 附件所有者引用
   * @param attachmentType - 可选的附件类型过滤
   * @param options - 可选的请求选项
   * @returns 附件对象数组
   */
  async listAttachments(owner: UserRef, attachmentType?: AttachmentType, options?: RequestOptions): Promise<Attachment[]> {
    validateUserRef(owner, "owner");
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "listUserAttachments",
          listUserAttachments: {
            requestId,
            owner: userRefToProto(owner),
            attachmentType: attachmentType == null ? 0 : attachmentTypeToProto(attachmentType)
          }
        }
      }),
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_user_attachments_response");
    }
    return result;
  }

  /**
   * 订阅频道。
   * 让 subscriber 用户订阅 channel 频道，之后可以通过频道功能发送和接收消息。
   *
   * @param subscriber - 订阅者引用
   * @param channel - 频道引用
   * @param options - 可选的请求选项
   * @returns 订阅对象
   */
  async subscribeChannel(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription> {
    const attachment = await this.upsertAttachment(subscriber, channel, "channel_subscription", new Uint8Array(), options);
    return {
      subscriber: attachment.owner,
      channel: attachment.subject,
      subscribedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    };
  }

  /**
   * 创建频道订阅（subscribeChannel 的别名方法）。
   *
   * @param subscriber - 订阅者引用
   * @param channel - 频道引用
   * @param options - 可选的请求选项
   * @returns 订阅对象
   */
  createSubscription(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription> {
    return this.subscribeChannel(subscriber, channel, options);
  }

  /**
   * 取消订阅频道。
   *
   * @param subscriber - 订阅者引用
   * @param channel - 频道引用
   * @param options - 可选的请求选项
   * @returns 取消订阅的对象（包含删除时间）
   */
  async unsubscribeChannel(subscriber: UserRef, channel: UserRef, options?: RequestOptions): Promise<Subscription> {
    const attachment = await this.deleteAttachment(subscriber, channel, "channel_subscription", options);
    return {
      subscriber: attachment.owner,
      channel: attachment.subject,
      subscribedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    };
  }

  /**
   * 获取指定用户订阅的频道列表。
   *
   * @param subscriber - 订阅者引用
   * @param options - 可选的请求选项
   * @returns 订阅对象数组
   */
  async listSubscriptions(subscriber: UserRef, options?: RequestOptions): Promise<Subscription[]> {
    const items = await this.listAttachments(subscriber, "channel_subscription", options);
    return items.map((attachment) => ({
      subscriber: attachment.owner,
      channel: attachment.subject,
      subscribedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    }));
  }

  /**
   * 将用户加入黑名单。
   * 被屏蔽的用户将无法与所有者进行通信。
   *
   * @param owner - 黑名单所有者引用
   * @param blocked - 被屏蔽的用户引用
   * @param options - 可选的请求选项
   * @returns 黑名单条目
   */
  async blockUser(owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.upsertAttachment(owner, blocked, "user_blacklist", new Uint8Array(), options);
    return {
      owner: attachment.owner,
      blocked: attachment.subject,
      blockedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    };
  }

  /**
   * 将用户从黑名单移除（解除屏蔽）。
   *
   * @param owner - 黑名单所有者引用
   * @param blocked - 被解除屏蔽的用户引用
   * @param options - 可选的请求选项
   * @returns 黑名单条目（包含删除时间）
   */
  async unblockUser(owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.deleteAttachment(owner, blocked, "user_blacklist", options);
    return {
      owner: attachment.owner,
      blocked: attachment.subject,
      blockedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    };
  }

  /**
   * 获取指定用户的黑名单列表。
   *
   * @param owner - 黑名单所有者引用
   * @param options - 可选的请求选项
   * @returns 黑名单条目数组
   */
  async listBlockedUsers(owner: UserRef, options?: RequestOptions): Promise<BlacklistEntry[]> {
    const items = await this.listAttachments(owner, "user_blacklist", options);
    return items.map((attachment) => ({
      owner: attachment.owner,
      blocked: attachment.subject,
      blockedAt: attachment.attachedAt,
      deletedAt: attachment.deletedAt,
      originNodeId: attachment.originNodeId
    }));
  }

  /**
   * 获取指定用户的消息列表。
   *
   * @param target - 目标用户引用
   * @param limit - 返回消息的最大数量，0 表示不限制
   * @param options - 可选的请求选项
   * @returns 消息对象数组
   */
  async listMessages(target: UserRef, limit = 0, options?: RequestOptions): Promise<Message[]> {
    validateUserRef(target, "target");
    validateLimit(limit, "limit");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "listMessages",
          listMessages: {
            requestId,
            user: userRefToProto(target),
            limit
          }
        }
      }),
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_messages_response");
    }
    return result;
  }

  /**
   * 获取事件列表，支持按起始序列号和数量限制。
   * 事件是系统内部的状态变更记录，用于事件溯源和集群同步。
   *
   * @param after - 起始事件序列号，默认为 "0"（从开始获取）
   * @param limit - 最大返回数量，0 表示不限制
   * @param options - 可选的请求选项
   * @returns 事件对象数组
   */
  async listEvents(after = "0", limit = 0, options?: RequestOptions): Promise<Event[]> {
    toWireInteger(after, "after");
    validateLimit(limit, "limit");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "listEvents",
          listEvents: {
            requestId,
            after,
            limit
          }
        }
      }),
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_events_response");
    }
    return result;
  }

  /**
   * 获取集群中所有节点的信息列表。
   *
   * @param options - 可选的请求选项
   * @returns 集群节点信息数组
   */
  async listClusterNodes(options?: RequestOptions): Promise<ClusterNode[]> {
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "listClusterNodes",
          listClusterNodes: { requestId }
        }
      }),
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_cluster_nodes_response");
    }
    return result;
  }

  /**
   * 获取指定集群节点上当前已登录的用户列表。
   *
   * @param nodeId - 集群节点 ID
   * @param options - 可选的请求选项
   * @returns 已登录用户信息数组
   */
  async listNodeLoggedInUsers(nodeId: string, options?: RequestOptions): Promise<LoggedInUser[]> {
    toRequiredWireInteger(nodeId, "nodeId");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "listNodeLoggedInUsers",
          listNodeLoggedInUsers: { requestId, nodeId }
        }
      }),
      options
    );
    if (!Array.isArray(result)) {
      throw new ProtocolError("missing items in list_node_logged_in_users_response");
    }
    return result;
  }

  /**
   * 解析用户在所有集群节点上的会话信息。
   * 返回用户在哪些节点在线、活跃会话列表及其连接方式。
   *
   * @param user - 目标用户引用
   * @param options - 可选的请求选项
   * @returns 用户会话解析结果（在线节点和会话列表）
   */
  async resolveUserSessions(user: UserRef, options?: RequestOptions): Promise<ResolveUserSessionsResult> {
    validateUserRef(user, "user");

    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "resolveUserSessions",
          resolveUserSessions: {
            requestId,
            user: userRefToProto(user)
          }
        }
      }),
      options
    );
    if (!isResolveUserSessionsResult(result)) {
      throw new ProtocolError("missing resolve_user_sessions_response");
    }
    return result;
  }

  /**
   * 获取当前连接的集群节点的运行状态。
   * 包含消息窗口、事件序列、写入门控、冲突统计、消息裁剪、投影和对等节点同步状态。
   *
   * @param options - 可选的请求选项
   * @returns 操作状态对象
   */
  async operationsStatus(options?: RequestOptions): Promise<OperationsStatus> {
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "operationsStatus",
          operationsStatus: { requestId }
        }
      }),
      options
    );
    if (!isOperationsStatus(result)) {
      throw new ProtocolError("missing status in operations_status_response");
    }
    return result;
  }

  /**
   * 获取集群节点的性能指标文本。
   * 返回格式为 Prometheus 或其他监控系统兼容的指标格式字符串。
   *
   * @param options - 可选的请求选项
   * @returns 指标文本字符串
   */
  async metrics(options?: RequestOptions): Promise<string> {
    const result = await this.rpc(
      (requestId) => ({
        body: {
          oneofKind: "metrics",
          metrics: { requestId }
        }
      }),
      options
    );
    if (typeof result !== "string") {
      throw new ProtocolError("missing text in metrics_response");
    }
    return result;
  }

  private ensureRunLoop(): void {
    if (this.runTask != null) {
      return;
    }
    const task = this.run();
    const trackedTask = task.finally(() => {
      if (this.runTask === trackedTask) {
        this.runTask = undefined;
      }
    });
    this.runTask = trackedTask;
  }

  private async awaitRunTask(): Promise<void> {
    if (this.runTask == null) {
      return;
    }
    try {
      await this.runTask;
    } catch {
      return;
    }
  }

  private ensureConnectWaiter(): Deferred<void> {
    if (this.connectWaiter == null) {
      this.connectWaiter = createDeferred<void>();
    }
    return this.connectWaiter;
  }

  private resolveConnectWaiter(): void {
    if (this.connectWaiter == null) {
      return;
    }
    const waiter = this.connectWaiter;
    this.connectWaiter = undefined;
    waiter.resolve();
  }

  private rejectConnectWaiter(error: unknown): void {
    if (this.connectWaiter == null) {
      return;
    }
    const waiter = this.connectWaiter;
    this.connectWaiter = undefined;
    waiter.reject(copyError(error));
  }

  private async run(): Promise<void> {
    let delayMs = this.initialReconnectDelayMs;
    while (!this.closed) {
      const result = await this.connectAndServe();
      if (result.connected) {
        delayMs = this.initialReconnectDelayMs;
      }
      if (this.closed || !this.shouldRetry(result.error)) {
        this.rejectConnectWaiter(result.error);
        this.failAllPending(result.error);
        return;
      }
      await this.safeHandlerCall(this.handler.onError, result.error);
      try {
        await sleep(delayMs, this.lifecycleAbort.signal);
      } catch {
        this.failAllPending(new ClosedError());
        return;
      }
      delayMs = Math.min(delayMs * 2, this.maxReconnectDelayMs);
    }
  }

  private async connectAndServe(): Promise<ServeResult> {
    if (this.closed) {
      return { connected: false, error: new ClosedError() };
    }

    let connected = false;
    let socket: QueuedWebSocket | undefined;
    const pingAbort = new AbortController();

    try {
      const seen = await Promise.resolve(this.cursorStore.loadSeenMessages());
      socket = await this.dial();
      this.connectingSocket = socket;
      const login = {
        password: passwordWireValue(this.credentials.password),
        seenMessages: seen.map(cursorToProto),
        transientOnly: this.transientOnly,
        loginName: isLoginNameCredentials(this.credentials) ? normalizeLoginName(this.credentials.loginName) : ""
      };
      if (!isLoginNameCredentials(this.credentials)) {
        Object.assign(login, {
          user: userRefToProto({
            nodeId: this.credentials.nodeId,
            userId: this.credentials.userId
          })
        });
      }
      await this.writeProto(socket, {
        body: {
          oneofKind: "login",
          login
        }
      });

      const loginInfo = this.expectLogin(await this.readProto(socket));
      if (this.closed) {
        this.connectingSocket = undefined;
        await socket.close();
        return { connected: false, error: new ClosedError() };
      }
      this.stopReconnect = false;
      this.connectingSocket = undefined;
      this.socket = socket;
      this.currentSessionRef = { ...loginInfo.sessionRef };
      this.connected = true;
      connected = true;

      await this.safeHandlerCall(this.handler.onLogin, loginInfo);
      this.resolveConnectWaiter();

      this.pingTask = this.pingLoop(pingAbort.signal);
      const readError = await this.readLoop(socket);
      this.connected = false;
      this.currentSessionRef = undefined;
      if (this.socket === socket) {
        this.socket = undefined;
      }
      this.failAllPending(new DisconnectedError());
      await this.safeHandlerCall(this.handler.onDisconnect, readError);
      await socket.close();
      return { connected, error: readError };
    } catch (error) {
      this.connected = false;
      this.currentSessionRef = undefined;
      if (this.connectingSocket === socket) {
        this.connectingSocket = undefined;
      }
      if (this.socket === socket) {
        this.socket = undefined;
      }
      if (socket != null) {
        await socket.close();
      }
      return { connected, error };
    } finally {
      pingAbort.abort();
      if (this.pingTask != null) {
        try {
          await this.pingTask;
        } catch {
          // ignore ping task cancellation during shutdown
        } finally {
          this.pingTask = undefined;
        }
      }
    }
  }

  private async dial(): Promise<QueuedWebSocket> {
    const wsUrl = websocketUrl(this.baseUrl, this.realtimeStream);
    const ws = new WebSocket(wsUrl, {
      handshakeTimeout: this.requestTimeoutMs
    });
    try {
      await waitForSocketOpen(ws);
      return new QueuedWebSocket(ws, () => this.closed);
    } catch (error) {
      ws.removeAllListeners();
      try {
        ws.close();
      } catch {
        return Promise.reject(ensureConnectionError("dial", error));
      }
      throw ensureConnectionError("dial", error);
    }
  }

  private expectLogin(env: ProtoServerEnvelope): LoginInfo {
    switch (env.body.oneofKind) {
      case "loginResponse":
        return {
          user: userFromProto(env.body.loginResponse.user),
          protocolVersion: env.body.loginResponse.protocolVersion,
          sessionRef: sessionRefFromProto(env.body.loginResponse.sessionRef)
        };
      case "error": {
        this.stopReconnect = env.body.error.code === "unauthorized";
        throw new ServerError(env.body.error.code, env.body.error.message, env.body.error.requestId);
      }
      default:
        throw new ProtocolError("expected login_response or error");
    }
  }

  private async readLoop(socket: QueuedWebSocket): Promise<unknown> {
    while (true) {
      let env: ProtoServerEnvelope;
      try {
        env = await this.readProto(socket);
      } catch (error) {
        return error;
      }
      try {
        await this.handleServerEnvelope(env);
      } catch (error) {
        await this.safeHandlerCall(this.handler.onError, error);
      }
    }
  }

  private async handleServerEnvelope(env: ProtoServerEnvelope): Promise<void> {
    switch (env.body.oneofKind) {
      case "messagePushed": {
        const message = messageFromProto(env.body.messagePushed.message);
        await this.persistAndDispatchMessage(message);
        return;
      }
      case "packetPushed": {
        const packet = packetFromProto(env.body.packetPushed.packet);
        if (this._relay != null && this._relay.handlePacket(packet)) {
          return;
        }
        await this.safeHandlerCall(this.handler.onPacket, packet);
        return;
      }
      case "sendMessageResponse":
        await this.handleSendMessageResponse(env.body.sendMessageResponse);
        return;
      case "pong":
        this.resolvePending(env.body.pong.requestId, undefined);
        return;
      case "createUserResponse":
        this.resolvePending(env.body.createUserResponse.requestId, userFromProto(env.body.createUserResponse.user));
        return;
      case "getUserResponse":
        this.resolvePending(env.body.getUserResponse.requestId, userFromProto(env.body.getUserResponse.user));
        return;
      case "getUserMetadataResponse":
        this.resolvePending(
          env.body.getUserMetadataResponse.requestId,
          userMetadataFromProto(env.body.getUserMetadataResponse.metadata)
        );
        return;
      case "upsertUserMetadataResponse":
        this.resolvePending(
          env.body.upsertUserMetadataResponse.requestId,
          userMetadataFromProto(env.body.upsertUserMetadataResponse.metadata)
        );
        return;
      case "deleteUserMetadataResponse":
        this.resolvePending(
          env.body.deleteUserMetadataResponse.requestId,
          userMetadataFromProto(env.body.deleteUserMetadataResponse.metadata)
        );
        return;
      case "scanUserMetadataResponse":
        this.resolvePending(
          env.body.scanUserMetadataResponse.requestId,
          userMetadataScanResultFromProto(env.body.scanUserMetadataResponse)
        );
        return;
      case "updateUserResponse":
        this.resolvePending(env.body.updateUserResponse.requestId, userFromProto(env.body.updateUserResponse.user));
        return;
      case "deleteUserResponse":
        this.resolvePending(env.body.deleteUserResponse.requestId, {
          status: env.body.deleteUserResponse.status,
          user: {
            nodeId: env.body.deleteUserResponse.user?.nodeId ?? "0",
            userId: env.body.deleteUserResponse.user?.userId ?? "0"
          }
        } satisfies DeleteUserResult);
        return;
      case "listMessagesResponse":
        this.resolvePending(env.body.listMessagesResponse.requestId, env.body.listMessagesResponse.items.map(messageFromProto));
        return;
      case "listUsersResponse":
        this.resolvePending(env.body.listUsersResponse.requestId, env.body.listUsersResponse.items.map(userFromProto));
        return;
      case "upsertUserAttachmentResponse":
        this.resolvePending(
          env.body.upsertUserAttachmentResponse.requestId,
          attachmentFromProto(env.body.upsertUserAttachmentResponse.attachment)
        );
        return;
      case "deleteUserAttachmentResponse":
        this.resolvePending(
          env.body.deleteUserAttachmentResponse.requestId,
          attachmentFromProto(env.body.deleteUserAttachmentResponse.attachment)
        );
        return;
      case "listUserAttachmentsResponse":
        this.resolvePending(
          env.body.listUserAttachmentsResponse.requestId,
          env.body.listUserAttachmentsResponse.items.map(attachmentFromProto)
        );
        return;
      case "listEventsResponse":
        this.resolvePending(env.body.listEventsResponse.requestId, eventsFromProto(env.body.listEventsResponse.items));
        return;
      case "listClusterNodesResponse":
        this.resolvePending(
          env.body.listClusterNodesResponse.requestId,
          clusterNodesFromProto(env.body.listClusterNodesResponse.items)
        );
        return;
      case "listNodeLoggedInUsersResponse":
        this.resolvePending(
          env.body.listNodeLoggedInUsersResponse.requestId,
          loggedInUsersFromProto(env.body.listNodeLoggedInUsersResponse.items)
        );
        return;
      case "resolveUserSessionsResponse":
        this.resolvePending(
          env.body.resolveUserSessionsResponse.requestId,
          resolveUserSessionsFromProto(env.body.resolveUserSessionsResponse)
        );
        return;
      case "operationsStatusResponse":
        this.resolvePending(
          env.body.operationsStatusResponse.requestId,
          operationsStatusFromProto(env.body.operationsStatusResponse.status)
        );
        return;
      case "metricsResponse":
        this.resolvePending(env.body.metricsResponse.requestId, env.body.metricsResponse.text);
        return;
      case "error": {
        const error = new ServerError(env.body.error.code, env.body.error.message, env.body.error.requestId);
        if (env.body.error.requestId !== "0") {
          this.rejectPending(env.body.error.requestId, error);
          return;
        }
        throw error;
      }
      case "loginResponse":
        throw new ProtocolError("unexpected login_response after authentication");
      default:
        throw new ProtocolError("unsupported server envelope");
    }
  }

  private async handleSendMessageResponse(response: ProtoSendMessageResponse): Promise<void> {
    const requestId = response.requestId;
    switch (response.body.oneofKind) {
      case "message": {
        try {
          const message = messageFromProto(response.body.message);
          await this.persistAndDispatchMessage(message);
          this.resolvePending(requestId, message);
        } catch (error) {
          this.rejectPending(requestId, error);
        }
        return;
      }
      case "transientAccepted":
        this.resolvePending(requestId, relayAcceptedFromProto(response.body.transientAccepted));
        return;
      default:
        this.rejectPending(requestId, new ProtocolError("empty send_message_response"));
    }
  }

  private async persistAndDispatchMessage(message: Message): Promise<void> {
    await Promise.resolve(this.cursorStore.saveMessage(message));
    await Promise.resolve(this.cursorStore.saveCursor(cursorForMessage(message)));
    if (this.ackMessages) {
      try {
        await this.sendEnvelope({
          body: {
            oneofKind: "ackMessage",
            ackMessage: { cursor: cursorToProto(cursorForMessage(message)) }
          }
        });
      } catch (error) {
        if (!(error instanceof ClosedError) && !(error instanceof NotConnectedError)) {
          await this.safeHandlerCall(this.handler.onError, error);
        }
      }
    }
    await this.safeHandlerCall(this.handler.onMessage, message);
  }

  private async pingLoop(signal: AbortSignal): Promise<void> {
    while (!this.closed && this.connected) {
      try {
        await sleep(this.pingIntervalMs, signal);
      } catch {
        return;
      }
      if (this.closed || !this.connected) {
        return;
      }
      try {
        await this.ping({ timeoutMs: this.requestTimeoutMs });
      } catch (error) {
        if (
          !(error instanceof NotConnectedError) &&
          !(error instanceof ClosedError) &&
          !(error instanceof DisconnectedError)
        ) {
          await this.safeHandlerCall(this.handler.onError, error);
        }
      }
    }
  }

  private nextRequestId(): string {
    this.requestId += 1n;
    return this.requestId.toString();
  }

  private async rpc(build: (requestId: string) => Parameters<typeof ProtoClientEnvelope.toBinary>[0], options?: RequestOptions): Promise<unknown> {
    const requestId = this.nextRequestId();
    const pending = this.registerPending(requestId);
    const abort = mergeAbortSignals(
      options?.signal == null
        ? { timeoutMs: options?.timeoutMs ?? this.requestTimeoutMs }
        : { signal: options.signal, timeoutMs: options.timeoutMs ?? this.requestTimeoutMs }
    );
    try {
      await this.sendEnvelope(build(requestId));
      return await waitForPromise(pending.promise, abort.signal);
    } finally {
      abort.cleanup();
      this.pending.delete(requestId);
    }
  }

  private registerPending(requestId: string): Deferred<unknown> {
    if (this.closed) {
      throw new ClosedError();
    }
    const deferred = createDeferred<unknown>();
    deferred.promise.catch(() => undefined);
    this.pending.set(requestId, deferred);
    return deferred;
  }

  private resolvePending(requestId: string, value: unknown): void {
    const deferred = this.pending.get(requestId);
    if (deferred == null) {
      return;
    }
    deferred.resolve(value);
  }

  private rejectPending(requestId: string, error: unknown): void {
    const deferred = this.pending.get(requestId);
    if (deferred == null) {
      return;
    }
    deferred.reject(copyError(error));
  }

  private failAllPending(error: unknown): void {
    for (const [requestId, deferred] of this.pending) {
      deferred.reject(copyError(error));
      this.pending.delete(requestId);
    }
  }

  private shouldRetry(error: unknown): boolean {
    if (this.closed || this.stopReconnect || !this.reconnectEnabled) {
      return false;
    }
    if (error instanceof ServerError && error.unauthorized()) {
      return false;
    }
    return !(error instanceof ClosedError);
  }

  private async sendEnvelope(env: Parameters<typeof ProtoClientEnvelope.toBinary>[0]): Promise<void> {
    const socket = this.socket;
    if (this.closed) {
      throw new ClosedError();
    }
    if (socket == null || !socket.isOpen()) {
      throw new NotConnectedError();
    }
    await this.writeProto(socket, env);
  }

  private async writeProto(socket: QueuedWebSocket, env: Parameters<typeof ProtoClientEnvelope.toBinary>[0]): Promise<void> {
    const payload = ProtoClientEnvelope.toBinary(ProtoClientEnvelope.create(env));
    const writeTask = this.writeChain.catch(() => undefined).then(() => socket.write(payload));
    this.writeChain = writeTask.then(() => undefined, () => undefined);
    try {
      await writeTask;
    } catch (error) {
      throw ensureConnectionError("write", error);
    }
  }

  private async readProto(socket: QueuedWebSocket): Promise<ProtoServerEnvelope> {
    const frame = await socket.read();
    if (!frame.isBinary) {
      throw new ProtocolError("invalid protobuf frame");
    }
    try {
      return ProtoServerEnvelope.fromBinary(rawDataToBytes(frame.data));
    } catch (error) {
      throw new ProtocolError("invalid protobuf frame");
    }
  }

  private async safeHandlerCall<T>(callback: (value: T) => void | Promise<void>, value: T): Promise<void>;
  private async safeHandlerCall(callback: () => void | Promise<void>): Promise<void>;
  private async safeHandlerCall(callback: ((...args: unknown[]) => void | Promise<void>), ...args: unknown[]): Promise<void> {
    try {
      await callback.apply(this.handler, args);
    } catch {
      return;
    }
  }
}

class QueuedWebSocket {
  private readonly frames: Frame[] = [];
  private readonly waiters: Deferred<Frame>[] = [];
  private readonly closePromise: Promise<void>;

  private closedError?: unknown;
  private socketError?: Error;

  constructor(
    private readonly socket: WebSocket,
    private readonly isClientClosed: () => boolean
  ) {
    const closeDeferred = createDeferred<void>();
    this.closePromise = closeDeferred.promise;

    socket.on("message", (data, isBinary) => {
      if (this.closedError != null) {
        return;
      }
      const frame = { data, isBinary };
      const waiter = this.waiters.shift();
      if (waiter == null) {
        this.frames.push(frame);
      } else {
        waiter.resolve(frame);
      }
    });

    socket.on("error", (error) => {
      this.socketError = error;
    });

    socket.on("close", (code, reason) => {
      const detail = Buffer.from(reason).toString("utf8");
      const cause = this.socketError ?? new Error(detail === ""
        ? `websocket closed with code ${code}`
        : `websocket closed with code ${code}: ${detail}`);
      const error = this.isClientClosed() ? new ClosedError() : new ConnectionError("read", cause);
      this.finish(error);
      closeDeferred.resolve();
    });
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  async read(): Promise<Frame> {
    const frame = this.frames.shift();
    if (frame != null) {
      return frame;
    }
    if (this.closedError != null) {
      throw copyError(this.closedError);
    }
    const deferred = createDeferred<Frame>();
    this.waiters.push(deferred);
    return deferred.promise;
  }

  async write(payload: Uint8Array): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new NotConnectedError();
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.send(payload, { binary: true }, (error) => {
        if (error == null) {
          resolve();
          return;
        }
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    this.finish(new ClosedError());
    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    const forceClose = setTimeout(() => {
      if (this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.terminate();
      }
    }, 200);
    try {
      await this.closePromise;
    } finally {
      clearTimeout(forceClose);
    }
  }

  private finish(error: unknown): void {
    if (this.closedError != null) {
      return;
    }
    this.closedError = error;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(copyError(error));
    }
  }
}

function validateLimit(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function normalizeListUsersName(name: string | undefined): string {
  return name?.trim() ?? "";
}

function listUsersUidToProto(uid: UserRef): { nodeId: string; userId: string } {
  if (isZeroUserRef(uid)) {
    return { nodeId: "0", userId: "0" };
  }
  return userRefToProto(uid);
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function websocketUrl(baseUrl: string, realtime: boolean): string {
  const url = new URL(baseUrl);
  switch (url.protocol) {
    case "http:":
      url.protocol = "ws:";
      break;
    case "https:":
      url.protocol = "wss:";
      break;
    case "ws:":
    case "wss:":
      break;
    default:
      throw new Error(`unsupported base URL scheme ${JSON.stringify(url.protocol.replace(/:$/, ""))}`);
  }
  const suffix = realtime ? "/ws/realtime" : "/ws/client";
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath === "" ? suffix : `${basePath}${suffix}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      const detail = reason.toString("utf8");
      reject(new Error(detail === ""
        ? `websocket closed with code ${code}`
        : `websocket closed with code ${code}: ${detail}`));
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError("unsupported websocket frame payload");
}

function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function copyError(error: unknown): unknown {
  if (error instanceof ClosedError) {
    return new ClosedError();
  }
  if (error instanceof NotConnectedError) {
    return new NotConnectedError();
  }
  if (error instanceof DisconnectedError) {
    return new DisconnectedError();
  }
  if (error instanceof ServerError) {
    return new ServerError(error.code, error.serverMessage, error.requestId);
  }
  if (error instanceof ProtocolError) {
    return new ProtocolError(error.protocolMessage);
  }
  if (error instanceof ConnectionError) {
    return new ConnectionError(error.op, error.cause);
  }
  return error;
}

function ensureConnectionError(op: string, error: unknown): ConnectionError {
  return error instanceof ConnectionError ? error : new ConnectionError(op, error);
}

function isMessage(value: unknown): value is Message {
  return value != null && typeof value === "object" && "seq" in value && "body" in value;
}

function isRelayAccepted(value: unknown): value is RelayAccepted {
  return value != null && typeof value === "object" && "packetId" in value && "recipient" in value;
}

function isUser(value: unknown): value is User {
  return value != null && typeof value === "object" && "username" in value && "role" in value;
}

function isDeleteUserResult(value: unknown): value is DeleteUserResult {
  return value != null && typeof value === "object" && "status" in value && "user" in value;
}

function isAttachment(value: unknown): value is Attachment {
  return value != null && typeof value === "object" && "owner" in value && "subject" in value;
}

function isUserMetadata(value: unknown): value is UserMetadata {
  return value != null && typeof value === "object" && "owner" in value && "key" in value && "value" in value;
}

function isUserMetadataScanResult(value: unknown): value is UserMetadataScanResult {
  return value != null && typeof value === "object" && "items" in value && "count" in value && "nextAfter" in value;
}

function isSubscription(value: unknown): value is Subscription {
  return value != null && typeof value === "object" && "subscriber" in value && "channel" in value;
}

function isBlacklistEntry(value: unknown): value is BlacklistEntry {
  return value != null && typeof value === "object" && "owner" in value && "blocked" in value;
}

function isResolveUserSessionsResult(value: unknown): value is ResolveUserSessionsResult {
  return value != null && typeof value === "object" && "user" in value && "presence" in value && "sessions" in value;
}

function isOperationsStatus(value: unknown): value is OperationsStatus {
  return value != null && typeof value === "object" && "nodeId" in value && "peers" in value;
}
