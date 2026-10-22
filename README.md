# V33 — Choice D51 Render 自动连接排查及修复版

基于你上传的 **V32 完整版**（并对照 V31 的本机桥接协议）制作。**这是完整 GitHub 仓库根目录文件，不是仅前端补丁。**

## 这次根据真实 Render Logs 修复了什么

你提供的日志确认：`/GetGameUrl` 已返回官方 Choice 授权入口，Playwright 也加载了 Choice 页面，但随后显示 `choice_websocket_not_seen`。**仅凭此错误，无法证明浏览器已进入 D51 或服务器有权限连接游戏 WebSocket。**

- 保留官方 `/GetGameUrl` 取得签名 Choice 入口的方式；不使用或复制用户电脑的 WebSocket 登录包。
- 为 Chromium 增加 **Playwright + CDP 双重 WebSocket 观察**。如果某条二进制数据帧没有被 Playwright 页面事件捕获，CDP 监听器可以在已识别的游戏连接上尝试读取并交给现有 D51 解码器（仅限 `D051`）。同一端口已由 Playwright 监听时不会重复解码。
- 将先前笼统的 `choice_websocket_not_seen` 细分为：游戏页面未加载、WebSocket 握手失败、未知端点、握手未确认、已经连接但尚无 D51 结果等。
- 为页面、iframe、WebSocket 创建和握手、浏览器 JS 错误、网页请求失败、WebSocket 数据帧增加**隐私安全的计数诊断**。
- 保留 **WinGo、K3、5D、TRX、手动百家乐**，不改变 MZPlay 登录 Token 或已有 API 请求流程。无任何自动下注行为。

**注意：** 即使 CDP 也可能看不到在独立 Worker 内部创建的 WebSocket；`workerCount` 仅表示浏览器观察到 Worker，不代表其中的连接已经捕获。游戏若用 Canvas 操作导航，程序不会盲点坐标或点击下注区域。**本版没有在你的真实 Render / D51 线上会话验证成功，不应被当成已通的 24 小时数据服务。**

## 上传安装

1. 解压 `V33-Choice-D51-Connection-Fix-Full.zip`，将文件和文件夹全部覆盖上传至 GitHub 原来的 **Test** 仓库根目录，包含隐藏的 `.github/workflows`；Commit。
2. 确认 GitHub Pages 完成部署，网站版本显示 **UI V33**。
3. Render 的 `Build Command = bash render_build.sh`、`Start Command = bash start_render.sh` 都不变。如果 Render 未自动部署，请在 Test 服务选择手动部署最新 Commit。
4. **不要更新** `MZPLAY_AUTH_STATE_B64`、`MZPLAY_USERNAME`、`MZPLAY_PASSWORD`、`MZPLAY_DEVICE_ID`。除非你确认它们已失效。
5. 打开 `https://test-4bvi.onrender.com/api/choice-status`，重点看 `stage`、`lastError`、`diagnostics`、`records`、`lastNewResultAt`。日志里还可以搜索 `[Choice/D51/Diag]`。

如果需要立刻停止 Choice 自动采集，在 Render Environment 设置 `CHOICE_AUTO_ENABLED=0` 后部署；其他游戏仍可正常运行。

## 如何理解 V33 诊断

| 字段 | 意义 |
|---|---|
| `gamePageSeen: false` | 没观察到 Choice 游戏主页面 `/pc/.../index.jsp`；可能停在转址或授权入口 |
| `pageCount` / `frameCount` | 浏览器页数、iframe 数量（不显示地址或签名） |
| `providerWebSockets: 0` | 尚未发现已知 Choice 服务器域名的 WebSocket 创建 |
| `otherWebSockets > 0` | 出现其他端点；可能属于游戏，也可能不相关，暂不能认定为 D51 |
| `webSocketHandshakes > 0` | 底层连接已收到 HTTP 101 握手成功（**不等于**已登录游戏） |
| `webSocketHandshakeFailures > 0` | 某些游戏 WebSocket 连接过程出错 |
| `webSocketFrames > 0` | 已捕获游戏端点的 WebSocket 数据帧（**不等于**已解出开奖结果） |
| `gameNavigationSelected: false` | 未成功选择到安全、明确的 DOM D51 房间导航控件；Canvas 房间不盲点 |
| `workerCount > 0` | 出现 Worker；其中的 socket 可能无法从页面监听器看到 |
| `records > 0` / `lastSnapshotAt > 0` | 确实已解析到 `D051` 开奖历史 |
| `lastNewResultAt > 0` 且持续变化 | 观察到新结果追加；比网页刚加载或读取时间更能表明有持续更新 |

## V33 新增失败类型

- `choice_game_not_loaded`：授权入口获取成功，但没确认进入游戏主页面。
- `choice_websocket_not_seen`：游戏页面看起来进入了，但没发现已知的游戏 socket。
- `choice_ws_endpoint_unrecognized`：检测到 WebSocket，端点不在已知游戏域名范围。
- `choice_ws_handshake_failed`：游戏 WebSocket 尝试连接，但握手失败。
- `choice_ws_handshake_unconfirmed`：找到游戏 socket，但没有确认握手或收到数据。
- `d51_result_not_seen`：观察到连接，但没有解出 `D051` 的有效开奖结果。

无论状态如何，**不应发送给任何人** Render Environment Value、Token、Refresh Token、Cookie、Authorization Header、签名游戏入口 URL 或原始 WebSocket 数据。

## 本地测试范围

执行：`python -m unittest test_v33_auto.py test_v32_auto.py`

测试覆盖：CDP 二进制帧解码、重复来源避免、其他房间过滤、阶段分类、隐私安全诊断、数据合并和旧版兼容检查。在本地 Chromium 对页面附加 CDP 的最小测试成功；测试环境阻止向本机 HTTP 地址进行浏览器访问，因此无法运行真实网络 WebSocket 浏览器端到端测试，线上连接仍需 Render 日志确认。
