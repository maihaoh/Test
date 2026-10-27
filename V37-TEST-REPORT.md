# V37 实际离线测试记录

**目标**：检测代码、保存与 UI，未进行真实 Choice 登录或外部 Provider 连接。

- Python: `test_v37_auto.py + test_v32_auto.py + test_v33_auto.py + test_v35_algorithms.py`：**31 个测试；30 通过，1 因当前容器无 Flask 而跳过**。覆盖历史保存、快照去重、短/长路单的追加判定、拒绝访问退避、诊断保密、原有 K3/5D/TRX 计算一致性。
- Node.js: `test_v35_browser.cjs`、`test_v34_browser_local.cjs`、`test_v36_baccarat_methods.cjs`、`test_v36_holdout.cjs` 全部通过。V36 内置 **12,012 次断言通过**，模拟八副牌 100 万局；此为历史/概率测试，不是 99% 预测胜率。
- Chromium: `test_v37_browser.py` 在 **1365px 桌面、390px 手机**测试，模拟 `provider_access_blocked` 提示正常、收到 30 条/31 条合成 D51 历史可更新路单、JS 页面错误为零。模拟开奖记录并非真实 D51 数据。
- JavaScript `node --check` 和 Python `compileall` 通过。
- GitHub Pages 发布目录已核对包含 HTML 所引用的全部本地 JS 和 CSS，修复 V36 静态文件遗漏。

**尚未验证/不能声称完成**：Render 真正进入 Choice D51、获许可的 WebSocket 握手、持续收到官方结果、跨实例数据库持久化。用户此前线上错误 `provider_access_blocked` 仍可能复现；V37 遇到此错误会如实显示并逐步延长重试间隔。
