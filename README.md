# V28 | MZPlay K3 / 5D / TRX 授权诊断与防重复登录

完整 V27 网站基础上升级，保留 WinGo、百家乐手动三按钮、K3、5D、TRX 界面及 Render API。

## 修复内容

- MZPlay 旧 Token 被拒绝后，三个游戏**共用一次**浏览器重新登录尝试；失败不再逐个游戏重复提交。
- 登录失败时自动进入 **5–15 分钟**逐级冷却；遇到人工验证时至少 **30 分钟**，不尝试绕过验证码或权限限制。
- Render Logs 输出安全阶段，例如 `stage=chromium_launch`、`stage=official_login_navigation`、`stage=login_form`、`stage=login_submission`，以及故障类别；不输出账号、密码、Token、带参数的 URL 或原始 Playwright 报错文本。
- 浏览器登录失败的冷却时间保存到服务器本地状态文件；采集器保留已有历史记录，不会把失败当成功。
- 更新 `render_build.sh`：支持 **Render Python 3 原生 Web Service** 安装 Playwright Chromium。此前的 `Dockerfile` 浏览器安装步骤对 Python 3 类型服务**不会生效**。

## 按当前 Render「Test · Python 3」服务部署

1. 把 ZIP 解压后的所有文件上传到你现有的 GitHub 仓库**根目录**，覆盖原文件并 Commit。
2. 进入 Render → Test → **Settings**，确认 Repository / Branch（通常 `main`）正确。
3. **Build Command** 改成：`bash render_build.sh`
4. **Start Command** 改成：`bash start_render.sh`
5. Environment 中保留现有的 `MZPLAY_USERNAME`、`MZPLAY_PASSWORD`、`MZPLAY_DEVICE_ID`、`MZPLAY_AUTH_STATE_B64`、`MULTI_GAMES_ENABLED=1` 和 `CHOICE_MANUAL_ONLY=1`（存在才保留，不必往聊天里发敏感值）。
6. **Manual Deploy → Deploy latest commit**。首次构建会下载 Chromium，时间可能比较久；如果 Build 失败，查看 Chromium 下载/系统库错误。
7. Logs 搜索 `MZPlay/Auth`，看新的 `stage`、`category`、`retry_after`。不要短时间内反复 Deploy。
8. 浏览器访问 [连接状态](https://test-4bvi.onrender.com/api/connection-status)，查看 K3 / 5D / TRX 的 `records`、`sourceStatus`、`observedRecently`。

**重要：** 这是程序防重复登录、错误诊断与运行环境修复，并非已验证的官方授权恢复。如果 MZPlay 仍返回 HTTP 401 / `No operation permission`，或要求验证码、设备验证、账号权限，必须通过官方登录或官方支持确认。代码不会也不能绕过服务端拒绝权限的决定。Render 免费实例也可能因休眠或浏览器资源不足而无法持续运行。
