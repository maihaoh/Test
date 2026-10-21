# V22 项目修复、数学验证与测试报告

- 版本：V22（基于用户上传的 V21 `Test-main` 项目直接修改，未重建项目）
- 日期：2026-10-21（马来西亚时间）
- 范围：百家乐研究 / D51–D58 手动录入 / WinGo / K3 / 5D / TRX / Render API / GitHub Pages
- 重要说明：**本项目只分析历史资料，不会且不能保证 90% 命中率、正期望或实际盈利。**

## A. 目标与约束

修复程序中能从本地源码和离线测试验证的问题，保留原本页面、八张桌的手动记录、各彩票栏目和可用的部署结构。不得把旧数据称为直播，不得使用未授权的 Choice 协议连接，不得在未验证的情况下声称接口、实盘采集或资金交易已经成功。

## B. 公开资料与数学依据

1. [Wizard of Odds – Baccarat Rules/Basics](https://wizardofodds.com/games/baccarat/basics/)：标准 Punto Banco 双方起始两张牌、Natural 8/9 与补牌表；本项目 `baccarat_engine.js` 按这套规则建模。
2. [Wizard of Odds – Baccarat Appendix 3](https://wizardofodds.com/games/baccarat/appendix/3/)：八副牌百家乐精确参考比例，庄约 45.859742%、闲约 44.624661%、和约 9.515597%。这些是通用基准，不是本桌下一局的实测概率。
3. [Wizard of Odds – House Edge](https://wizardofodds.com/gambling/house-edge/)：在庄赢收 5% 佣金、闲 1:1、和 8:1 的标准规则下，庄约 1.06%、闲约 1.24%、和约 14.36% 为赌场优势。
4. [Baccarat.wiki – Roadmaps](https://baccarat.wiki/en/roadmaps.html)：作为历史路单布局的参考；不同游戏平台可能采用不同的排版细节。

未取得或验证具体线上赌场的完整专用规则、官方实时 API、牌靴内剩余牌组成或经确认来源的最新逐局数据。因此数学引擎使用**标准佣金制 Punto Banco**，不能直接应用于非标准规则变体。

## C. 已定位并修复的问题与根因

| 部分 | 原因/风险 | 已采取措施 |
|---|---|---|
| Choice 旧测试 | 旧断言期望未经验证的心跳/订阅数据包，与最新版仅观察的连接策略冲突 | 测试改为核对安全的只读观察状态；不会为过测试而发送猜测中的登录/订阅报文 |
|百家乐规则 | 原项目缺乏可独立复用的严格补牌与投注结算数学模块 | 新增 `baccarat_engine.js`，对抽牌、Natural、补牌、庄佣金、和局退回、净收益/回撤进行测试 |
|百家乐路单 | 原来主要是简单的结果顺序展示 | 新增 `baccarat_roads.js`，保留旧图，另外显示珠盘路、大路和衍生三路；不把路单当作概率保证 |
|百家乐记录 | 损坏的 `localStorage` JSON 可能被正常操作覆盖 | 阻止静默覆盖；只有验证过且用户确认的导入才能替换损坏备份 |
| K3/5D/TRX | 旧版把“成功重复读取相同期号”的时间误用作“新期开奖时间” | 分开记录读取成功时间与真实观察到新期号的时间，拒绝未来时钟，并取消过期预测展示 |
| WinGo 实时性 | 仅凭成功读取历史列表无法证明实时 | 首次读取只做基准；观察到新的当天期号才临时判为更新中；过期、错误或空结果时暂停预测及清空过时的市场指标 |
| WinGo 数据 | 缺失或无法解析的号码通过 `safeNumber` 变成 `0`，可能伪造结果 | 验证整数 0–9，跳过错误数据；大小标签根据号码重新计算 |
| WinGo 回测 | 历史回测使用浏览器当前已训练参数，可能包含未来信息 | 改为按最旧→最新的逐局回放：仅使用之前结果预测，再加入当前真实结果训练，和当前浏览器保存状态完全隔离 |
| WinGo 页面安全 | 不可信开奖结果可能通过 `innerHTML` 被当作 HTML | 对远程动态字段做 HTML 转义并增加恶意输入回归测试 |
| API 数据 | 空白、部分损坏或未来时间戳快照可能替换正常数据；错误读取有时被显示为健康 | 新增结构和有效历史验证；损坏 `data.json` 时 `/health`、`/api/data` 返回 503 |
| GitHub Pages | 旧打包方式可能将后端源码与不需要的文件一并公开 | `pages.yml` 仅部署前端 HTML/CSS/JS 和必要的历史 `data.json` |

## D. 数学模型与算法边界

- 标准八副牌：0 点牌共有 `16 × decks`，1–9 点各有 `4 × decks`，依标准补牌表判庄/闲/和。
- **和局退回**庄/闲主注，押和中标按配置奖金净收益结算；标准庄 5% 佣金。
- 预设 8 副牌参考概率用于 EV；非 8 副牌时不会把八副牌参考 EV 误写为精确结果。
- 蒙特卡洛使用固定随机种子，并输出下注总额、净盈亏、收益率、最大回撤、最长连输、跳过/推和等指标。
- 手动历史的 Markov/频次/Brier 研究和路单只代表历史关联。没有剩余牌组成信息时，不能从庄/闲/和序列推断下一局必中的走向。
- WinGo `runBacktest` 是 **历史滚动模拟**：训练状态依时间推进，不使用之后开奖结果更新之前的预测。仍然不是“从未看过的独立未来数据集”测试，PASS 局不计入 `WIN/(WIN+LOSS)`，页面同时显示参与判断局数和固定猜大的参考比例。

## E. 修改的主要代码

`baccarat_engine.js`（新增）、`baccarat_roads.js`（新增）、`choice_manual.js`、`baccarat_analysis.js`（保留既有研究算法）、`script.js`、`multi_games.js`、`mzplay_multi.py`、`multi_snapshot.py`（新增）、`realtime_api.py`、`index.html`、`style.css`、`.github/workflows/pages.yml` 和 `tests/` 内的回归测试。

**没有执行任何真实下注、赌场后台配置修改或线上 GitHub/Render 更新。**

## F. 已实际执行的测试

在本地测试容器中执行：

```bash
python -m unittest discover -s tests -v
# 22 tests / OK

node --test tests/test_baccarat_engine.js
# 11 tests / 11 passed

node --check script.js
node --check choice_manual.js
node --check multi_games.js
node --check baccarat_analysis.js
node --check baccarat_engine.js
node --check baccarat_roads.js
python -m compileall -q bot.py mzplay_multi.py direct_choice_render.py choice_result_decoder.py realtime_api.py multi_runtime.py multi_snapshot.py
# 所有语法/编译检查通过
```

Python 测试包含 8 个使用真实本地 Chromium + Playwright 的 **离线 DOM/交互测试**，以及 Choice/快照/API 函数测试。因为测试环境无法连接线上 HTTP 地址，并且没有安装 Flask HTTP 测试依赖（网络下载受限），API 测试通过函数 stub 检查请求处理结果；**不能把这些测试冒称完整 Render HTTP 集成测试或实时赌场联机测试。**

## G. 可复现的模拟结果（非实盘）

固定随机种子 `20261021`、八副牌、每手固定下注 1 模拟单位、初始模拟资金 1,000,000 单位，每种投注分别模拟 50,000 手。相同种子使用相同随机序列。结果如下：

| 固定投注 | 模拟手数 | WIN | LOSS | PUSH | 模拟净盈亏 | 模拟 ROI | 标准理论 ROI |
|---|---:|---:|---:|---:|---:|---:|---:|
| 庄（5% 佣金） | 50,000 | 22,870 | 22,336 | 4,794 | -609.50 | -1.219% | 约 -1.058% |
| 闲 | 50,000 | 22,336 | 22,870 | 4,794 | -534.00 | -1.068% | 约 -1.235% |
| 和（8:1） | 50,000 | 4,794 | 45,206 | 0 | -6,854.00 | -13.708% | 约 -14.360% |

复现方式：

```bash
node -e "const e=require('./baccarat_engine');for(const bet of ['B','P','T'])console.log(bet,e.simulate({rounds:50000,bankroll:1000000,stake:1,bet,seed:20261021}))"
```

这些数字是运行代码得到的随机模拟，不是真实赌场数据，也不代表未来收益。模拟波动与理论长期期望不必完全一致。本次**没有**得到来源充分可验证的外部实时历史序列用于严格独立测试，因而**未证明 90% 胜率**。

## H. 未解决、需另外验证的事项

- **Choice D51–D58 自动实时采集：未连通、未验证。** 原有服务器能够建立 WebSocket 并不代表完成账号/游戏的合法认证。缺少正规授权的会话/bootstrap，不会以猜测数据包或绕过限制的方式强行“修复”。八桌手动记录仍可使用。
- **WinGo Worker 真实线上返回与连接稳定性：未验证。** 浏览器离线测试使用模拟 API 响应；要在用户自己的网站上确认 CORS、签名、期号和数据延迟。
- **K3/5D/TRX 与 Render 实时源：未实际联机验证。** 页面会在数据过期时标记历史状态，不再假装实时。
- **`data.json` 是项目附带的历史快照**（可见样本期号为 2026-10-02），并不代表 2026-10-21 的真实结果。
- 未执行 Docker 真正构建、Render 线上部署、GitHub Actions 在线执行或 Flask 的 HTTP 集成测试。外部账号和部署密钥不在本地，不能伪称成功。
- 免费 GitHub Actions 与 Render 可能受到平台额度、休眠、运行时长与策略变化影响；本次不保证 24/7 或 RM0 永久在线。

## I. 运行和部署操作

**本地测试**：解压项目，进入解压后的 `Test-main` 文件夹，执行上面的测试命令。查看静态 UI 可在文件夹内运行 `python -m http.server 8000`，浏览器打开 `http://localhost:8000`。这个方式只用于本机查看，不会让电脑关机后网站继续运行。

**线上更新**：先备份 GitHub 旧代码与浏览器八桌 JSON 手动记录。把 `Test-main` **内部所有文件和隐藏 `.github` 文件夹**放进现有 GitHub 仓库根目录，不要把整个 ZIP 当成一个文件上传。GitHub Pages 选择 GitHub Actions 部署源；Render 需由账户拥有者自行在已连接仓库部署，保留现有环境变量。若使用新域名或新 Render 服务，按项目配置修改 `multi_games.js` 的 `ENDPOINT`、`script.js` 的 Worker 地址（仅在自己有授权的情况下）、`render.yaml` 的 `DASHBOARD_ORIGIN` 和自动化的 `PUSH_URL`。不要在代码、截图或聊天中明文提交密码、Token、Cookie。

上线后分别查看 GitHub Actions 的 Pages 执行结果、Render 的 `/health`、`/api/data` 与各游戏的数据时间。**只在实际验证看到新的合法期号后，才认定某个实时数据源可用。**
