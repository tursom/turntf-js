/**
 * turntf 客户端的基础错误类。
 * 所有 turntf 相关的错误类型均继承自此类。
 * 自动将错误名称设置为当前类的构造函数名称。
 */
export class TurntfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * 客户端已关闭时抛出的错误。
 * 当对已关闭的 Client 实例进行操作时触发，例如调用 connect() 或 sendMessage()。
 */
export class ClosedError extends TurntfError {
  constructor() {
    super("turntf client is closed");
  }
}

/**
 * 客户端未建立连接时抛出的错误。
 * 在 WebSocket 连接尚未建立或已断开时尝试发送消息等操作会触发此错误。
 */
export class NotConnectedError extends TurntfError {
  constructor() {
    super("turntf client is not connected");
  }
}

/**
 * WebSocket 连接意外断开时抛出的错误。
 * 在读取循环中检测到连接断开时触发，通常会自动触发重连机制。
 */
export class DisconnectedError extends TurntfError {
  constructor() {
    super("turntf websocket disconnected");
  }
}

/**
 * 服务器返回错误响应时抛出的错误。
 * 包含服务器返回的错误码、错误消息和请求 ID。
 * 当错误码为 "unauthorized" 时，客户端将停止自动重连。
 */
export class ServerError extends TurntfError {
  readonly code: string;
  readonly requestId: string;
  readonly serverMessage: string;

  constructor(code: string, message: string, requestId = "0") {
    super(requestId === "0"
      ? `turntf server error: ${code} (${message})`
      : `turntf server error: ${code} (${message}), request_id=${requestId}`);
    this.code = code;
    this.requestId = requestId;
    this.serverMessage = message;
  }

  /**
   * 判断是否为未授权错误。
   * 当返回 "unauthorized" 错误码时，客户端应停止重连并提示用户重新登录。
   *
   * @returns 如果是未授权错误则返回 true
   */
  unauthorized(): boolean {
    return this.code === "unauthorized";
  }
}

/**
 * 协议解析错误时抛出的错误。
 * 当客户端收到无法识别的消息格式或缺少必要字段时触发。
 */
export class ProtocolError extends TurntfError {
  readonly protocolMessage: string;

  constructor(message: string) {
    super(`turntf protocol error: ${message}`);
    this.protocolMessage = message;
  }
}

/**
 * 网络连接错误时抛出的错误。
 * 在 WebSocket 连接、发送或接收数据过程中发生网络异常时触发。
 * 包含操作名称（op）和原始错误原因（cause）。
 */
export class ConnectionError extends TurntfError {
  readonly op: string;
  override readonly cause?: unknown;

  constructor(op: string, cause: unknown) {
    super(`turntf connection error during ${op}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.op = op;
    this.cause = cause;
  }
}
