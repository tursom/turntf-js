# turntf-js 开发、测试与发布

## 1. 目录概览

`turntf-js/` 当前可以按下面的职责理解：

- `src/client.ts`：WS-first `Client`，负责连接、重连、消息分发、RPC 与可靠性语义
- `src/http.ts`：`HTTPClient`，负责 HTTP JSON 管理/查询接口
- `src/store.ts`：`CursorStore` 与 `MemoryCursorStore`
- `src/errors.ts`：SDK 错误类型
- `src/types.ts`：对业务友好的公开类型
- `src/generated/client.ts`：由 `proto/client.proto` 生成的 protobuf 类型与编解码器
- `test/client.test.ts`：WebSocket 客户端主测试
- `test/smoke.test.ts`：入口导出与基础 smoke 测试

## 2. 本地开发命令

以下命令都在 `turntf-js/` 目录下执行：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run pack:check
```

它们分别对应：

- `npm ci`：安装锁定依赖
- `npm run typecheck`：执行 `tsc --noEmit`
- `npm test`：执行 `vitest run`
- `npm run build`：使用 `tsup` 产出 ESM、CJS 与 `.d.ts`
- `npm run pack:check`：跑 `npm pack --dry-run`，确认发布包内容

当前构建产物包括：

- `dist/index.mjs`
- `dist/index.cjs`
- `dist/index.d.ts`
- 对应 sourcemap

## 3. 修改 proto 时的流程

如果改动了 `turntf-js/proto/client.proto`，需要同步更新生成代码：

```bash
npm run gen:proto
```

这个脚本会做两步：

1. 用 `protoc` + `@protobuf-ts/plugin` 生成 `src/generated/client.ts`
2. 运行 `scripts/postprocess-generated.mjs` 做后处理

注意事项：

- 机器上需要可用的 `protoc`
- 生成结果、公开类型、测试与文档要一起更新
- 任何涉及 `sessionRef`、`AckMessage`、`resolveUserSessions`、`targetSession`、`transientOnly` 的协议改动，都应该同时核对服务端文档和其他 SDK

## 4. 现有测试覆盖了什么

### `test/smoke.test.ts`

覆盖的重点：

- 包入口是否导出 `HTTPClient`、`Client`、`proto`、密码辅助函数等核心符号
- `proto` 命名空间是否可用
- `MemoryCursorStore` 是否对外部调用者保持状态隔离

### `test/client.test.ts`

覆盖的重点：

- 连接、首帧登录、`sessionRef` 暴露
- `MessagePushed` 的自动 ack 与 `CursorStore` 持久化顺序
- `sendMessage()` 返回的持久消息也会落 `CursorStore`
- `ping()` / `pong`
- `transientOnly` 与 `realtimeStream`
- `unauthorized` 登录失败后停止重连
- 重连时从 `loadSeenMessages()` 恢复 `seen_messages`
- 常见管理/查询 RPC
- `resolveUserSessions()` 与按 `targetSession` 定向 `sendPacket()`
- 请求乱序时按 `request_id` 精确路由
- 每次请求独立超时
- 非二进制帧与非法 protobuf 帧的 `ProtocolError`

目前没有单独的 `HTTPClient` 集成测试文件。如果后续修改：

- HTTP 路径
- JSON 字段映射
- `fetch` 错误处理

建议同时补一组 `HTTPClient` 测试，而不是只靠 README 或手工验证。

## 5. 本地改动建议顺序

如果要修改 `turntf-js` 的行为，推荐顺序是：

1. 先读 `src/client.ts` / `src/http.ts` 与对应测试
2. 先补或更新测试，再改实现
3. 跑 `npm run typecheck` 与 `npm test`
4. 如果动了发布内容，再跑 `npm run build` 与 `npm run pack:check`
5. 如果动了 proto 或共享协议语义，同步更新文档

对共享语义要特别小心：

- `CursorStore` 的持久化顺序
- `AckMessage` 与 `seen_messages`
- `sessionRef`
- `resolveUserSessions`
- `targetSession`
- `transientOnly`
- `realtimeStream`

这些点一旦和服务端或其他 SDK 口径不一致，最容易引发跨语言行为差异。

## 6. CI 流程

仓库内已经带了两个工作流：

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

### CI

`ci.yml` 会在下面两个场景触发：

- push 到 `master`
- 任意 Pull Request

执行步骤是：

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run pack:check`

这意味着 README、类型、测试、构建与发布包内容检查都会被一起跑一遍。

### Publish

`publish.yml` 会在推送 `v*` tag 时触发，例如：

- `v0.1.0`
- `v0.2.3`

执行步骤是：

1. `npm ci`
2. 校验 tag 去掉前缀 `v` 后，是否与 `package.json.version` 完全一致
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. `npm publish`
7. 自动创建 GitHub Release

发布目标 registry 是 GitHub Packages，来自 `package.json` 里的：

```json
{
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

## 7. 手动发布流程

如果要在本地手动发布，推荐顺序如下：

1. 确认工作区干净，或者至少明确哪些改动会进入本次发布
2. 在 `turntf-js/` 内执行：

```bash
npm run typecheck
npm test
npm run build
npm run pack:check
```

3. 更新版本号：

```bash
npm version patch
```

4. 推送提交与 tag：

```bash
git push origin master --follow-tags
```

5. 让 `publish.yml` 自动完成发布

如果你确实需要手动发包，也可以直接执行：

```bash
npm publish
```

这时会先跑 `prepublishOnly`：

```json
"prepublishOnly": "npm run typecheck && npm run test && npm run build"
```

也就是说，即使手动执行 `npm publish`，仍会先经过类型检查、测试和构建。

## 8. 发布前自检清单

- `README.md` 和 `docs/` 是否仍然符合当前实现
- 改动是否影响 `HTTPClient` 与 `Client` 的职责边界
- 如果改了消息可靠性语义，测试是否覆盖了 `saveMessage -> saveCursor -> ack -> onMessage`
- 如果改了瞬时包能力，是否检查了 `resolveUserSessions()` 与 `targetSession`
- 如果改了 proto，是否重新生成 `src/generated/client.ts`
- `package.json.version` 是否与预期 tag 对应
- `npm run pack:check` 里最终会发布的文件是否符合预期
