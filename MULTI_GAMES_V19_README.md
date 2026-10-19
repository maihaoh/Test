# V19 · WinGo + K3 + 5D + TRX + 手动百家乐

## 本次改动

- **K3 Lotre、5D Lotre、TRX Win**：恢复网页的实际数据显示（开奖结果、历史、统计模型参考、复盘）。浏览器每 **12 秒**通过只读 GET 请求访问 `https://test-4bvi.onrender.com/api/data`，不需要把 MZPlay 密码交给浏览器。
- **后端（Render）**：在 WinGo 线程旁独立启动 `MultiGameCollector`，每 12 秒左右轮询 K3/5D/TRX 的既有 MZPlay 授权 API。旧版采集器会等待 Choice 登录，V19 不再依赖它。Render 把游戏结果写进独立的 `multi_runtime.json`，API 优先选用有最近**成功时间**的来源。
- **GitHub Actions 备用路径**：既有四小时采集工作流继续可用，设置手动百家乐模式、不再启动 Choice 浏览器。远程数据仍通过有签名认证的 `/api/ingest` 推送到 Render。Render 可择最新成功的 K3、5D、TRX 数据，避免被另一来源的旧数据覆盖。
- **Choice 显示名称**：改为「🃏 百家乐手动」，同时保留旧 `localStorage` 的存储键，之前手动保存的 D51–D58 数据不会因改名而丢失。请注意这只是**手动百家乐**，仍不是自动识别百家乐开奖结果。
- **WinGo**：原来的官方 Worker 读取方式与 `bot.wingo_loop()` 保持不变。

## 怎么使用（最简单）

1. 把 ZIP 中 `Test-main/` **内部的所有文件和 `.github` 目录**更新到原 GitHub 仓库的对应位置。文件应在仓库根目录，不能多套一层 `Test-main/`（除非原仓库本来就这样部署）。
2. 让 GitHub Pages 和 Render 从更新后的仓库部署。既有 `render.yaml` 会启用 `CHOICE_MANUAL_ONLY=1`、`MULTI_GAMES_ENABLED=1`。已经配置过 MZPlay 账号与会话的环境变量可继续使用，**无需发给任何人**。
3. 打开网页，切换 K3、5D、TRX：状态应显示「数据更新正常」及 MYT 更新时间。只有最近三分钟确实取得对应游戏的有效数据时才视为更新正常。**旧数据会标明「历史数据 / 未验证实时连接」，并暂停下一期参考。**
4. 若状态为「未连接」、显示后台授权错误：检查 Render 环境变量或 GitHub Actions Secrets（`MZPLAY_USERNAME`、`MZPLAY_PASSWORD`、`MZPLAY_DEVICE_ID`，已有会话也可使用 `MZPLAY_AUTH_STATE_B64`）。登录或 API 被服务商拒绝时，代码不能绕过授权限制。
5. 只需检查 `https://test-4bvi.onrender.com/health` 和 `https://test-4bvi.onrender.com/api/data` 是否可访问、各游戏的 `updated_at` 是否接近当前时间。**不需要执行浏览器 Console 抓 Token。**

## 数据准确性

- 游戏自带预测为**历史频率/转移模型参考**，不是概率保证。内部 `confidence` 以「历史模型分数（非命中率）」显示；号码随机时无法保证提高准确性。
- `/api/data` 中单一游戏的 `updated_at` 只在读到有效开奖记录后刷新，任何错误、限流、空响应、重试都不能把历史数据伪装成新开奖。
- `data.json` 随 ZIP 附带的 K3/5D/TRX 历史记录最后更新于 **2026-10-02**，本身不能证明 2026-10-19 的实时连接。
- GitHub Pages 提供 `./data.json` 只是供 API 断线时查看**历史**。即使文件日期碰巧很新，只要 Render API 不通，也不会显示「实时」。
- Render 可能休眠，首页首次请求需要等待。显示绿色「数据更新正常」需要实际获取新数据；页面可每 12 秒再次尝试。

## 运行与验证

- Python：`python -m py_compile bot.py direct_choice_render.py mzplay_multi.py multi_runtime.py multi_snapshot.py realtime_api.py`
- JavaScript：`node --check script.js`、`node --check choice_manual.js`、`node --check multi_games.js`
- 本地自动化：`python -m unittest discover -s tests -v`。
- Chromium 交互覆盖三个游戏切页、三个游戏的历史和模型数据显示、过期后隐藏模型、断线回退、XSS 安全和手机尺寸；旧百家乐手动记录的撤销／恢复／备份测试继续通过。使用模拟合法 API 响应，**不代表已经在真正的 MZPlay 服务器实时获取开奖记录**。
- 在当前无外网 DNS/Flask wheel 的隔离环境，不能访问生产 Render，也不能完成 Flask 的 HTTP 运行测试。这个限制在测试报告中明确列出。真正的 MZPlay 授权/开奖接收必须部署在你的已授权环境后验证。
