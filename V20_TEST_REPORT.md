# V20 本地功能测试（2026-10-19）

**总计 33 项：32 项通过，1 项跳过，0 项失败。**

- 原 V19 WinGo / K3 / 5D / TRX Python 采集与 API 合并单元测试继续运行。
- 原 V19 Chromium UI 测试：K3、5D、TRX 模拟 API 新/旧数据、XSS、移动页面不溢出。
- 原 V19 手动百家乐 UI：D51–D58 分别统计、撤销/清空、JSON 备份恢复、移动布局。
- 新 V20 Chromium UI：Lottery / Baccarat 分区及返回上次彩票、四款彩票子导航。
- 新 V20 Chromium UI：和局不算庄闲样本、20/50/100 样本进度、近 20 / 全部窗口切换正确、50 局及 100 局统计、近似 Wilson 95% 区间、撤销/切桌之后进度重算、390px / 320px 画面不发生整体水平溢出。
- `node --check` 检查三份前端 JS 通过；Python 源文件 `compileall` 通过。

**跳过的一项**：当前环境缺少 Flask，未运行需要 Flask HTTP test-client 的 `/api/data` 端点集成测试。API 合并核心函数的其他单元测试通过。

**测试限制**：本地 Chromium 测试使用 HTML/CSS/JS 注入的真实 DOM 点击，但通过模拟 localStorage 和 Render `/api/data` 响应完成；无公网认证连接，因此不能宣称 WinGo/K3/5D/TRX 线上实时采集成功，亦不等于 Github Pages/Render 已部署。手动百家乐并不自动读取真实开奖。

**数学限制**：百家乐下一手不能靠增加历史局数保证正确。各个样本档位只是数据积累指示器。窗口的 95% Wilson 区间仅说明历史比例估计的抽样不确定性。
