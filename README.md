# V36 Baccarat 多路法研究与测试完整版

- 新增 **45 种可执行看路/统计方法**，自动从手动百家乐或 Choice D51 的已取得历史开展逐局回测。
- 新增 **13 类玩法规则、21 类边注、6 种路单、14 种金额系统**资料库。
- 新增 `baccarat_variant_rules.js` 作为标准/EZ/Super6 赔付与部分可支持边注规则的离线研究模块。没有实际牌面时绝不伪造结果。
- 新增独立可复现的 `test_v36_baccarat_methods.cjs`、`test_v36_browser.py` 和 GitHub Actions JavaScript 测试。
- **99% 预测软件命中率不曾达到，也不能从路单保证。** 实际只报告测试过的结果；参见 `V36-TEST-REPORT.md`。
- **重要：Choice D51 的 Render 授权阻挡仍未解决**，此版本不会让被挡住的第三方游戏接口自动通行。

**安装**：直接将此 ZIP 解压并覆盖 GitHub `Test` 原项目文件，Commit；现有 Render Token / Environment 不需要改动。刷新 GitHub Pages，检查 `UI V36`。进入百家乐手动或 Choice 页面向下滚动查看“45 种路法客观检验”。历史少于100局会提示样本不足。若 Choice 没有实际历史，该页不会显示假数据。

**新研究资料**：`BACCARAT-RESEARCH-V36.md` · `V36-TEST-REPORT.md`

---

# V36 Baccarat 多路法研究与测试完整版

- 新增 **45 种可执行看路/统计方法**，自动从手动百家乐或 Choice D51 的已取得历史开展逐局回测。
- 新增 **13 类玩法规则、21 类边注、6 种路单、14 种金额系统**资料库。
- 新增 `baccarat_variant_rules.js` 作为标准/EZ/Super6 赔付与部分可支持边注规则的离线研究模块。没有实际牌面时绝不伪造结果。
- 新增独立可复现的 `test_v36_baccarat_methods.cjs`、`test_v36_browser.py` 和 GitHub Actions JavaScript 测试。
- **99% 预测软件命中率不曾达到，也不能从路单保证。** 实际只报告测试过的结果；参见 `V36-TEST-REPORT.md`。
- **重要：Choice D51 的 Render 授权阻挡仍未解决**，此版本不会让被挡住的第三方游戏接口自动通行。

**安装**：直接将此 ZIP 解压并覆盖 GitHub `Test` 原项目文件，Commit；现有 Render Token / Environment 不需要改动。刷新 GitHub Pages，检查 `UI V36`。进入百家乐手动或 Choice 页面向下滚动查看“45 种路法客观检验”。历史少于100局会提示样本不足。若 Choice 没有实际历史，该页不会显示假数据。

**新研究资料**：`BACCARAT-RESEARCH-V36.md` · `V36-TEST-REPORT.md`

---

# V36 Baccarat 多路法研究与测试完整版

- 新增 **45 种可执行看路/统计方法**，自动从手动百家乐或 Choice D51 的已取得历史开展逐局回测。
- 新增 **13 类玩法规则、21 类边注、6 种路单、14 种金额系统**资料库。
- 新增 `baccarat_variant_rules.js` 作为标准/EZ/Super6 赔付与部分可支持边注规则的离线研究模块。没有实际牌面时绝不伪造结果。
- 新增独立可复现的 `test_v36_baccarat_methods.cjs`、`test_v36_browser.py` 和 GitHub Actions JavaScript 测试。
- **99% 预测软件命中率不曾达到，也不能从路单保证。** 实际只报告测试过的结果；参见 `V36-TEST-REPORT.md`。
- **重要：Choice D51 的 Render 授权阻挡仍未解决**，此版本不会让被挡住的第三方游戏接口自动通行。

**安装**：直接将此 ZIP 解压并覆盖 GitHub `Test` 原项目文件，Commit；现有 Render Token / Environment 不需要改动。刷新 GitHub Pages，检查 `UI V36`。进入百家乐手动或 Choice 页面向下滚动查看“45 种路法客观检验”。历史少于100局会提示样本不足。若 Choice 没有实际历史，该页不会显示假数据。

**新研究资料**：`BACCARAT-RESEARCH-V36.md` · `V36-TEST-REPORT.md`

---

# V35 完整修复版｜GitHub + Render

**你要的算法修复已加入：** K3 和值／大小／单双、5D 五位、TRX 号码／大小／颜色不再互相矛盾；WinGo 修正号码与大小，并只对开奖前已保存的预测计算真实复盘；百家乐加入长龙、单跳、双跳、断路判断。混合路型会显示「观察」，不硬猜。

