import { ConnectionError, ProtocolError } from "./errors";
import { passwordWireValue, plainPassword, type PasswordInput } from "./password";
import {
  AttachmentType,
  type Attachment,
  DeliveryMode,
  type BlacklistEntry,
  type ClusterNode,
  type CreateUserRequest,
  type LoggedInUser,
  type Message,
  type RequestOptions,
  type ScanUserMetadataRequest,
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
  idToString,
  normalizeLoginName,
  toRequiredWireInteger,
  validateDeliveryMode,
  validateLoginName,
  validateUserMetadataKey,
  validateUserMetadataScanRequest,
  validateUserRef
} from "./validation";

export interface HTTPClientOptions {
  fetch?: typeof fetch;
}

export class HTTPClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

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

  createChannel(token: string, request: Omit<CreateUserRequest, "role"> & Partial<Pick<CreateUserRequest, "role">>, options?: RequestOptions): Promise<User> {
    return this.createUser(token, { ...request, role: request.role ?? "channel" }, options);
  }

  async createSubscription(token: string, user: UserRef, channel: UserRef, options?: RequestOptions): Promise<void> {
    await this.upsertAttachment(token, user, channel, AttachmentType.ChannelSubscription, new Uint8Array(), options);
  }

  async listMessages(token: string, target: UserRef, limit = 0, options?: RequestOptions): Promise<Message[]> {
    validateUserRef(target, "target");
    const query = limit > 0 ? `?limit=${encodeURIComponent(String(limit))}` : "";
    const response = await this.doJSON(
      "GET",
      `/nodes/${target.nodeId}/users/${target.userId}/messages${query}`,
      token,
      undefined,
      [200],
      options
    );
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(messageFromHTTP);
  }

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

  async listClusterNodes(token: string, options?: RequestOptions): Promise<ClusterNode[]> {
    const response = await this.doJSON("GET", "/cluster/nodes", token, undefined, [200], options);
    const items = Array.isArray(response) ? response : (Array.isArray(objectField(response, "nodes"))
      ? arrayField(response, "nodes")
      : arrayField(response, "items"));
    return items.map(clusterNodeFromHTTP);
  }

  async listNodeLoggedInUsers(token: string, nodeId: string, options?: RequestOptions): Promise<LoggedInUser[]> {
    toRequiredWireInteger(nodeId, "nodeId");
    const response = await this.doJSON("GET", `/cluster/nodes/${nodeId}/logged-in-users`, token, undefined, [200], options);
    const items = Array.isArray(response) ? response : arrayField(response, "items");
    return items.map(loggedInUserFromHTTP);
  }

  async blockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.upsertAttachment(token, owner, blocked, AttachmentType.UserBlacklist, new Uint8Array(), options);
    return blacklistEntryFromHTTP(attachment);
  }

  async unblockUser(token: string, owner: UserRef, blocked: UserRef, options?: RequestOptions): Promise<BlacklistEntry> {
    const attachment = await this.deleteAttachment(token, owner, blocked, AttachmentType.UserBlacklist, options);
    return blacklistEntryFromHTTP(attachment);
  }

  async listBlockedUsers(token: string, owner: UserRef, options?: RequestOptions): Promise<BlacklistEntry[]> {
    const items = await this.listAttachments(token, owner, AttachmentType.UserBlacklist, options);
    return items.map(blacklistEntryFromHTTP);
  }

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

function isPasswordInput(value: unknown): value is PasswordInput {
  return value != null
    && typeof value === "object"
    && "source" in value
    && "encoded" in value;
}
