/* =========================================================
   CONFIG
========================================================= */

const WORKER_URL =
    "https://rapid-disk-cfwingo-api.j05stm24f008.workers.dev";

let myChart = null;
let currentMainTab = "wingo";
let currentBaccaratTable = "D51";

const AI_LEARNING_KEY = "wingo_ai_learning_v2";


/* =========================================================
   AI SELF LEARNING
========================================================= */

const DEFAULT_AI_LEARNING = {
    version: 3,
    factors: {
        markov: {weight: 1.00, win: 0, loss: 0},
        mean: {weight: 1.00, win: 0, loss: 0},
        streak: {weight: 1.00, win: 0, loss: 0},
        frequency: {weight: 1.00, win: 0, loss: 0}
    },
    stats: {total: 0, win: 0, loss: 0},
    patterns: {recent: [], wrongPatterns: [], successfulPatterns: []},
    recentReviews: [],
    lastReviewedIssue: null,
    lastLearningMessage: "等待第一笔真实 Result 进行学习",
    confidenceBias: 0
};


/* =========================================================
   AI STORAGE
========================================================= */

function loadAILearning() {

    try {

        const saved =
            localStorage.getItem(
                AI_LEARNING_KEY
            );

        const base =
            typeof structuredClone === "function"
                ? structuredClone(
                    DEFAULT_AI_LEARNING
                )
                : JSON.parse(
                    JSON.stringify(
                        DEFAULT_AI_LEARNING
                    )
                );

        if (!saved) {
            return base;
        }

        const parsed =
            JSON.parse(saved);

        const restored = mergeLearningState(base, parsed);
        restored.stats.total = restored.stats.win + restored.stats.loss;
        return restored;

    } catch (e) {

        console.warn(
            "AI Learning Load Error:",
            e
        );

        return JSON.parse(
            JSON.stringify(
                DEFAULT_AI_LEARNING
            )
        );
    }
}


function mergeLearningState(base, source) {
    if (Array.isArray(base)) return Array.isArray(source)
        ? source.filter(item => item && typeof item === "object").slice(0, 500) : base;
    if (base && typeof base === "object") {
        if (!source || typeof source !== "object" || Array.isArray(source)) return base;
        for (const key of Object.keys(base)) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                base[key] = mergeLearningState(base[key], source[key]);
            }
        }
        return base;
    }
    if (base === null) return typeof source === "string" ? source : base;
    return typeof source === typeof base &&
        (typeof source !== "number" || Number.isFinite(source)) ? source : base;
}


let aiLearning =
    loadAILearning();


function saveAILearning() {

    try {

        localStorage.setItem(
            AI_LEARNING_KEY,
            JSON.stringify(
                aiLearning
            )
        );

    } catch (e) {

        console.warn(
            "AI Learning Save Error:",
            e
        );
    }
}


/* =========================================================
   BASIC HELPERS
========================================================= */

function clamp(
    value,
    min,
    max
) {

    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}


function safeNumber(value) {

    const n =
        Number(value);

    return Number.isFinite(n)
        ? n
        : 0;
}


function getDirectionFromSize(size) {

    if (size === "大") {
        return 1;
    }

    if (size === "小") {
        return -1;
    }

    return 0;
}


function getSizeFromDirection(
    direction
) {

    return direction >= 0
        ? "大"
        : "小";
}


/* =========================================================
   MYT CLOCK
========================================================= */

function updateMYTClock() {

    const now =
        new Date();

    const myt =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone:
                    "Asia/Kuala_Lumpur",

                hour: "2-digit",

                minute: "2-digit",

                second: "2-digit",

                hour12: false
            }
        ).format(now);

    const el =
        document.getElementById(
            "myt-clock"
        );

    if (el) {
        el.textContent =
            myt;
    }
}


/* =========================================================
   MAIN TAB
========================================================= */

function switchMainTab(
    tab,
    button
) {

    document
        .querySelectorAll(
            ".main-section"
        )
        .forEach(
            section => {

                section.classList.remove(
                    "active"
                );
            }
        );

    document
        .querySelectorAll(
            ".main-tab"
        )
        .forEach(
            btn => {

                btn.classList.remove(
                    "active"
                );
            }
        );

    const target =
        document.getElementById(
            tab + "-section"
        );

    if (target) {

        target.classList.add(
            "active"
        );
    }

    if (button) {

        button.classList.add(
            "active"
        );
    }

    currentMainTab = tab;
    updateNextCountdown();
}


/* =========================================================
   NUMBER ICON
========================================================= */

function getNumberIconHtml(num) {

    const n =
        Number(num);

    let cls = "";

    if (n === 0) {

        cls =
            "number-red";

    } else if (n === 5) {

        cls =
            "number-green";

    } else if (n % 2 === 0) {

        cls =
            "number-red";

    } else {

        cls =
            "number-green";
    }

    return `
        <span class="number-icon ${cls}">
            ${n}
        </span>
    `;
}


/* =========================================================
   FEATURE EXTRACTION
========================================================= */

function getFeatureSnapshot(draws) {
    if (!draws || draws.length < 5) {
        return {markov: 0, mean: 0, streak: 0, frequency: 0};
    }

    const nums = draws.map(d => safeNumber(d.number));
    const sizes = draws.map(d => d.size === "大" ? "大" : "小");

    const lastNum = nums[0];
    let bigTransitions = 0, smallTransitions = 0, totalTransitions = 0;
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === lastNum) {
            totalTransitions++;
            if (sizes[i - 1] === "大") bigTransitions++;
            else smallTransitions++;
        }
    }
    const markov = totalTransitions ? (bigTransitions - smallTransitions) / totalTransitions : 0;

    const recent10 = sizes.slice(0, Math.min(10, sizes.length));
    const big10 = recent10.filter(x => x === "大").length;
    const small10 = recent10.length - big10;
    const mean = recent10.length >= 5 ? -((big10 - small10) / recent10.length) : 0;

    let streak = 1;
    for (let i = 1; i < sizes.length && sizes[i] === sizes[0]; i++) streak++;
    const streakSignal = streak >= 2
        ? getDirectionFromSize(sizes[0]) * Math.min(1, streak / 5)
        : 0;

    const recent20 = sizes.slice(0, Math.min(20, sizes.length));
    const big20 = recent20.filter(x => x === "大").length;
    const frequency = recent20.length
        ? (big20 - (recent20.length - big20)) / recent20.length
        : 0;

    return {
        markov: clamp(markov, -1, 1),
        mean: clamp(mean, -1, 1),
        streak: clamp(streakSignal, -1, 1),
        frequency: clamp(frequency, -1, 1)
    };
}


/* =========================================================
   PATTERN MEMORY
========================================================= */

function getCurrentPattern(
    draws
) {

    if (
        !draws ||
        draws.length < 6
    ) {

        return "";
    }

    const sizes =
        draws
            .slice(
                0,
                6
            )
            .map(
                d =>
                    d.size === "大"
                        ? "B"
                        : "S"
            );

    return sizes.join("");
}


function rememberPattern(
    pattern,
    prediction,
    actual,
    outcome
) {

    if (!pattern) {
        return;
    }

    const item = {

        pattern,

        prediction,

        actual,

        outcome,

        time:
            Date.now()
    };

    aiLearning.patterns.recent.unshift(
        item
    );

    aiLearning.patterns.recent =
        aiLearning.patterns.recent.slice(
            0,
            100
        );


    if (
        outcome === "WIN"
    ) {

        aiLearning.patterns.successfulPatterns.unshift(
            item
        );

        aiLearning.patterns.successfulPatterns =
            aiLearning.patterns.successfulPatterns.slice(
                0,
                50
            );
    }


    if (
        outcome === "LOSS"
    ) {

        aiLearning.patterns.wrongPatterns.unshift(
            item
        );

        aiLearning.patterns.wrongPatterns =
            aiLearning.patterns.wrongPatterns.slice(
                0,
                50
            );
    }
}


/* =========================================================
   SIMILAR PATTERN EXPERIENCE
========================================================= */

