# V32 — Choice D51 Render 全自动连接（只读，待线上验证）

## 已改好

- **Choice → D51** 使用 Render 后台采集，不再需要用户打开 D51、复制 Console 或保持电脑开机。
- 复用已经配置在 Render 的 `MZPLAY_AUTH_STATE_B64`，与 K3 / 5D / TRX 在**同一个 Render 进程**中共享一个加锁的 MZPlay 会话。
- 依照现有 MZPlay 客户端的 `/GetGameUrl` 获取 **AG_Video 官方签名入口**，由 Playwright 打开该入口，让**官方 Choice 客户端自己建立 WebSocket**。不手工构造/重放游戏登录包，不猜测登录票据，不绕过 Cloudflare。
- 自动尝试点击明确标记 `D51` 的房间导航控件（若存在），监听官方游戏 WebSocket 的 `BAC_FULL_RESULT_LIST (135176)`，**仅接受 D051** 且所有结果字段完整、无歧义的快照。
- 有效快照写入 `choice_runtime.json`，`/api/data` 自动合并进 `baccarat.rooms.D51`。跟 WinGo/K3/5D/TRX 数据分开存放，不会被旧的 GitHub 采集快照覆盖。
- `/api/choice-status` 和 `/api/connection-status` 都暴露**不含 URL、Token、Cookie 的只读状态**。首次载入历史不谎称已经实时，只有观察到快照变化之后才标记新开奖。
- 保留原来的「百家乐手动」及其他全部游戏；不下注、不转账、不自动投注，也不预测保证盈利。

## 安装（一次）

1. 解压 `V32-Choice-D51-Render-Auto-Full.zip`，将全部文件上传 **GitHub 原来的 Test 仓库根目录**（覆盖同名文件，包含隐藏的 `.github`），然后 Commit。
2. GitHub Pages 部署后，网页顶部应显示 **UI V32**。Render 原有 `Build Command = bash render_build.sh`、`Start Command = bash start_render.sh` 保持不变。
3. 在 Render → **Test → Environment**，原有 Token、账号密码等变量全部保持不变。V32 新开关是 `CHOICE_AUTO_ENABLED=1`（代码本身默认就是 1，无需额外添加）；即使原有 `CHOICE_MANUAL_ONLY=1` 也不会阻止自动 D51 采集。
4. Render 完成自动部署之后访问：`https://test-4bvi.onrender.com/api/choice-status`。用 `stage` 判断进展。进入网站 **Choice → D51** 会每 12 秒自动查询 Render。

## 如何判定真正连接成功

- `stage=requesting_authorized_choice_launch`：正在请求官方允许的入口。
- `stage=choice_client_loaded`：浏览器打开，不代表登录或 D51 已成功。
- `stage=choice_websocket_open`：游戏连接已建立，但不代表 D51 结果已收到。
- **`stage=d51_snapshot_received` 且 `records > 0`**：至少成功获取 D51 历史。
- **`lastNewResultAt` 随后变成非零并继续前进**：进一步证明确有新开奖结果到达。
- `lastError=provider_authentication_failed`、`authorized_launch_failed`、`provider_access_blocked`：服务器可能仍无游戏授权或遭访问拦截，不要重新抓取或公开 Token。`d51_result_not_seen` 则表示前端/协议还需根据实际授权数据调整。

## 限制（务必先看）

**本版本地测试了脚本、数据校验、合并、界面；没有你在 Render 的真实 MZPlay 权限，也没接入 D51 官方实时数据做线上验证，不能保证部署后直接连通。** K3/5D/TRX 的 API 权限成功，不自动赋予 `GetGameUrl` 或游戏 WebSocket 权限。

Render Free 可能休眠／重启，Playwright Chromium 也可能受内存限制。签名官方启动链接可能过期，需要新获取；程序带有重试和冷却，不会无限密集重试。游戏如以 Canvas 绘制房间或要求人工验证，无法保证靠 DOM 自动选中 D51；没有真实 D051 消息就不会展示虚构结果。

`choice_console_bridge.js` 仅作为之前版本的未启用备份存在，不再由 V32 前端加载。页面不要求 Console，不向网页上传敏感凭据。

如果需要停用后台 D51 采集，在 Render Environment 设置 `CHOICE_AUTO_ENABLED=0` 并部署，WinGo、K3、5D、TRX 和手动百家乐不受影响。
