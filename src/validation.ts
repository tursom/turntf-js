import {
  type Credentials,
  DeliveryMode,
  type ListUsersRequest,
  type LoginNameCredentials,
  type Message,
  type MessageCursor,
  type ScanUserMetadataRequest,
  type SessionRef,
  type UserRef
} from "./types";

const unsignedDecimalPattern = /^(0|[1-9][0-9]*)$/;
const userMetadataKeyPattern = /^[A-Za-z0-9._:-]*$/;
const userMetadataKeyMaxLength = 128;
const userMetadataScanLimitMax = 1000;

/**
 * 标准化登录名：去除首尾空白字符。
 *
 * @param value - 原始登录名
 * @returns 去除首尾空格后的登录名
 */
export function normalizeLoginName(value: string): string {
  return value.trim();
}

/**
 * 验证字符串必须为非负整数的十进制表示。
 *
 * @param value - 待验证的字符串
 * @param field - 字段名称，用于错误提示
 * @throws 如果值不是合法的十进制整数表示则抛出错误
 */
export function assertDecimalString(value: string, field: string): void {
  if (!unsignedDecimalPattern.test(value)) {
    throw new Error(`${field} must be a decimal string`);
  }
}

/**
 * 验证字符串必须为非零的非负整数十进制表示。
 * 在 assertDecimalString 的基础上额外要求值不能为 "0"。
 *
 * @param value - 待验证的字符串
 * @param field - 字段名称，用于错误提示
 * @throws 如果值为空或不是合法的十进制整数表示则抛出错误
 */
export function assertRequiredDecimalString(value: string, field: string): void {
  assertDecimalString(value, field);
  if (value === "0") {
    throw new Error(`${field} is required`);
  }
}

/**
 * 验证用户引用（UserRef）的 nodeId 和 userId 均不为空且为有效的十进制整数字符串。
 *
 * @param ref - 用户引用对象
 * @param field - 字段名称前缀，默认为 "user"
 * @throws 如果 nodeId 或 userId 无效则抛出错误
 */
export function validateUserRef(ref: UserRef, field = "user"): void {
  assertRequiredDecimalString(ref.nodeId, `${field}.nodeId`);
  assertRequiredDecimalString(ref.userId, `${field}.userId`);
}

/**
 * 判断 UserRef 是否为零值引用。
 * 在部分查询协议中，`{ nodeId: "0", userId: "0" }` 表示“未指定目标”。
 *
 * @param ref - 待判断的用户引用
 * @returns 如果 nodeId 和 userId 都为 "0" 则返回 true
 */
export function isZeroUserRef(ref: UserRef | undefined): boolean {
  return ref?.nodeId === "0" && ref.userId === "0";
}

/**
 * 验证用于 listUsers 过滤的 uid。
 * 允许 `{ nodeId: "0", userId: "0" }` 作为“未指定 uid 过滤”的显式零值，
 * 但不允许一半为 0、一半为非 0 的半空引用。
 *
 * @param ref - 待验证的用户引用
 * @param field - 字段名称前缀，默认为 "uid"
 * @throws 如果 uid 非法则抛出错误
 */
export function validateListUsersUid(ref: UserRef, field = "uid"): void {
  assertDecimalString(ref.nodeId, `${field}.nodeId`);
  assertDecimalString(ref.userId, `${field}.userId`);
  const nodeIdIsZero = ref.nodeId === "0";
  const userIdIsZero = ref.userId === "0";
  if (nodeIdIsZero !== userIdIsZero) {
    throw new Error(`${field} must provide both nodeId and userId together`);
  }
}

/**
 * 验证登录名是否非空（去空白后）。
 *
 * @param value - 登录名字符串
 * @param field - 字段名称，默认为 "loginName"
 * @throws 如果登录名为空则抛出错误
 */
export function validateLoginName(value: string, field = "loginName"): void {
  if (normalizeLoginName(value) === "") {
    throw new Error(`${field} is required`);
  }
}

