/* 百家乐 manual tracker (UI v18).
 * This file intentionally never contacts the Choice service and never submits bets.
 * Results are entered by the user, stored locally, and used only for descriptive
 * statistics. It must not be described as a predictive advantage.
 */
(() => {
    "use strict";

    const TABLES = Object.freeze(["D51", "D52", "D53", "D54", "D55", "D56", "D57", "D58"]);
    const STORAGE_KEY = "choice_manual_history_v1";
    const SELECTED_KEY = "choice_manual_selected_v1";
    const MAX_PER_TABLE = 5000;
    let corruptStorage = false;
    const CODE_NAMES = Object.freeze({B: "庄", P: "闲", T: "和"});
    const CODE_CLASSES = Object.freeze({B: "is-banker", P: "is-player", T: "is-tie"});

    let histories = emptyHistories();
    let selectedTable = TABLES[0];
    let windowView = 50; // Number of recent recorded rounds, including ties.
    const WINDOWS = Object.freeze([20, 50, 100, "all"]);

    function emptyHistories() {
        return Object.fromEntries(TABLES.map(table => [table, []]));
    }

    function element(id) { return document.getElementById(id); }
    function setText(id, value) {
        const node = element(id);
        if (node) node.textContent = String(value);
    }

    function message(text, isError = false) {
        const node = element("bc-manual-message");
        if (!node) return;
        node.textContent = text;
        node.classList.toggle("is-error", isError);
    }

    function validateBackup(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1 ||
            !input.tables || typeof input.tables !== "object" || Array.isArray(input.tables)) {
            throw new Error("格式不符合 百家乐手动记录 v1 备份规范");
        }
        const parsed = emptyHistories();
        for (const table of TABLES) {
            const values = input.tables[table];
            if (!Array.isArray(values) || values.length > MAX_PER_TABLE ||
                !values.every(item => item === "B" || item === "P" || item === "T")) {
                throw new Error(`${table} 的记录无效或超过 ${MAX_PER_TABLE} 局`);
            }
            parsed[table] = values.slice();
        }
        return parsed;
    }

    function loadFromBrowser() {
        let initialMessage = "准备记录。刷新后仍会保留本浏览器上的记录。";
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            // An external tab may have removed all records; do not keep a stale
            // in-memory copy while claiming the browser is empty.
            histories = raw ? validateBackup(JSON.parse(raw)) : emptyHistories();
            corruptStorage = false;
            if (raw) initialMessage = "已从本浏览器恢复手动记录。";
            const previousTable = localStorage.getItem(SELECTED_KEY);
            if (TABLES.includes(previousTable)) selectedTable = previousTable;
        } catch (error) {
            // An invalid existing backup must never be overwritten silently by
            // an Add/Undo action. Explicit confirmed import can recover it.
            corruptStorage = true;
            initialMessage = `无法读取本地记录：${error.message}。请先导出/保留原浏览器数据，再通过确认导入恢复；已禁止自动覆盖。`;
            message(initialMessage, true);
            return;
        }
        message(initialMessage);
    }

    function persist(next = histories, confirmedReplacement = false) {
        if (corruptStorage && !confirmedReplacement) {
            message("旧本地记录损坏，为避免覆盖已停止修改；可在确认后导入有效 JSON 备份。", true);
            return false;
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, tables: next}));
            corruptStorage = false;
            return true;
        } catch (error) {
            message("浏览器保存失败：记录仅暂存在页面内，刷新可能丢失。请检查浏览器储存权限。", true);
            return false;
        }
    }

    function currentCounts(history) {
        return history.reduce((counts, code) => {
            counts[code]++;
            return counts;
        }, {B: 0, P: 0, T: 0});
    }

    function decisiveOnly(history) { return history.filter(code => code !== "T"); }

    function trailingStreak(history) {
        const decisive = decisiveOnly(history);
        if (!decisive.length) return {type: null, count: 0};
        const type = decisive[decisive.length - 1];
        let count = 0;
        for (let i = decisive.length - 1; i >= 0 && decisive[i] === type; i--) count++;
        return {type, count};
    }

    function maxStreak(history, type) {
        let best = 0;
        let count = 0;
        for (const code of decisiveOnly(history)) {
            if (code === type) {
                count++;
                best = Math.max(best, count);
            } else {
                count = 0;
            }
        }
        return best;
    }

    // Wilson score interval for historical banker fraction among non-ties.
    // Assumes independent observations for its approximate coverage; never a
    // prediction of the next outcome or a claimed betting advantage.
    function wilsonInterval(successes, total) {
        if (total === 0) return null;
        const z = 1.96;
        const p = successes / total;
        const denom = 1 + z * z / total;
        const center = (p + z * z / (2 * total)) / denom;
        const delta = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom;
        return {low: Math.max(0, center - delta), high: Math.min(1, center + delta)};
    }

    function transitionCounts(history) {
        const decisive = decisiveOnly(history);
        const counts = {BB: 0, BP: 0, PB: 0, PP: 0};
        for (let i = 1; i < decisive.length; i++) {
            counts[decisive[i - 1] + decisive[i]]++;
        }
        return counts;
    }

    function sampleStage(nonTieCount) {
        if (nonTieCount < 20) return {label: "收集中 · 暂不显示走势方向", next: `还差 ${20 - nonTieCount} 局庄／闲到 20 局初步观察`, threshold: 20};
        if (nonTieCount < 50) return {label: "初步观察 · 已满 20 局", next: `再录 ${50 - nonTieCount} 局庄／闲，可比较 50 局窗口`, threshold: 50};
        if (nonTieCount < 100) return {label: "分段对照 · 已满 50 局", next: `再录 ${100 - nonTieCount} 局庄／闲，可比较 100 局窗口`, threshold: 100};
        return {label: "较多历史样本 · 已满 100 局", next: "历史比例描述更有样本基础，但不能稳定预测下一局", threshold: 100};
    }

    function trendReference(history) {
        const decisive = decisiveOnly(history);
        const n = decisive.length;
        if (n < 20) return {
            pick: null,
            sample: `本桌 ${n} 局庄／闲 · 至少 20 局才展示历史偏多方`,
            reason: `还差 ${20 - n} 局庄／闲才开始显示走势描述；和局不计算在这 20 局内。这些门槛不是命中率门槛。`
        };

        // Past frequencies may be interesting descriptively; they do not
        // establish a forecasting relationship for an independent next hand.
        const recent = decisive.slice(-50);
        const counts = currentCounts(recent);
        const last = decisive[n - 1];
        const sameAsLast = transitionCounts(decisive.slice(-100));
        const transitions = last === "B"
            ? {B: sameAsLast.BB, P: sameAsLast.BP}
            : {B: sameAsLast.PB, P: sameAsLast.PP};
        const transitionSample = transitions.B + transitions.P;
        const isTie = counts.B === counts.P;
        const pick = isTie ? null : counts.B > counts.P ? "B" : "P";
        const reason = `最近 ${recent.length} 局有效庄闲：庄 ${counts.B} 次、闲 ${counts.P} 次。过去最多 100 局中，出现「${CODE_NAMES[last]}」后接庄 ${transitions.B} 次、接闲 ${transitions.P} 次（共 ${transitionSample} 次）。这些是历史记录频率，不支持推断下局必然偏向哪边。`;
        return {
            pick,
            sample: `最近 ${recent.length} 局庄／闲历史频率 · 非下局胜率`,
            reason: isTie ? `两边历史次数相同，暂无偏多方。${reason}` : reason
        };
    }

    function makeChip(code, round, latest = false) {
        const chip = document.createElement("span");
        chip.className = `bc-manual-chip ${CODE_CLASSES[code]}${latest ? " is-latest" : ""}`;
        chip.textContent = CODE_NAMES[code];
        chip.title = `手动记录第 ${round} 局：${CODE_NAMES[code]}`;
        chip.setAttribute("aria-label", chip.title);
        return chip;
    }

    function renderChips(containerId, history, limit, reverse = false) {
        const node = element(containerId);
        if (!node) return;
        const fragment = document.createDocumentFragment();
        if (!history.length) {
            const empty = document.createElement("span");
            empty.className = "bc-manual-empty";
            empty.textContent = "还没有结果。上方点击庄／闲／和开始记录。";
            fragment.appendChild(empty);
        } else {
            const firstIndex = Math.max(0, history.length - limit);
            const recent = history.slice(firstIndex).map((code, i) => ({code, round: firstIndex + i + 1}));
            if (reverse) recent.reverse();
            for (const item of recent) {
                fragment.appendChild(makeChip(item.code, item.round, item.round === history.length));
            }
        }
        node.replaceChildren(fragment);
    }

    function renderRoadGrid(id, cells) {
        const node = element(id);
        if (!node) return;
        const fragment = document.createDocumentFragment();
        const maxCol = cells.reduce((max, cell) => Math.max(max, cell.col), -1);
        node.style.gridTemplateColumns = `repeat(${Math.max(1, maxCol + 1)}, 24px)`;
        if (!cells.length) {
            const note = document.createElement("span");
            note.className = "bc-manual-empty";
            note.textContent = "历史样本不足";
            fragment.appendChild(note);
        }
        for (const cell of cells) {
            const mark = document.createElement("span");
            mark.className = `bc-road-mark bc-road-${cell.code}`;
            mark.style.gridColumnStart = String(cell.col + 1);
            mark.style.gridRowStart = String(cell.row + 1);
            mark.textContent = cell.code === "B" ? "庄" : cell.code === "P" ? "闲" :
                cell.code === "T" ? "和" : cell.code === "R" ? "●" : "○";
            if (cell.ties) {
                const tie = document.createElement("span");
                tie.className = "bc-road-ties";
                tie.textContent = cell.ties > 1 ? `和${cell.ties}` : "和";
                mark.appendChild(tie);
            }
            mark.title = cell.ties ? `${mark.textContent}（含和 ${cell.ties} 局）` : mark.textContent;
            fragment.appendChild(mark);
        }
        node.replaceChildren(fragment);
    }

    function renderRoadmaps(history) {
        if (!window.BaccaratRoads) return;
        const recent = history.slice(-120);
        const roads = window.BaccaratRoads.build(recent);
        setText("bc-roads-table", selectedTable);
        renderRoadGrid("bc-road-bead", roads.bead);
        renderRoadGrid("bc-road-big", roads.big);
        renderRoadGrid("bc-road-eye", roads.bigEyeBoy);
        renderRoadGrid("bc-road-small", roads.smallRoad);
        renderRoadGrid("bc-road-cockroach", roads.cockroachRoad);
    }

    function render() {
        const history = histories[selectedTable];
        const length = history.length;
        const counts = currentCounts(history);
        const streak = trailingStreak(history);
        const last = length ? history[length - 1] : null;
        const allCount = TABLES.reduce((sum, table) => sum + histories[table].length, 0);
        const decisiveCount = counts.B + counts.P;
        const stage = sampleStage(decisiveCount);
        const windowHistory = windowView === "all" ? history : history.slice(-windowView);
        const wc = currentCounts(windowHistory);
        const windowNonTies = wc.B + wc.P;
        const confidenceInterval = wilsonInterval(wc.B, windowNonTies);
        const transitions = transitionCounts(windowHistory);

        document.querySelectorAll("[data-manual-table]").forEach(button => {
            const name = button.getAttribute("data-manual-table");
            const isCurrent = selectedTable === name;
            button.classList.toggle("active", isCurrent);
            button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
            setText(`bc-tab-count-${name}`, `${histories[name].length} 局`);
        });

        setText("bc-all-total", allCount);
        for (const id of ["bc-manual-table-name", "bc-entry-table", "bc-prediction-table", "bc-stats-table", "bc-road-table", "bc-history-table", "bc-sample-table", "bc-window-table"]) {
            setText(id, selectedTable);
        }
        setText("bc-manual-round-count", length);
        setText("bc-manual-total", length);
        setText("bc-manual-latest", last ? CODE_NAMES[last] : "--");
        setText("bc-manual-streak", streak.type ? `连续${CODE_NAMES[streak.type]} ${streak.count} 局（和不打断）` : "目前没有庄／闲记录");
        setText("bc-manual-banker-count", counts.B);
        setText("bc-manual-player-count", counts.P);
        setText("bc-manual-tie-count", counts.T);
        setText("bc-manual-banker-percent", length ? `${(100 * counts.B / length).toFixed(1)}%` : "--");
        setText("bc-manual-player-percent", length ? `${(100 * counts.P / length).toFixed(1)}%` : "--");
        setText("bc-manual-current-streak", streak.type ? `${CODE_NAMES[streak.type]} ${streak.count} 连` : "--");
        setText("bc-manual-max-banker", maxStreak(history, "B"));
        setText("bc-manual-max-player", maxStreak(history, "P"));
        element("bc-manual-undo").disabled = length === 0;
        element("bc-manual-clear").disabled = length === 0;

        // Local progress milestones describe sample sizes, not accuracy levels.
        setText("bc-sample-stage", stage.label);
        setText("bc-sample-next", stage.next);
        setText("bc-sample-decisive", decisiveCount);
        const sampleProgress = element("bc-sample-progress");
        if (sampleProgress) sampleProgress.setAttribute("aria-valuenow", String(Math.min(100, decisiveCount)));
        const bar = element("bc-sample-progress-fill");
        if (bar) bar.style.width = `${Math.min(100, decisiveCount)}%`;
        for (const threshold of [20, 50, 100]) {
            const milestone = element(`bc-milestone-${threshold}`);
            if (milestone) milestone.classList.toggle("achieved", decisiveCount >= threshold);
        }
        document.querySelectorAll("[data-bc-window]").forEach(button => {
            const selected = String(windowView) === button.getAttribute("data-bc-window");
            button.classList.toggle("active", selected);
            button.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        const windowLabel = windowView === "all" ? "全部历史" : `最近 ${windowView} 局`;
        setText("bc-window-summary", `${windowLabel} · 实际录入 ${windowHistory.length} 局（其中庄／闲 ${windowNonTies} 局，和 ${wc.T} 局）`);
        setText("bc-window-banker", windowNonTies ? `${(wc.B / windowNonTies * 100).toFixed(1)}% · ${wc.B} 局` : "--");
        setText("bc-window-player", windowNonTies ? `${(wc.P / windowNonTies * 100).toFixed(1)}% · ${wc.P} 局` : "--");
        setText("bc-window-tie", windowHistory.length ? `${(wc.T / windowHistory.length * 100).toFixed(1)}% · ${wc.T} 局` : "--");
        setText("bc-window-ci", confidenceInterval
            ? `${(confidenceInterval.low * 100).toFixed(1)}% – ${(confidenceInterval.high * 100).toFixed(1)}%（庄 ${wc.B} / 有效 ${windowNonTies} 局）`
            : "没有庄／闲有效样本");
        setText("bc-window-transition", windowNonTies > 1
            ? `庄→庄 ${transitions.BB} · 庄→闲 ${transitions.BP} · 闲→庄 ${transitions.PB} · 闲→闲 ${transitions.PP}`
            : "至少需要 2 局庄／闲结果（忽略和局）");

        // Separate the defensible theoretical odds from exploratory pattern
        // correlations. Never label pattern scores as a validated win chance.
        if (window.BaccaratAnalysis) {
            const analysis = window.BaccaratAnalysis.analyze(history);
            const base = analysis.baseline;
            const pct = n => `${(100 * n).toFixed(2)}%`;
            setText("bc-ai-table", selectedTable);
            setText("bc-ai-base-banker", pct(base.B));
            setText("bc-ai-base-player", pct(base.P));
            setText("bc-ai-base-tie", pct(base.T));
            setText("bc-ai-baseline-call", `庄 · ${pct(base.B)}`);
            const direction = analysis.patternDirection === "B" ? "庄" : "闲";
            setText("bc-ai-pattern-call", analysis.decisive < 20
                ? "资料不足 · 先记录 20 局庄／闲" :
                (analysis.hasDistinctPattern ? `模式参考：${direction}` : "庄闲模式接近五五开"));
            setText("bc-ai-pattern-note", `${analysis.decisive} 局有效庄／闲，${analysis.ties} 局和。${analysis.caveat}`);
            setText("bc-ai-score", analysis.decisive < 20
                ? "至少 20 局庄／闲后显示平滑的实验性模式分数"
                : `庄 ${pct(analysis.patternScore.B)} · 闲 ${pct(analysis.patternScore.P)} · 和 ${pct(analysis.patternScore.T)}（仅模型分数）`);
            const bt = analysis.backtest;
            const label = bt.status === "observed_improvement"
                ? "过去回测略优于基准 · 未证明未来优势"
                : (bt.status === "not_better" ? "没有发现优于数学基准的稳定证据" : "回测样本不足 · 不给出可靠信号");
            setText("bc-ai-validation", label);
            setText("bc-ai-evaluation", bt.observations
                ? `只看该桌最近 ${bt.observations} 个历史可检验决胜局：模型方向吻合 ${pct(bt.candidateHitRate)}，固定选庄基准 ${pct(bt.baselineHitRate)}；模型 Brier ${bt.candidateBrier.toFixed(4)}，理论基准 ${bt.baselineBrier.toFixed(4)}（越低越好）。这仅是历史逐局回测，非未来命中率。`
                : "在拥有至少 40 局庄／闲作为训练数据后，才开始计入回测；达到 120 个回测样本也不代表可预测。");
        }

        if (window.BaccaratEngine) {
            const ev = window.BaccaratEngine.referenceEV();
            const pct = number => `${(number * 100).toFixed(2)}%`;
            setText("bc-ai-ev", `押庄 ${pct(ev.B)} · 押闲 ${pct(ev.P)} · 押和 ${pct(ev.T)}（每单位押注的长期期望净回报）`);
        }
        renderRoadmaps(history);
        if (window.BaccaratPredictor) window.BaccaratPredictor.render(history, selectedTable);
        const trend = trendReference(history);
        const pick = element("bc-manual-pick");
        pick.textContent = trend.pick ? `历史偏多：${CODE_NAMES[trend.pick]}` : (decisiveCount ? "观察中／无明显偏多" : "等待记录");
        pick.className = `bc-manual-pick${trend.pick ? " " + CODE_CLASSES[trend.pick] : ""}`;
        setText("bc-manual-pick-sample", trend.sample);
        setText("bc-manual-pick-reason", trend.reason);
        renderChips("bc-manual-road", history, 120, false);
        renderChips("bc-manual-history", history, 20, true);
    }

    window.choiceManualSetWindow = function(nextWindow) {
        const parsed = nextWindow === "all" ? "all" : Number(nextWindow);
        if (!WINDOWS.includes(parsed)) return;
        windowView = parsed;
        render();
    };

    window.choiceManualSelect = function(table) {
        if (!TABLES.includes(table)) return;
        selectedTable = table;
        try { localStorage.setItem(SELECTED_KEY, selectedTable); } catch (_) { /* still usable */ }
        render();
        message(`已切换到 ${table}，本桌有 ${histories[table].length} 局手动记录。`);
    };

    window.choiceManualAdd = function(code) {
        if (!Object.hasOwn(CODE_NAMES, code)) return;
        if (corruptStorage) {
            message("本地备份无法读取，请先导入有效备份，避免覆盖旧记录。", true);
            return;
        }
        const history = histories[selectedTable];
        if (history.length >= MAX_PER_TABLE) {
            message(`每桌最多保存 ${MAX_PER_TABLE} 局，请先导出备份后清空。`, true);
            return;
        }
        history.push(code);
        const saved = persist();
        render();
        if (saved) message(`${selectedTable} 第 ${history.length} 局：${CODE_NAMES[code]}。已保存至本浏览器。`);
    };

    window.choiceManualUndo = function() {
        if (corruptStorage) { message("本地备份无法读取，请先恢复备份。", true); return; }
        const history = histories[selectedTable];
        if (!history.length) return;
        const removed = history.pop();
        const saved = persist();
        render();
        if (saved) message(`已撤销 ${selectedTable} 的最后一局「${CODE_NAMES[removed]}」，剩余 ${history.length} 局。`);
    };

    window.choiceManualClear = function() {
        if (corruptStorage) { message("本地备份无法读取，请先恢复备份。", true); return; }
        const history = histories[selectedTable];
        if (!history.length) return;
        if (!window.confirm(`确定清空 ${selectedTable} 已手动输入的 ${history.length} 局吗？其他桌的记录不会删除。`)) return;
        histories[selectedTable] = [];
        const saved = persist();
        render();
        if (saved) message(`已清空 ${selectedTable}，其他 7 桌保持不变。`);
    };

    window.choiceManualExport = function() {
        const backup = {
            version: 1,
            exportedAt: new Date().toISOString(),
            tables: histories
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `baccarat-manual-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message("已导出全部 8 桌 JSON 备份。此文件不包含登录信息。请妥善保存。 ");
    };

    window.choiceManualImport = async function(event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error("备份文件超过 1 MB");
            const incoming = validateBackup(JSON.parse(await file.text()));
            const count = TABLES.reduce((sum, table) => sum + incoming[table].length, 0);
            if (!window.confirm(`导入将覆盖当前浏览器全部 8 桌记录。新备份包含 ${count} 局，确定继续吗？`)) {
                message("已取消导入，现有记录未改变。");
                return;
            }
            // Commit validated storage first; if quota/permissions reject the
            // write, keep existing in-memory records and show a real failure.
            if (!persist(incoming, true)) {
                message("导入失败：浏览器无法保存备份，现有页面记录没有改变。", true);
                return;
            }
            histories = incoming;
            render();
            message(`导入成功：共 ${count} 局，8 桌记录已更新。`);
        } catch (error) {
            message(`导入失败：${error.message}。原有记录没有改变。`, true);
        } finally {
            if (input) input.value = "";
        }
    };

    function initialize() {
        if (!element("bc-manual-round-count")) return;
        loadFromBrowser();
        render();
        window.addEventListener("storage", event => {
            if (event.key === STORAGE_KEY) {
                loadFromBrowser();
                render();
                if (!corruptStorage) message("已同步同一浏览器其他标签页更新的 百家乐手动记录。");
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {once: true});
    } else {
        initialize();
    }
})();
