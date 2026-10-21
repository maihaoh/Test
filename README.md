# V31 | Choice D51 单房间本机实时桥接（完整版）

## 本版核心功能

- 只保留一个 **Choice → D51** 房间，与「百家乐手动」分开；保留 WinGo、K3、5D、TRX 的所有原有功能。
- 已授权的官方 D51 页面有 WebSocket 时，用户可从自己的电脑 **只读** 捕获已验证 `BAC_FULL_RESULT_LIST (135176)` 的 D051 快照，并只把 B/P/T 结果通过浏览器内的 `postMessage` 发给自己的 GitHub Pages 仪表板。
- **不会传输 Token、Cookie、密码、个人下注、原始 WebSocket 包，也不会发送游戏 WebSocket 消息或下注指令。**
- 仪表板按新结果更新历史、大路和珠盘路；未观察到新一局时只显示历史，不会假装实时连接。
- 游戏官方页面的入口 `https://gci.arvideo.video/pc/pcv1/index.jsp?` 并非已证实的 D51 直达地址，可能需要从 MZPlay 正常登录及选 D51。
- Render 的 `/api/data` 仍可作为后备，但不能把 Render 可访问等同于 D51 已连通。

## 一次安装（GitHub + Render）

1. 解压 `V31-Choice-D51-Live-Bridge.zip`，把里面文件上传覆盖到原 GitHub 仓库根目录（包括 `.github/workflows/pages.yml`）。
2. 点击 Commit，等 Pages Actions 部署成功，刷新网站确认 `UI V31`。你原本 WinGo/K3/5D/TRX 的 Render 变量不要改，**不必重置 Token**。
3. 进入网站 **Choice → D51**，点击 **① 复制连接代码**。
4. 在自己的 Chrome、已经登录的 **官方 Choice D51** 页面按 F12 → Console → Ctrl+V → Enter。
5. 如果浏览器提示阻止弹窗，允许该游戏页打开自己的网站。保持 D51 和网站两个标签页打开，等下一局出结果。
6. 网站会显示「本机 D51 WebSocket」「已解析快照」和历史结果；在确实观察到新的结果之后才显示实时更新。

## 限制与核验

- **只是本地浏览器实时桥接，不是 Render 全自动 24 小时后台采集。** 关闭自己的电脑／游戏页、网页被暂停或失去授权都会停止。需要重新执行代码时，在站内重新复制即可。
- `queryObjects(WebSocket)` 是 Chrome DevTools Console 特有接口，普通网页 JS Console 外不可直接依赖；既有连接 5000、7101、5030 只能说明 OPEN，**不能保证必定收到解码器认识的 D051 明文快照**。
- 任何压缩、加密、分包差异导致不能解析时，仪表板显示等待／未连接，不会生成模拟开奖结果。Console 可执行 `window.__CHOICE_D51_BRIDGE_V31__.status()` 查看安全统计（仅数字，无凭据）。可执行 `.stop()` 停止监听。
- 数据只在同一电脑的浏览器标签之间转发，结果缓存到此网站的 Local Storage（只有 B/P/T，无凭据）；其他设备不会自动同步这份本机数据。
- 路单和统计预测仅为历史数据展示/实验性推测，不保证下一局结果，不自动下注。
- 更新 GitHub Pages **不需要**改 Render 配置；原先服务器的 401、Cloudflare 拦截并没有因此消失。

## 本地验证

- 运行 `node --check choice_live.js` 以及 `node --check choice_console_bridge.js` 检查 JS 语法。
- V31 JS binary decoder 通过合成明文 `BAC_FULL_RESULT_LIST` 数据包的解析及错误拒绝测试；不等于真实官方数据协议已经连接。
- V31 桌面/手机模拟 UI 检查脚本使用合成庄、闲、和，不证明线上可以持续获取结果。

---

# V30 | Choice 单房间按钮（在 V29 上增量更新）

- 主页面新增独立 **Choice** 按钮，进入固定一个百家乐房间 **D51**。
- 保留原来的「百家乐手动」按钮及本地记录，不删除、不迁移、不混合任何数据。
- Choice 使用现有 Render **只读** `/api/data`，每 12 秒检查 `baccarat.rooms.D51`；显示最新局号、历史结果和两条路单。
- 初次取得历史不会误报「实时」。页面需要实际观察到新的房间结果，才会标记「观察到新开奖结果」。没有数据则清楚显示「未连接/等待数据」，不造假开奖或预测。
- 对真正更新过的房间，仅显示现有统计模型的下局**参考**（不保证准确，不自动投注）。
- GitHub Pages 工作流增加 `choice_live.js`，部署时记得上传这个新文件。后端登录逻辑、Token 配置和 K3/5D/TRX 均不变。
- **此修改只加上 Choice 的单房间界面与实时检测，不代表 Choice 原始数据连接已授权或恢复。** V29 的 `/api/choice-status` 后端诊断仍可查看。若该房间没有数据，需要另行处理数据源。

## 上传方法

解压 ZIP，把里面所有文件上传覆盖 GitHub 仓库 `main` 根目录（含 `.github`）。确认 Actions 的 Pages 部署完成，强制刷新网页看到 `UI V30`。若只需要这次前端更新，Render 无需改 Environment，也无需重置已有 Token。

