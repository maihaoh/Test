# V19 测试报告 · 2026-10-19

**本地回归：29 项运行，28 项通过，1 项跳过。**

已验证：

- `node --check` 检查 `script.js`、`choice_manual.js`、`multi_games.js` 通过。
- Python `py_compile` 检查 `bot.py`、`direct_choice_render.py`、`mzplay_multi.py`、`multi_runtime.py`、`multi_snapshot.py`、`realtime_api.py` 通过。
- Chromium UI 实际操作：K3/5D/TRX 三个标签页，从模拟的 Render `/api/data` 响应渲染开奖号码、历史、目标期号和统计参考；手机显示；避免脚本注入。
- 模拟 Render 断线后，网页只把本地文件当作历史备份，不显示有效的下一期预测。
- 使用 ZIP 内**真实 2026-10-02 的 K3/5D/TRX 历史快照**测试，三个游戏都正确标注历史，不会显示为 2026-10-19 的实时数据。
- 旧百家乐手动录入、八桌分离、撤销、清空、备份／导入、窗口刷新恢复功能继续通过。
- 使用假 MZPlayClient（没有公网请求）测试 K3 正规 API 路由选择、无有效开奖结果不会更新成功时间。
- 新增 Render / GitHub 不同数据来源的结果优先级、暂时失败保留历史记录、以及不等待百家乐授权即可启动三游戏采集的单元测试。

**跳过的 1 项**：真实 Flask HTTP test-client 环境中 `/api/data` 合并数据测试（测试容器没有 Flask，也不能下载 wheel）。相同的核心合并函数已有单独的纯 Python 单元测试通过。

**未验证且不得宣称成功的项目**：无法从此隔离容器访问 `https://test-4bvi.onrender.com` 或授权的 MZPlay API（DNS/网络不可达），所以没有取得今天的实际 K3/5D/TRX 新开奖记录，不能认定已完成线上实时连接。你部署到已有授权环境后，只有站点显示 `数据更新正常` 且 MYT 时间与实际开奖对应，才可确认在线可用。无资料时会显式显示等待或历史。

本程序只读取开奖结果、保存手动百家乐记录，不提交任何押注、资金或账户操作。