function getPatternExperience(
    draws,
    prediction,
    learning = aiLearning
) {

    const pattern =
        getCurrentPattern(
            draws
        );

    if (!pattern) {

        return {
            bonus: 0,
            samples: 0,
            wins: 0,
            losses: 0
        };
    }


    const records =
        learning.patterns.recent.filter(
            x =>
                x.pattern === pattern
        );


    if (!records.length) {

        return {
            bonus: 0,
            samples: 0,
            wins: 0,
            losses: 0
        };
    }


    let wins = 0;
    let losses = 0;

    records.forEach(
        item => {

            if (
                item.outcome === "WIN"
            ) {

                wins++;
            }

            if (
                item.outcome === "LOSS"
            ) {

                losses++;
            }
        }
    );


    const total =
        wins + losses;

    if (!total) {

        return {
            bonus: 0,
            samples: 0,
            wins,
            losses
        };
    }


    let bonus = 0;


    if (
        prediction === "大"
    ) {

        const bigWins =
            records.filter(
                x =>
                    x.prediction === "大" &&
                    x.outcome === "WIN"
            ).length;

        const bigLosses =
            records.filter(
                x =>
                    x.prediction === "大" &&
                    x.outcome === "LOSS"
            ).length;

        if (
            bigWins + bigLosses > 0
        ) {

            bonus =
                (
                    bigWins -
                    bigLosses
                ) /
                (
                    bigWins +
                    bigLosses
                );
        }

    } else {

        const smallWins =
            records.filter(
                x =>
                    x.prediction === "小" &&
                    x.outcome === "WIN"
            ).length;

        const smallLosses =
            records.filter(
                x =>
                    x.prediction === "小" &&
                    x.outcome === "LOSS"
            ).length;

        if (
            smallWins + smallLosses > 0
        ) {

            bonus =
                (
                    smallWins -
                    smallLosses
                ) /
                (
                    smallWins +
                    smallLosses
                );
        }
    }


    return {

        bonus:
            clamp(
                bonus,
                -1,
                1
            ),

        samples:
            total,

        wins,

        losses
    };
}


/* =========================================================
   AI PREDICTION
========================================================= */

function getLearnedPrediction(draws, learning = aiLearning) {
    if (!draws || draws.length === 0) return null;

    if (draws.length < 10) {
        const nums = draws.map(d => Number(d.number)).filter(n => Number.isInteger(n) && n >= 0 && n <= 9);
        const counts = new Map();
        nums.forEach((n, i) => counts.set(n, (counts.get(n) || 0) + (nums.length - i)));
        let predictedNum = nums[0] ?? 5;
        let best = -1;
        for (const [n, value] of counts.entries()) {
            if (value > best) { best = value; predictedNum = n; }
        }
        const size = predictedNum >= 5 ? "大" : "小";
        return {
            num: predictedNum,
            size,
            signal: size === "大" ? "BIG" : "SMALL",
            confidence: clamp(50 + draws.length * 3, 50, 70),
            bigScore: size === "大" ? 1 : 0,
            smallScore: size === "小" ? 1 : 0,
            streakCnt: getCurrentStreak(draws.map(d => d.size)),
            markovSize: size,
            meanSize: size,
            isSpecial: false,
            features: getFeatureSnapshot(draws),
            weightedScore: size === "大" ? 1 : -1,
            rawScore: size === "大" ? 1 : -1,
            factorContributions: {}
        };
    }

    const nums = draws.map(d => safeNumber(d.number));
    const sizes = draws.map(d => d.size === "大" ? "大" : "小");
    const features = getFeatureSnapshot(draws);
    const factors = learning.factors;
    const contributions = {};
    let score = 0;

    Object.keys(features).forEach(key => {
        const feature = safeNumber(features[key]);
        const weight = clamp(safeNumber(factors[key]?.weight) || 1, 0.20, 2.00);
        contributions[key] = feature * weight;
        score += contributions[key];
    });

    const latest = sizes[0];
    const previous = sizes[1];
    let transitionScore = 0, transitionSamples = 0;
    for (let i = 2; i < sizes.length - 1; i++) {
        if (sizes[i] === latest && sizes[i + 1]) {
            transitionSamples++;
            transitionScore += sizes[i + 1] === "大" ? 1 : -1;
        }
    }
    if (transitionSamples >= 2) {
        transitionScore /= transitionSamples;
        score += transitionScore * 0.80;
    }

    const temporaryPrediction = score >= 0 ? "大" : "小";
    const patternMemory = getPatternExperience(draws, temporaryPrediction, learning);
    if (patternMemory.samples >= 2) {
        score += patternMemory.bonus * Math.min(1.20, 0.35 + patternMemory.samples * 0.05);
    }

    if (latest === previous) score += getDirectionFromSize(latest) * 0.20;

    const recentReviews = learning.recentReviews.slice(0, 10)
        .filter(x => x.outcome === "WIN" || x.outcome === "LOSS");
    let selfConfidence = 0;
    if (recentReviews.length >= 3) {
        const wins = recentReviews.filter(x => x.outcome === "WIN").length;
        const accuracy = wins / recentReviews.length;
        selfConfidence = (accuracy - 0.5) * 0.8;
        score += selfConfidence;
    }

    const prediction = getSizeFromDirection(score >= 0 ? 1 : -1);
    let confidence = clamp(50 + Math.abs(score) * 22, 50, 92);
    confidence = clamp(confidence + safeNumber(learning.confidenceBias), 50, 94);

    const lastNum = nums[0];
    let predictedNum = null;
    const transitionCounts = {};
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === lastNum) {
            const nextNum = nums[i - 1];
            transitionCounts[nextNum] = (transitionCounts[nextNum] || 0) + 1;
        }
    }
    const transitionEntries = Object.entries(transitionCounts).sort((a, b) => b[1] - a[1]);
    if (transitionEntries.length) predictedNum = Number(transitionEntries[0][0]);

    if (predictedNum === null || Number.isNaN(predictedNum)) {
        const freq = {};
        nums.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
        const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
        if (entries.length) predictedNum = Number(entries[0][0]);
    }

    if ((predictedNum >= 5 ? "大" : "小") !== prediction) {
        const candidates = Array.from({length: 5}, (_, i) => i + (prediction === "大" ? 5 : 0));
        candidates.sort((a, b) => nums.filter(n => n === b).length - nums.filter(n => n === a).length || a - b);
        predictedNum = candidates[0];
    }

    return {
        num: predictedNum,
        size: prediction,
        signal: prediction === "大" ? "BIG" : "SMALL",
        confidence: Math.round(confidence),
        bigScore: Math.max(score, 0),
        smallScore: Math.max(-score, 0),
        streakCnt: getCurrentStreak(sizes),
        markovSize: features.markov >= 0 ? "大" : "小",
        meanSize: features.mean >= 0 ? "大" : "小",
        isSpecial: lastNum === 0 || lastNum === 5,
        features,
        weightedScore: score,
        rawScore: score,
        factorContributions: contributions,
        patternMemory,
        transitionScore,
        selfConfidence
    };
}


/* =========================================================
   OLD COMPATIBILITY FUNCTION
========================================================= */

function getPredictionForDraw(
    draws
) {

    return getLearnedPrediction(
        draws
    );
}


/* =========================================================
   CURRENT STREAK
========================================================= */

function getCurrentStreak(
    sizes
) {

    if (
        !sizes ||
        !sizes.length
    ) {

        return 0;
    }

    let count = 1;

    for (
        let i = 1;
        i < sizes.length;
        i++
    ) {

        if (
            sizes[i] === sizes[0]
        ) {

            count++;

        } else {

            break;
        }
    }

    return count;
}


/* =========================================================
   LEARNING ENGINE
   WIN / LOSS ONLY BASED ON SIZE
========================================================= */

function learnFromReview(review) {
    if (!review || !review.issue || !["WIN", "LOSS"].includes(review.outcome)) return;
    if (aiLearning.lastReviewedIssue && compareIssues(review.issue, aiLearning.lastReviewedIssue) <= 0) return;

    const actualDirection = getDirectionFromSize(review.actualSize);
    const correct = review.outcome === "WIN";
    if (correct) aiLearning.stats.win++;
    else aiLearning.stats.loss++;
    aiLearning.stats.total = aiLearning.stats.win + aiLearning.stats.loss;

    Object.keys(aiLearning.factors).forEach(key => {
        const feature = safeNumber(review.featureSnapshot?.[key]);
        if (Math.abs(feature) < 0.08) return;
        const factor = aiLearning.factors[key];
        const aligned = (feature >= 0 ? 1 : -1) === actualDirection;
        if (aligned === correct) factor.weight += correct ? 0.035 : 0.020;
        else factor.weight -= correct ? 0.020 : 0.040;
        factor.weight = clamp(factor.weight, 0.25, 2.00);
        if (correct) factor.win++;
        else factor.loss++;
    });

    aiLearning.confidenceBias = clamp(
        aiLearning.confidenceBias + (correct ? 0.35 : -0.55),
        -8,
        8
    );

    rememberPattern(review.pattern, review.predictionSize, review.actualSize, review.outcome);
    aiLearning.lastLearningMessage = correct
        ? `实际大小 ${review.actualSize} 与 AI 大小判断一致，AI 强化有效因素。`
        : `实际大小 ${review.actualSize} 与 AI 大小判断相反，AI 降低近期失效因素权重。`;

    review.source = "historical_replay";
    aiLearning.recentReviews.unshift(review);
    aiLearning.recentReviews = aiLearning.recentReviews.slice(0, 100);
    aiLearning.lastReviewedIssue = review.issue;
    saveAILearning();
}


