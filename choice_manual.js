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
    const CODE_NAMES = Object.freeze({B: "庄", P: "闲", T: "和"});
    const CODE_CLASSES = Object.freeze({B: "is-banker", P: "is-player", T: "is-tie"});

    let histories = emptyHistories();
    let selectedTable = TABLES[0];

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
            if (raw) {
                histories = validateBackup(JSON.parse(raw));
                initialMessage = "已从本浏览器恢复手动记录。";
            }
            const previousTable = localStorage.getItem(SELECTED_KEY);
            if (TABLES.includes(previousTable)) selectedTable = previousTable;
        } catch (error) {
            initialMessage = `无法读取本地记录：${error.message}。当前显示空白记录，先不要覆盖原有备份。`;
            message(initialMessage, true);
            return;
        }
        message(initialMessage);
    }

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, tables: histories}));
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

    function trendReference(history) {
        const decisive = decisiveOnly(history);
        const n = decisive.length;
        if (n < 3) {
            return {
                pick: null,
                sample: `已有 ${n} 局庄／闲结果（和局不参与趋势计算）`,
                reason: `至少再录入 ${3 - n} 局庄或闲，才会显示简单趋势参考。`
            };
        }

        // Descriptive one-step transitions, not estimated physical win probability.
        const last = decisive[n - 1];
        const nextCounts = {B: 0, P: 0};
        for (let i = 1; i < n; i++) {
            if (decisive[i - 1] === last) nextCounts[decisive[i]]++;
        }
        const transitionSample = nextCounts.B + nextCounts.P;
        let pick;
        let reason;
        let sample;

        if (transitionSample >= 3 && nextCounts.B !== nextCounts.P) {
            pick = nextCounts.B > nextCounts.P ? "B" : "P";
            sample = `历史同类转移样本 ${transitionSample} 次 · 非命中率`;
            reason = `本桌记录中，之前出现「${CODE_NAMES[last]}」后，下一局为庄 ${nextCounts.B} 次、闲 ${nextCounts.P} 次。这里只展示次数较多的一方。`;
        } else {
            const recent = decisive.slice(-12);
            const count = currentCounts(recent);
            pick = count.B === count.P ? last : count.B > count.P ? "B" : "P";
            sample = `最近 ${recent.length} 局庄闲频率 · 非命中率`;
            reason = `最近 ${recent.length} 局：庄 ${count.B} 次，闲 ${count.P} 次。${count.B === count.P ? "频率相同，暂用上一局庄闲作显示参考。" : "展示近期次数较多的一方。"} 当前同结果后转移样本仅 ${transitionSample} 次。`;
        }

        return {pick, sample, reason};
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

    function render() {
        const history = histories[selectedTable];
        const length = history.length;
        const counts = currentCounts(history);
        const streak = trailingStreak(history);
        const last = length ? history[length - 1] : null;
        const allCount = TABLES.reduce((sum, table) => sum + histories[table].length, 0);

        document.querySelectorAll("[data-manual-table]").forEach(button => {
            const name = button.getAttribute("data-manual-table");
            const isCurrent = selectedTable === name;
            button.classList.toggle("active", isCurrent);
            button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
            setText(`bc-tab-count-${name}`, `${histories[name].length} 局`);
        });

        setText("bc-all-total", allCount);
        for (const id of ["bc-manual-table-name", "bc-entry-table", "bc-prediction-table", "bc-stats-table", "bc-road-table", "bc-history-table"]) {
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

        const trend = trendReference(history);
        const pick = element("bc-manual-pick");
        pick.textContent = trend.pick ? `参考：${CODE_NAMES[trend.pick]}` : "等待记录";
        pick.className = `bc-manual-pick${trend.pick ? " " + CODE_CLASSES[trend.pick] : ""}`;
        setText("bc-manual-pick-sample", trend.sample);
        setText("bc-manual-pick-reason", trend.reason);
        renderChips("bc-manual-road", history, 120, false);
        renderChips("bc-manual-history", history, 20, true);
    }

    window.choiceManualSelect = function(table) {
        if (!TABLES.includes(table)) return;
        selectedTable = table;
        try { localStorage.setItem(SELECTED_KEY, selectedTable); } catch (_) { /* still usable */ }
        render();
        message(`已切换到 ${table}，本桌有 ${histories[table].length} 局手动记录。`);
    };

    window.choiceManualAdd = function(code) {
        if (!Object.hasOwn(CODE_NAMES, code)) return;
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
        const history = histories[selectedTable];
        if (!history.length) return;
        const removed = history.pop();
        const saved = persist();
        render();
        if (saved) message(`已撤销 ${selectedTable} 的最后一局「${CODE_NAMES[removed]}」，剩余 ${history.length} 局。`);
    };

    window.choiceManualClear = function() {
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
            histories = incoming;
            const saved = persist();
            render();
            if (saved) message(`导入成功：共 ${count} 局，8 桌记录已更新。`);
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
                message("已同步同一浏览器其他标签页更新的 百家乐手动记录。");
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {once: true});
    } else {
        initialize();
    }
})();
