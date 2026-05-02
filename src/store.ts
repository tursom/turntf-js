import type { Message, MessageCursor } from "./types";
import { cursorForMessage } from "./validation";

/**
 * 游标存储接口，用于持久化已接收消息的游标信息。
 * 实现此接口可以自定义消息去重逻辑的存储后端（如内存、文件、数据库等）。
 * 客户端在重连时会加载已存储的游标，避免重复处理已接收的消息。
 */
export interface CursorStore {
  /** 加载所有已接收消息的游标列表，在 WebSocket 重连时发送给服务器用于去重 */
  loadSeenMessages(): Promise<MessageCursor[]> | MessageCursor[];
  /** 保存收到的消息，用于后续去重查询 */
  saveMessage(message: Message): Promise<void> | void;
  /** 保存消息游标，标记某条消息已被接收 */
  saveCursor(cursor: MessageCursor): Promise<void> | void;
}

/**
 * 基于内存的游标存储实现。
 * 使用 Map 存储消息，使用数组维护游标顺序。
 * 适用于单次会话中的消息去重，重启后数据会丢失。
 */
export class MemoryCursorStore implements CursorStore {
  private readonly messages = new Map<string, Message>();
  private readonly order: MessageCursor[] = [];

  loadSeenMessages(): MessageCursor[] {
    return this.order.map((cursor) => ({ ...cursor }));
  }

  saveMessage(message: Message): void {
    this.messages.set(cursorKey(cursorForMessage(message)), cloneMessage(message));
  }

  saveCursor(cursor: MessageCursor): void {
    const key = cursorKey(cursor);
    if (!this.messages.has(key)) {
      this.messages.set(key, {
        recipient: { nodeId: "0", userId: "0" },
        nodeId: cursor.nodeId,
        seq: cursor.seq,
        sender: { nodeId: "0", userId: "0" },
        body: new Uint8Array(0),
        createdAtHlc: ""
      });
    }
    if (!this.order.some((item) => item.nodeId === cursor.nodeId && item.seq === cursor.seq)) {
      this.order.push({ ...cursor });
    }
  }

  /**
   * 检查指定游标对应的消息是否已被存储。
   *
   * @param cursor - 消息游标
   * @returns 如果消息已存在则返回 true
   */
  hasCursor(cursor: MessageCursor): boolean {
    return this.messages.has(cursorKey(cursor));
  }

  /**
   * 根据消息游标获取已存储的消息副本。
   *
   * @param cursor - 消息游标
   * @returns 返回消息的深拷贝，如果不存在则返回 undefined
   */
  message(cursor: MessageCursor): Message | undefined {
    const message = this.messages.get(cursorKey(cursor));
    return message == null ? undefined : cloneMessage(message);
  }
}

/** 根据游标生成 Map 的键值，格式为 "nodeId:seq" */
function cursorKey(cursor: MessageCursor): string {
  return `${cursor.nodeId}:${cursor.seq}`;
}

/** 深拷贝 Message 对象 */
function cloneMessage(message: Message): Message {
  return {
    recipient: { ...message.recipient },
    nodeId: message.nodeId,
    seq: message.seq,
    sender: { ...message.sender },
    body: new Uint8Array(message.body),
    createdAtHlc: message.createdAtHlc
  };
}
