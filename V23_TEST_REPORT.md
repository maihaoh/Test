# V23 修复与测试报告（2026-10-21）

## 问题和具体根因

- `script.js` 的 Worker 读数原先固定 `pageSize: 10`，而 `runBacktest()` 先要求历史长度至少 12 条；十条永远无法得到至少 10 已知 + 1 被测局的逐局回测结果。
- V22 在未观察到新期号时会调用 `resetWingoLiveAnalysis()`，把原本可以历史计算的市场信息也清空。V23 将**历史统计**与**实时下一期参考**分离，后者仍需新期号。
- WinGo 实时复盘原先用当前已存学习参数回头评价最近一局，存在偏向历史数据的可能。V23 的展示取自 `runBacktest` 的时间顺序模拟，不使用之后的数据评价之前的时点。
- WinGo `getLearnedPrediction` 中另一个转移统计使用了最新在前序列的 `sizes[i+1]`，实际上应统计在 `sizes[i]` 之后发生的 `sizes[i-1]`。已修正。
- 旧 `/health` 仅显示 Render Flask/Waitress 是否在响应，不能直接说明 K3/5D/TRX 的采集状态。增加只读 `/api/connection-status`，按最新观察到新期号的时间区分新/旧。

## 范围和限制

- WinGo：优先请求 50，服务端明确拒绝时回退到 10；低于 11 条时尝试历史分页。独立缓存 200 条已校验历史，损坏缓存不会被静默覆盖。
- 无法联网并证明 Worker 接受 50 条或支持分页；有回退策略，但**服务端不接受某个参数**时仍需其维护方检查。
- K3/5D/TRX：后端状态/历史数据读取逻辑保持，新增透明诊断入口。没有擅自注入凭证或绕过服务商授权。
- Choice D51–D58：保持手动录入和旧本地键。没有自动下注。
- 没有新的独立未来数据集支持任何准确率保证。

## 本地验证

从 `Test-main` 目录运行：

```
python -m unittest discover -s tests -q
node --test tests/test_baccarat_engine.js
node --check script.js
node --check choice_manual.js
node --check multi_games.js
python -m compileall -q realtime_api.py mzplay_multi.py multi_snapshot.py bot.py
```

- Python：**27 项通过**（包括离线 Chromium 真实 DOM 测试）。
- Node.js：**11 项通过**。
- 共 **38 项**通过；JS 和 Python 语法检查通过。
- 离线浏览器：验证 50 条主请求、10 条降级和多页查询、首次只标为历史、观察新期号后更新实时参考、超时后不伪装实时、断网后仅保留历史统计、损坏缓存保留、百家乐手动按钮与手机 320/390px 窗口无横向溢出。
- 这些测试使用合法结构的**模拟测试数据**；不是对用户 Worker/Render 生产环境的真实连接测试。

## 上线后应观察

- 标题显示 `UI V23`，WinGo 新蓝色诊断面板出现，否则不是新前端。
- Worker 有历史数据：市场统计和回测可用，但下一期预测可能继续标为未验证，直到真正观察到新期号。
- Worker 请求被拒绝/网络不通：诊断面板显示原因和浏览器历史，可根据实际错误排查。
- 其他游戏打开 `/api/connection-status`，从 `observedRecently` 判断是否实际观察到新的合法期号，而不是仅看健康检查的 `ok`。
