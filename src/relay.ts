/**
 * turntf relay 点对点传输层实现。
 *
 * 提供基于 relay 协议的点对点连接管理，支持三种可靠性模式：
 * - BestEffort: 无 ACK，无重传，无去重，无排序
 * - AtLeastOnce: ACK + 重传，不保证去重和排序
 * - ReliableOrdered: ACK + 重传 + 去重 + 严格有序
 *
 * @module relay
 */

import { randomBytes } from "node:crypto";

import {
  defaultRelayConfig,
  DeliveryMode,
  RelayError,
  RelayErrorCode,
  RelayKind,
  RelayState,
  Reliability,
  type RelayConfig,
  type RelayEnvelope as DomainRelayEnvelope,
  type UserRef,
  type SessionRef,
  type Packet,
  type ResolveUserSessionsResult,
  type RelayAccepted,
  type RequestOptions,
  type SendPacketOptions
} from "./types";
import { createDeferred, type Deferred } from "./utils";

import {
  RelayEnvelope as ProtoRelayEnvelope,
  RelayKind as ProtoRelayKind
} from "./generated/relay";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 生成随机的 relay 连接 ID。
 */
function newRelayID(): string {
  return randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Relay 管理器依赖的客户端接口。
 * 用于解耦 Client 与 Relay 的循环依赖。
 */
export interface RelayClient {
  resolveUserSessions(user: UserRef, options?: RequestOptions): Promise<ResolveUserSessionsResult>;
  sendPacket(
    target: UserRef,
    body: Uint8Array,
    deliveryMode: DeliveryMode,
    options?: SendPacketOptions
  ): Promise<RelayAccepted>;
  readonly sessionRef: SessionRef | undefined;
}

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface UnackedFrame {
  data: Uint8Array;
  retransmit: number;
}

// ---------------------------------------------------------------------------
// RelayConnection
// ---------------------------------------------------------------------------

/**
 * 一条点对点的 relay 连接，提供可靠或尽力而为的数据传输。
 *
 * 支持通过 AsyncIterable 接口和 onData 回调两种方式接收数据。
 * 发送使用 async send() 方法，内部通过 sendLoop 轮询发送队列。
 */
export class RelayConnection {
  readonly relay: Relay;
  readonly relayID: string;

  private _state: number = RelayState.Closed;
  private readonly _config: RelayConfig;
  private _remotePeer: UserRef;
  private _remoteSession: SessionRef;
  private readonly _mySession: SessionRef;

  // 滑动窗口
  private sendBase = BigInt(0);
  private nextSeq = BigInt(0);
  private readonly unacked = new Map<string, UnackedFrame>();
  private expectedSeq = BigInt(1);
  private readonly recvBuf = new Map<string, Uint8Array>();
  private retransCnt = 0;

  // 发送队列
  private readonly sendQueue: Uint8Array[] = [];
  private pendingBytes = 0;
  private spaceAvailable: Deferred<void> | undefined;
  private sendQueueWaiter: Deferred<void> | undefined;

  // 窗口等待（发送窗口满时等待 ACK）
  private ackWaiter: Deferred<void> | undefined;

  // 接收端
  private readonly recvQueue: Uint8Array[] = [];
  private readonly recvWaiters: Deferred<IteratorResult<Uint8Array>>[] = [];
  private recvClosed = false;

  // 生命周期
  private readonly abortController = new AbortController();
  private sendLoopPromise: Promise<void> | undefined;
  private openResolve: (() => void) | undefined;
  private readonly openPromise: Promise<void>;
  private readonly closeHandlers: ((error?: Error) => void)[] = [];
  private _onData: ((data: Uint8Array) => void) | undefined;
  private _closed = false;

  // 重传定时器
  private retransmitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    relay: Relay,
    relayID: string,
    remotePeer: UserRef,
    remoteSession: SessionRef,
    mySession: SessionRef,
    config: RelayConfig
  ) {
    this.relay = relay;
    this.relayID = relayID;
    this._remotePeer = remotePeer;
    this._remoteSession = remoteSession;
    this._mySession = mySession;
    this._config = config;

    this.openPromise = new Promise<void>((resolve) => {
      this.openResolve = resolve;
    });
  }

  // -- accessors ---------------------------------------------------------

  /** 当前连接状态。 */
  get state(): number {
    return this._state;
  }

  /** 远端用户引用。 */
  get remotePeer(): UserRef {
    return this._remotePeer;
  }

  /** 远端会话引用。 */
  get remoteSession(): SessionRef {
    return this._remoteSession;
  }

  // -- callbacks ---------------------------------------------------------

  /**
   * 注册连接关闭回调。
   * 当连接因任何原因关闭时调用。
   */
  onClose(fn: (error?: Error) => void): void {
    this.closeHandlers.push(fn);
  }

  /**
   * 接收数据的回调处理器。
   * 设置后，每个收到的数据帧会同步调用此回调。
   * 同时 AsyncIterable 接口仍然可用。
   */
  get onData(): ((data: Uint8Array) => void) | undefined {
    return this._onData;
  }

  set onData(handler: ((data: Uint8Array) => void) | undefined) {
    this._onData = handler;
  }

  // -- internal state management ----------------------------------------

  /** @internal 设置连接状态（仅由 Relay 在握手阶段调用）。 */
  setState(state: number): void {
    this._state = state;
  }

  /** @internal 修改远端会话引用（收到 OPEN_ACK 后更新）。 */
  setRemoteSession(session: SessionRef): void {
    this._remoteSession = session;
  }

  // -- send / receive ----------------------------------------------------

  /**
   * 发送数据。
   *
   * 数据会被加入发送队列，由内部的 sendLoop 异步发送。
   * 在 BestEffort 模式下直接发送，不保证送达。
   * 在 AtLeastOnce / ReliableOrdered 模式下使用滑动窗口和 ACK 重传。
   *
   * @param data - 要发送的字节数组
   * @throws {RelayError} 如果连接未打开或已关闭
   */
  async send(data: Uint8Array): Promise<void> {
    if (data.length === 0) return;
    if (this._state !== RelayState.Open) {
      throw new RelayError(RelayErrorCode.NotConnected, "connection not open");
    }
    if (this._closed) {
      throw new RelayError(RelayErrorCode.ClientClosed, "connection closed");
    }

    const timeoutMs = this._config.sendTimeoutMs;
    if (timeoutMs != null && timeoutMs > 0) {
      await this.sendWithTimeout(data, timeoutMs);
    } else {
      this.sendQueue.push(data);
      this.pendingBytes += data.length;
      this.notifySendQueue();
    }
  }

  /**
   * 异步迭代器接口，用于接收对端发送的数据。
   *
   * 使用方式：
   * ```ts
   * for await (const data of conn) {
   *   // 处理 data (Uint8Array)
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    const self = this;
    return {
      next(): Promise<IteratorResult<Uint8Array>> {
        return self.nextRecv();
      }
    };
  }

  private async nextRecv(): Promise<IteratorResult<Uint8Array>> {
    if (this.recvQueue.length > 0) {
      return { value: this.recvQueue.shift()!, done: false };
    }
    if (this.recvClosed) {
      return { value: undefined, done: true };
    }
    const waiter = createDeferred<IteratorResult<Uint8Array>>();
    this.recvWaiters.push(waiter);
    return waiter.promise;
  }

  /**
   * 从连接接收数据，支持超时。
   *
   * @param timeoutMs - 超时毫秒数，不传则使用配置的 receiveTimeoutMs
   * @returns 接收到的数据
   * @throws {RelayError} 超时或连接关闭时抛出
   */
  async receiveTimeout(timeoutMs?: number): Promise<Uint8Array> {
    const t = timeoutMs ?? this._config.receiveTimeoutMs;
    if (t != null && t > 0) {
      return this.nextRecvWithTimeout(t);
    }
    const result = await this.nextRecv();
    return result.value!;
  }

  private async nextRecvWithTimeout(timeoutMs: number): Promise<Uint8Array> {
    if (this.recvQueue.length > 0) {
      return this.recvQueue.shift()!;
    }
    if (this.recvClosed) {
      throw new RelayError(RelayErrorCode.ClientClosed, "connection closed");
    }

    const waiter = createDeferred<IteratorResult<Uint8Array>>();
    this.recvWaiters.push(waiter);

    try {
      const result = await raceTimeout(
        waiter.promise,
        timeoutMs,
        new RelayError(RelayErrorCode.ReceiveTimeout, "receive timeout"),
        this.abortController.signal
      );
      if (result.done) {
        throw new RelayError(RelayErrorCode.ClientClosed, "connection closed");
      }
      return result.value;
    } catch (error) {
      const idx = this.recvWaiters.indexOf(waiter);
      if (idx >= 0) {
        this.recvWaiters.splice(idx, 1);
      }
      throw error;
    }
  }

  private pushRecv(data: Uint8Array): void {
    // onData 回调
    if (this._onData != null) {
      try {
        this._onData(data);
      } catch {
        // 忽略回调中抛出的异常
      }
    }

    // 异步迭代器投递
    if (this.recvWaiters.length > 0) {
      const waiter = this.recvWaiters.shift()!;
      waiter.resolve({ value: data, done: false });
    } else {
      this.recvQueue.push(data);
    }
  }

  private closeRecv(): void {
    this.recvClosed = true;
    while (this.recvWaiters.length > 0) {
      this.recvWaiters.shift()!.resolve({ value: undefined, done: true });
    }
  }

  // -- lifecycle ---------------------------------------------------------

  /** @internal */
  startSendLoop(): void {
    if (this.sendLoopPromise != null) return;
    this.sendLoopPromise = this.sendLoop();
  }

  /**
   * 等待连接建立（OPEN_ACK）。
   * @internal
   */
  async waitForOpen(timeoutMs: number): Promise<void> {
    const signal = this.abortController.signal;
    if (signal.aborted) {
      throw new RelayError(RelayErrorCode.NotConnected, "connection aborted");
    }

    await raceTimeout(
      this.openPromise,
      timeoutMs,
      new RelayError(RelayErrorCode.OpenTimeout, "OPEN timeout waiting for OPEN_ACK"),
      signal
    );
  }

  /**
   * 优雅关闭连接。
   * 发送 CLOSE 帧并清理本地状态。
   */
  async close(): Promise<void> {
    if (this._state !== RelayState.Open) return;
    this._state = RelayState.Closing;

    const closeEnv: DomainRelayEnvelope = {
      relayId: this.relayID,
      kind: RelayKind.Close,
      senderSession: this._mySession,
      targetSession: this._remoteSession,
      seq: "0",
      ackSeq: "0",
      payload: new Uint8Array(0),
      sentAtMs: Date.now().toString()
    };
    try {
      await this.sendRelayEnvelope(closeEnv);
    } catch {
      // 忽略 CLOSE 发送失败
    }

    this.handleClose();
  }

  /**
   * 强制关闭连接。
   * @param reason - 关闭原因
   */
  abort(reason?: Error): void {
    this.handleClose(reason);
  }

  // -- internal envelope handling ----------------------------------------

  /** @internal */
  handleOpenAck(env: DomainRelayEnvelope): void {
    if (this._state === RelayState.Opening) {
      this._state = RelayState.Open;
      this._remoteSession = env.senderSession;
      if (this.openResolve != null) {
        this.openResolve();
        this.openResolve = undefined;
      }
    }
  }

  /** @internal */
  handleRemoteClose(): void {
    this.handleClose(
      new RelayError(RelayErrorCode.RemoteClose, "remote peer closed connection")
    );
  }

  /** @internal */
  handleRemoteError(env: DomainRelayEnvelope): void {
    const msg = Buffer.from(env.payload).toString("utf8");
    this.handleClose(
      new RelayError(RelayErrorCode.Protocol, `remote peer error: ${msg}`)
    );
  }

  /** @internal */
  handleEnvelope(env: DomainRelayEnvelope): void {
    switch (env.kind) {
      case RelayKind.Data:
        this.handleData(env);
        break;
      case RelayKind.Ack:
        this.handleAck(env);
        break;
      case RelayKind.Ping:
        this.handlePing(env);
        break;
      // 其他类型已在 Relay.handlePacket 中处理
    }
  }

  /** @internal */
  async sendRelayEnvelope(env: DomainRelayEnvelope): Promise<void> {
    const body = encodeRelayEnvelope(env);
    const mode = this._config.deliveryMode !== "" ? this._config.deliveryMode : DeliveryMode.RouteRetry;

    await this.relay.client.sendPacket(
      this._remotePeer,
      body,
      mode,
      { targetSession: this._remoteSession }
    );
  }

  // -- private: handle incoming frames -----------------------------------

  private handleData(env: DomainRelayEnvelope): void {
    const reliability = this._config.reliability;

    if (reliability === Reliability.BestEffort) {
      this.pushRecv(env.payload);
      return;
    }

    // AtLeastOnce & ReliableOrdered: 回复 ACK
    const ackEnv: DomainRelayEnvelope = {
      relayId: this.relayID,
      kind: RelayKind.Ack,
      senderSession: this._mySession,
      targetSession: this._remoteSession,
      seq: "0",
      ackSeq: env.seq,
      payload: new Uint8Array(0),
      sentAtMs: Date.now().toString()
    };
    this.sendRelayEnvelope(ackEnv).catch(() => {});

    if (reliability === Reliability.AtLeastOnce) {
      this.pushRecv(env.payload);
      return;
    }

    // ReliableOrdered: 有序投递
    const seq = BigInt(env.seq);
    if (seq === this.expectedSeq) {
      this.pushRecv(env.payload);
      this.expectedSeq++;
      // 投递缓冲中连续的帧
      while (true) {
        const buf = this.recvBuf.get(this.expectedSeq.toString());
        if (buf == null) break;
        this.pushRecv(buf);
        this.recvBuf.delete(this.expectedSeq.toString());
        this.expectedSeq++;
      }
    } else if (seq > this.expectedSeq) {
      const diff = seq - this.expectedSeq;
      if (diff < BigInt(this._config.windowSize)) {
        this.recvBuf.set(env.seq, env.payload);
      }
    }
    // seq < expectedSeq: 重复帧，忽略
  }

  private handleAck(env: DomainRelayEnvelope): void {
    if (this._config.reliability === Reliability.BestEffort) return;

    const ackSeq = BigInt(env.ackSeq);
    if (ackSeq >= this.sendBase) {
      for (let seq = this.sendBase; seq <= ackSeq; seq++) {
        this.unacked.delete(seq.toString());
      }
      this.sendBase = ackSeq + 1n;
      this.retransCnt = 0;
    }

    // 有窗口空间可用，通知 sendLoop
    if (this.ackWaiter != null) {
      this.ackWaiter.resolve();
      this.ackWaiter = undefined;
    }

    // 所有帧已确认，取消重传定时器
    if (this.unacked.size === 0) {
      this.clearRetransmitTimer();
    }
  }

  private handlePing(_env: DomainRelayEnvelope): void {
    const errEnv: DomainRelayEnvelope = {
      relayId: this.relayID,
      kind: RelayKind.Error,
      senderSession: this._mySession,
      targetSession: this._remoteSession,
      seq: "0",
      ackSeq: "0",
      payload: new Uint8Array(0),
      sentAtMs: Date.now().toString()
    };
    this.sendRelayEnvelope(errEnv).catch(() => {});
  }

  // -- private: close ----------------------------------------------------

  private handleClose(reason?: Error): void {
    if (this._closed) return;
    this._closed = true;
    this._state = RelayState.Closed;

    this.abortController.abort(reason);
    this.clearRetransmitTimer();
    this.notifySendQueue();
    this.notifyAckWaiter();
    this.notifySpaceAvailable();

    // 完成 OPEN_ACK 等待
    if (this.openResolve != null) {
      this.openResolve();
      this.openResolve = undefined;
    }

    // 关闭接收端
    this.closeRecv();

    // 异步清理
    const doCleanup = () => {
      this.relay.removeConnection(this.relayID);
      const handlers = this.closeHandlers.slice();
      for (const fn of handlers) {
        try {
          fn(reason);
        } catch {
          // 忽略回调异常
        }
      }
    };

    if (this.sendLoopPromise != null) {
      this.sendLoopPromise.catch(() => {}).finally(doCleanup);
    } else {
      doCleanup();
    }
  }

  // -- private: retransmit -----------------------------------------------

  private scheduleRetransmit(): void {
    this.clearRetransmitTimer();
    if (this._closed || this._config.reliability === Reliability.BestEffort) return;
    if (this.unacked.size === 0) return;

    this.retransmitTimer = setTimeout(() => {
      this.retransmitTimer = undefined;
      if (this._closed) return;
      this.retransmit();
      // 重传后如果仍有未确认帧，继续调度
      this.scheduleRetransmit();
    }, this._config.ackTimeoutMs);
  }

  private clearRetransmitTimer(): void {
    if (this.retransmitTimer != null) {
      clearTimeout(this.retransmitTimer);
      this.retransmitTimer = undefined;
    }
  }

  private retransmit(): void {
    if (this.unacked.size === 0) return;

    this.retransCnt++;
    if (this.retransCnt > this._config.maxRetransmits) {
      this.handleClose(
        new RelayError(RelayErrorCode.MaxRetransmit, "max retransmits exceeded")
      );
      return;
    }

    for (let seq = this.sendBase; seq < this.nextSeq; seq++) {
      const frame = this.unacked.get(seq.toString());
      if (frame == null) continue;

      const env: DomainRelayEnvelope = {
        relayId: this.relayID,
        kind: RelayKind.Data,
        senderSession: this._mySession,
        targetSession: this._remoteSession,
        seq: seq.toString(),
        ackSeq: "0",
        payload: frame.data,
        sentAtMs: Date.now().toString()
      };
      this.sendRelayEnvelope(env).catch(() => {});
    }
  }

  // -- private: sendLoop -------------------------------------------------

  private notifySendQueue(): void {
    if (this.sendQueueWaiter != null) {
      this.sendQueueWaiter.resolve();
      this.sendQueueWaiter = undefined;
    }
  }

  private notifySpaceAvailable(): void {
    if (this.spaceAvailable != null) {
      this.spaceAvailable.resolve();
      this.spaceAvailable = undefined;
    }
  }

  private async sendWithTimeout(data: Uint8Array, timeoutMs: number): Promise<void> {
    while (this.pendingBytes >= this._config.sendBufferSize) {
      if (this._closed) {
        throw new RelayError(RelayErrorCode.ClientClosed, "connection closed");
      }

      const spaceWaiter = createDeferred<void>();
      this.spaceAvailable = spaceWaiter;

      try {
        await raceTimeout(
          spaceWaiter.promise,
          timeoutMs,
          new RelayError(RelayErrorCode.SendTimeout, "send timeout waiting for buffer space"),
          this.abortController.signal
        );
      } catch (error) {
        if (this.spaceAvailable === spaceWaiter) {
          this.spaceAvailable = undefined;
        }
        throw error;
      }
    }

    this.sendQueue.push(data);
    this.pendingBytes += data.length;
    this.notifySendQueue();
  }

  private notifyAckWaiter(): void {
    if (this.ackWaiter != null) {
      this.ackWaiter.resolve();
      this.ackWaiter = undefined;
    }
  }

  private async sendLoop(): Promise<void> {
    const signal = this.abortController.signal;

    while (!signal.aborted) {
      // 等待发送队列有数据
      if (this.sendQueue.length === 0) {
        // 可靠模式下同时等待 ACK 超时
        const hasUnacked = this._config.reliability !== Reliability.BestEffort && this.unacked.size > 0;

        const waiter = createDeferred<void>();
        this.sendQueueWaiter = waiter;

        try {
          if (hasUnacked) {
            await raceWithSignal(
              Promise.race([
                waiter.promise,
                sleep(this._config.ackTimeoutMs)
              ]),
              signal
            );
          } else {
            await raceWithSignal(waiter.promise, signal);
          }
        } catch {
          return;
        }

        if (this.sendQueueWaiter === waiter) {
          this.sendQueueWaiter = undefined;
        }

        // 超时且无新数据到达：进行重传
        if (this.sendQueue.length === 0 && hasUnacked && this.unacked.size > 0) {
          this.retransmit();
        }
        continue;
      }

      // 取出一条数据
      const data = this.sendQueue.shift()!;

      if (this._config.reliability === Reliability.BestEffort) {
        // BestEffort: 直接发送，无需序号
        this.pendingBytes -= data.length;
        this.notifySpaceAvailable();

        const env: DomainRelayEnvelope = {
          relayId: this.relayID,
          kind: RelayKind.Data,
          senderSession: this._mySession,
          targetSession: this._remoteSession,
          seq: "0",
          ackSeq: "0",
          payload: data,
          sentAtMs: Date.now().toString()
        };
        try {
          await this.sendRelayEnvelope(env);
        } catch (error) {
          this.handleClose(error as Error);
          return;
        }
        continue;
      }

      // AtLeastOnce / ReliableOrdered: 滑动窗口
      const windowUsed = Number(this.nextSeq - this.sendBase);
      if (windowUsed >= this._config.windowSize) {
        // 窗口满，放回数据等待 ACK
        this.sendQueue.unshift(data);
        this.pendingBytes += data.length; // 恢复缓冲区计数

        const ackWaiter = createDeferred<void>();
        this.ackWaiter = ackWaiter;

        try {
          await raceWithSignal(
            Promise.race([
              ackWaiter.promise,
              sleep(this._config.ackTimeoutMs)
            ]),
            signal
          );
        } catch {
          return;
        }

        if (this.ackWaiter === ackWaiter) {
          this.ackWaiter = undefined;
        }
        continue;
      }

      // 窗口可用，分配序号发送
      this.pendingBytes -= data.length;
      this.notifySpaceAvailable();

      const seq = this.nextSeq;
      this.nextSeq++;
      this.unacked.set(seq.toString(), { data, retransmit: 0 });
      if (this.sendBase === BigInt(0)) {
        this.sendBase = seq;
      }

      // 启动/重置重传定时器
      this.scheduleRetransmit();

      const env: DomainRelayEnvelope = {
        relayId: this.relayID,
        kind: RelayKind.Data,
        senderSession: this._mySession,
        targetSession: this._remoteSession,
        seq: seq.toString(),
        ackSeq: "0",
        payload: data,
        sentAtMs: Date.now().toString()
      };
      try {
        await this.sendRelayEnvelope(env);
      } catch (error) {
        this.clearRetransmitTimer();
        this.handleClose(error as Error);
        return;
      }
    }

    this.clearRetransmitTimer();
  }
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

/**
 * Relay 管理器，基于 Client 管理 relay 连接。
 *
 * 负责：
 * - 通过 connect() 发起出站连接
 * - 通过 onConnection() 注册入站连接处理器
 * - 通过 handlePacket() 分发入口的 Packet 到对应的连接
 */
export class Relay {
  readonly client: RelayClient;
  private readonly conns = new Map<string, RelayConnection>();
  private onConnHandler: ((conn: RelayConnection) => void) | undefined;

  constructor(client: RelayClient) {
    this.client = client;
  }

  /**
   * 注册入站 relay 连接的处理器。
   * 每个新入站连接会调用 handler。
   */
  onConnection(handler: (conn: RelayConnection) => void): void {
    this.onConnHandler = handler;
  }

  /**
   * 向目标用户发起 relay 连接。
   *
   * 自动解析目标用户的在线会话，选择支持瞬时消息的会话。
   * config 为 undefined 时使用默认配置。
   *
   * @param target - 目标用户
   * @param config - 可选的自定义配置
   * @returns 已建立连接的 RelayConnection
   * @throws {RelayError} 如果无法解析会话、发送 OPEN 超时或连接被拒绝
   */
  async connect(target: UserRef, config?: RelayConfig): Promise<RelayConnection> {
    const sessions = await this.client.resolveUserSessions(target);

    let targetSession: SessionRef | undefined;
    for (const s of sessions.sessions) {
      if (s.transientCapable) {
        targetSession = s.session;
        break;
      }
    }
    if (targetSession == null) {
      throw new RelayError(
        RelayErrorCode.NotConnected,
        "no transient-capable session found for target user"
      );
    }

    const cfg = config ?? defaultRelayConfig();
    const relayID = newRelayID();
    const mySession = this.client.sessionRef;
    if (mySession == null) {
      throw new RelayError(RelayErrorCode.NotConnected, "client not connected");
    }

    const conn = new RelayConnection(
      this,
      relayID,
      target,
      targetSession,
      mySession,
      cfg
    );

    this.conns.set(relayID, conn);

    const openEnv: DomainRelayEnvelope = {
      relayId: relayID,
      kind: RelayKind.Open,
      senderSession: mySession,
      targetSession,
      seq: "0",
      ackSeq: "0",
      payload: new Uint8Array(0),
      sentAtMs: Date.now().toString()
    };

    try {
      await conn.sendRelayEnvelope(openEnv);
    } catch (error) {
      this.conns.delete(relayID);
      throw new RelayError(
        RelayErrorCode.NotConnected,
        `send OPEN: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    conn.startSendLoop();

    try {
      await conn.waitForOpen(cfg.openTimeoutMs);
    } catch (error) {
      conn.abort(error as Error);
      this.conns.delete(relayID);
      throw error;
    }

    return conn;
  }

  /**
   * 处理入站 packet，检查 body 是否为 relay 帧。
   *
   * @param packet - 收到的 Packet
   * @returns true 表示该 packet 被 relay 层消费
   */
  handlePacket(packet: Packet): boolean {
    let env: DomainRelayEnvelope;
    try {
      env = decodeRelayEnvelope(packet.body);
    } catch {
      return false;
    }

    const conn = this.conns.get(env.relayId);

    switch (env.kind) {
      case RelayKind.Open:
        if (conn == null) {
          this.acceptIncoming(env);
        }
        return true;

      case RelayKind.OpenAck:
        if (conn != null) {
          conn.handleOpenAck(env);
        }
        return true;

      case RelayKind.Close:
        if (conn != null) {
          conn.handleRemoteClose();
        }
        return true;

      case RelayKind.Error:
        if (conn != null) {
          conn.handleRemoteError(env);
        }
        return true;

      default:
        if (conn != null) {
          conn.handleEnvelope(env);
        }
        return true;
    }
  }

  /**
   * 从管理器移除连接。
   * @internal
   */
  removeConnection(relayID: string): void {
    this.conns.delete(relayID);
  }

  // -- private ------------------------------------------------------------

  private acceptIncoming(env: DomainRelayEnvelope): void {
    const cfg = defaultRelayConfig();

    // 构造新的连接对象，远端用户暂未知（后续可通过 Packet 的 sender 字段推断）
    const conn = new RelayConnection(
      this,
      env.relayId,
      { nodeId: "0", userId: "0" },
      env.senderSession,
      env.targetSession,
      cfg
    );
    conn.setState(RelayState.Open);

    // 处理并发 OPEN
    if (this.conns.has(env.relayId)) {
      // 已有相同 relay_id 的连接，说明是重复 OPEN，丢弃新连接
      conn.abort(new RelayError(RelayErrorCode.DuplicateOpen, "concurrent OPEN, keeping existing connection"));
      return;
    }
    this.conns.set(env.relayId, conn);

    conn.startSendLoop();

    // 回复 OPEN_ACK
    const openAckEnv: DomainRelayEnvelope = {
      relayId: env.relayId,
      kind: RelayKind.OpenAck,
      senderSession: env.targetSession,
      targetSession: env.senderSession,
      seq: "0",
      ackSeq: "0",
      payload: new Uint8Array(0),
      sentAtMs: Date.now().toString()
    };
    conn.sendRelayEnvelope(openAckEnv).catch(() => {});

    const handler = this.onConnHandler;
    if (handler != null) {
      handler(conn);
    }
  }
}

// ---------------------------------------------------------------------------
// RelayEnvelope encode / decode
// ---------------------------------------------------------------------------

/**
 * 将领域模型的 RelayEnvelope 编码为 protobuf 字节数组。
 */
export function encodeRelayEnvelope(env: DomainRelayEnvelope): Uint8Array {
  return ProtoRelayEnvelope.toBinary(ProtoRelayEnvelope.create({
    relayId: env.relayId,
    kind: relayKindToProto(env.kind),
    senderSession: {
      servingNodeId: env.senderSession.servingNodeId,
      sessionId: env.senderSession.sessionId
    },
    targetSession: {
      servingNodeId: env.targetSession.servingNodeId,
      sessionId: env.targetSession.sessionId
    },
    seq: env.seq,
    ackSeq: env.ackSeq,
    payload: env.payload,
    sentAtMs: env.sentAtMs
  }));
}

/**
 * 从 protobuf 字节数组解码出领域模型的 RelayEnvelope。
 * 如果解码失败则抛出错误。
 */
export function decodeRelayEnvelope(data: Uint8Array): DomainRelayEnvelope {
  const pb = ProtoRelayEnvelope.fromBinary(data);
  return {
    relayId: pb.relayId,
    kind: relayKindFromProto(pb.kind),
    senderSession: {
      servingNodeId: pb.senderSession?.servingNodeId ?? "0",
      sessionId: pb.senderSession?.sessionId ?? ""
    },
    targetSession: {
      servingNodeId: pb.targetSession?.servingNodeId ?? "0",
      sessionId: pb.targetSession?.sessionId ?? ""
    },
    seq: pb.seq,
    ackSeq: pb.ackSeq,
    payload: pb.payload,
    sentAtMs: pb.sentAtMs
  };
}

// ---------------------------------------------------------------------------
// RelayKind conversion helpers
// ---------------------------------------------------------------------------

/**
 * 将领域 RelayKind 值转换为 protobuf RelayKind 枚举。
 */
function relayKindToProto(kind: number): ProtoRelayKind {
  switch (kind) {
    case RelayKind.Open: return ProtoRelayKind.OPEN;
    case RelayKind.OpenAck: return ProtoRelayKind.OPEN_ACK;
    case RelayKind.Data: return ProtoRelayKind.DATA;
    case RelayKind.Ack: return ProtoRelayKind.ACK;
    case RelayKind.Close: return ProtoRelayKind.CLOSE;
    case RelayKind.Ping: return ProtoRelayKind.PING;
    case RelayKind.Error: return ProtoRelayKind.ERROR;
    default: return ProtoRelayKind.UNSPECIFIED;
  }
}

/**
 * 将 protobuf RelayKind 枚举转换为领域 RelayKind 值。
 */
function relayKindFromProto(kind: ProtoRelayKind): number {
  switch (kind) {
    case ProtoRelayKind.OPEN: return RelayKind.Open;
    case ProtoRelayKind.OPEN_ACK: return RelayKind.OpenAck;
    case ProtoRelayKind.DATA: return RelayKind.Data;
    case ProtoRelayKind.ACK: return RelayKind.Ack;
    case ProtoRelayKind.CLOSE: return RelayKind.Close;
    case ProtoRelayKind.PING: return RelayKind.Ping;
    case ProtoRelayKind.ERROR: return RelayKind.Error;
    default: return RelayKind.Unspecified;
  }
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/**
 * 对 Promise 进行超时包装。
 */
function raceTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: unknown,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(copyError(timeoutError));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new Error("connection aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    if (signal.aborted) {
      cleanup();
      reject(new Error("connection aborted"));
      return;
    }

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

/**
 * 以 signal 为竞速条件的 Promise 包装。
 * 当 signal 被中止时, promise 也会被 reject。
 */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error("aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
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
  if (typeof error === "object" && error != null && "constructor" in error) {
    const ctor = (error as { constructor: new (...args: unknown[]) => unknown }).constructor;
    if (ctor.name === "RelayError") {
      return new RelayError(
        (error as RelayError).code,
        (error as Error).message.replace(/^relay: /, "")
      );
    }
  }
  return error;
}

/**
 * 延迟指定的毫秒数。
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