/**
 * 判断凭据是否为登录名凭据类型（LoginNameCredentials）。
 * 当凭据对象包含 "loginName" 字段且为字符串类型时返回 true。
 *
 * @param credentials - 待判断的凭据对象
 * @returns 如果是登录名凭据则返回 true
 */
export function isLoginNameCredentials(credentials: Credentials): credentials is LoginNameCredentials {
  return "loginName" in credentials && typeof credentials.loginName === "string";
}

/**
 * 验证凭据对象的合法性。
 * 凭据必须且只能提供 (nodeId, userId) 对或 loginName 中的一种。
 * 如果提供了 nodeId/userId，两者必须同时存在且为有效的十进制整数字符串。
 * 如果提供了 loginName，则不能为空。
 *
 * @param credentials - 待验证的凭据对象
 * @param field - 字段名称前缀，默认为 "credentials"
 * @throws 如果凭据不合法则抛出错误
 */
export function validateCredentials(credentials: Credentials, field = "credentials"): void {
  const hasNodeId = "nodeId" in credentials && typeof credentials.nodeId === "string";
  const hasUserId = "userId" in credentials && typeof credentials.userId === "string";
  const hasLoginName = isLoginNameCredentials(credentials);

  if (hasLoginName) {
    validateLoginName(credentials.loginName, `${field}.loginName`);
  }
  if (hasNodeId || hasUserId) {
    if (!hasNodeId || !hasUserId) {
      throw new Error(`${field}.nodeId and ${field}.userId must be provided together`);
    }
    validateUserRef(
      {
        nodeId: credentials.nodeId,
        userId: credentials.userId
      },
      field
    );
  }
  if ((hasNodeId || hasUserId) === hasLoginName) {
    throw new Error(`exactly one of ${field}.(nodeId,userId) or ${field}.loginName must be provided`);
  }
}

/**
 * 验证会话引用（SessionRef）的合法性。
 * servingNodeId 必须为非零的十进制整数字符串，sessionId 不能为空。
 *
 * @param ref - 会话引用对象
 * @param field - 字段名称前缀，默认为 "session"
 * @throws 如果会话引用不合法则抛出错误
 */
export function validateSessionRef(ref: SessionRef, field = "session"): void {
  assertRequiredDecimalString(ref.servingNodeId, `${field}.servingNodeId`);
  if (ref.sessionId === "") {
    throw new Error(`${field}.sessionId is required`);
  }
}

/**
 * 验证投递模式的合法性。
 * 投递模式必须是 DeliveryMode.BestEffort 或 DeliveryMode.RouteRetry。
 *
 * @param mode - 投递模式值
 * @throws 如果投递模式不合法则抛出错误
 */
export function validateDeliveryMode(mode: DeliveryMode): void {
  if (mode !== DeliveryMode.BestEffort && mode !== DeliveryMode.RouteRetry) {
    throw new Error(`invalid deliveryMode ${JSON.stringify(mode)}`);
  }
}

/**
 * 验证数字限制值的合法性。
 * 值必须为非负整数，且如果指定了最大值则不能超过最大值。
 *
 * @param value - 待验证的数字
 * @param field - 字段名称，用于错误提示
 * @param max - 可选的最大值
 * @throws 如果值不是非负整数或超过最大值则抛出错误
 */
export function validateLimit(value: number, field: string, max?: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  if (max != null && value > max) {
    throw new Error(`${field} cannot exceed ${max}`);
  }
}

/**
 * 验证用户元数据键的合法性。
 * 键不能为空，长度不能超过 128 个字符，且只能包含字母、数字、点、下划线、冒号和短横线。
 *
 * @param value - 待验证的键名
 * @param field - 字段名称，默认为 "key"
 * @throws 如果键名不合法则抛出错误
 */
export function validateUserMetadataKey(value: string, field = "key"): void {
  validateUserMetadataKeyFragment(value, field, false);
}

/**
 * 验证用户元数据键片段的合法性。
 * 与 validateUserMetadataKey 类似，但支持 allowEmpty 参数允许空字符串。
 *
 * @param value - 待验证的键名字符串
 * @param field - 字段名称，用于错误提示
 * @param allowEmpty - 是否允许空字符串
 * @throws 如果不允许为空且值为空，或值长度超过限制，或包含不支持字符则抛出错误
 */
