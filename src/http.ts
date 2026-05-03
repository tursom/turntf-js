import { ConnectionError, ProtocolError } from "./errors";
import { passwordWireValue, plainPassword, type PasswordInput } from "./password";
import {
  AttachmentType,
  type Attachment,
  type DeleteUserResult,
  DeliveryMode,
  type BlacklistEntry,
  type ClusterNode,
  type CreateUserRequest,
  type Event,
  type ListUsersRequest,
  type LoggedInUser,
  type Message,
  type OperationsStatus,
  type PeerOriginStatus,
  type PeerStatus,
  type RequestOptions,
  type ScanUserMetadataRequest,
  type UpdateUserRequest,
  type UpsertUserMetadataRequest,
  type UserMetadata,
  type UserMetadataScanResult,
  type User,
  type UserRef
} from "./types";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  mergeAbortSignals,
  parseJson,
  stringifyJson,
  utf8ToBytes
} from "./utils";
import {
  assertDecimalString,
  idToString,
  isZeroUserRef,
  normalizeLoginName,
  toRequiredWireInteger,
  validateDeliveryMode,
  validateListUsersRequest,
  validateLoginName,
  validateUserMetadataKey,
  validateUserMetadataScanRequest,
  validateUserRef
} from "./validation";

/**
 * HTTP 客户端选项。
 */
export interface HTTPClientOptions {
  /** 自定义 fetch 函数，用于替换全局 fetch，适用于测试或特定运行时环境 */
  fetch?: typeof fetch;
}

/**
 * HTTP 客户端，提供基于 REST API 的 HTTP 请求封装。
 * 所有 API 方法都返回 Promise，支持通过 RequestOptions 设置超时和取消。
 * 与 WebSocket 客户端（Client）不同，HTTP 客户端提供无状态的 RESTful API 调用。
 */