/* =========================================================
   REVIEW NEW RESULT
   ONLY SIZE DECIDES WIN / LOSS
========================================================= */

function compareIssues(left, right) {
    const a = String(left), b = String(right);
    return a.length - b.length || a.localeCompare(b);
}

let learningSyncInfo = {checkedAt: null, added: 0, latest: null, count: 0};

function reviewNewOutcome(draws) {
    const ordered = normalizeWingoDraws(draws);
    const before = aiLearning.stats.win + aiLearning.stats.loss;
    let latestReview = null;
    for (let index = ordered.length - 11; index >= 0; index--) {
        const draw = ordered[index];
        if (aiLearning.lastReviewedIssue && compareIssues(draw.issue, aiLearning.lastReviewedIssue) <= 0) continue;
        latestReview = reviewSingleOutcome(ordered.slice(index)) || latestReview;
    }
    learningSyncInfo = {
        checkedAt: new Date().toLocaleTimeString("zh-CN", {timeZone: "Asia/Kuala_Lumpur"}),
        added: aiLearning.stats.win + aiLearning.stats.loss - before,
        latest: ordered[0]?.issue || null,
        count: ordered.length
    };
    return latestReview;
}

function reviewSingleOutcome(draws) {
    if (!draws || draws.length < 11) return null;
    const actual = draws[0];
    if (!actual) return null;
    if (aiLearning.lastReviewedIssue === actual.issue) return null;

    const history = draws.slice(1);
    const prediction = getLearnedPrediction(history);
    if (!prediction) return null;
    const actualSize = actual.size === "大" ? "大" : "小";
    const outcome = prediction.size === actualSize ? "WIN" : "LOSS";

    const review = {
        issue: actual.issue,
        predictionSize: prediction.size,
        predictedNum: prediction.num,
        signal: prediction.signal,
        actualSize,
        actualNum: actual.number,
        outcome,
        pattern: getCurrentPattern(history),
        featureSnapshot: prediction.features,
        weightBefore: getCurrentWeights(),
        weightAfter: null,
        timestamp: Date.now()
    };

    learnFromReview(review);
    review.weightAfter = getCurrentWeights();
    if (aiLearning.recentReviews[0]) {
        aiLearning.recentReviews[0].weightAfter = review.weightAfter;
        saveAILearning();
    }
    return review;
}


/* =========================================================
   CURRENT WEIGHTS
========================================================= */

function getCurrentWeights() {
    return {
        markov: Number(aiLearning.factors.markov.weight).toFixed(2),
        mean: Number(aiLearning.factors.mean.weight).toFixed(2),
        streak: Number(aiLearning.factors.streak.weight).toFixed(2),
        frequency: Number(aiLearning.factors.frequency.weight).toFixed(2)
    };
}


/* =========================================================
   AI LEARNING DASHBOARD
========================================================= */

function updateAILearningDashboard() {
    const stats = aiLearning.stats;
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText("ai-learning-status", aiLearning.lastReviewedIssue ? "🧠 历史复盘学习（本浏览器）" : "等待有效历史");
    setText("ai-state", learningSyncInfo.added > 0 ? `新增 ${learningSyncInfo.added} 笔` : aiLearning.lastReviewedIssue ? "已同步，等待新期" : "等待数据");
    setText("learning-sync-detail", learningSyncInfo.checkedAt
        ? `最近检查 ${learningSyncInfo.checkedAt} MYT · 读取 ${learningSyncInfo.count} 笔 · 最新期号 ${learningSyncInfo.latest || "—"} · 已复盘至 ${aiLearning.lastReviewedIssue || "—"}。${learningSyncInfo.added ? `本次新增复盘 ${learningSyncInfo.added} 笔。` : "本次没有可复盘的新期号，次数保持不变。"}`
        : "正在检查历史数据…");
    setText("ai-learning-count", stats.win + stats.loss);
    setText("ai-learning-win", stats.win);
    setText("ai-learning-loss", stats.loss);
    setText("ai-weight-markov", Number(aiLearning.factors.markov.weight).toFixed(2));
    setText("ai-weight-mean", Number(aiLearning.factors.mean.weight).toFixed(2));
    setText("ai-weight-streak", Number(aiLearning.factors.streak.weight).toFixed(2));
    setText("ai-weight-frequency", Number(aiLearning.factors.frequency.weight).toFixed(2));
    setText("ai-last-learning", aiLearning.lastLearningMessage);
}


/* =========================================================
   AI REVIEW DISPLAY
   PREDICTED NUMBER IS DISPLAY ONLY
   WIN / LOSS = SIZE ONLY
========================================================= */

function getNumberColours(number) {
    if (!Number.isInteger(number) || number < 0 || number > 9) return [];
    if (number === 0) return ["红", "紫"];
    if (number === 5) return ["绿", "紫"];
    return [number % 2 ? "绿" : "红"];
}

function evaluateReview(row) {
    if (!row.prediction || row.outcome === "NO_DATA") return {number: "NO_DATA", colour: "NO_DATA", size: "NO_DATA"};
    const predicted = row.prediction.num;
    return {
        number: predicted === row.draw.number ? "WIN" : "LOSS",
        colour: getNumberColours(predicted).join() === getNumberColours(row.draw.number).join() ? "WIN" : "LOSS",
        size: row.outcome
    };
}

function resultBadge(outcome, label = "") {
    const names = {WIN: "WIN", LOSS: "LOSS", NO_DATA: "数据不足"};
    return `<span class="outcome outcome-${outcome.toLowerCase()}">${label}${names[outcome] || outcome}</span>`;
}

function renderAIReview(draws) {
    const rows = getHistoricalRows(draws);
    const row = rows[0];
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    if (!row || !row.prediction) {
        for (const id of ["review-status", "review-prediction", "review-actual", "review-result", "review-message", "review-summary"]) {
            set(id, "历史不足，至少需要该期之前 10 笔记录");
        }
        return;
    }

    const {draw, prediction, outcome} = row;
    const result = evaluateReview(row);
    set("review-status", `历史复盘 · ${draw.issue}`);
    set("review-prediction", `${prediction.num} / ${prediction.size}`);
    set("review-actual", `${draw.number} / ${draw.size}`);
    const resultEl = document.getElementById("review-result");
    if (resultEl) resultEl.innerHTML = resultBadge(result.size);

    const factorNames = {markov:"转移规律", mean:"均值回归", streak:"连续大小", frequency:"近期频率"};
    const factors = Object.entries(prediction.factorContributions || {})
        .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,3);
    const explanation = factors.map(([name,value]) => `${factorNames[name] || name} ${value > 0 ? "偏大" : value < 0 ? "偏小" : "中性"}（${value.toFixed(2)}）`).join("；");
    set("review-message", `只比较大小：0–4 小，5–9 大；号码不同但大小相同也算 WIN。主要大小因素：${explanation || "暂无"}。这些是规则贡献，不是开奖原因。`);

    const summaries = [10,50].map(limit => {
        const sample = rows.slice(0,limit);
        const decisions = sample.filter(r=>r.prediction && r.outcome !== "NO_DATA");
        const wins = decisions.filter(r=>r.outcome === "WIN").length;
        const missing = sample.length - decisions.length;
        const rate = decisions.length ? `${(wins / decisions.length * 100).toFixed(1)}%` : "暂无有效判断";
        return `最近 ${sample.length} 期：大小 WIN ${wins} / LOSS ${decisions.length-wins} · 命中率 ${rate}${missing ? ` · 历史不足 ${missing} 笔` : ""}。`;
    });

    let losses = 0;
    for (const entry of rows) {
        if (entry.outcome === "NO_DATA" || entry.outcome !== "LOSS") break;
        losses++;
    }
    set("review-summary", `${summaries.join("\n")}\n最近有效大小判断连续失误 ${losses} 次。0–4 小，5–9 大；结果只比较大小。以上为固定初始权重的历史回测，不是预先保存的实盘预测。`);
}


// One shared snapshot for both tabs; do not let a stalled request freeze polling.
let snapshotPromise = null;
let snapshotCache = null;
let snapshotLoadedAt = 0;
let lastWingoDraws = [];

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {...options, signal: controller.signal});
        // Consume the body under the same timeout, including a stalled response body.
        const body = await response.text();
        return {ok: response.ok, status: response.status,
            text: async () => body, json: async () => JSON.parse(body)};
    } finally { clearTimeout(timer); }
}

