# 远程联机部署与排查

**推荐：Linux VPS + 自有域名 + Caddy。** 适合想自行备份数据、管理账号和控制域名的用户。也可以在支持服务器端 Worker、D1、R2 的 ChatGPT Sites 上建立独立站点。GitHub 仓库和 GitHub Pages 不能运行这个联机后端；只上传 `public/` 没有匹配、语音信令、好友或后台。

## 方案 A：Linux VPS 和域名

1. 准备一台有公网 IP 的 Linux 服务器，装好 Git、Node.js 22.13+ 和 [Caddy](https://caddyserver.com/docs/install)。如果 Node 只通过个人的版本管理器安装，systemd 服务可能找不到它；请使用系统可用的 Node，或把服务文件的 `ExecStart` 改为 Node 的实际绝对路径加入口脚本。
2. 在 DNS 服务商创建 `play.example.com` 的 `A` 记录，指向服务器的公网 IPv4；只有服务器和防火墙确实支持公网 IPv6 时才添加 `AAAA`。将文档与模板里的域名替换为自己的域名。云安全组和主机防火墙都开放 TCP 80、443；**不要开放 3000**。首次配置可用 DNS-only 模式，让域名直接指向服务器。
3. 安装应用与服务。不要在已有同名服务或数据目录上直接覆盖配置。

```sh
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin duetrhythm
sudo git clone https://github.com/erhaerha66/duet-rhythm-plus.git /opt/duet-rhythm-plus
cd /opt/duet-rhythm-plus
npm test
sudo install -m 0644 deploy/duet-rhythm.service /etc/systemd/system/duet-rhythm.service
sudo install -m 0600 /dev/null /etc/duet-rhythm.env
sudoedit /etc/duet-rhythm.env
```

在服务环境文件中填入下列配置，将两个占位符分别替换为不同的高强度随机值。可以运行两次 `openssl rand -hex 32` 生成；不要发到聊天或推送到 Git。

```dotenv
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/duet-rhythm
PUBLIC_ORIGIN=https://play.example.com
ADMIN_PASSWORD=REPLACE_WITH_UNIQUE_RANDOM_VALUE
MODERATION_KEY=REPLACE_WITH_ANOTHER_RANDOM_VALUE
```

`PUBLIC_ORIGIN` 必须与访问的 HTTPS 源完全一致，不加子路径。否则后台登录、账号绑定或房间写请求可能被拒绝。反向代理部署默认只按账号封禁，不会把代理 IP 当成玩家 IP。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now duet-rhythm
curl --fail http://127.0.0.1:3000/api/active-rooms
```

4. 将 [Caddyfile 示例](../deploy/Caddyfile) 中的站点块合并到 `/etc/caddy/Caddyfile`，换成实际域名。如果服务器已有其他站点，请保留原有配置。DNS 生效且端口可达后，[Caddy 会申请和续签证书、重定向 HTTP 到 HTTPS](https://caddyserver.com/docs/automatic-https)。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl --fail https://play.example.com/api/active-rooms
```

5. 访问域名的 `/admin`，用服务端管理员密码登录。分享的是 HTTPS 域名或游戏生成的邀请，不是服务器的 3000 端口。服务升级前备份数据目录，停止应用后一起备份 SQLite、伴随文件和附件，再更新源码、运行测试、重启服务；不要删除数据库来解决迁移问题。只运行一个 Node 实例，公开前在反代或防护服务中配置请求限流，不记录请求体或 Cookie，不缓存 `/api/*`。

## 方案 B：ChatGPT Sites 托管

这是独立的 **Worker + D1 + R2** 部署，不运行 Node 进程，也不会连接原站。需要支持后端和存储绑定的 Sites 工作区，以及该站点的编辑权限；如果只有静态发布能力，请用方案 A。

1. 在装有 Sites 的 Codex 中打开仓库的干净副本，请 Sites **新建独立的测试站**并返回其项目 ID。不要选原站。默认先仅对受邀测试者开放；多人测试时让三位测试者都具备访问权限。
2. 在该 Sites 源码副本中创建或更新 `.openai/hosting.json`，用平台返回的真实项目 ID 替换占位符，并保留平台已有的非静态配置。若选择了静态模板，应改用 Worker 站点，不保留 `static` 配置。GitHub 仓库不提交任何项目 ID；仅在 Sites 专用副本里用 `git add -f .openai/hosting.json` 让 Sites 工作流跟踪该清单。

```json
{
  "project_id": "REPLACE_WITH_NEW_SITES_PROJECT_ID",
  "d1": "DB",
  "r2": "REPORT_FILES"
}
```

3. 执行 `npm ci`、`npm test`、`npm run build:sites`。再让 Sites 同步源码、上载生成的 `dist/` 并发布到该测试站。产物包含 Worker `dist/server/index.js`、部署清单和 `dist/drizzle/` 下的迁移；由 Sites 在部署时准备数据库和私有附件桶并应用迁移。不需要上传 SQLite 文件、环境文件或旧数据。
4. 在 Sites 的服务端运行环境设置 `ADMIN_EMAILS`（逗号分隔的授权 ChatGPT 账号邮箱）及独立随机的 `MODERATION_KEY`（生成举报凭证）。按需添加下节的 TURN 变量。Sites 的 `/admin` 使用平台登录加邮箱白名单，**不使用** `ADMIN_PASSWORD`；未配置白名单不会授予管理权限。玩家可绑定自己的 ChatGPT 账号同步本站好友，不会导入旧站好友。
5. 用 Sites 发布后返回的 HTTPS 地址联机。若工作区支持自定义域名，到 Sites 的域名设置添加子域名，再按平台实际给出的 DNS 记录操作，等平台确认域名和证书可用。不需要给这个域名配置 VPS 的 A 记录。域名启用后，统一分享新地址；游客身份保存在浏览器，换域名不会自动带过去。

## 公网语音：先直连，再验证 TURN

房间中的语音需要双人同意并各自授权麦克风。HTTPS 让浏览器可以申请权限，但不保证两个网络能直连。应用默认用 STUN 尝试 WebRTC 直连，失败时可试房间里的「使用兼容语音」（通过站点转发加密片段）。

- 建议优先用 [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/)：在服务商控制台创建 TURN Key，把 `TURN_KEY_ID` 与 `TURN_KEY_API_TOKEN` 配到服务端。通话获准后服务端申请短期凭据，长期密钥不下发给浏览器。
- 也可使用自己的 TURN 服务或第三方 TURN，成套配置 `TURN_URL`、`TURN_USERNAME` 和 `TURN_CREDENTIAL`。例如 `TURN_URL=turns:turn.example.com:5349?transport=tcp`。这些凭据会发到获准连接的浏览器，不能使用管理员密钥或无期限高权限账号。自建 TURN 时端口和转发范围以 TURN 服务实际配置为准，不是应用的 3000 端口。
- 出现「能进房但没声音」：用系统浏览器打开正式 HTTPS 地址，双方分别开麦；检查系统权限、浏览器是否静音。换 Wi-Fi 和手机流量各一端测试；可在浏览器 WebRTC 诊断中查看是否选中 `relay` 候选。立即关闭通话后，两端都应释放麦克风。

## 上线验收

本版本已在本地 Caddy HTTPS 下用桌面和模拟手机浏览器验证三人流程，并通过 Sites 构建及本地 Worker 后端测试。实际购买的域名、证书颁发、公网跨网络 TURN、Sites 托管发布仍需用自己的环境按下面步骤验收。

用三个独立浏览器配置；发布到公网后至少让一个设备走手机流量：

1. A 和 B 在大厅打开「在线列表」，展开「我的上线状态和偏好」；打开「显示我在线」后对方才能在公开在线列表找到你。取消后不应继续公开展示。
2. A 创建好友房，B 用房间码加入。两人确认允许观战并准备开局；C 在「房间列表」应能找到本局并进入观战。准备时允许观战默认勾选，需要私密对局就先取消。未公开或未开局的房间不显示在此列表。任一玩家关闭公开观战后，C 应退出旁观。
3. C 默认听不到语音；只有双方都同意通话、各自打开公开语音开关后，普通观众才可听到已开麦者。随后关闭任一侧公开语音，确认 C 不再收到声音。后台没有管理员旁听入口。
4. A 和 B 试通话、加好友和发私信。后台检查用户、房间与流量，展开举报后测试翻页；未获授权的账号不应能读取举报或附件。

排查：域名不通先看 DNS、端口和 `journalctl -u caddy`；页面可开但 API 不通，VPS 查看 `journalctl -u duet-rhythm`，Sites 检查绑定与迁移；好友列表为空先核对是否还在原浏览器和原域名。为避免误报，先用演示账号和合成附件验收。