export class HTTPClient {
  /** 基础 URL（已去除尾部斜杠） */
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /**
   * 创建 HTTPClient 实例。
   *
   * @param baseUrl - 服务器基础 URL，例如 "http://localhost:8080"
   * @param options - 可选配置
   * @throws 如果 baseUrl 为空或 fetch 不可用则抛出错误
   */
  constructor(baseUrl: string, options: HTTPClientOptions = {}) {
    if (baseUrl.trim() === "") {
      throw new Error("baseUrl is required");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (this.fetchImpl == null) {
      throw new Error("fetch is required");
    }
  }

  /**
   * 使用明文密码登录（异步密码处理）。
   * 支持两种登录方式：
   * 1. 通过 (nodeId, userId, password) 登录
   * 2. 通过 (loginName, password) 登录
   *
   * @param nodeIdOrLoginName - 节点 ID 或登录名
   * @param userIdOrPassword - 用户 ID 或密码
   * @param passwordOrOptions - 密码或请求选项
   * @param maybeOptions - 请求选项（当使用 nodeId/userId 方式时）
   * @returns 返回认证令牌（token）字符串
   * @throws {ConnectionError} 网络连接失败时抛出
   * @throws {ProtocolError} 服务器返回异常时抛出
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
      return this.loginWithPassword(
        nodeIdOrLoginName,
        userIdOrPassword,
        await plainPassword(passwordOrOptions),
        maybeOptions
      );
    }
    return this.loginWithPassword(
      nodeIdOrLoginName,
      await plainPassword(userIdOrPassword),
      passwordOrOptions
    );
  }

  /**
   * 使用 PasswordInput 对象登录（密码已由调用方处理）。
   * 支持两种登录方式：
   * 1. 通过 (nodeId, userId, password) 登录
   * 2. 通过 (loginName, password) 登录
   *
   * @param nodeIdOrLoginName - 节点 ID 或登录名
   * @param userIdOrPassword - 用户 ID 或 PasswordInput
   * @param passwordOrOptions - PasswordInput 或请求选项
   * @param maybeOptions - 请求选项（当使用 nodeId/userId 方式时）
   * @returns 返回认证令牌（token）字符串
   * @throws {ConnectionError} 网络连接失败时抛出
   * @throws {ProtocolError} 服务器返回异常或 token 为空时抛出
   */
  async loginWithPassword(nodeId: string, userId: string, password: PasswordInput, options?: RequestOptions): Promise<string>;
  async loginWithPassword(loginName: string, password: PasswordInput, options?: RequestOptions): Promise<string>;
  async loginWithPassword(
    nodeIdOrLoginName: string,
    userIdOrPassword: string | PasswordInput,
    passwordOrOptions?: PasswordInput | RequestOptions,
    maybeOptions?: RequestOptions
  ): Promise<string> {
    let body: Record<string, unknown>;
    let options: RequestOptions | undefined;
    if (typeof userIdOrPassword === "string") {
      if (!isPasswordInput(passwordOrOptions)) {
        throw new Error("password is required");
      }
      body = {
        node_id: toRequiredWireInteger(nodeIdOrLoginName, "nodeId"),
        user_id: toRequiredWireInteger(userIdOrPassword, "userId"),
        password: passwordWireValue(passwordOrOptions)
      };
      options = maybeOptions;
    } else {
      const loginName = normalizeLoginName(nodeIdOrLoginName);
      validateLoginName(loginName, "loginName");
      body = {
        login_name: loginName,
        password: passwordWireValue(userIdOrPassword)
      };
      options = passwordOrOptions as RequestOptions | undefined;
    }

    const response = await this.doJSON("POST", "/auth/login", "", body, [200], options);
    const token = objectField(response, "token");
    if (typeof token !== "string" || token === "") {
      throw new ProtocolError("empty token in login response");
    }
    return token;
  }

  /**
   * 创建新用户。
   *
   * @param token - 认证令牌
   * @param request - 创建用户请求参数
   * @param options - 可选请求选项
   * @returns 创建的用户信息
   * @throws 如果用户名或角色为空则抛出错误
   */
  async createUser(token: string, request: CreateUserRequest, options?: RequestOptions): Promise<User> {
    if (request.username === "") {
      throw new Error("username is required");
    }
    if (request.role === "") {
      throw new Error("role is required");
    }
    const body: Record<string, unknown> = {
      username: request.username,
      role: request.role
    };
    if (request.loginName !== undefined) {
      body.login_name = normalizeLoginName(request.loginName);
    }
    if (request.password) {
      body.password = passwordWireValue(request.password);
    }
    if (request.profileJson && request.profileJson.length > 0) {
      body.profile = parseJson(bytesToUtf8(request.profileJson));
    }
    const response = await this.doJSON("POST", "/users", token, body, [200, 201], options);
    return userFromHTTP(response);
  }

  /**
   * 创建频道（Channel）。
   * 实质是创建角色为 "channel" 的特殊用户。
   *
   * @param token - 认证令牌
   * @param request - 创建频道请求（自动设置 role 为 "channel"）
   * @param options - 可选请求选项
   * @returns 创建的频道用户信息
   */
  createChannel(token: string, request: Omit<CreateUserRequest, "role"> & Partial<Pick<CreateUserRequest, "role">>, options?: RequestOptions): Promise<User> {
    return this.createUser(token, { ...request, role: request.role ?? "channel" }, options);
  }

  /**
   * 获取当前用户可通讯的活跃用户列表。
   * 支持按名称子串和用户唯一标识过滤。
   *
   * @param token - 认证令牌
   * @param request - 可选过滤条件
   * @param options - 可选请求选项
   * @returns 用户列表
   */
  async listUsers(token: string, request: ListUsersRequest = {}, options?: RequestOptions): Promise<User[]> {
    validateListUsersRequest(request, "request");
    const query = new URLSearchParams();
    const name = normalizeListUsersName(request.name);
    if (name !== undefined) {
      query.set("name", name);
    }
    const uid = uidFilterToHTTP(request.uid);
    if (uid !== undefined) {
      query.set("uid", uid);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await this.doJSON("GET", `/users${suffix}`, token, undefined, [200], options);
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(userFromHTTP);
  }

  /**
   * 创建用户对频道的订阅关系。
   *
   * @param token - 认证令牌
   * @param user - 订阅者引用
   * @param channel - 频道引用
   * @param options - 可选请求选项
   */
  async createSubscription(token: string, user: UserRef, channel: UserRef, options?: RequestOptions): Promise<void> {
    await this.upsertAttachment(token, user, channel, AttachmentType.ChannelSubscription, new Uint8Array(), options);
  }

  /**
   * 获取指定用户的消息列表。
   * 可选参数 limit 控制返回的最大消息数量。
   * 可选参数 peer 用于指定会话对端用户引用（同时提供 peer.nodeId 和 peer.userId 时生效）。
   *
   * 注意：target 的 nodeId/userId 允许为 "0"（作为"当前用户"的 sentinel 值），
   * 因此此处不使用 validateUserRef（它会拒绝 "0"）。
   *
   * @param token - 认证令牌
   * @param target - 目标用户引用
   * @param limit - 返回消息的最大数量，0 表示不限制
   * @param peer - 可选的会话对端用户引用
   * @param options - 可选请求选项
   * @returns 消息对象数组
   */
  async listMessages(token: string, target: UserRef, limit = 0, peer?: UserRef, options?: RequestOptions): Promise<Message[]> {
    // 宽松验证：允许 "0" 作为 sentinel（当前用户）
    assertDecimalString(target.nodeId, "target.nodeId");
    assertDecimalString(target.userId, "target.userId");
    const query = new URLSearchParams();
    if (limit > 0) {
      query.set("limit", String(limit));
    }
    if (peer != null) {
      assertDecimalString(peer.nodeId, "peer.nodeId");
      assertDecimalString(peer.userId, "peer.userId");
      query.set("peer_node_id", peer.nodeId);
      query.set("peer_user_id", peer.userId);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await this.doJSON(
      "GET",
      `/nodes/${target.nodeId}/users/${target.userId}/messages${suffix}`,
      token,
      undefined,
      [200],
      options
    );
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(messageFromHTTP);
  }

  /**
   * 向目标用户发送持久化消息。
   * 消息会被存储在服务器上，接收方可以后续拉取。
   *
   * @param token - 认证令牌
   * @param target - 目标用户引用
   * @param body - 消息体（字节数组），不能为空
   * @param options - 可选请求选项
   * @returns 发送的消息对象
   * @throws 如果消息体为空则抛出错误
   */
  async postMessage(token: string, target: UserRef, body: Uint8Array, options?: RequestOptions): Promise<Message> {
    validateUserRef(target, "target");
    if (body.length === 0) {
      throw new Error("body is required");
    }
    const response = await this.doJSON(
      "POST",
      `/nodes/${target.nodeId}/users/${target.userId}/messages`,
      token,
      { body: bytesToBase64(body) },
      [200, 201],
      options
    );
    return messageFromHTTP(response);
  }

  /**
   * 向目标节点发送瞬态数据包（Packet）。
   * 数据包不会被持久化存储，投递模式决定是否进行重试。
   *
   * @param token - 认证令牌
   * @param targetNodeId - 目标节点 ID
   * @param relayTarget - 中转目标用户引用
   * @param body - 数据包体（字节数组），不能为空
   * @param mode - 投递模式（BestEffort 或 RouteRetry）
   * @param options - 可选请求选项
   * @throws 如果节点 ID 与用户节点 ID 不匹配、消息体为空或投递模式无效则抛出错误
   */
  async postPacket(
    token: string,
    targetNodeId: string,
    relayTarget: UserRef,
    body: Uint8Array,
    mode: DeliveryMode,
    options?: RequestOptions
  ): Promise<void> {
    toRequiredWireInteger(targetNodeId, "targetNodeId");
    validateUserRef(relayTarget, "relayTarget");
    if (targetNodeId !== relayTarget.nodeId) {
      throw new Error(`target node ID ${targetNodeId} does not match target user nodeId ${relayTarget.nodeId}`);
    }
    if (body.length === 0) {
      throw new Error("body is required");
    }
    validateDeliveryMode(mode);
    await this.doJSON(
      "POST",
      `/nodes/${relayTarget.nodeId}/users/${relayTarget.userId}/messages`,
      token,
      {
        body: bytesToBase64(body),
        delivery_kind: "transient",
        delivery_mode: mode
      },
      [202],
      options
    );
  }

  /**
   * 获取集群中所有节点的信息列表。
   *
   * @param token - 认证令牌
   * @param options - 可选请求选项
   * @returns 集群节点信息数组
   */
  async listClusterNodes(token: string, options?: RequestOptions): Promise<ClusterNode[]> {
    const response = await this.doJSON("GET", "/cluster/nodes", token, undefined, [200], options);
    const items = Array.isArray(response) ? response : (Array.isArray(objectField(response, "nodes"))
      ? arrayField(response, "nodes")
      : arrayField(response, "items"));
    return items.map(clusterNodeFromHTTP);
  }

  /**
   * 获取指定集群节点上当前已登录的用户列表。
   *
   * @param token - 认证令牌
   * @param nodeId - 集群节点 ID
   * @param options - 可选请求选项
   * @returns 已登录用户信息数组
   */
  async listNodeLoggedInUsers(token: string, nodeId: string, options?: RequestOptions): Promise<LoggedInUser[]> {
    toRequiredWireInteger(nodeId, "nodeId");
    const response = await this.doJSON("GET", `/cluster/nodes/${nodeId}/logged-in-users`, token, undefined, [200], options);
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(loggedInUserFromHTTP);
  }

  /**
   * 将用户加入黑名单。
   *
   * @param token - 认证令牌
   * @param owner - 黑名单所有者引用
   * @param blocked - 被屏蔽的用户引用
   * @param options - 可选请求选项
   * @returns 黑名单条目
   */
  async blockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.upsertAttachment(token, owner, blocked, AttachmentType.UserBlacklist, new Uint8Array(), options);
    return blacklistEntryFromHTTP(attachment);
  }

  /**
   * 将用户从黑名单中移除（解除屏蔽）。
   *
   * @param token - 认证令牌
   * @param owner - 黑名单所有者引用
   * @param blocked - 被解除屏蔽的用户引用
   * @param options - 可选请求选项
   * @returns 黑名单条目（包含删除时间）
   */
  async unblockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.deleteAttachment(token, owner, blocked, AttachmentType.UserBlacklist, options);
    return blacklistEntryFromHTTP(attachment);
  }

  /**
   * 获取指定用户的黑名单列表。
   *
   * @param token - 认证令牌
   * @param owner - 黑名单所有者引用
   * @param options - 可选请求选项
   * @returns 黑名单条目数组
   */
  async listBlockedUsers(token: string, owner: UserRef, options?: RequestOptions): Promise<BlacklistEntry[]> {
    const items = await this.listAttachments(token, owner, AttachmentType.UserBlacklist, options);
    return items.map(blacklistEntryFromHTTP);
  }

  /**
   * 获取指定用户的元数据。
   *
   * @param token - 认证令牌
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param options - 可选请求选项
   * @returns 用户元数据对象
   */
  async getUserMetadata(token: string, owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata> {
    validateUserRef(owner, "owner");
    validateUserMetadataKey(key, "key");
    const response = await this.doJSON(
      "GET",
      `/nodes/${owner.nodeId}/users/${owner.userId}/metadata/${encodeURIComponent(key)}`,
      token,
      undefined,
      [200],
      options
    );
    return userMetadataFromHTTP(response);
  }

  /**
   * 创建或更新用户元数据。
   * 如果键名已存在则更新，不存在则创建。
   * 支持设置过期时间，过期后元数据自动删除。
   *
   * @param token - 认证令牌
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param request - 元数据内容（值和过期时间）
   * @param options - 可选请求选项
   * @returns 更新后的用户元数据对象
   */
  async upsertUserMetadata(
    token: string,
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
    const body: Record<string, unknown> = {
      value: bytesToBase64(request.value)
    };
    if (request.expiresAt !== undefined) {
      body.expires_at = request.expiresAt;
    }
    const response = await this.doJSON(
      "PUT",
      `/nodes/${owner.nodeId}/users/${owner.userId}/metadata/${encodeURIComponent(key)}`,
      token,
      body,
      [200, 201],
      options
    );
    return userMetadataFromHTTP(response);
  }

  /**
   * 删除指定用户元数据。
   *
   * @param token - 认证令牌
   * @param owner - 元数据所有者引用
   * @param key - 元数据键名
   * @param options - 可选请求选项
   * @returns 被删除的用户元数据对象（包含删除时间）
   */
  async deleteUserMetadata(token: string, owner: UserRef, key: string, options?: RequestOptions): Promise<UserMetadata> {
    validateUserRef(owner, "owner");
    validateUserMetadataKey(key, "key");
    const response = await this.doJSON(
      "DELETE",
      `/nodes/${owner.nodeId}/users/${owner.userId}/metadata/${encodeURIComponent(key)}`,
      token,
      undefined,
      [200],
      options
    );
    return userMetadataFromHTTP(response);
  }

  /**
   * 扫描用户元数据，支持按前缀过滤和分页。
   *
   * @param token - 认证令牌
   * @param owner - 元数据所有者引用
   * @param request - 扫描请求参数（前缀、分页游标、数量限制）
   * @param options - 可选请求选项
   * @returns 元数据扫描结果（包含匹配项列表和下一页游标）
   */
  async scanUserMetadata(
    token: string,
    owner: UserRef,
    request: ScanUserMetadataRequest = {},
    options?: RequestOptions
  ): Promise<UserMetadataScanResult> {
    validateUserRef(owner, "owner");
    validateUserMetadataScanRequest(request, "request");
    const query = new URLSearchParams();
    if (request.prefix != null && request.prefix !== "") {
      query.set("prefix", request.prefix);
    }
    if (request.after != null && request.after !== "") {
      query.set("after", request.after);
    }
    if (request.limit != null && request.limit > 0) {
      query.set("limit", String(request.limit));
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await this.doJSON(
      "GET",
      `/nodes/${owner.nodeId}/users/${owner.userId}/metadata${suffix}`,
      token,
      undefined,
      [200],
      options
    );
    return userMetadataScanResultFromHTTP(response);
  }

  /**
   * 创建或更新附件关系。
   * 用于管理频道管理员、频道写入者、频道订阅和用户黑名单等关联关系。
   *
   * @param token - 认证令牌
   * @param owner - 附件所有者引用
   * @param subject - 附件主体引用
   * @param attachmentType - 附件类型
   * @param configJson - 配置信息的 JSON 字节数组
   * @param options - 可选请求选项
   * @returns 附件对象
   */
  async upsertAttachment(
    token: string,
    owner: UserRef,
    subject: UserRef,
    attachmentType: AttachmentType,
    configJson: Uint8Array,
    options?: RequestOptions
  ): Promise<Attachment> {
    validateUserRef(owner, "owner");
    validateUserRef(subject, "subject");
    const response = await this.doJSON(
      "PUT",
      `/nodes/${owner.nodeId}/users/${owner.userId}/attachments/${attachmentType}/${subject.nodeId}/${subject.userId}`,
      token,
      {
        config_json: configJson.length === 0 ? {} : parseJson(bytesToUtf8(configJson))
      },
      [200, 201],
      options
    );
    return attachmentFromHTTP(response);
  }

  /**
   * 删除附件关系。
   *
   * @param token - 认证令牌
   * @param owner - 附件所有者引用
   * @param subject - 附件主体引用
   * @param attachmentType - 附件类型
   * @param options - 可选请求选项
   * @returns 被删除的附件对象（包含删除时间）
   */
  async deleteAttachment(
    token: string,
    owner: UserRef,
    subject: UserRef,
    attachmentType: AttachmentType,
    options?: RequestOptions
  ): Promise<Attachment> {
    validateUserRef(owner, "owner");
    validateUserRef(subject, "subject");
    const response = await this.doJSON(
      "DELETE",
      `/nodes/${owner.nodeId}/users/${owner.userId}/attachments/${attachmentType}/${subject.nodeId}/${subject.userId}`,
      token,
      undefined,
      [200],
      options
    );
    return attachmentFromHTTP(response);
  }

  /**
   * 获取指定用户的附件列表。
   * 可选参数 attachmentType 用于按类型过滤附件。
   *
   * @param token - 认证令牌
   * @param owner - 附件所有者引用
   * @param attachmentType - 可选的附件类型过滤
   * @param options - 可选请求选项
   * @returns 附件对象数组
   */
  async listAttachments(token: string, owner: UserRef, attachmentType?: AttachmentType, options?: RequestOptions): Promise<Attachment[]> {
    validateUserRef(owner, "owner");
    const query = attachmentType ? `?attachment_type=${encodeURIComponent(attachmentType)}` : "";
    const response = await this.doJSON(
      "GET",
      `/nodes/${owner.nodeId}/users/${owner.userId}/attachments${query}`,
      token,
      undefined,
      [200],
      options
    );
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(attachmentFromHTTP);
  }

  /**
   * 获取指定用户的详细信息。
   */
  async getUser(token: string, target: UserRef, options?: RequestOptions): Promise<User> {
    validateUserRef(target, "target");
    const response = await this.doJSON(
      "GET",
      `/nodes/${target.nodeId}/users/${target.userId}`,
      token,
      undefined,
      [200],
      options
    );
    return userFromHTTP(response);
  }

  /**
   * 更新用户信息。仅已设置的字段会被更新。
   * login_name 为空字符串时解除登录名绑定。频道（role="channel"）不支持设置 login_name。
   */
  async updateUser(token: string, target: UserRef, request: UpdateUserRequest, options?: RequestOptions): Promise<User> {
    validateUserRef(target, "target");
    if (request.role === "channel" && request.loginName != null && request.loginName !== "") {
      throw new Error("channel users cannot have a login_name");
    }
    const body: Record<string, unknown> = {};
    if (request.username !== undefined) {
      body.username = request.username;
    }
    if (request.loginName !== undefined) {
      body.login_name = request.loginName === "" ? "" : request.loginName.trim();
    }
    if (request.password) {
      body.password = passwordWireValue(request.password);
    }
    if (request.profileJson && request.profileJson.length > 0) {
      body.profile = parseJson(bytesToUtf8(request.profileJson));
    }
    if (request.role !== undefined) {
      body.role = request.role;
    }
    const response = await this.doJSON(
      "PATCH",
      `/nodes/${target.nodeId}/users/${target.userId}`,
      token,
      body,
      [200],
      options
    );
    return userFromHTTP(response);
  }

  /**
   * 删除指定用户（软删除）。
   */
  async deleteUser(token: string, target: UserRef, options?: RequestOptions): Promise<DeleteUserResult> {
    validateUserRef(target, "target");
    const response = await this.doJSON(
      "DELETE",
      `/nodes/${target.nodeId}/users/${target.userId}`,
      token,
      undefined,
      [200],
      options
    );
    return deleteUserResultFromHTTP(response);
  }

  /**
   * 查询事件日志，支持分页游标。
   */
  async listEvents(token: string, after = "0", limit = 0, options?: RequestOptions): Promise<Event[]> {
    const query = new URLSearchParams();
    if (after !== "0") {
      query.set("after", after);
    }
    if (limit > 0) {
      query.set("limit", String(limit));
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await this.doJSON("GET", `/events${suffix}`, token, undefined, [200], options);
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(eventFromHTTP);
  }

  /**
   * 查询节点运行状态。
   */
  async operationsStatus(token: string, options?: RequestOptions): Promise<OperationsStatus> {
    const response = await this.doJSON("GET", "/ops/status", token, undefined, [200], options);
    return operationsStatusFromHTTP(response);
  }

  /**
   * 获取 Prometheus 格式的监控指标文本。
   */
  async metrics(token: string, options?: RequestOptions): Promise<string> {
    return this.doText("/metrics", token, options);
  }

  private async doText(path: string, token: string, options?: RequestOptions): Promise<string> {
    const abort = mergeAbortSignals(options);
    try {
      const headers: Record<string, string> = {};
      if (token !== "") {
        headers.Authorization = `Bearer ${token}`;
      }
      const request: RequestInit = {
        method: "GET",
        headers,
        signal: abort.signal
      };
      const response = await this.fetchImpl(this.baseUrl + path, request);
      const text = await response.text();
      if (response.status !== 200) {
        throw new ProtocolError(`unexpected HTTP status ${response.status}: ${text.trim()}`);
      }
      return text;
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      throw new ConnectionError(`GET ${path}`, error);
    } finally {
      abort.cleanup();
    }
  }

  private async doJSON(
    method: string,
    path: string,
    token: string,
    body: unknown,
    statuses: number[],
    options?: RequestOptions
  ): Promise<unknown> {
    const abort = mergeAbortSignals(options);
    try {
      const headers: Record<string, string> = {};
      let payload: string | undefined;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = stringifyJson(body);
      }
      if (token !== "") {
        headers.Authorization = `Bearer ${token}`;
      }

      const request: RequestInit = {
        method,
        headers,
        signal: abort.signal
      };
      if (payload !== undefined) {
        request.body = payload;
      }

      const response = await this.fetchImpl(this.baseUrl + path, request);
      const text = await response.text();
      if (!statuses.includes(response.status)) {
        throw new ProtocolError(`unexpected HTTP status ${response.status}: ${text.trim()}`);
      }
      if (text.trim() === "") {
        return undefined;
      }
      return parseJson(text);
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      throw new ConnectionError(`${method} ${path}`, error);
    } finally {
      abort.cleanup();
    }
  }
}

function objectField(value: unknown, field: string): unknown {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[field];
}

function arrayField(value: unknown, field: string): unknown[] {
  const item = objectField(value, field);
  return Array.isArray(item) ? item : [];
}

function normalizeListUsersName(name: string | undefined): string | undefined {
  if (name == null) {
    return undefined;
  }
  const normalized = name.trim();
  return normalized === "" ? undefined : normalized;
}

function uidFilterToHTTP(uid: UserRef | undefined): string | undefined {
  if (uid == null || isZeroUserRef(uid)) {
    return undefined;
  }
  return `${uid.nodeId}:${uid.userId}`;
}

function userRefFromHTTP(value: unknown): UserRef {
  return {
    nodeId: idToString(objectField(value, "node_id")),
    userId: idToString(objectField(value, "user_id"))
  };
}

function userFromHTTP(value: unknown): User {
  const profile = objectField(value, "profile") ?? objectField(value, "profile_json");
  return {
    nodeId: idToString(objectField(value, "node_id")),
    userId: idToString(objectField(value, "user_id")),
    username: String(objectField(value, "username") ?? ""),
    loginName: String(objectField(value, "login_name") ?? ""),
    role: String(objectField(value, "role") ?? ""),
    profileJson: profile == null ? new Uint8Array(0) : utf8ToBytes(stringifyJson(profile)),
    systemReserved: Boolean(objectField(value, "system_reserved")),
    createdAt: String(objectField(value, "created_at") ?? ""),
    updatedAt: String(objectField(value, "updated_at") ?? ""),
    originNodeId: idToString(objectField(value, "origin_node_id"))
  };
}

function messageFromHTTP(value: unknown): Message {
  return {
    recipient: userRefFromHTTP(objectField(value, "recipient")),
    nodeId: idToString(objectField(value, "node_id")),
    seq: idToString(objectField(value, "seq")),
    sender: userRefFromHTTP(objectField(value, "sender")),
    body: base64ToBytes(String(objectField(value, "body") ?? "")),
    createdAtHlc: String(objectField(value, "created_at_hlc") ?? objectField(value, "created_at") ?? "")
  };
}

function clusterNodeFromHTTP(value: unknown): ClusterNode {
  return {
    nodeId: idToString(objectField(value, "node_id")),
    isLocal: Boolean(objectField(value, "is_local")),
    configuredUrl: String(objectField(value, "configured_url") ?? ""),
    source: String(objectField(value, "source") ?? "")
  };
}

function loggedInUserFromHTTP(value: unknown): LoggedInUser {
  return {
    nodeId: idToString(objectField(value, "node_id")),
    userId: idToString(objectField(value, "user_id")),
    username: String(objectField(value, "username") ?? ""),
    loginName: String(objectField(value, "login_name") ?? "")
  };
}

function attachmentFromHTTP(value: unknown): Attachment {
  return {
    owner: userRefFromHTTP(objectField(value, "owner")),
    subject: userRefFromHTTP(objectField(value, "subject")),
    attachmentType: String(objectField(value, "attachment_type") ?? "") as AttachmentType,
    configJson: utf8ToBytes(stringifyJson(objectField(value, "config_json") ?? {})),
    attachedAt: String(objectField(value, "attached_at") ?? ""),
    deletedAt: String(objectField(value, "deleted_at") ?? ""),
    originNodeId: idToString(objectField(value, "origin_node_id"))
  };
}

function blacklistEntryFromHTTP(value: unknown): BlacklistEntry {
  const attachment = attachmentFromHTTP(value);
  return {
    owner: attachment.owner,
    blocked: attachment.subject,
    blockedAt: attachment.attachedAt,
    deletedAt: attachment.deletedAt,
    originNodeId: attachment.originNodeId
  };
}

function userMetadataFromHTTP(value: unknown): UserMetadata {
  return {
    owner: userRefFromHTTP(objectField(value, "owner")),
    key: String(objectField(value, "key") ?? ""),
    value: base64ToBytes(String(objectField(value, "value") ?? "")),
    updatedAt: String(objectField(value, "updated_at") ?? ""),
    deletedAt: String(objectField(value, "deleted_at") ?? ""),
    expiresAt: String(objectField(value, "expires_at") ?? ""),
    originNodeId: idToString(objectField(value, "origin_node_id"))
  };
}

function userMetadataScanResultFromHTTP(value: unknown): UserMetadataScanResult {
  const items = arrayField(value, "items").map(userMetadataFromHTTP);
  const count = objectField(value, "count");
  return {
    items,
    count: typeof count === "number" ? count : items.length,
    nextAfter: String(objectField(value, "next_after") ?? "")
  };
}

function eventFromHTTP(value: unknown): Event {
  return {
    sequence: idToString(objectField(value, "sequence")),
    eventId: idToString(objectField(value, "event_id")),
    eventType: String(objectField(value, "event_type") ?? ""),
    aggregate: String(objectField(value, "aggregate") ?? ""),
    aggregateNodeId: idToString(objectField(value, "aggregate_node_id")),
    aggregateId: idToString(objectField(value, "aggregate_id")),
    hlc: String(objectField(value, "hlc") ?? ""),
    originNodeId: idToString(objectField(value, "origin_node_id")),
    eventJson: base64ToBytes(String(objectField(value, "event_json") ?? ""))
  };
}

function deleteUserResultFromHTTP(value: unknown): DeleteUserResult {
  return {
    status: String(objectField(value, "status") ?? ""),
    user: {
      nodeId: idToString(objectField(value, "node_id")),
      userId: idToString(objectField(value, "user_id"))
    }
  };
}

function peerOriginStatusFromHTTP(value: unknown): PeerOriginStatus {
  return {
    originNodeId: idToString(objectField(value, "origin_node_id")),
    ackedEventId: idToString(objectField(value, "acked_event_id")),
    appliedEventId: idToString(objectField(value, "applied_event_id")),
    unconfirmedEvents: idToString(objectField(value, "unconfirmed_events")),
    cursorUpdatedAt: String(objectField(value, "cursor_updated_at") ?? ""),
    remoteLastEventId: idToString(objectField(value, "remote_last_event_id")),
    pendingCatchup: Boolean(objectField(value, "pending_catchup"))
  };
}

function peerStatusFromHTTP(value: unknown): PeerStatus {
  return {
    nodeId: idToString(objectField(value, "node_id")),
    configuredUrl: String(objectField(value, "configured_url") ?? ""),
    source: String(objectField(value, "source") ?? ""),
    discoveredUrl: String(objectField(value, "discovered_url") ?? ""),
    discoveryState: String(objectField(value, "discovery_state") ?? ""),
    lastDiscoveredAt: String(objectField(value, "last_discovered_at") ?? ""),
    lastConnectedAt: String(objectField(value, "last_connected_at") ?? ""),
    lastDiscoveryError: String(objectField(value, "last_discovery_error") ?? ""),
    connected: Boolean(objectField(value, "connected")),
    sessionDirection: String(objectField(value, "session_direction") ?? ""),
    origins: arrayField(value, "origins").map(peerOriginStatusFromHTTP),
    pendingSnapshotPartitions: Number(objectField(value, "pending_snapshot_partitions") ?? 0),
    remoteSnapshotVersion: String(objectField(value, "remote_snapshot_version") ?? ""),
    remoteMessageWindowSize: Number(objectField(value, "remote_message_window_size") ?? 0),
    clockOffsetMs: idToString(objectField(value, "clock_offset_ms")),
    lastClockSync: String(objectField(value, "last_clock_sync") ?? ""),
    snapshotDigestsSentTotal: idToString(objectField(value, "snapshot_digests_sent_total")),
    snapshotDigestsReceivedTotal: idToString(objectField(value, "snapshot_digests_received_total")),
    snapshotChunksSentTotal: idToString(objectField(value, "snapshot_chunks_sent_total")),
    snapshotChunksReceivedTotal: idToString(objectField(value, "snapshot_chunks_received_total")),
    lastSnapshotDigestAt: String(objectField(value, "last_snapshot_digest_at") ?? ""),
    lastSnapshotChunkAt: String(objectField(value, "last_snapshot_chunk_at") ?? "")
  };
}

function operationsStatusFromHTTP(value: unknown): OperationsStatus {
  return {
    nodeId: idToString(objectField(value, "node_id")),
    messageWindowSize: Number(objectField(value, "message_window_size") ?? 0),
    lastEventSequence: idToString(objectField(value, "last_event_sequence")),
    writeGateReady: Boolean(objectField(value, "write_gate_ready")),
    conflictTotal: idToString(objectField(value, "conflict_total")),
    messageTrim: {
      trimmedTotal: idToString(objectField(objectField(value, "message_trim"), "trimmed_total")),
      lastTrimmedAt: String(objectField(objectField(value, "message_trim"), "last_trimmed_at") ?? "")
    },
    projection: {
      pendingTotal: idToString(objectField(objectField(value, "projection"), "pending_total")),
      lastFailedAt: String(objectField(objectField(value, "projection"), "last_failed_at") ?? "")
    },
    peers: arrayField(value, "peers").map(peerStatusFromHTTP)
  };
}

function isPasswordInput(value: unknown): value is PasswordInput {
  return value != null
    && typeof value === "object"
    && "source" in value
    && "encoded" in value;
}