async function loadDashboardSnapshot() {
    if (snapshotCache && Date.now() - snapshotLoadedAt < 1500) return snapshotCache;
    if (!snapshotPromise) {
        snapshotPromise = (async () => {
            const response = await fetchWithTimeout(`./data.json?t=${Date.now()}`, {cache: "no-store"});
            if (!response.ok) throw new Error(`data.json HTTP ${response.status}`);
            const data = await response.json();
            if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("无效的数据文件");
            const buildEl = document.getElementById("build-version");
            if (buildEl) buildEl.textContent = `Build ${data.build_version || "unknown"} · UI v17`;
            snapshotCache = data;
            snapshotLoadedAt = Date.now();
            updateNextCountdown();
            return data;
        })().finally(() => { snapshotPromise = null; });
    }
    return snapshotPromise;
}

function setDataStatus(feed, message) {
    const el = document.getElementById(`${feed}-data-status`);
    if (el) el.textContent = message;
}

function snapshotTime(data) {
    const date = new Date(Number(data.updated_at) * 1000);
    if (!Number.isFinite(date.getTime()) || !data.updated_at) return "快照更新时间未知";
    const stale = Date.now() - date.getTime() > 10 * 60 * 1000;
    return `${stale ? "数据可能已过期 · " : ""}文件更新：${date.toLocaleString("zh-CN", {timeZone: "Asia/Kuala_Lumpur"})} MYT（非实时）`;
}

function normalizeWingoDraws(list) {
    if (!Array.isArray(list)) return [];
    const draws = new Map();
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const issue = String(item.issueNumber ?? item.issue ?? "").trim();
        const raw = item.number ?? item.num;
        const number = Number(raw);
        if (!/^\d+$/.test(issue) || raw === null || raw === undefined || String(raw).trim() === "" ||
            !Number.isInteger(number) || number < 0 || number > 9) continue;
        draws.set(issue, {issue, number, size: number >= 5 ? "大" : "小", colour: item.colour ?? item.color ?? ""});
    }
    return [...draws.values()].sort((a, b) => b.issue.length - a.issue.length || b.issue.localeCompare(a.issue)).slice(0, 300);
}

async function fetchDraws() {
    try {
        const data = await loadDashboardSnapshot();
        const draws = normalizeWingoDraws(data.wingo?.draws);
        if (!draws.length) throw new Error("data.json 没有有效 WinGo 数据");
        lastWingoDraws = draws;
        setDataStatus("wingo", `已读取 ${draws.length} 笔历史 · ${snapshotTime(data)}`);
        return draws;
    } catch (error) {
        console.warn("WinGo snapshot unavailable:", error);
        const draws = normalizeWingoDraws(await fetchWorkerDraws());
        if (draws.length) {
            lastWingoDraws = normalizeWingoDraws([...lastWingoDraws, ...draws]);
            setDataStatus("wingo", `备用接口已加载 ${lastWingoDraws.length} 笔记录`);
            return lastWingoDraws;
        }
        setDataStatus("wingo", lastWingoDraws.length
            ? "数据更新失败，当前显示上次成功读取的历史记录。"
            : "无法读取开奖数据。请使用 HTTP 服务打开页面，并检查 data.json / 数据接口。");
        return lastWingoDraws;
    }
}