export function validateUserMetadataKeyFragment(value: string, field: string, allowEmpty: boolean): void {
  if (value === "") {
    if (allowEmpty) {
      return;
    }
    throw new Error(`${field} is required`);
  }
  if (value.length > userMetadataKeyMaxLength) {
    throw new Error(`${field} cannot exceed ${userMetadataKeyMaxLength} characters`);
  }
  if (!userMetadataKeyPattern.test(value)) {
    throw new Error(`${field} contains unsupported characters`);
  }
}

/**
 * 验证用户元数据扫描请求的合法性。
 * 检查前缀和后缀的格式，以及 limit 是否在有效范围内。
 * 如果同时提供了 prefix 和 after，after 必须以 prefix 开头。
 *
 * @param request - 扫描请求对象
 * @param field - 字段名称前缀，默认为 "request"
 * @throws 如果请求不合法则抛出错误
 */
export function validateUserMetadataScanRequest(request: ScanUserMetadataRequest, field = "request"): void {
  validateUserMetadataKeyFragment(request.prefix ?? "", `${field}.prefix`, true);
  validateUserMetadataKeyFragment(request.after ?? "", `${field}.after`, true);
  if (request.limit != null) {
    validateLimit(request.limit, `${field}.limit`, userMetadataScanLimitMax);
  }
  if (
    request.prefix != null &&
    request.prefix !== "" &&
    request.after != null &&
    request.after !== "" &&
    !request.after.startsWith(request.prefix)
  ) {
    throw new Error(`${field}.after must use the same prefix as ${field}.prefix`);
  }
}

/**
 * 验证列用户请求。
 * `name` 允许为空白字符串，SDK 会在发请求前将其规范化为“未设置”。
 *
 * @param request - 列用户请求参数
 * @param field - 字段名称前缀，默认为 "request"
 */
export function validateListUsersRequest(request: ListUsersRequest, field = "request"): void {
  if (request.uid != null) {
    validateListUsersUid(request.uid, `${field}.uid`);
  }
}

/**
 * 从消息对象中提取游标信息（nodeId 和 seq）。
 *
 * @param message - 消息对象
 * @returns 包含 nodeId 和 seq 的游标对象
 */
export function cursorForMessage(message: Message): MessageCursor {
  return { nodeId: message.nodeId, seq: message.seq };
}

/**
 * 将十进制整数字符串转换为 BigInt 类型。
 * 先验证字符串是否合法的非负十进制整数。
 *
 * @param value - 十进制整数字符串
 * @param field - 字段名称，用于错误提示
 * @returns 转换后的 BigInt 值
 * @throws 如果字符串不是合法的十进制整数则抛出错误
 */
export function toWireInteger(value: string, field: string): bigint {
  assertDecimalString(value, field);
  return BigInt(value);
}

/**
 * 将非零的十进制整数字符串转换为 BigInt 类型。
 * 先验证字符串是否合法且非零。
 *
 * @param value - 十进制整数字符串，不能为 "0"
 * @param field - 字段名称，用于错误提示
 * @returns 转换后的 BigInt 值
 * @throws 如果字符串不合法或为 "0" 则抛出错误
 */
export function toRequiredWireInteger(value: string, field: string): bigint {
  assertRequiredDecimalString(value, field);
  return BigInt(value);
}

/**
 * 将不同类型的 ID 值统一转换为十进制字符串。
 * 支持 string、bigint、number 类型。
 * - string: 直接返回
 * - bigint: 调用 toString() 转换
 * - number: 必须是有限整数
 * - null/undefined: 返回 "0"
 * - 其他类型: 调用 String() 转换
 *
 * @param value - 待转换的 ID 值
 * @returns 十进制字符串表示
 * @throws 如果 number 类型的值不是有限整数则抛出错误
 */
export function idToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`invalid integer value ${value}`);
    }
    return String(value);
  }
  if (value == null) {
    return "0";
  }
  return String(value);
}
