# proxy-subscribe-merge

将多个✈️订阅或单条分享链接合并为一条订阅输出；通过 Web 管理订阅池与用户配置（每个用户 profile 对应独立 `token`）。技术栈为 Next.js 15，默认监听 **8787** 端口。

## 界面预览

配置页（订阅池与 profile）：

![配置页](./readme/config.png)

订阅池编辑示例：

![订阅池](./readme/pool.png)

## 本地运行

前置条件：**Node.js ≥ 20**、[pnpm](https://pnpm.io/)（与 `package.json` 中 `packageManager` 版本一致为佳）。

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 准备配置与环境变量：

   ```bash
   cp config.example.json config.json
   cp .env.example .env
   ```

   编辑 `config.json`：填写 `subscriptionPool` 中各源的 `url`、`profiles` 里每个用户的 `token` 与 `sources`；按需设置 `adminPassword`（也可仅用环境变量 `ADMIN_PASSWORD`，见 `.env.example` 注释）。

   编辑 `.env`：将 `SESSION_SECRET` 改为**至少 32 位**随机字符串；可按需调整 `CONFIG_PATH`（默认项目根目录下的 `./config.json`）。

3. 启动开发服务：

   ```bash
   pnpm dev
   ```

   浏览器访问 `http://localhost:8787`，使用管理密码登录后进入配置页。

生产构建与启动：

```bash
pnpm build
pnpm start
```

## Docker 部署

1. 将 `docker-compose.example.yml` 复制为 `docker-compose.yml`，按文件内注释修改镜像名、`SESSION_SECRET`、端口映射等。

2. 在同目录放置可写的 `config.json`（可由 `config.example.json` 复制后修改）。若保存配置时出现权限错误，可参考 `docker-compose.example.yml` 中的说明调整宿主机上 `config.json` 的权限或属主。

3. 启动：

   ```bash
   docker compose up -d
   ```

   默认对外映射 **8787**。镜像构建使用仓库根目录 `Dockerfile`（Next.js `standalone` 输出）。

## 合并订阅地址

合并后的订阅由接口提供，路径为 **`/sub`**（与 `/api/sub` 等价）。

- 基本形式：`http://<主机>:8787/sub?token=<profile 的 token>`
- 默认响应为 **UTF-8 文本经 Base64 编码**的一行（便于部分客户端作为「订阅 URL」使用）。
- 若需要**明文**多行节点列表：加上 `plain=1` 或 `plain=true`，例如：`http://<主机>:8787/sub?token=<token>&plain=1`

健康检查：`GET /api/health`。

## 配置说明摘要

| 项 | 说明 |
| --- | --- |
| `subscriptionPool` | 命名订阅源；`url` 可为通用订阅链接或单条 `vless://` 等；可设 `disabled`、`userAgent` |
| `profiles` | 每个用户一条；`sources` 为池中名称列表，按顺序拉取并去重合并 |
| `SESSION_SECRET` | 会话加密，生产环境必须更换 |
| `SESSION_COOKIE_SECURE` | Docker 示例中 HTTP 部署常用 `false`；全站 HTTPS 时可设为 `true` |

更细的字段说明见 `config.example.json` 与 `docker-compose.example.yml` 内注释。

## 使用声明

本项目仅用于个人学习、研究与非商业展示，禁止任何形式的商业使用、二次售卖或盈利行为。

不用于任何商业产品、企业项目、对外服务或付费模板。

如有问题或版权相关沟通，请通过 Issue 或邮件联系。

本项目基于 MIT 开源协议发布，仅限学习使用，作者不对因使用本库导致的任何法律问题或损失承担责任。