async function fetchWorkerDraws() {

    try {

        if (
            typeof CryptoJS ===
            "undefined"
        ) {

            throw new Error(
                "CryptoJS 未加载，请检查 index.html"
            );
        }


        if (
            !window.crypto ||
            !crypto.getRandomValues
        ) {

            throw new Error(
                "浏览器不支持 crypto.getRandomValues"
            );
        }


        const random =
            Array.from(
                crypto.getRandomValues(
                    new Uint8Array(16)
                )
            )
                .map(
                    b =>
                        b.toString(16)
                            .padStart(
                                2,
                                "0"
                            )
                )
                .join("");


        const timestamp =
            Math.floor(
                Date.now() / 1000
            );


        /*
         * IMPORTANT
         * 签名参数必须保持：
         * language
         * pageNo
         * pageSize
         * random
         * typeId
         *
         * timestamp 不参与 MD5
         */

        const signObj = {

            language: 0,

            pageNo: 1,

            pageSize: 100,

            random,

            typeId: 30
        };


        const signRaw =
            JSON.stringify(
                signObj
            );


        console.log(
            "========== Signature 原始内容 =========="
        );

        console.log(
            signRaw
        );

        console.log(
            "========================================="
        );


        const sign =
            CryptoJS.MD5(
                signRaw
            )
                .toString()
                .toUpperCase();


        console.log(
            "========== Signature =========="
        );

        console.log(
            sign
        );

        console.log(
            "==============================="
        );


        const requestBody = {

            ...signObj,

            timestamp,

            sign
        };


        console.log(
            "========== Worker Request =========="
        );

        console.log(
            requestBody
        );

        console.log(
            "===================================="
        );


        const response =
            await fetchWithTimeout(
                WORKER_URL,
                {
                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            requestBody
                        )
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        const rawText =
            await response.text();


        console.log(
            "========== Worker Raw Response =========="
        );

        console.log(
            rawText
        );

        console.log(
            "=========================================="
        );


        if (!rawText) {

            console.warn(
                "Worker 返回空内容"
            );

            return [];
        }


        let json;


        try {

            json =
                JSON.parse(
                    rawText
                );

        } catch (parseError) {

            console.error(
                "Worker 返回不是 JSON:",
                parseError
            );

            return [];
        }


        console.log(
            "========== Worker JSON =========="
        );

        console.log(
            json
        );

        console.log(
            "================================="
        );


        if (
            json?.code !== undefined &&
            Number(json.code) !== 0
        ) {

            console.error(
                "========== Worker API ERROR =========="
            );

            console.error(
                "Code:",
                json?.code
            );

            console.error(
                "Message:",
                json?.msg
            );

            console.error(
                "Message Code:",
                json?.msgCode
            );

            console.error(
                "Trace ID:",
                json?.traceId
            );

            console.error(
                "Request Sign:",
                sign
            );

            console.error(
                "Request Sign Raw:",
                signRaw
            );

            console.error(
                "========================================"
            );

            return [];
        }


        /*
         * 支持不同 Worker 返回结构
         */

        let list = null;


        if (
            Array.isArray(
                json?.data?.list
            )
        ) {

            list =
                json.data.list;

        }

        else if (
            Array.isArray(
                json?.data?.records
            )
        ) {

            list =
                json.data.records;

        }

        else if (
            Array.isArray(
                json?.data?.rows
            )
        ) {

            list =
                json.data.rows;

        }

        else if (
            Array.isArray(
                json?.data?.data
            )
        ) {

            list =
                json.data.data;

        }

        else if (
            Array.isArray(
                json?.data
            )
        ) {

            list =
                json.data;

        }

        else if (
            Array.isArray(
                json?.result?.list
            )
        ) {

            list =
                json.result.list;

        }

        else if (
            Array.isArray(
                json?.result?.records
            )
        ) {

            list =
                json.result.records;

        }

        else if (
            Array.isArray(
                json?.result?.rows
            )
        ) {

            list =
                json.result.rows;

        }

        else if (
            Array.isArray(
                json?.result
            )
        ) {

            list =
                json.result;

        }

        else if (
            Array.isArray(
                json?.payload?.list
            )
        ) {

            list =
                json.payload.list;

        }

        else if (
            Array.isArray(
                json?.payload?.records
            )
        ) {

            list =
                json.payload.records;

        }

        else if (
            Array.isArray(
                json?.payload?.rows
            )
        ) {

            list =
                json.payload.rows;

        }

        else if (
            Array.isArray(
                json?.list
            )
        ) {

            list =
                json.list;

        }

        else if (
            Array.isArray(
                json?.records
            )
        ) {

            list =
                json.records;

        }

        else if (
            Array.isArray(
                json?.rows
            )
        ) {

            list =
                json.rows;
        }


        if (
            !Array.isArray(list)
        ) {

            console.error(
                "========== 找不到开奖数组 =========="
            );

            console.error(
                "Worker 完整 JSON:"
            );

            console.error(
                JSON.stringify(
                    json,
                    null,
                    2
                )
            );

            console.error(
                "===================================="
            );


            if (
                json?.code !== undefined ||
                json?.msg !== undefined
            ) {

                console.error(
                    "Worker Code:",
                    json?.code
                );

                console.error(
                    "Worker Message:",
                    json?.msg
                );
            }


            return [];
        }


        console.log(
            "Worker 找到开奖数量:",
            list.length
        );


        const parsed =
            list
                .map(
                    item => {

                        if (
                            !item ||
                            typeof item !==
                            "object"
                        ) {

                            return null;
                        }


                        const rawNumber =
                            item?.number ??
                            item?.num ??
                            item?.result ??
                            item?.openNumber ??
                            item?.openNum ??
                            item?.winningNumber;


                        const number =
                            safeNumber(
                                rawNumber
                            );


                        const issue =
                            String(
                                item?.issueNumber ??
                                item?.issue ??
                                item?.period ??
                                item?.periodNumber ??
                                item?.issue_no ??
                                item?.drawNumber ??
                                item?.drawNo ??
                                ""
                            );


                        const colour =
                            item?.colour ??
                            item?.color ??
                            item?.colourName ??
                            item?.colorName ??
                            "";


                        let size =
                            item?.size ??
                            item?.sizeName ??
                            "";


                        if (
                            size !== "大" &&
                            size !== "小"
                        ) {

                            size =
                                number >= 5
                                    ? "大"
                                    : "小";
                        }


                        return {

                            issue,

                            number,

                            size,

                            colour
                        };
                    }
                )
                .filter(
                    x =>
                        x &&
                        x.issue &&
                        Number.isFinite(
                            x.number
                        ) &&
                        x.number >= 0 &&
                        x.number <= 9
                );


        console.log(
            `WinGo 成功解析 ${parsed.length} 笔`,
            parsed.slice(0, 3)
        );


        if (
            parsed.length === 0
        ) {

            console.warn(
                "Worker 找到了数组，但没有解析出有效开奖资料:"
            );

            console.warn(
                list
            );
        }


        return parsed;

    } catch (error) {

        console.error(
            "fetchDraws ERROR:",
            error
        );

        console.error(
            "Worker URL:",
            WORKER_URL
        );

        return [];
    }
}


/* =========================================================
   UPDATE LATEST CARD
========================================================= */

function updateLatestCard(
    latest
) {

    const issueEl =
        document.getElementById(
            "latest-issue"
        );


    const resultEl =
        document.getElementById(
            "latest-result"
        );


    if (issueEl) {

        issueEl.textContent =
            latest.issue;
    }


    if (resultEl) {

        resultEl.innerHTML = `
            ${getNumberIconHtml(
                latest.number
            )}
            ${latest.number}
            ${latest.size}
        `;
    }
}


/* =========================================================
   UPDATE PREDICTION CARD
   预测号码 + 大小 + 信心
========================================================= */

function updatePredictionCard(
    prediction
) {

    const el =
        document.getElementById(
            "predicted-result"
        );


    if (!el) {
        return;
    }


    if (!prediction) {

        el.innerHTML = `
            <strong>
                ---
            </strong>

            <span>
                等待数据
            </span>
        `;

        return;
    }

    /*
     * 正常预测
     *
     * 例如：
     * 7 / 大
     * 72%
     *
     * 注意：
     * 号码只是显示
     * WIN / LOSS 仍然只看大小
     */

    const colours = getNumberColours(Number(prediction.num));
    const colourText = colours.length ? colours.map(c => c === "red" ? "红" : c === "green" ? "绿" : "紫").join("+") : "-";
    el.innerHTML = `
        <strong>${prediction.num ?? "-"} / ${prediction.size} / ${colourText}</strong>
        <span>统计信心 ${prediction.confidence}%</span>
    `;
}


/* =========================================================
   MARKET ANALYSIS
========================================================= */

function updateMarketAnalysis(draws, prediction) {
    const sizes = draws.map(d => d.size);
    const nums = draws.map(d => safeNumber(d.number));
    const streak = getCurrentStreak(sizes);
    const features = prediction.features || getFeatureSnapshot(draws);
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText("analysis-streak", `${streak} 连${sizes[0] || ""}`);
    setText("analysis-markov", features.markov >= 0 ? "大" : "小");
    setText("analysis-mean", features.mean >= 0 ? "大" : "小");
    setText("analysis-number", nums[0] ?? "--");
}


/* =========================================================
   BACKTEST
   ONLY SIZE DECIDES WIN / LOSS
========================================================= */

// Replay each outcome using only older draws and fixed baseline weights.
// These are retrospective simulations, not saved pre-draw predictions.
function getHistoricalRows(draws) {
    const ordered = normalizeWingoDraws(draws);
    const baseline = JSON.parse(JSON.stringify(DEFAULT_AI_LEARNING));
    return ordered.slice(0, 50).map((draw, index) => {
        const history = ordered.slice(index + 1);
        if (history.length < 10) return {draw, prediction: null, outcome: "NO_DATA"};
        const prediction = getLearnedPrediction(history, baseline);
        const outcome = prediction.size === draw.size ? "WIN" : "LOSS";
        return {draw, prediction, outcome};
    });
}

function runBacktest(draws) {
    const rows = getHistoricalRows(draws);
    const count = outcome => rows.filter(row => row.outcome === outcome).length;
    const win = count("WIN"), loss = count("LOSS");
    const valid = win + loss;
    return {win, loss, valid, rate: valid ? win / valid * 100 : 0};
}


/* =========================================================
   UPDATE WIN RATE
========================================================= */

function updateWinRate(
    result
) {

    const el =
        document.getElementById(
            "win-rate"
        );


    if (!el) {
        return;
    }


    el.innerHTML = `
        <div style="
            font-size:1.8rem;
            font-weight:900;
        ">
            ${result.rate.toFixed(1)}%
        </div>

        <div style="
            font-size:11px;
            color:#94a3b8;
            margin-top:5px;
        ">
            WIN ${result.win}
            · LOSS ${result.loss}
        </div>
    `;
}


/* =========================================================
   DRAW TABLE
========================================================= */

function renderDrawTable(draws) {
    const table = document.getElementById("draw-table");
    if (!table) return;
    const rows = getHistoricalRows(draws).map(({draw, prediction, outcome}) => `
        <tr>
            <td>${draw.issue}</td>
            <td>${getNumberIconHtml(draw.number)} <span>${draw.size}</span></td>
            <td>${!prediction ? "—" : `${getNumberIconHtml(prediction.num)} <span>${prediction.size}</span>`}</td>
            <td>${resultBadge(outcome)}</td>
        </tr>
    `).join("") || '<tr><td colspan="4">暂无数据</td></tr>';
    if (table.tagName === "TBODY") table.innerHTML = rows;
    else table.innerHTML = `<div class="table-wrapper"><table>
        <thead><tr><th>期号</th><th>实际开奖</th><th>回测预测</th><th>回测结果</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}


/* =========================================================
   NUMBER CHART
========================================================= */

function renderNumberChart(
    draws
) {

    const canvas =
        document.getElementById(
            "chart-numbers"
        );


    if (!canvas) {
        return;
    }


    const chartDraws =
        draws
            .slice(
                0,
                30
            )
            .reverse();


    const labels =
        chartDraws.map(
            d =>
                d.issue.slice(-4)
        );


    const data =
        chartDraws.map(
            d =>
                safeNumber(
                    d.number
                )
        );


    if (myChart) {

        myChart.destroy();
    }


    if (
        typeof Chart ===
        "undefined"
    ) {

        return;
    }


    myChart =
        new Chart(
            canvas,
            {

                type:
                    "line",

                data: {

                    labels,

                    datasets: [

                        {

                            label:
                                "WinGo 数字",

                            data,

                            tension:
                                0.25,

                            borderWidth:
                                2,

                            pointRadius:
                                3
                        }

                    ]
                },

                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    scales: {

                        y: {

                            min: 0,

                            max: 9,

                            ticks: {

                                stepSize: 1
                            }
                        }
                    },

                    plugins: {

                        legend: {

                            display: false
                        }
                    }
                }
            }
        );
}


/* =========================================================
   REFRESH DASHBOARD
========================================================= */

async function refreshDashboard() {
    try {
        const draws = await fetchDraws();

        if (!draws || !draws.length) {
            console.log("WinGo 暂无开奖数据");
            return;
        }

        draws.sort((a, b) =>
            String(b.issue).localeCompare(String(a.issue))
        );

        // AI 自动复盘 / 学习
        reviewNewOutcome(draws);

        // 下一期 AI 预测
        const prediction = getLearnedPrediction(draws);

        // 最新开奖
        const latest = draws[0];

        updateLatestCard(latest);

        // 下一期预测
        updatePredictionCard(prediction);

        // 市场分析
        updateMarketAnalysis(draws, prediction);

        // AI 智能复盘
        renderAIReview(draws);

        // AI 智能学习状态
        updateAILearningDashboard();

        // AI 胜率
        const backtest = runBacktest(draws);
        updateWinRate(backtest);

        // 最近 50 局
        renderDrawTable(draws);

        // 已删除 WinGo 数字走势 Chart
        // renderNumberChart(draws);

    } catch (error) {
        console.error("WinGo Dashboard Refresh Error:", error);
    }
}


/* ============================================================
   BACCARAT REAL DATA
============================================================ */

const baccaratData = {

    D51: {
        round: 0,
        history: []
    },

    D52: {
        round: 0,
        history: []
    },

    D53: {
        round: 0,
        history: []
    },

    D54: {
        round: 0,
        history: []
    },

    D55: {
        round: 0,
        history: []
    },

    D56: {
        round: 0,
        history: []
    },

    D57: {
        round: 0,
        history: []
    },

    D58: {
        round: 0,
        history: []
    }
};


/* ============================================================
   BACCARAT DATA.JSON LOADER
============================================================ */

function baccaratResultToCode(
    result
) {

    const value = String(
        result ?? ""
    ).trim().toLowerCase();

    if (
        value === "庄" ||
        value === "banker" ||
        value === "b"
    ) {

        return "B";
    }

    if (
        value === "闲" ||
        value === "player" ||
        value === "p"
    ) {

        return "P";
    }

    if (
        value === "和" ||
        value === "tie" ||
        value === "t"
    ) {

        return "T";
    }

    return null;
}


function normalizeBaccaratRoomHistory(
    roomHistory
) {

    if (!Array.isArray(roomHistory)) {
        return [];
    }

    const result =
        roomHistory
            .map(
                item => {

                    if (
                        typeof item ===
                        "string"
                    ) {

                        return baccaratResultToCode(
                            item
                        );
                    }

                    if (
                        item &&
                        typeof item ===
                        "object"
                    ) {

                        return baccaratResultToCode(
                            item.result
                        );
                    }

                    return null;
                }
            )
            .filter(
                Boolean
            );


    /*
     * bot.py 最新结果放在 index 0。
     *
     * 但现有 renderBaccarat /
     * predictBaccarat 的 history
     * 是：
     *
     * oldest -> newest
     *
     * 所以这里反转一次。
     */

    return result.reverse();
}


async function fetchBaccaratData() {

    try {

        const data = await loadDashboardSnapshot();


        if (
            !data ||
            !data.baccarat ||
            !data.baccarat.rooms
        ) {

            throw new Error("data.json 没有 baccarat.rooms");
        }


        const rooms =
            data.baccarat.rooms;


        Object.keys(
            baccaratData
        ).forEach(
            room => {

                const source =
                    rooms[room];


                if (
                    !Array.isArray(
                        source
                    )
                ) {

                    baccaratData[room] = {

                        round: 0,

                        history: [],

                        records: []
                    };

                    return;
                }


                /*
                 * =================================================
                 * 保存完整 Baccarat Record
                 * =================================================
                 */

                const records =
                    source
                        .filter(
                            item =>
                                item &&
                                typeof item ===
                                "object"
                        )
                        .map(
                            item => {

                                const result =
                                    baccaratResultToCode(
                                        item.result
                                    );


                                return {

                                    room:
                                        item.room ??
                                        room,

                                    game:
                                        item.game ??
                                        item.round ??
                                        item.game_no ??
                                        0,

                                    round:
                                        item.round ??
                                        item.game ??
                                        item.game_no ??
                                        0,

                                    game_id:
                                        item.game_id ??
                                        "",

                                    result:
                                        result,

                                    resultName:
                                        result === "B"
                                            ? "庄"
                                            : result === "P"
                                                ? "闲"
                                                : result === "T"
                                                    ? "和"
                                                    : "-",

                                    bval:
                                        safeNumber(
                                            item.bval
                                        ),

                                    pval:
                                        safeNumber(
                                            item.pval
                                        ),

                                    pair:
                                        safeNumber(
                                            item.pair
                                        ),

                                    num:
                                        safeNumber(
                                            item.num
                                        ),

                                    predict:
                                        item.predict ??
                                        ""
                                };

                            }
                        )
                        .filter(
                            item =>
                                item.result
                        );


                /*
                 * =================================================
                 * 历史结果
                 *
                 * bot.py:
                 *
                 * index 0 = 最新
                 *
                 * 前端:
                 *
                 * oldest -> newest
                 * =================================================
                 */

                const history =
                    records
                        .map(
                            item =>
                                item.result
                        )
                        .reverse();


                /*
                 * =================================================
                 * 最新一局
                 * =================================================
                 */

                const latest =
                    source.length > 0
                        ? source[0]
                        : null;


                let round = 0;


                if (
                    latest &&
                    typeof latest ===
                    "object"
                ) {

                    round =
                        Number(
                            latest.game ??
                            latest.round ??
                            latest.game_no ??
                            0
                        );


                    if (
                        !Number.isFinite(
                            round
                        )
                    ) {

                        round = 0;
                    }
                }


                baccaratData[room] = {

                    round,

                    history,

                    records
                };


                console.log(
                    `[Baccarat ${room}]`,
                    {
                        total:
                            records.length,

                        latest:
                            records[0] ??
                            null
                    }
                );
            }
        );


        /*
         * =================================================
         * 更新目前显示的桌
         * =================================================
         */

        renderBaccarat(currentBaccaratTable);
        const count = Object.values(baccaratData).reduce((n, room) => n + room.history.length, 0);
        setDataStatus("baccarat", count
            ? `已读取 ${count} 笔记录 · ${snapshotTime(data)}`
            : "尚未收到百家乐开奖记录；请检查 bot.py 的 WebSocket 连接。");


    } catch (error) {

        console.warn(
            "Baccarat data.json 读取失败:", error
        );
        setDataStatus("baccarat", "数据读取失败，保留上次结果。请使用 HTTP 服务打开页面并检查 data.json。");
    }
}


/* =========================================================
   BACCARAT
========================================================= */

function switchBaccaratTable(
    table
) {

    currentBaccaratTable =
        table;


    renderBaccarat(
        table
    );
}


function baccaratResultName(
    result
) {

    if (
        result === "B"
    ) {

        return "庄";
    }

    if (
        result === "P"
    ) {

        return "闲";
    }

    return "和";
}


function getBaccaratStreak(
    history
) {

    if (
        !history ||
        !history.length
    ) {

        return 0;
    }


    const latest =
        history[
            history.length - 1
        ];


    let count = 1;


    for (
        let i =
            history.length - 2;

        i >= 0;

        i--
    ) {

        if (
            history[i] ===
            latest
        ) {

            count++;

        } else {

            break;
        }
    }


    return count;
}


function getMaxStreak(
    history,
    target
) {

    let max = 0;

    let current = 0;


    history.forEach(
        item => {

            if (
                item === target
            ) {

                current++;

                max =
                    Math.max(
                        max,
                        current
                    );

            } else {

                current = 0;
            }
        }
    );


    return max;
}


function predictBaccarat(
    history
) {

    if (!history || history.length === 0) {
        return {result: "B", confidence: 50, action: "BANKER", reason: "尚未收到真实历史，暂以中性默认方向显示；有数据后自动重算"};
    }


    const banker =
        history.filter(
            x =>
                x === "B"
        ).length;


    const player =
        history.filter(
            x =>
                x === "P"
        ).length;


    const streak =
        getBaccaratStreak(
            history
        );


    let result;


    if (
        streak >= 3
    ) {

        result =
            history[
                history.length - 1
            ];

    } else {

        result =
            banker >= player
                ? "B"
                : "P";
    }


    const total =
        banker +
        player;


    const confidence =
        total > 0
            ? Math.round(
                (
                    Math.max(
                        banker,
                        player
                    ) /
                    total
                ) *
                100
            )
            : 50;


    return {

        result,

        confidence:

            clamp(
                confidence,
                50,
                85
            ),

        action:
            result === "B"
                ? "BANKER"
                : "PLAYER",

        reason:
            `庄 ${banker} / 闲 ${player}，当前 ${streak} 连${baccaratResultName(result)}`
    };
}


function renderBigRoad(
    history
) {

    const el =
        document.getElementById(
            "big-road"
        );


    if (!el) {
        return;
    }


    el.innerHTML =
        history
            .map(
                item => `

                    <span
                        class="history-item ${
                            item === "B"
                                ? "banker"
                                : item === "P"
                                    ? "player"
                                    : "tie"
                        }"
                    >

                        ${item}

                    </span>
                `
            )
            .join("");
}


function renderSmallRoad(
    history,
    elementId
) {

    const el =
        document.getElementById(
            elementId
        );


    if (!el) {
        return;
    }


    el.innerHTML =
        history
            .map(
                item => `

                    <span
                        class="history-item ${
                            item === "B"
                                ? "banker"
                                : item === "P"
                                    ? "player"
                                    : "tie"
                        }"
                    >

                        ${item}

                    </span>
                `
            )
            .join("");
}


function renderBaccaratHistory(
    history
) {

    const el =
        document.getElementById(
            "bc-history"
        );


    if (!el) {
        return;
    }


    el.innerHTML =
        history
            .map(
                item => `

                    <span
                        class="history-item ${
                            item === "B"
                                ? "banker"
                                : item === "P"
                                    ? "player"
                                    : "tie"
                        }"
                    >

                        ${baccaratResultName(
                            item
                        )}

                    </span>
                `
            )
            .join("");
}


function renderBaccarat(
    table
) {

    const data =
        baccaratData[table];


    if (!data) {
        return;
    }


    const history =
        data.history;


    const banker =
        history.filter(
            x =>
                x === "B"
        ).length;


    const player =
        history.filter(
            x =>
                x === "P"
        ).length;


    const tie =
        history.filter(
            x =>
                x === "T"
        ).length;


    const prediction =
        predictBaccarat(
            history
        );


    const setText = (
        id,
        value
    ) => {

        const el =
            document.getElementById(
                id
            );

        if (el) {

            el.textContent =
                value;
        }
    };


    setText(
        "bc-table-name",
        table
    );


    setText(
        "bc-round",
        data.round
    );


    setText(
        "bc-latest",
        baccaratResultName(
            history[
                history.length - 1
            ]
        )
    );


    setText(
        "bc-streak",
        getBaccaratStreak(
            history
        )
    );


    renderBigRoad(
        history
    );


    renderSmallRoad(
        history,
        "eye-road"
    );


    renderSmallRoad(
        history.slice(
            0,
            10
        ),
        "small-road"
    );


    renderSmallRoad(
        history.slice(
            0,
            10
        ),
        "cockroach-road"
    );


    setText(
        "bc-banker-count",
        banker
    );


    setText(
        "bc-player-count",
        player
    );


    setText(
        "bc-tie-count",
        tie
    );


    const total =
        history.length;


    setText(
        "bc-banker-rate",
        total
            ? `${(
                banker /
                total *
                100
            ).toFixed(1)}%`
            : "0%"
    );


    setText(
        "bc-player-rate",
        total
            ? `${(
                player /
                total *
                100
            ).toFixed(1)}%`
            : "0%"
    );


    setText(
        "bc-current-streak",
        getBaccaratStreak(
            history
        )
    );


    setText(
        "bc-max-banker",
        getMaxStreak(
            history,
            "B"
        )
    );


    setText(
        "bc-max-player",
        getMaxStreak(
            history,
            "P"
        )
    );


    setText(
        "bc-total-rounds",
        total
    );


    renderBaccaratHistory(
        history
    );


    setText(
        "bc-prediction",
        baccaratResultName(
            prediction.result
        )
    );


    setText(
        "bc-confidence",
        `${prediction.confidence}%`
    );


    setText(
        "bc-action",
        prediction.action
    );


    setText(
        "bc-reason",
        prediction.reason
    );


    const action =
        document.getElementById(
            "bc-action"
        );


    if (action) {

        action.className =
            prediction.result === "B"
                ? "banker"
                : prediction.result === "P"
                    ? "player"
                    : "neutral";
    }


    document
        .querySelectorAll(
            ".baccarat-table-btn"
        )
        .forEach(
            btn => {

                btn.classList.toggle(
                    "active",
                    btn.dataset.table ===
                    table
                );
            }
        );
}


/* =========================================================
   UNIFIED DASHBOARD REFRESH SYSTEM
========================================================= */

let dashboardRefreshRunning = false;
let baccaratRefreshRunning = false;


/* =========================================================
   SAFE WINGO REFRESH
========================================================= */

async function safeRefreshDashboard() {

    if (dashboardRefreshRunning) {
        return;
    }

    dashboardRefreshRunning = true;

    try {

        await refreshDashboard();

    } catch (error) {

        console.error(
            "WinGo Dashboard Refresh Error:",
            error
        );

    } finally {

        dashboardRefreshRunning = false;
    }
}


/* =========================================================
   SAFE BACCARAT REFRESH
========================================================= */

async function safeFetchBaccaratData() {

    if (baccaratRefreshRunning) {
        return;
    }

    baccaratRefreshRunning = true;

    try {

        await fetchBaccaratData();

    } catch (error) {

        console.error(
            "Baccarat Refresh Error:",
            error
        );

    } finally {

        baccaratRefreshRunning = false;
    }
}


/* =========================================================
   NEXT DRAW COUNTDOWN
   Uses MZPLAY issue end/service time for K3/5D/TRX.
   WinGo 30s is aligned to the next 30-second wall-clock boundary.
========================================================= */

function parseMytApiTime(value) {
    if (!value) return NaN;
    let text = String(value).trim().replace(" ", "T");
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) text += "+08:00";
    return Date.parse(text);
}

function formatCountdown(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(value / 60);
    const secs = value % 60;
    return minutes > 0
        ? `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        : `${String(secs).padStart(2, "0")}s`;
}

