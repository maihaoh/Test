> **注意：这份是旧 V18 的历史说明。最新 V19 功能和部署方法请查看 `MULTI_GAMES_V19_README.md`。V19 已接入 K3 / 5D / TRX 的页面与独立后台。**

# Choice 手动记录版（UI v18）

此版本按用户要求把 **Choice D51–D58** 改为手动记录，**WinGo、K3、5D、TRX** 的页面与计算流程不改。

## 怎么使用

1. 进入网站的 **「🃏 Choice 手动」** 标签，选择 D51～D58。
2. 每局**已经开奖之后**点击 **庄 / 闲 / 和**，每点击一次记为 1 局。各桌独立统计。
3. 上方显示当前桌已录局数、八桌总录入局数；下方自动显示庄闲和次数、连续次数、顺序图、最近 20 局以及下一局**趋势参考**。
4. 录错可点 **撤销上一局**；换靴或重新开始可以点 **清空当前桌**（会二次确认）。
5. 数据储存在当前网站域名对应的浏览器 `localStorage`，同一个浏览器刷新不会消失；跨手机、电脑或清除浏览器数据不会自动同步。建议使用 **导出全部桌备份** 保存 JSON，换设备用 **导入备份**（会确认覆盖全部 8 桌）。

**局数说明**：这里只统计使用者手动输入的局数，不能读取或推断赌场已开的实际总局数；如果中途开始记录，显示的并非整靴的局数。

**趋势提示说明**：至少有 3 局非和局才显示简单趋势参考。优先统计「上一局同结果之后出现庄/闲的次数」，样本不足时展示最近 12 局较多的一方；这只是过去观察到的频率，**不是可验证的中奖概率**，更不能保证下局准确。程序不会投注，不采集身份凭据。

## 部署方式

这是完整项目 ZIP，目录仍是 `Test-main/`。在原仓库中使用 ZIP 内文件更新仓库即可。**前端主要改动**：`index.html`、`style.css`、`script.js`，**新增** `choice_manual.js`。`script.js` 保留原 WinGo 流程，只关闭 Choice 每两秒从 `data.json` 覆盖数据的旧流程。

**Render 后端**：`direct_choice_render.py` 在环境变量 `CHOICE_MANUAL_ONLY=1`（默认）时不再尝试未授权的 Choice WebSocket，但 **WinGo 原来的 `bot.wingo_loop` 线程仍然运行**。`render.yaml` 已加入这一设置，Render 的 `Dockerfile` 也改为轻量化安装（手动模式不再需要 Chromium）。`CHOICE_MANUAL_ONLY=0` 可以恢复原来自动尝试 Choice 的旧代码（不代表授权连接能成功）。不要求 MZPlay Token/Cookie。

## 已知边界

- 手动模式不会自动记录官方的开奖，不会知道百家乐桌的真实总局数。
- 数据按浏览器和站点分别隔离；不同域名例如本地测试、GitHub Pages 互不共享。
- 顺序图不是赌场官方的大路/眼路/蟑螂路规则。
- 旧 `.github/workflows/choice-collector.yml` 未修改（避免影响其他自动收集功能）。

## 本地验证

`node --check choice_manual.js`，`node --check script.js`，`python -m py_compile direct_choice_render.py`。
浏览器交互测试在 Chromium 上验证每桌输入、统计、模拟页面重载恢复、撤销、清除、导出、导入及窄屏展示。由于测试沙箱限制了 Chromium 的 HTTP/file 导航，自动化测试使用 `page.set_content` 注入网站 HTML/JS，并用内存模拟 `localStorage`；不能据此断言生产域名上的存储、网络或 Render 部署已经过真实验证。
