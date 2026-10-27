# V37 · Choice D51 Render 自动采集测试版（GitHub + Render 完整项目）

**目标**：Render 运行时自动复用已有 MZPlay 授权，取得 Choice 官方入口，尝试进入 D51；当官方页面允许建立只读数据通道且获得可解码的 D051 开奖快照时，自动保存历史并更新网站。**不需要 F12、Chrome Console 或开着用户电脑。** 不下注、不发送下注指令。

## 本版已完成

1. 保留原版 WinGo、K3、5D、TRX、手动百家乐和 V36 的 45 种路法实验室。
2. Choice D51 网站改成 **Render 优先模式**，自动读取 `/api/data` 与 `/api/choice-status`，显示断线、服务器被拒绝及实际历史记录，不再要求使用 Console。
3. 后台保留官方已授权的 `GetGameUrl(AG_Video)` 入口和单房间 D051 白名单；只读监听浏览器实际建立的 WebSocket，拒绝其他房间数据。
4. 若是短暂的普通安全检查页面，最多等待 20 秒自然结束；**不处理验证码，不绕过访问限制**。明确的拒绝页面会按 5、10、20、40、60 分钟逐步退避，避免高频请求。
5. 新增 `choice_archive.py`（Python 内置 SQLite）：按快照内容签名去重，最多保存 5,000 份不同的已验证 D51 路单**快照**；同一实例重启可尝试恢复本地数据。`archiveSnapshots` 不是独立开奖局数。
6. 修正误报新开奖：长路单只有一两格碰巧一致时不计为新局；首次取得历史不算实时更新。
7. 修正 GitHub Pages 发布脚本，补齐此前遗漏的 `wingo_consistency.js`、`baccarat_methods.js`、`baccarat_lab_ui.js`、`baccarat_variant_rules.js`。
8. `/api/choice-status` 新增 `retryInSeconds`、`consecutiveAccessBlocks`、`archiveSnapshots`、`storageMode`、`secondsSinceData` 等不含凭据的诊断字段。

## 重要限制（真实线上状态）

用户此前 V33 的诊断为 `provider_access_blocked`，`gamePageSeen=false`、`webSocketHandshakes=0`、`records=0`。**本地代码测试不能证明第三方解除拦截；V37 也没有破解它。** 即使 MZPlay Token 能获取 Choice 签名入口，Choice 提供方仍可能拒绝 Render 服务器。要实现真正无人值守，必须是提供方允许服务器访问，或有正式授权的只读开奖接口。

D051 历史数据包属于“替换整份路单”的快照，**没有可靠的逐局官方 ID**。SQLite 保存多个不同路单快照，不等于已还原“平台全部历史牌局”。断线后是否补齐遗漏局，需要来自提供方的实际数据支持。

**Render Free 运行磁盘为临时储存**：本实例的 SQLite 与 JSON 可能在重新部署/迁移/休眠重建后消失。V37 没有提供外部数据库的跨部署持久化承诺。如果以后要永久归档，需要另接经许可的持久化数据库；请不要以本地 SQLite 作为跨部署备份。

## 安装（和之前版本相同）

1. 备份原来的 GitHub `Test` 项目（若曾手动保存百家乐历史，也先导出）。
2. 解压 V37 ZIP，把**全部文件和 `.github/`** 上传到原来的 `Test` GitHub 仓库并 Commit。不要上传 Token 或本地缓存文件。
3. Render `Test` 服务部署对应的最新 Commit。保留 `MZPLAY_AUTH_STATE_B64`、`MZPLAY_USERNAME`、`MZPLAY_PASSWORD` 和其他原有 Environment，不用重新抓 Token。
4. GitHub Pages 刷新网站，检查显示 `UI V37`，进入 **Choice → D51**，网页会自动请求服务器状态。
5. 检查：
   - `https://test-4bvi.onrender.com/api/choice-status`
   - `https://test-4bvi.onrender.com/api/connection-status`

## 怎么读 Choice 状态

| 字段 / 阶段 | 实际含义 |
| --- | --- |
| `requesting_authorized_choice_launch` | 正在从 MZPlay 请求合法 Choice 入口；还没有进游戏 |
| `choice_client_loaded` | 浏览器客户端已加载；不能视为 D51 已连接 |
| `waiting_provider_security_check` | 普通安全检查正在自然等待，最多 20 秒 |
| `provider_access_blocked` | 第三方拒绝服务器网页访问；Token 无法自动解除 |
| `choice_websocket_seen` | 看到了候选 WebSocket；不等于登录成功 |
| `choice_websocket_open` | 看到了成功握手；还不能证明有开奖数据 |
| `d51_snapshot_received` | 真实 D051 数据包已成功解码与验证 |
| `records` | 最近一次有效路单快照包含多少条结果 |
| `archiveSnapshots` | 本机已保存的不同路单快照份数，不是局数 |
| `lastNewResultAt` | 观察到可靠“新结果追加”的时间，首次历史不填 |
| `storageMode: instance_local_ephemeral` | 本机临时储存，跨 Render 部署不保证保留 |

## 离线测试

```bash
python -m unittest test_v37_auto.py test_v32_auto.py test_v33_auto.py test_v35_algorithms.py -v
node test_v35_browser.cjs
node test_v34_browser_local.cjs
node test_v36_baccarat_methods.cjs
node test_v36_holdout.cjs
python test_v37_browser.py  # 需要本机 Playwright Chromium
```

本地检查详见 `V37-TEST-REPORT.md`。模拟/离线成功不代表第三方实时连接验证完成。百家乐路单不能保证 99% 的真实下一局预测准确率。