function getIssueCountdown(state, defaultIntervalSeconds = 60) {
    const issue = state?.current_issue || {};
    const endMs = parseMytApiTime(issue.endTime);
    const serviceMs = parseMytApiTime(issue.serviceTime);
    if (!Number.isFinite(endMs)) return null;

    const receivedMs = Number(state?.updated_at || 0) * 1000;
    const serverNowMs = Number.isFinite(serviceMs) && receivedMs > 0
        ? serviceMs + Math.max(0, Date.now() - receivedMs)
        : Date.now();

    const intervalSeconds = Math.max(1, Math.round(Number(issue.intervalM || 0) * 60) || defaultIntervalSeconds);
    let remaining = Math.ceil((endMs - serverNowMs) / 1000);
    while (remaining <= 0) remaining += intervalSeconds;
    return remaining;
}

function updateNextCountdown() {
    const el = document.getElementById("countdown");
    if (!el) return;

    if (currentMainTab === "baccarat") {
        el.textContent = "LIVE";
        return;
    }

    if (currentMainTab === "wingo") {
        const second = Math.floor(Date.now() / 1000);
        const remaining = 30 - (second % 30);
        el.textContent = formatCountdown(remaining);
        return;
    }

    const key = currentMainTab === "5d" ? "5d" : currentMainTab;
    const remaining = getIssueCountdown(snapshotCache?.[key], 60);
    el.textContent = remaining == null ? "--" : formatCountdown(remaining);
}

