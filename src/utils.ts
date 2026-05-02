import JSONBig from "json-bigint";

import { ConnectionError } from "./errors";
import type { RequestOptions } from "./types";

const json = JSONBig({
  storeAsString: true,
  useNativeBigInt: true,
  protoAction: "ignore",
  constructorAction: "ignore"
});

/**
 * 延迟结果对象，提供 Promise 及其 resolve/reject 方法的引用。
 * 用于在异步流程中从外部控制 Promise 的完成状态。
 *
 * @typeParam T - Promise 解析值的类型
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/**
 * 创建一个 Deferred 对象。
 * Deferred 对象将 Promise 的 resolve 和 reject 方法暴露出来，
 * 使得可以在 Promise 创建后从外部控制其完成状态。
 * 常用于异步回调转换为 Promise 的场景。
 *
 * @typeParam T - Promise 解析值的类型
 * @returns 包含 promise、resolve 和 reject 的 Deferred 对象
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

/**
 * 解析 JSON 字符串，支持大整数（BigInt）。
 * 使用 json-bigint 库解析，大整数将保留为字符串或转换为 BigInt。
 *
 * @param text - 待解析的 JSON 字符串
 * @returns 解析后的 JavaScript 对象或值
 */
export function parseJson(text: string): unknown {
  return json.parse(text);
}

/**
 * 将 JavaScript 对象或值序列化为 JSON 字符串，支持大整数（BigInt）。
 * 使用 json-bigint 库进行序列化。
 *
 * @param value - 待序列化的对象或值
 * @returns JSON 格式的字符串
 */
export function stringifyJson(value: unknown): string {
  return json.stringify(value);
}

/**
 * 将 Uint8Array 字节数组编码为 Base64 字符串。
 *
 * @param bytes - 待编码的字节数组
 * @returns Base64 编码后的字符串
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * 将 Base64 字符串解码为 Uint8Array 字节数组。
 *
 * @param value - Base64 编码的字符串
 * @returns 解码后的字节数组
 */
export function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * 将 UTF-8 字符串编码为 Uint8Array 字节数组。
 *
 * @param value - UTF-8 格式的字符串
 * @returns 编码后的字节数组
 */
export function utf8ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "utf8"));
}

/**
 * 将 Uint8Array 字节数组解码为 UTF-8 字符串。
 *
 * @param value - 待解码的字节数组
 * @returns UTF-8 格式的字符串
 */
export function bytesToUtf8(value: Uint8Array): string {
  return Buffer.from(value).toString("utf8");
}

/**
 * 克隆字节数组，返回一个新的 Uint8Array 副本。
 * 如果传入 undefined 或 null，则返回一个空数组。
 *
 * @param value - 待克隆的字节数组，可选
 * @returns 新的 Uint8Array 副本或空数组
 */
export function cloneBytes(value: Uint8Array | undefined): Uint8Array {
  return value == null ? new Uint8Array(0) : new Uint8Array(value);
}

/**
 * 异步等待指定的毫秒数，支持通过 AbortSignal 取消等待。
 * 在等待期间如果信号被中止，会立即抛出中止错误。
 *
 * @param ms - 等待的毫秒数
 * @param signal - 可选的 AbortSignal，用于取消等待
 * @returns 等待完成后 resolve
 * @throws 如果等待被 signal 取消则抛出中止错误
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(abortReason(signal));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * 获取 AbortSignal 的中止原因。
 * 如果信号没有提供中止原因，则返回默认的 Error 对象。
 *
 * @param signal - 可选的 AbortSignal
 * @returns 中止原因
 */
export function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error("operation aborted");
}

/**
 * 合并多个中止信号和超时设置为一个统一的 AbortSignal。
 * 当任意一个输入信号被中止或超时到达时，返回的信号也会被中止。
 * 使用完毕后应调用返回的 cleanup 函数释放资源。
 *
 * @param options - 包含 AbortSignal 和超时时间的请求选项
 * @returns 包含合并后的 signal 和 cleanup 清理函数的对象
 */
export function mergeAbortSignals(options?: RequestOptions): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const { signal, timeoutMs } = options ?? {};
  let timeout: NodeJS.Timeout | undefined;

  const onAbort = () => {
    controller.abort(abortReason(signal));
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(abortReason(signal));
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs != null && timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(new Error(`operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", onAbort);
    }
  };
}

/**
 * 读取 HTTP 响应的文本内容。
 * 封装了 response.text() 调用，方便在异步流程中使用。
 *
 * @param response - HTTP Response 对象
 * @returns 响应体的文本字符串
 */
export async function readResponseText(response: Response): Promise<string> {
  return response.text();
}

/**
 * 确保错误对象为 ConnectionError 类型。
 * 如果传入的 error 已经是 ConnectionError 则直接返回，否则创建一个新的 ConnectionError。
 *
 * @param op - 发生错误时的操作名称
 * @param cause - 原始错误原因
 * @returns ConnectionError 实例
 */
export function ensureConnectionError(op: string, cause: unknown): ConnectionError {
  return cause instanceof ConnectionError ? cause : new ConnectionError(op, cause);
}
