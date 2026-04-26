# turntf-js

`turntf-js` 是 turntf 的 Node.js SDK，当前提供：

- HTTP JSON 管理与查询客户端
- 密码处理辅助方法
- 类型安全的 turntf 数据模型
- 由 `proto/client.proto` 生成的 protobuf 类型与编解码对象

## 安装

### 从 GitHub Packages 安装

先配置 `.npmrc`：

```ini
@tursom:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

然后安装：

```bash
npm install @tursom/turntf-js
```

## 快速开始

```ts
import {
  HTTPClient,
  plainPasswordSync,
  type CreateUserRequest,
  type UserRef
} from "@tursom/turntf-js";

const client = new HTTPClient("http://127.0.0.1:8080");

const token = await client.loginWithPassword(
  "4096",
  "1",
  plainPasswordSync("root-password")
);

const request: CreateUserRequest = {
  username: "alice",
  password: plainPasswordSync("alice-password"),
  role: "user"
};

const user = await client.createUser(token, request);

const target: UserRef = { nodeId: user.nodeId, userId: user.userId };
await client.listMessages(token, target, 20);
```

如果你需要直接使用生成的 protobuf 类型，可以从 `proto` 命名空间访问：

```ts
import { proto } from "@tursom/turntf-js";

const envelope = proto.ClientEnvelope.create({
  body: {
    oneofKind: "ping",
    ping: {}
  }
});
```

原始 proto 文件也会一起发布：

```ts
import protoPath from "@tursom/turntf-js/proto/client.proto";
```

## 发布流程

仓库已经附带 GitHub Actions：

- `CI`：在 `master` 分支 push / PR 时执行 `typecheck`、`test`、`build`、`pack:check`
- `Publish`：在推送 `v*` tag 时自动发布到 GitHub Packages，并创建 GitHub Release

推荐发布步骤：

```bash
npm version patch
git push origin master --follow-tags
```

工作流会校验 tag 和 `package.json` 里的版本号是否一致，例如 `v0.1.1` 对应 `0.1.1`。

如果你想手动发布到 GitHub Packages，也可以直接运行：

```bash
npm publish
```

默认会使用 `publishConfig.registry` 指向 `https://npm.pkg.github.com`。如果以后要改为发布到 npmjs.com，可以显式覆盖：

```bash
npm publish --registry https://registry.npmjs.org
```