setInterval(updateNextCountdown, 250);
setInterval(safeRefreshDashboard, 5000);


/* =========================================================
   BACCARAT REALTIME REFRESH
========================================================= */

setInterval(
    safeFetchBaccaratData,
    2000
);


/* =========================================================
   MYT CLOCK
========================================================= */

setInterval(
    updateMYTClock,
    1000
);


/* =========================================================
   INITIALIZE DASHBOARD
========================================================= */

async function initializeDashboard() {

    console.log(
        "========================================"
    );

    console.log(
        "Dashboard Initializing..."
    );

    console.log(
        "========================================"
    );


    /* -----------------------------------------------------
       MYT CLOCK
    ----------------------------------------------------- */

    try {

        updateMYTClock();

    } catch (error) {

        console.error(
            "MYT Clock Init Error:",
            error
        );
    }


    /* -----------------------------------------------------
       AI LEARNING
    ----------------------------------------------------- */

    try {

        updateAILearningDashboard();

    } catch (error) {

        console.error(
            "AI Dashboard Init Error:",
            error
        );
    }


    /* -----------------------------------------------------
       BACCARAT
    ----------------------------------------------------- */

    try {

        await Promise.allSettled([safeFetchBaccaratData(), safeRefreshDashboard()]);

    } catch (error) {

        console.error(
            "Baccarat Init Error:",
            error
        );
    }


    /* -----------------------------------------------------
       WINGO
    ----------------------------------------------------- */

    try {

        await safeRefreshDashboard();

    } catch (error) {

        console.error(
            "WinGo Dashboard Init Error:",
            error
        );
    }


    /* -----------------------------------------------------
       COUNTDOWN DISPLAY
    ----------------------------------------------------- */

    updateNextCountdown();


    console.log(
        "========================================"
    );

    console.log(
        "Dashboard Initialized"
    );

    console.log(
        "WinGo refresh: 5 seconds"
    );

    console.log(
        "Baccarat refresh: 2 seconds"
    );

    console.log(
        "========================================"
    );
}


/* =========================================================
   START APPLICATION
========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeDashboard,
        {
            once: true
        }
    );

} else {

    initializeDashboard();

}

/* =========================================================
   K3 / 5D / TRX FULL PREDICTION DASHBOARD
========================================================= */
function mgEsc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