---

# V29 | 浏览器路径修复 + 百家乐顶部预测

## 如何更新

1. 把 ZIP 里的文件放到原 GitHub 仓库根目录，包括 .github 和新文件 browser_runtime.py。不要把 ZIP 本身当成网页上传。
2. 现有 Render Python 3 服务：Build Command = `bash render_build.sh`；Start Command = `bash start_render.sh`。
3. Render Environment 将 `PLAYWRIGHT_BROWSERS_PATH` 设为 `.playwright-browsers`。代码会以项目根目录解析它。保留现有的账号密码、Token 及 INGEST_SECRET，不要写进前端。
4. 提交后用 Render Manual Deploy -> Clear build cache & deploy，这次需要重新安装浏览器并实际试启动。
5. 前端等 GitHub Pages 部署后刷新，页面标识 UI V29。原记录仍在原浏览器同一网站域名下；更换域名需先导出备份。

## 此次修改

- Chromium 安装、试启动、正式登录共用同一个目录与完整 Chromium channel。安装或启动检查失败会阻止构建报成功。不在每次登录中反复下载。
- 区分浏览器未安装、系统依赖缺失、执行权限、超时。保留三游戏共享授权冷却。
- Bearer 字段补正常分隔空格，不再拼成 `BearerTOKEN`。这是格式修复，不等于已证明之前 401 的唯一原因。
- 百家乐只保留一个顶部下局预测，简短策略原因，三个录入按钮。路单紧接在下方，没有房间或照片。
- 修复已删页面元素仍被 JS 直接访问的问题；修复大路龙尾遇占位后错误再向下转弯。
- 保存录入前显示的预测。旧记录不事后补预测。开奖一排、预测一排，同局对齐，格式一致。
- 旧版记录只继承上次选中的一组，不混合牌桌，不删除旧存储。新牌靴需确认，存储损坏时阻止覆盖。

## 预测策略是什么

这些是本项目设计的「可测试模式假设」，不是赌场官方的预知算法，不是从网上找到的已验证高胜率方法。

| 规则 | 本版处理 |
| --- | --- |
| 长龙 | 忽略和后同方向至少 4 连，输出延续方向参考 |
| 单跳 | 最近至少 5 个庄闲交替，输出相反方向参考 |
| 双跳 | 识别至少 3 组双连；每组第一局后参考同方向，第二局后参考切换 |
| 断路 | 既有长龙或跳路刚断，暂停强行判断 |
| 其他 | 少样本使用明确标注的数学基准；足够样本使用平滑频率和转移，无清晰分数差时显示观察 |

和局不打断庄闲路型，但仍作为一个结果记录。预测仅显示庄 / 闲 / 观察；和按钮用于记录。不显示伪造的下局胜率，不追损加倍，不自动投注。

## 连接怎样才算恢复

`[Browser/Check]` 的 `status=ready` 和 `launchVerified=true` 只说明能打开浏览器。这个预检不访问 MZPlay。

`/api/connection-status` 新增 `browserRuntime` 和 `release=V29`。游戏真正连通需要分别看 `records>0`、有效 `latestIssue`、后续新期号被观察到。即使浏览器能启动，仍可能需官方账号权限或人工验证。

若构建试启动报 `system_libraries_missing`，那是本机系统依赖缺失，不要反复换 Token。包内 Dockerfile 包含 `--with-deps` 备用部署；现有 Python 服务不会自动使用它。

## 测试范围

本地 18 项策略 JS 测试、19 项 Python 授权/路径测试、15 项浏览器组件测试通过，共 52 项。组件测试使用系统 Chromium，存储和网络是测试替身，不等于真实部署验证。

本地尝试下载 Playwright Chromium 时，CDN 域名解析返回 `EAI_AGAIN`。因此未验证真实 Render 构建、配套浏览器安装或官方账号登录。本版不声称已经连通三个游戏。

随机负对照：种子 290210，20000 局独立合成结果，不是赌场历史，不模拟牌靴消耗。出方向 7331 局，观察 12669 局；含和的方向命中比例 45.53%，排除和后 50.46%；固定单位、庄抽 5% 模拟净额 -53.35。同一批出手局固定选庄 -25.95。这个负对照没有显示模式预测优势。没有为这个种子再调参。

## 公开依据与本项目设计的区别

- Playwright 官方文档：每个库版本需对应浏览器版本，安装与运行需一致的浏览器路径和 channel。https://playwright.dev/python/docs/browsers
- Render 官方部署文档：修改构建后可清除构建缓存再部署。https://render.com/docs/deploys
- IETF RFC 6750 第 2.1 节：Bearer 和 Token 用空格分隔。https://www.rfc-editor.org/rfc/rfc6750
- Wizard of Odds 数学分析：标准补牌规则、概率基准和抽佣。https://wizardofodds.com/games/baccarat/basics/

资料查阅日期：2026-10-21。长龙、单跳、双跳的识别阈值是本项目的设计选择，上述资料没有证明这些策略对未来有优势。