**安装：** 解压 ZIP，把全部文件上传 GitHub `Test` 仓库，覆盖旧文件并 Commit。必须包含新增 `wingo_consistency.js`、`mzplay_multi.py` 和 `.github/`。Render 需要部署这个最新 Commit，网站刷新后看 **UI V35**。Render Token、密码、Environment 不用修改。

**特别说明：** Choice D51 的 Render 访问被提供方阻止属于另一个问题；V35 不会自动解决 `provider_access_blocked`。博彩历史路型也不能保证下局结果，页面的「模型分数」不代表命中率。

---

# V35 — Algorithm Consistency + Baccarat Road Audit (Full GitHub + Render)

This release is built from the **user's V34 complete ZIP**. All existing pages,
Choice D51 code, GitHub workflows, WinGo Worker integration, and Render/MZPlay
client are retained. It is an **algorithm and integrity** release, not a fix for
Choice's independent `provider_access_blocked` access restriction.

## Install

1. Back up your existing GitHub repository and, if needed, export your existing
   browser-local baccarat record using its existing Export button.
2. Extract this ZIP and upload **all files, including new
   `wingo_consistency.js`, `mzplay_multi.py` and `.github/`**, to the same GitHub
   `Test` repository. Commit to the branch used by GitHub Pages and Render.
3. Allow Render's deployment to run. No token, password or environment variable
   changes are required by V35.
4. Refresh your GitHub Pages site; confirm **UI V35**. If the old UI persists,
   hard refresh with Ctrl+Shift+R.
5. Check your normal `/api/connection-status` and `/api/choice-status` separately.
   Real results must come from the authorized live data feeds; V35 does not
   fabricate a live connection.

## Fixes

### K3
- Candidates for the three dice are model estimates; the displayed sum, size,
  odd/even and sum-range are now derived from **those same three dice**.
- When normalizing actual results, the sum is calculated from the actual dice;
  a mismatching optional upstream `sumCount` cannot corrupt the display.

### 5D
- The displayed sum and per-position labels derive from the same five digits.
- Actual draw sum likewise derives from the five digits, not a contradictory
  optional upstream field.

### TRX
- Choose a single 0–9 candidate. Size and color are now calculated from that
  candidate (including 0=red/purple, 5=green/purple).

### Prediction ledger and backtest
- Multi-game forecasts are **frozen by target issue**. Polling the same issue
  again cannot rewrite the previously shown prediction.
- A settled forecast must have been generated before that target's result.
- Adds last-25-period **strict walk-forward historical holdout metrics** on new
  K3/5D/TRX predictions. These describe past performance, never the odds of
  winning the next draw.
- The browser blocks inconsistent stale-backend forecasts rather than displaying
  impossible numeric combinations.
- The WinGo browser now stores a forecast against its source issue before the
  next result; a real-time WIN/LOSS needs an exact, subsequent observed issue.
  Historical replay is still labeled historical. Previous old-version learning
  data is retained untouched under the old localStorage key; V35 starts a clean
  live-only ledger.
- WinGo's displayed candidate number is always consistent with the selected
  Big/Small classification; PASS shows no fabricated number.

### Baccarat (manual + Choice D51)
- Explicit classification of Big Road *streak* (dragon), single alternating
  results, double alternating pairs, their first breaks, and mixed states.
- A Tie remains an actual recorded round on the Bead Road but never starts or
  breaks a Banker/Player run on the Big Road.
- The next-hand directional display is a **road-pattern hypothesis only**, not
  a statistically validated betting edge. A mixed/inadequately evaluated road
  shows **Observe**, rather than a forced guess.
- Previously recorded manual forecasts remain intact for audit; the next pending
  forecast switches to the V35 interpreter after the site loads.
- Choice D51 reuses that same model when it has *real* room results. **V35 does
  not make a blocked provider feed operational.**

## Validation performed offline

- `python -m unittest -v test_v35_algorithms.py`
- `node test_v35_browser.cjs`
- `node test_v34_browser_local.cjs`
- `python -m unittest test_v32_auto.py test_v33_auto.py`
- JavaScript syntax checks for all shipped JS sources, Python syntax check.
- Chromium desktop and mobile tests with the production HTML/scripts injected
  locally (without contacting the gambling data feed).

**Limitations:** Automated sports/casino outcomes cannot be reliably predicted
from scoreboards alone. Patterns and scores are descriptive and do not imply a
validated winning probability. Choice D51 real-time cloud ingestion is still
subject to the provider's access policy; a standalone token cannot bypass that.