function mgTag(value) {
    const text = String(value ?? "-");
    let cls = "";
    if (text === "大") cls = "tag-big";
    else if (text === "小") cls = "tag-small";
    else if (text === "单") cls = "tag-odd";
    else if (text === "双") cls = "tag-even";
    else if (text.includes("红")) cls = "tag-red";
    else if (text.includes("绿")) cls = "tag-green";
    else if (text.includes("紫")) cls = "tag-violet";
    return `<span class="${cls}">${mgEsc(text)}</span>`;
}

function mgBalls(values) {
    return `<span class="ball-line">${(values || []).map(n => `<span class="num-ball">${mgEsc(n)}</span>`).join("")}</span>`;
}

function mgTile(title, value, meta = "") {
    return `<div class="prediction-tile"><div class="pt-title">${mgEsc(title)}</div><div class="pt-value">${value}</div>${meta ? `<div class="pt-meta">${meta}</div>` : ""}</div>`;
}

function mgSet(id, html, asText = false) {
    const el = document.getElementById(id);
    if (!el) return;
    if (asText) el.textContent = html;
    else el.innerHTML = html;
}

function mgStatus(game, state, data) {
    const msg = state?.status || "等待数据";
    const count = Array.isArray(state?.draws) ? state.draws.length : 0;
    const updated = state?.updated_at ? new Date(state.updated_at * 1000).toLocaleString("zh-CN", {timeZone:"Asia/Kuala_Lumpur"}) : "--";
    mgSet(`${game}-data-status`, `${msg} · 历史 ${count} 笔 · ${updated} MYT`, true);
}

function mgReviewTable(game, reviews) {
    if (!Array.isArray(reviews) || !reviews.length) {
        return `<div class="multi-empty">等待下一期真实开奖后开始实盘复盘</div>`;
    }
    return `<div class="multi-row header"><span>期号</span><span>预测</span><span>实际</span><span>结果</span></div>` +
        reviews.slice(0, 10).map(r => `<div class="multi-row"><span>${mgEsc(r.issueNumber)}</span><span>${mgEsc(r.prediction)}</span><span>${mgEsc(r.actual)}</span><span class="${r.win ? "win-text" : "loss-text"}">${mgEsc(r.score)}</span></div>`).join("");
}

function renderK3State(state, data) {
    mgStatus("k3", state, data);
    const latest = state?.draws?.[0];
    const p = state?.prediction || {};
    mgSet("k3-latest", latest ? mgBalls(latest.dice) : "--");
    mgSet("k3-latest-meta", latest ? `${mgEsc(latest.issueNumber)} · Sum ${latest.sum} · ${latest.size} · ${latest.oddEven}` : "暂无开奖", true);
    mgSet("k3-prediction", p.dice?.length ? mgBalls(p.dice) : "等待真实数据");
    mgSet("k3-confidence", `统计信心 ${Number(p.confidence || 0)}%`, true);
    mgSet("k3-target", p.issueNumber || state?.current_issue?.issueNumber || "--", true);
    const dc = p.detailConfidence?.dice || [];
    mgSet("k3-prediction-grid", p.dice?.length ? [
        mgTile("三骰预测", mgBalls(p.dice), `位置置信 ${dc.map(x => `${x}%`).join(" / ")}`),
        mgTile("大小", mgTag(p.size), `置信 ${p.detailConfidence?.size ?? "--"}%`),
        mgTile("单双", mgTag(p.oddEven), `置信 ${p.detailConfidence?.oddEven ?? "--"}%`),
        mgTile("Sum 区间", mgEsc(p.sumRange || "--"), `预测 Sum ${p.sum ?? "--"} · 置信 ${p.detailConfidence?.sumRange ?? "--"}%`)
    ].join("") : "");
    mgSet("k3-review", mgReviewTable("k3", state?.reviews));
    const history = state?.draws || [];
    mgSet("k3-history", history.length ? `<div class="multi-row header"><span>期号</span><span>骰子</span><span>Sum</span><span>分类</span></div>` + history.slice(0, 15).map(d => `<div class="multi-row"><span>${mgEsc(d.issueNumber)}</span><span>${mgEsc(d.premium)}</span><span>${d.sum}</span><span>${mgTag(d.size)} ${mgTag(d.oddEven)} · ${mgEsc(d.sumRange)}</span></div>`).join("") : `<div class="multi-empty">暂无 K3 历史</div>`);
}

function render5DState(state, data) {
    mgStatus("5d", state, data);
    const latest = state?.draws?.[0];
    const p = state?.prediction || {};
    mgSet("5d-latest", latest ? mgBalls(latest.digits) : "--");
    mgSet("5d-latest-meta", latest ? `${mgEsc(latest.issueNumber)} · Sum ${latest.sum}` : "暂无开奖", true);
    mgSet("5d-prediction", p.digits?.length ? mgBalls(p.digits) : "等待真实数据");
    mgSet("5d-confidence", `统计信心 ${Number(p.confidence || 0)}%`, true);
    mgSet("5d-target", p.issueNumber || state?.current_issue?.issueNumber || "--", true);
    const labels = ["A", "B", "C", "D", "E"];
    mgSet("5d-prediction-grid", p.digits?.length ? p.digits.map((n, i) => mgTile(`${labels[i]} 位`, `<span class="num-ball">${n}</span>`, `${mgTag(p.sizeByPosition?.[i])} ${mgTag(p.oddEvenByPosition?.[i])} · ${p.detailConfidence?.[i] ?? "--"}%`)).join("") : "");
    mgSet("5d-review", mgReviewTable("5d", state?.reviews));
    const history = state?.draws || [];
    mgSet("5d-history", history.length ? `<div class="multi-row header"><span>期号</span><span>号码</span><span>Sum</span><span>A-E 大小/单双</span></div>` + history.slice(0, 15).map(d => `<div class="multi-row"><span>${mgEsc(d.issueNumber)}</span><span>${mgEsc(d.premium)}</span><span>${d.sum}</span><span>${d.digits.map((_,i)=>`${d.sizeByPosition[i]}${d.oddEvenByPosition[i]}`).join(" · ")}</span></div>`).join("") : `<div class="multi-empty">暂无 5D 历史</div>`);
}

function renderTrxState(state, data) {
    mgStatus("trx", state, data);
    const latest = state?.draws?.[0];
    const p = state?.prediction || {};
    mgSet("trx-latest", latest ? `<span class="num-ball">${latest.number}</span>` : "--");
    mgSet("trx-latest-meta", latest ? `${mgEsc(latest.issueNumber)} · ${latest.size} · ${latest.colour}` : "暂无开奖", true);
    mgSet("trx-prediction", Number.isInteger(p.number) ? `<span class="num-ball">${p.number}</span> ${mgTag(p.size)} ${mgTag(p.colour)}` : "等待真实数据");
    mgSet("trx-confidence", `统计信心 ${Number(p.confidence || 0)}%`, true);
    mgSet("trx-target", p.issueNumber || state?.current_issue?.issueNumber || "--", true);
    mgSet("trx-prediction-grid", Number.isInteger(p.number) ? [
        mgTile("号码", `<span class="num-ball">${p.number}</span>`, `置信 ${p.detailConfidence?.number ?? "--"}%`),
        mgTile("大小", mgTag(p.size), `置信 ${p.detailConfidence?.size ?? "--"}%`),
        mgTile("颜色", mgTag(p.colour), `置信 ${p.detailConfidence?.colour ?? "--"}%`),
        mgTile("算法", mgEsc(p.method || "统计模型"), "每期固定输出")
    ].join("") : "");
    mgSet("trx-review", mgReviewTable("trx", state?.reviews));
    const history = state?.draws || [];
    mgSet("trx-history", history.length ? `<div class="multi-row header"><span>期号</span><span>号码</span><span>大小/颜色</span><span>Block</span></div>` + history.slice(0, 15).map(d => `<div class="multi-row"><span>${mgEsc(d.issueNumber)}</span><span><span class="num-ball">${d.number}</span></span><span>${mgTag(d.size)} ${mgTag(d.colour)}</span><span>${mgEsc(d.blockNumber || "-")}</span></div>`).join("") : `<div class="multi-empty">暂无 TRX 历史</div>`);
}

let multiGameRefreshRunning = false;
async function refreshMultiGames() {
    if (multiGameRefreshRunning) return;
    multiGameRefreshRunning = true;
    try {
        snapshotLoadedAt = 0;
        const data = await loadDashboardSnapshot();
        renderK3State(data.k3 || {}, data);
        render5DState(data["5d"] || {}, data);
        renderTrxState(data.trx || {}, data);
    } catch (error) {
        console.warn("Multi-game refresh error:", error);
        ["k3","5d","trx"].forEach(g => mgSet(`${g}-data-status`, "读取 data.json 失败，保留上次显示。", true));
    } finally {
        multiGameRefreshRunning = false;
    }
}

setInterval(refreshMultiGames, 3000);
setTimeout(refreshMultiGames, 250);
