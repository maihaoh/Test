const WORKER_URL =
    "https://rapid-disk-cfwingo-api.j05stm24f008.workers.dev";

let myChart = null;
let countdownVal = 5;
let currentBaccaratTable = "D51";


/* =====================================================
   AI SMART LEARNING
===================================================== */

const AI_LEARNING_KEY = "wingo_ai_learning";

const DEFAULT_AI_LEARNING = {
    version: 1,

    weights: {
        markov: 1.00,
        mean: 1.00,
        streak: 0.80,
        frequency: 0.70,
        balance: 0.60
    },

    passThreshold: 0.85,

    stats: {
        win: 0,
        loss: 0,
        pass: 0,
        passCorrect: 0,
        passMissed: 0
    },

    factorStats: {
        markov: {
            correct: 0,
            wrong: 0
        },
        mean: {
            correct: 0,
            wrong: 0
        },
        streak: {
            correct: 0,
            wrong: 0
        },
        frequency: {
            correct: 0,
            wrong: 0
        },
        balance: {
            correct: 0,
            wrong: 0
        }
    },

    reviews: [],

    lastReviewedIssue: null
};


let aiLearning = loadAILearning();


function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );
}


function cloneObject(obj) {

    return JSON.parse(
        JSON.stringify(obj)
    );
}


function loadAILearning() {

    try {

        const saved =
            localStorage.getItem(
                AI_LEARNING_KEY
            );

        if (!saved) {

            return cloneObject(
                DEFAULT_AI_LEARNING
            );
        }

        const parsed =
            JSON.parse(saved);

        const base =
            cloneObject(
                DEFAULT_AI_LEARNING
            );

        return {

            ...base,

            ...parsed,

            weights: {
                ...base.weights,
                ...(parsed.weights || {})
            },

            stats: {
                ...base.stats,
                ...(parsed.stats || {})
            },

            factorStats: {
                ...base.factorStats,
                ...(parsed.factorStats || {})
            },

            reviews:
                Array.isArray(parsed.reviews)
                    ? parsed.reviews
                    : []

        };

    } catch (e) {

        console.warn(
            "AI learning data load failed",
            e
        );

        return cloneObject(
            DEFAULT_AI_LEARNING
        );
    }
}


function saveAILearning() {

    try {

        localStorage.setItem(
            AI_LEARNING_KEY,
            JSON.stringify(aiLearning)
        );

    } catch (e) {

        console.warn(
            "AI learning data save failed",
            e
        );
    }
}


/* =====================================================
   CLOCK
===================================================== */

function updateMYTClock() {

    const now = new Date();

    const options = {
        timeZone: "Asia/Kuala_Lumpur",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    };

    document.getElementById("myt-clock").innerText =
        new Intl.DateTimeFormat(
            "en-GB",
            options
        ).format(now);
}

updateMYTClock();

setInterval(updateMYTClock, 1000);


/* =====================================================
   MAIN TAB
===================================================== */

function switchMainTab(tab, element) {

    document
        .querySelectorAll(".main-tab")
        .forEach(btn => {
            btn.classList.remove("active");
        });

    element.classList.add("active");

    document
        .querySelectorAll(".main-section")
        .forEach(section => {
            section.classList.remove("active");
        });

    if (tab === "wingo") {

        document
            .getElementById("wingo-section")
            .classList.add("active");

    } else {

        document
            .getElementById("baccarat-section")
            .classList.add("active");

        renderBaccarat(currentBaccaratTable);
    }
}


/* =====================================================
   WINGO NUMBER ICON
===================================================== */

function getNumberIconHtml(num, large = false) {

    num = parseInt(num);

    let colorClass = "";

    if (num === 0) {

        colorClass = "bg-red-purple";

    } else if (num === 5) {

        colorClass = "bg-green-purple";

    } else if ([1, 3, 7, 9].includes(num)) {

        colorClass = "bg-green";

    } else if ([2, 4, 6, 8].includes(num)) {

        colorClass = "bg-red";
    }

    return `
        <span class="${
            large
                ? "prediction-number"
                : "icon-num"
        } ${colorClass}">
            ${num}
        </span>
    `;
}


/* =====================================================
   AI FEATURE ANALYSIS
===================================================== */

function getAIFeatures(draws) {

    if (!draws || draws.length < 10) {

        return {

            markov: 0,
            mean: 0,
            streak: 0,
            frequency: 0,
            balance: 0,

            markovSize: "数据不足",
            meanSize: "数据不足",

            streakCnt: 0,

            isSpecial: false,

            lastSize: null,
            lastNum: null
        };
    }


    const nums =
        draws.map(
            d => Number(d.number)
        );

    const sizes =
        draws.map(
            d => d.size
        );


    const lastNum =
        nums[0];

    const lastSize =
        sizes[0];


    /* =================================================
       STREAK
    ================================================= */

    let streakCnt = 0;

    for (const s of sizes) {

        if (s === lastSize) {

            streakCnt++;

        } else {

            break;
        }
    }


    /* =================================================
       MARKOV
    ================================================= */

    const transitionCounts =
        Array(10).fill(0);

    for (
        let i = 0;
        i < nums.length - 1;
        i++
    ) {

        if (
            nums[i + 1] === lastNum
        ) {

            transitionCounts[nums[i]]++;
        }
    }

    const maxTransition =
        Math.max(
            ...transitionCounts
        );

    let markovBestNum = null;

    let markovSize = "平";

    if (maxTransition > 0) {

        markovBestNum =
            transitionCounts.indexOf(
                maxTransition
            );

        markovSize =
            markovBestNum >= 5
                ? "大"
                : "小";
    }


    /* =================================================
       MEAN REVERSION
    ================================================= */

    const recent10 =
        nums.slice(0, 10);

    const big10 =
        recent10.filter(
            n => n >= 5
        ).length;

    let meanSize = "平";

    if (big10 >= 7) {

        meanSize = "小";

    } else if (big10 <= 3) {

        meanSize = "大";
    }


    /* =================================================
       FREQUENCY
    ================================================= */

    const recent20 =
        nums.slice(
            0,
            Math.min(20, nums.length)
        );

    const big20 =
        recent20.filter(
            n => n >= 5
        ).length;

    const frequencyRate =
        recent20.length
            ? big20 / recent20.length
            : 0.5;

    let frequency =
        (frequencyRate - 0.5) * 2;

    frequency =
        clamp(
            frequency,
            -1,
            1
        );


    /* =================================================
       BALANCE
    ================================================= */

    const recent50 =
        nums.slice(
            0,
            Math.min(50, nums.length)
        );

    const big50 =
        recent50.filter(
            n => n >= 5
        ).length;

    const big50Rate =
        recent50.length
            ? big50 / recent50.length
            : 0.5;


    /*
       如果长期大明显过多
       → 小方向稍微增加

       如果长期小明显过多
       → 大方向稍微增加
    */

    let balance = 0;

    if (big50Rate >= 0.60) {

        balance =
            -(big50Rate - 0.50) * 2.5;

    } else if (big50Rate <= 0.40) {

        balance =
            (0.50 - big50Rate) * 2.5;
    }

    balance =
        clamp(
            balance,
            -1,
            1
        );


    /* =================================================
       STREAK
    ================================================= */

    let streak = 0;

    if (streakCnt >= 3) {

        /*
           不让长龙直接决定方向。
           这里只给轻微延续信号。
        */

        streak =
            lastSize === "大"
                ? 0.35
                : -0.35;

    } else if (streakCnt === 2) {

        streak =
            lastSize === "大"
                ? 0.15
                : -0.15;
    }


    /* =================================================
       MARKOV NORMALIZED
    ================================================= */

    let markov = 0;

    if (markovSize === "大") {

        markov = 1;

    } else if (markovSize === "小") {

        markov = -1;
    }


    /* =================================================
       MEAN NORMALIZED
    ================================================= */

    let mean = 0;

    if (meanSize === "大") {

        mean = 1;

    } else if (meanSize === "小") {

        mean = -1;
    }


    /* =================================================
       SPECIAL
    ================================================= */

    const isSpecial =
        lastNum === 0 ||
        lastNum === 5;


    return {

        markov,
        mean,
        streak,
        frequency,
        balance,

        markovSize,
        meanSize,

        streakCnt,

        isSpecial,

        lastSize,
        lastNum,

        transitionCounts,
        maxTransition
    };
}


/* =====================================================
   SMART PREDICTOR
===================================================== */

function getPredictionForDraw(draws) {

    if (!draws || draws.length < 10) {

        return {

            num: null,
            size: null,
            signal: "观望",
            confidence: "低",

            bigScore: 0,
            smallScore: 0,

            streakCnt: 0,

            markovSize: "数据不足",
            meanSize: "数据不足",

            isSpecial: false,

            weightedScore: 0,
            passThreshold:
                aiLearning.passThreshold,

            features: null,

            factorContributions: {}
        };
    }


    const nums =
        draws.map(
            d => Number(d.number)
        );


    const features =
        getAIFeatures(draws);


    /*
       AI 权重
    */

    const weights =
        aiLearning.weights;


    const factorContributions = {

        markov:
            features.markov *
            weights.markov,

        mean:
            features.mean *
            weights.mean,

        streak:
            features.streak *
            weights.streak,

        frequency:
            features.frequency *
            weights.frequency,

        balance:
            features.balance *
            weights.balance
    };


    /*
       总方向分数

       正数 = 大
       负数 = 小
    */

    let weightedScore =

        factorContributions.markov +

        factorContributions.mean +

        factorContributions.streak +

        factorContributions.frequency +

        factorContributions.balance;


    /*
       Special 0 / 5 不直接 PASS。

       只增加一点安全门槛。
    */

    let passThreshold =
        aiLearning.passThreshold;


    if (features.isSpecial) {

        passThreshold += 0.15;
    }


    /*
       PASS
    */

    let finalSize = null;

    let signal = "观望";

    let confidence = "低";


    if (
        Math.abs(weightedScore) <
        passThreshold
    ) {

        signal = "观望";

        confidence = "避险";

    } else {

        finalSize =
            weightedScore > 0
                ? "大"
                : "小";

        signal = "BUY";

        const strength =
            Math.abs(weightedScore);

        if (strength >= 2.4) {

            confidence = "🔥高确信";

        } else if (strength >= 1.55) {

            confidence = "较强";

        } else {

            confidence = "普通";
        }
    }


    /* =================================================
       TARGET NUMBER
    ================================================= */

    let targetNum = null;


    if (finalSize) {

        const start =
            finalSize === "大"
                ? 5
                : 0;

        const end =
            finalSize === "大"
                ? 10
                : 5;


        let maxScore = -1;


        /*
           Markov
        */

        for (
            let i = start;
            i < end;
            i++
        ) {

            const score =
                features.transitionCounts[i];

            if (
                score > maxScore
            ) {

                maxScore = score;

                targetNum = i;
            }
        }


        /*
           没有 Markov 数据
           → 使用历史频率
        */

        if (
            features.maxTransition === 0
        ) {

            const freq =
                Array(10).fill(0);

            nums.forEach(n => {

                freq[n]++;
            });


            maxScore = -1;


            for (
                let i = start;
                i < end;
                i++
            ) {

                if (
                    freq[i] >
                    maxScore
                ) {

                    maxScore =
                        freq[i];

                    targetNum = i;
                }
            }
        }
    }


    /*
       大 / 小 score
       保留给原本 UI 使用
    */

    const bigScore =
        Math.max(
            0,
            weightedScore
        );

    const smallScore =
        Math.max(
            0,
            -weightedScore
        );


    return {

        num: targetNum,

        size: finalSize,

        signal,

        confidence,

        bigScore,
        smallScore,

        streakCnt:
            features.streakCnt,

        markovSize:
            features.markovSize,

        meanSize:
            features.meanSize,

        isSpecial:
            features.isSpecial,

        weightedScore,

        passThreshold,

        features,

        factorContributions
    };
}


/* =====================================================
   COUNTERFACTUAL PASS
===================================================== */

function getCounterfactualPrediction(
    prediction
) {

    if (!prediction) {

        return null;
    }


    /*
       PASS 如果强制下注：

       正分 → 大
       负分 → 小

       不能因为 PASS 就没有结果。
    */

    let score =
        prediction.weightedScore;


    if (score === 0) {

        return {
            size: null,
            signal: "PASS"
        };
    }


    return {

        size:
            score > 0
                ? "大"
                : "小",

        signal: "FORCED"
    };
}


/* =====================================================
   AI FACTOR LEARNING
===================================================== */

function learnFromOutcome(
    prediction,
    actual,
    outcome,
    counterfactual = null
) {

    if (
        !prediction ||
        !prediction.features ||
        !actual
    ) {

        return {
            changes: []
        };
    }


    const actualDirection =
        actual.size === "大"
            ? 1
            : -1;


    const features =
        prediction.features;


    const factorNames = [
        "markov",
        "mean",
        "streak",
        "frequency",
        "balance"
    ];


    const learningRate =
        0.035;


    const changes = [];


    /*
       WIN / LOSS 学习

       因子方向正确
       → 权重稍微增加

       因子方向错误
       → 权重稍微减少

       不会一次大幅修改。
    */

    factorNames.forEach(
        factor => {

            const value =
                Number(
                    features[factor] || 0
                );


            if (
                Math.abs(value) <
                0.08
            ) {

                return;
            }


            const oldWeight =
                aiLearning.weights[
                    factor
                ];


            const factorDirection =
                value > 0
                    ? 1
                    : -1;


            const aligned =
                factorDirection ===
                actualDirection;


            let delta =
                learningRate *
                Math.abs(value);


            if (
                outcome === "LOSS"
            ) {

                /*
                   LOSS：

                   错误方向的因素
                   → 明显降低

                   正确方向的因素
                   → 保留 / 小幅提高
                */

                delta =
                    aligned
                        ? delta * 0.45
                        : -delta;

            } else {

                /*
                   WIN：

                   正确因素增加
                   错误因素轻微下降
                */

                delta =
                    aligned
                        ? delta
                        : -delta * 0.45;
            }


            const newWeight =
                clamp(
                    oldWeight + delta,
                    0.35,
                    1.65
                );


            aiLearning.weights[
                factor
            ] = newWeight;


            if (aligned) {

                aiLearning.factorStats[
                    factor
                ].correct++;

            } else {

                aiLearning.factorStats[
                    factor
                ].wrong++;
            }


            if (
                Math.abs(
                    newWeight -
                    oldWeight
                ) >= 0.005
            ) {

                changes.push({

                    factor,

                    old:
                        oldWeight,

                    new:
                        newWeight,

                    delta:
                        newWeight -
                        oldWeight
                });
            }
        }
    );


    /*
       PASS 专门学习

       PASS + 强制下注 WIN
       → PASS 太保守
       → threshold 稍微下降

       PASS + 强制下注 LOSS
       → PASS 有价值
       → threshold 稍微增加
    */

    if (
        outcome === "PASS" &&
        counterfactual
    ) {

        if (
            counterfactual ===
            "WIN"
        ) {

            const oldThreshold =
                aiLearning.passThreshold;

            aiLearning.passThreshold =
                clamp(
                    aiLearning.passThreshold -
                    0.015,
                    0.55,
                    1.20
                );


            changes.push({

                factor:
                    "PASS阈值",

                old:
                    oldThreshold,

                new:
                    aiLearning.passThreshold,

                delta:
                    aiLearning.passThreshold -
                    oldThreshold
            });

        } else if (
            counterfactual ===
            "LOSS"
        ) {

            const oldThreshold =
                aiLearning.passThreshold;

            aiLearning.passThreshold =
                clamp(
                    aiLearning.passThreshold +
                    0.015,
                    0.55,
                    1.20
                );


            changes.push({

                factor:
                    "PASS阈值",

                old:
                    oldThreshold,

                new:
                    aiLearning.passThreshold,

                delta:
                    aiLearning.passThreshold -
                    oldThreshold
            });
        }
    }


    return {
        changes
    };
}


/* =====================================================
   REVIEW ONE DRAW
===================================================== */

function processNewAIReview(
    prediction,
    actual
) {

    if (
        !prediction ||
        !actual
    ) {

        return null;
    }


    const isBuy =
        prediction.signal === "BUY" &&
        prediction.size !== null;


    let outcome =
        "PASS";


    let counterfactual =
        null;


    if (isBuy) {

        outcome =
            prediction.size ===
            actual.size
                ? "WIN"
                : "LOSS";

    } else {

        const forced =
            getCounterfactualPrediction(
                prediction
            );


        if (
            forced &&
            forced.size
        ) {

            counterfactual =
                forced.size ===
                actual.size
                    ? "WIN"
                    : "LOSS";
        }
    }


    /*
       统计
    */

    if (outcome === "WIN") {

        aiLearning.stats.win++;

    } else if (
        outcome === "LOSS"
    ) {

        aiLearning.stats.loss++;

    } else {

        aiLearning.stats.pass++;

        if (
            counterfactual ===
            "WIN"
        ) {

            aiLearning.stats.passMissed++;

        } else if (
            counterfactual ===
            "LOSS"
        ) {

            aiLearning.stats.passCorrect++;
        }
    }


    /*
       学习
    */

    const learning =
        learnFromOutcome(
            prediction,
            actual,
            outcome,
            counterfactual
        );


    /*
       保存复盘
    */

    const review = {

        issue:
            actual.issueNumber,

        actualNumber:
            actual.number,

        actualSize:
            actual.size,

        predictionSize:
            prediction.size,

        predictionNumber:
            prediction.num,

        signal:
            prediction.signal,

        outcome,

        counterfactual,

        weightedScore:
            Number(
                prediction.weightedScore
            .toFixed(3)
            ),

        passThreshold:
            Number(
                prediction.passThreshold
                .toFixed(3)
            ),

        factors: {

            markov:
                Number(
                    prediction.features.markov
                    .toFixed(3)
                ),

            mean:
                Number(
                    prediction.features.mean
                    .toFixed(3)
                ),

            streak:
                Number(
                    prediction.features.streak
                    .toFixed(3)
                ),

            frequency:
                Number(
                    prediction.features.frequency
                    .toFixed(3)
                ),

            balance:
                Number(
                    prediction.features.balance
                    .toFixed(3)
                )
        },

        weightChanges:
            learning.changes,

        time:
            Date.now()
    };


    aiLearning.reviews.unshift(
        review
    );


    /*
       只保留最近 100 次学习
    */

    if (
        aiLearning.reviews.length >
        100
    ) {

        aiLearning.reviews =
            aiLearning.reviews.slice(
                0,
                100
            );
    }


    saveAILearning();


    return review;
}


/* =====================================================
   LIVE REVIEW PROTECTION
===================================================== */

function reviewLatestCompletedRound(
    draws
) {

    if (
        !draws ||
        draws.length < 11
    ) {

        return null;
    }


    /*
       draws[0] = 最新开奖

       draws[1] = 刚刚可以复盘的开奖

       draws[2...] = 当时预测时真正可看到的历史
    */

    const actual =
        draws[1];


    if (!actual) {
        return null;
    }


    /*
       防止每 5 秒重复学习同一期
    */

    if (
        aiLearning.lastReviewedIssue ===
        actual.issueNumber
    ) {

        return null;
    }


    const history =
        draws.slice(2);


    const prediction =
        getPredictionForDraw(
            history
        );


    const review =
        processNewAIReview(
            prediction,
            actual
        );


    aiLearning.lastReviewedIssue =
        actual.issueNumber;


    saveAILearning();


    return review;
}


/* =====================================================
   AI REVIEW DISPLAY
===================================================== */

function renderAIReview(draws) {

    if (
        !draws ||
        draws.length < 11
    ) {

        return;
    }


    /*
       先学习新的完成局
    */

    const newReview =
        reviewLatestCompletedRound(
            draws
        );


    const previousActual =
        draws[1];


    const previousHistory =
        draws.slice(2);


    const previousPrediction =
        getPredictionForDraw(
            previousHistory
        );


    const statusEl =
        document.getElementById(
            "review-status"
        );

    const predictionEl =
        document.getElementById(
            "review-prediction"
        );

    const actualEl =
        document.getElementById(
            "review-actual"
        );

    const resultEl =
        document.getElementById(
            "review-result"
        );

    const messageEl =
        document.getElementById(
            "review-message"
        );


    /*
       当前复盘结果
    */

    let review =
        newReview;


    /*
       如果刚才已经学习过
       从记录里面找到
    */

    if (!review) {

        review =
            aiLearning.reviews.find(
                item =>
                    item.issue ===
                    previousActual.issueNumber
            );
    }


    /*
       没有记录时
       根据现场计算
    */

    if (!review) {

        const forced =
            getCounterfactualPrediction(
                previousPrediction
            );


        if (
            previousPrediction.signal ===
            "BUY"
        ) {

            review = {

                outcome:
                    previousActual.size ===
                    previousPrediction.size
                        ? "WIN"
                        : "LOSS",

                counterfactual:
                    null
            };

        } else {

            review = {

                outcome:
                    "PASS",

                counterfactual:
                    forced &&
                    forced.size ===
                    previousActual.size
                        ? "WIN"
                        : "LOSS"
            };
        }
    }


    /*
       预测显示
    */

    if (
        previousPrediction.signal ===
        "BUY" &&
        previousPrediction.num !== null
    ) {

        predictionEl.innerHTML =
            `
            ${getNumberIconHtml(
                previousPrediction.num,
                true
            )}

            <span style="margin-left:8px;">
                ${previousPrediction.size}
            </span>
            `;

    } else {

        predictionEl.innerHTML =
            `
            <span class="tag-wait">
                PASS
            </span>
            `;
    }


    actualEl.innerHTML =
        `
        ${getNumberIconHtml(
            previousActual.number,
            true
        )}

        <span style="margin-left:8px;">
            ${previousActual.size}
        </span>
        `;


    /* =================================================
       WIN
    ================================================= */

    if (
        review.outcome ===
        "WIN"
    ) {

        statusEl.className =
            "review-status review-win";

        statusEl.innerText =
            "✅ WIN";


        resultEl.innerHTML =
            '<span class="tag-win">预测成功</span>';


        const factors =
            getFactorReviewText(
                previousPrediction,
                previousActual
            );


        messageEl.innerHTML =
            `
            <b style="color:#34d399;">
                ✓ AI 这次预测正确
            </b>

            <br>

            实际：
            ${previousActual.number}
            (${previousActual.size})

            ／

            预测：
            ${previousPrediction.num}
            (${previousPrediction.size})

            <br><br>

            <b>智能复盘：</b>
            <br>
            ${factors}

            <br>

            <b style="color:#60a5fa;">
                🧠 AI 已记录这次成功组合，
                正确因素权重小幅增加。
            </b>
            `;
    }


    /* =================================================
       LOSS
    ================================================= */

    else if (
        review.outcome ===
        "LOSS"
    ) {

        statusEl.className =
            "review-status review-loss";

        statusEl.innerText =
            "❌ LOSS";


        resultEl.innerHTML =
            '<span class="tag-loss">预测错误</span>';


        const reasons =
            getLossReasons(
                previousPrediction,
                previousActual
            );


        const learned =
            review.weightChanges &&
            review.weightChanges.length
                ? review.weightChanges
                : [];


        let learningText =
            "AI 暂未需要大幅调整。";


        if (
            learned.length
        ) {

            learningText =
                learned
                    .slice(0, 3)
                    .map(
                        change => {

                            const delta =
                                change.delta >= 0
                                    ? "+"
                                    : "";

                            return `
                                ${change.factor}
                                ${delta}${change.delta.toFixed(3)}
                            `;
                        }
                    )
                    .join(" ／ ");
        }


        messageEl.innerHTML =
            `
            <b style="color:#f87171;">
                ❌ 本期预测没有命中。
            </b>

            <br>

            实际：
            ${previousActual.number}
            (${previousActual.size})

            ／

            预测：
            ${previousPrediction.num}
            (${previousPrediction.size})

            <br><br>

            <b>AI 反省：</b>
            <br>
            ${reasons}

            <br>

            <b style="color:#fbbf24;">
                🧠 学习调整：
            </b>
            <br>
            ${learningText}

            <br><br>

            不追上一期方向，
            下一期重新计算全部因素。
            `;
    }


    /* =================================================
       PASS
    ================================================= */

    else {

        statusEl.className =
            "review-status review-wait";

        statusEl.innerText =
            "⏸️ PASS / AI 复盘";


        resultEl.innerHTML =
            '<span class="tag-wait">PASS</span>';


        const forced =
            getCounterfactualPrediction(
                previousPrediction
            );


        if (
            forced &&
            forced.size
        ) {

            const counterResult =
                forced.size ===
                previousActual.size
                    ? "WIN"
                    : "LOSS";


            if (
                counterResult ===
                "WIN"
            ) {

                messageEl.innerHTML =
                    `
                    <b style="color:#fbbf24;">
                        ⏸️ AI 本期选择 PASS
                    </b>

                    <br>

                    实际：
                    ${previousActual.number}
                    (${previousActual.size})

                    <br><br>

                    <b>如果强制下注：</b>
                    ${forced.size}

                    <br>

                    结果：
                    <span class="tag-win">
                        ✅ WIN
                    </span>

                    <br><br>

                    <b style="color:#60a5fa;">
                        🧠 AI 反省：
                    </b>

                    PASS 可能过于保守。
                    已记录为一次
                    <b>PASS 错过机会</b>，
                    PASS 阈值会轻微调整。
                    `;

            } else {

                messageEl.innerHTML =
                    `
                    <b style="color:#fbbf24;">
                        ⏸️ AI 本期选择 PASS
                    </b>

                    <br>

                    实际：
                    ${previousActual.number}
                    (${previousActual.size})

                    <br><br>

                    <b>如果强制下注：</b>
                    ${forced.size}

                    <br>

                    结果：
                    <span class="tag-loss">
                        ❌ LOSS
                    </span>

                    <br><br>

                    <b style="color:#34d399;">
                        🧠 AI 反省：
                    </b>

                    这次 PASS 是有效的，
                    避免了一次错误下注。
                    PASS 阈值会保留，
                    不会强行增加交易次数。
                    `;
            }

        } else {

            messageEl.innerHTML =
                `
                <b style="color:#fbbf24;">
                    ⏸️ PASS
                </b>

                <br>
                当前信号差距太小，
                AI 没有足够优势。

                <br><br>

                这次 PASS
                不会被当成没有发生，
                系统会继续记录并学习。
                `;
        }
    }
}


/* =====================================================
   FACTOR REVIEW
===================================================== */

function getFactorReviewText(
    prediction,
    actual
) {

    if (
        !prediction ||
        !prediction.features
    ) {

        return "暂无因素数据";
    }


    const actualDirection =
        actual.size === "大"
            ? 1
            : -1;


    const names = {

        markov: "Markov",

        mean: "均值回归",

        streak: "长龙",

        frequency: "近期频率",

        balance: "50期平衡"
    };


    const factors = [
        "markov",
        "mean",
        "streak",
        "frequency",
        "balance"
    ];


    return factors
        .map(
            factor => {

                const value =
                    prediction.features[
                        factor
                    ] || 0;


                if (
                    Math.abs(value) <
                    0.08
                ) {

                    return `
                        <span style="color:#64748b;">
                            ○ ${names[factor]} 中性
                        </span>
                    `;
                }


                const direction =
                    value > 0
                        ? 1
                        : -1;


                const correct =
                    direction ===
                    actualDirection;


                return `
                    <span style="
                        color:${
                            correct
                                ? "#34d399"
                                : "#f87171"
                        };
                    ">
                        ${
                            correct
                                ? "✓"
                                : "✗"
                        }
                        ${names[factor]}
                    </span>
                `;
            }
        )
        .join("<br>");
}


/* =====================================================
   LOSS REASONS
===================================================== */

function getLossReasons(
    prediction,
    actual
) {

    if (
        !prediction ||
        !prediction.features
    ) {

        return "数据不足";
    }


    const actualDirection =
        actual.size === "大"
            ? 1
            : -1;


    const reasons = [];


    const names = {

        markov: "Markov",

        mean: "均值回归",

        streak: "长龙",

        frequency: "近期频率",

        balance: "50期平衡"
    };


    const factors = [
        "markov",
        "mean",
        "streak",
        "frequency",
        "balance"
    ];


    factors.forEach(
        factor => {

            const value =
                prediction.features[
                    factor
                ] || 0;


            if (
                Math.abs(value) <
                0.15
            ) {

                return;
            }


            const direction =
                value > 0
                    ? 1
                    : -1;


            if (
                direction !==
                actualDirection
            ) {

                reasons.push(
                    `${names[factor]} 本次方向错误`
                );
            }
        }
    );


    if (
        prediction.features.streakCnt >= 3
    ) {

        reasons.push(
            "长龙因素可能造成过度追随"
        );
    }


    if (
        reasons.length === 0
    ) {

        reasons.push(
            "多个因素同时出现短期失效"
        );
    }


    return reasons
        .map(
            x =>
                "• " + x
        )
        .join("<br>");
}


/* =====================================================
   FETCH
===================================================== */

async function fetchDraws() {

    const random =
        Array.from(
            { length: 32 },
            () =>
                Math.floor(
                    Math.random() * 16
                ).toString(16)
        ).join("");

    const timestamp =
        Math.floor(
            Date.now() / 1000
        );

    const signObj = {

        "language": 0,

        "pageNo": 1,

        "pageSize": 60,

        "random": random,

        "typeId": 30
    };

    const jsonSignStr =
        JSON.stringify(signObj);

    const signature =
        CryptoJS.MD5(
            jsonSignStr
        ).toString()
        .toUpperCase();

    const payload = {

        "typeId": 30,

        "pageNo": 1,

        "pageSize": 60,

        "language": 0,

        "random": random,

        "signature": signature,

        "timestamp": timestamp
    };

    try {

        const response =
            await fetch(
                WORKER_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        const json =
            await response.json();

        if (
            json.code === 0 &&
            json.data &&
            json.data.list
        ) {

            return json.data.list.map(
                item => {

                    const num =
                        parseInt(
                            item.number
                        );

                    return {

                        issueNumber:
                            String(
                                item.issueNumber
                            ),

                        number: num,

                        size:
                            num >= 5
                                ? "大"
                                : "小",

                        colour:
                            item.colour
                    };
                }
            );
        }

    } catch (e) {

        console.error(
            "Worker 请求解析失败",
            e
        );
    }

    return [];
}


/* =====================================================
   WINGO REFRESH
===================================================== */

async function refreshDashboard() {

    const draws =
        await fetchDraws();

    if (
        !draws ||
        draws.length === 0
    ) {

        return;
    }


    const latest =
        draws[0];


    document
        .getElementById(
            "latest-issue"
        )
        .innerText =
        latest.issueNumber.slice(-4);


    document
        .getElementById(
            "latest-result"
        )
        .innerHTML = `
            ${getNumberIconHtml(
                latest.number
            )}

            <span class="${
                latest.size === "大"
                    ? "tag-big"
                    : "tag-small"
            }">
                ${latest.size}
            </span>
        `;


    const nextPrediction =
        getPredictionForDraw(
            draws
        );


    /* =========================
       NEXT PREDICTION
    ========================== */

    if (
        nextPrediction.signal ===
        "BUY"
        &&
        nextPrediction.num !== null
    ) {

        document
            .getElementById(
                "predicted-result"
            )
            .innerHTML = `

                <div class="prediction-wrapper">

                    ${getNumberIconHtml(
                        nextPrediction.num,
                        true
                    )}

                    <div>

                        <div style="
                            color:#fff;
                            font-size:18px;
                            font-weight:800;
                        ">
                            ${nextPrediction.size}
                        </div>

                        <div style="
                            color:#94a3b8;
                            font-size:12px;
                            margin-top:3px;
                        ">
                            ${nextPrediction.confidence}
                        </div>

                    </div>

                </div>
            `;

    } else {

        document
            .getElementById(
                "predicted-result"
            )
            .innerHTML = `
                <span class="tag-wait">
                    PASS / 观望
                </span>
            `;
    }


    /* =========================
       ANALYSIS
    ========================== */

    document
        .getElementById(
            "analysis-streak"
        )
        .innerText =
        nextPrediction.streakCnt
        + " 连";


    document
        .getElementById(
            "analysis-markov"
        )
        .innerText =
        nextPrediction.markovSize;


    document
        .getElementById(
            "analysis-mean"
        )
        .innerText =
        nextPrediction.meanSize;


    document
        .getElementById(
            "analysis-number"
        )
        .innerHTML =
        nextPrediction.num !== null
            ? getNumberIconHtml(
                nextPrediction.num
            )
            : "--";


    const recent10 =
        draws.slice(0, 10);


    const big10 =
        recent10.filter(
            d => d.number >= 5
        ).length;


    const small10 =
        recent10.length -
        big10;


    const recent50 =
        draws.slice(0, 50);


    const big50 =
        recent50.filter(
            d => d.number >= 5
        ).length;


    const small50 =
        recent50.length -
        big50;


    const big10Rate =
        recent10.length
            ? Math.round(
                big10 /
                recent10.length *
                100
            )
            : 0;


    const small10Rate =
        recent10.length
            ? Math.round(
                small10 /
                recent10.length *
                100
            )
            : 0;


    const big50Rate =
        recent50.length
            ? Math.round(
                big50 /
                recent50.length *
                100
            )
            : 0;


    const small50Rate =
        recent50.length
            ? Math.round(
                small50 /
                recent50.length *
                100
            )
            : 0;


    document
        .getElementById(
            "analysis-big10"
        )
        .innerText =
        big10Rate + "%";


    document
        .getElementById(
            "analysis-small10"
        )
        .innerText =
        small10Rate + "%";


    document
        .getElementById(
            "analysis-big50"
        )
        .innerText =
        big50Rate + "%";


    document
        .getElementById(
            "analysis-small50"
        )
        .innerText =
        small50Rate + "%";


    /* =========================
       BIG / SMALL BAR
    ========================== */

    const scoreFill =
        document.getElementById(
            "score-fill"
        );


    scoreFill.style.width =
        big10Rate + "%";


    scoreFill.style.background =
        big10Rate >= 50
            ? "#ef4444"
            : "#3b82f6";


    document
        .getElementById(
            "score-text"
        )
        .innerText =
        `大 ${big10Rate}% / 小 ${small10Rate}%`;


    /* =========================
       AI REVIEW
    ========================== */

    renderAIReview(
        draws
    );


    /* =========================
       BACKTEST 50
    ========================== */

    let winCount = 0;
    let lossCount = 0;
    let passCount = 0;

    let passCorrectCount = 0;
    let passMissedCount = 0;

    let totalReviewed = 0;
    let totalValid = 0;

    let tableHtml = "";


    const maxRows = Math.min(
        50,
        draws.length - 10
    );


    for (
        let i = 0;
        i < maxRows;
        i++
    ) {

        const currentDraw =
            draws[i];


        const historySlice =
            draws.slice(i + 1);


        if (
            historySlice.length < 10
        ) {

            continue;
        }


        const prediction =
            getPredictionForDraw(
                historySlice
            );


        totalReviewed++;


        const isValidPrediction =
            prediction.signal === "BUY" &&
            prediction.size !== null;


        /* PASS */

        if (!isValidPrediction) {

            passCount++;


            const forced =
                getCounterfactualPrediction(
                    prediction
                );


            const forcedResult =
                forced &&
                forced.size
                    ? (
                        currentDraw.size ===
                        forced.size
                            ? "WIN"
                            : "LOSS"
                    )
                    : null;


            if (
                forcedResult ===
                "WIN"
            ) {

                passMissedCount++;

            } else if (
                forcedResult ===
                "LOSS"
            ) {

                passCorrectCount++;
            }


            tableHtml += `

                <tr>

                    <td>
                        ${currentDraw.issueNumber.slice(-4)}期
                    </td>

                    <td>

                        ${getNumberIconHtml(
                            currentDraw.number
                        )}

                        <span class="${
                            currentDraw.size === "大"
                                ? "tag-big"
                                : "tag-small"
                        }">
                            ${currentDraw.size}
                        </span>

                    </td>

                    <td>

                        ${
                            prediction.num !== null
                                ? getNumberIconHtml(
                                    prediction.num
                                )
                                : "-"
                        }

                        ${
                            prediction.size
                                ? `

                                    <span class="${
                                        prediction.size === "大"
                                            ? "tag-big"
                                            : "tag-small"
                                    }">

                                        ${prediction.size}

                                    </span>

                                `
                                : ""
                        }

                    </td>

                    <td>

                        <span class="tag-wait">
                            PASS
                        </span>

                    </td>

                    <td>

                        ${
                            forcedResult === "WIN"

                                ? `
                                    <span class="tag-win">
                                        PASS错过
                                    </span>
                                  `

                                : forcedResult === "LOSS"

                                    ? `
                                        <span class="tag-loss">
                                            PASS正确
                                        </span>
                                      `

                                    : `
                                        <span class="tag-wait">
                                            不计
                                        </span>
                                      `
                        }

                    </td>

                </tr>
            `;

            continue;
        }


        /* 有效预测 */

        totalValid++;


        const isWin =
            currentDraw.size ===
            prediction.size;


        if (isWin) {

            winCount++;

        } else {

            lossCount++;
        }


        tableHtml += `

            <tr>

                <td>
                    ${currentDraw.issueNumber.slice(-4)}期
                </td>

                <td>

                    ${getNumberIconHtml(
                        currentDraw.number
                    )}

                    <span class="${
                        currentDraw.size === "大"
                            ? "tag-big"
                            : "tag-small"
                    }">
                        ${currentDraw.size}
                    </span>

                </td>

                <td>

                    ${
                        prediction.num !== null
                            ? getNumberIconHtml(
                                prediction.num
                            )
                            : "-"
                    }

                    <span class="${
                        prediction.size === "大"
                            ? "tag-big"
                            : "tag-small"
                    }">
                        ${prediction.size}
                    </span>

                </td>

                <td>

                    <span class="tag-buy">
                        BUY
                    </span>

                </td>

                <td>

                    ${
                        isWin

                            ? `

                                <span class="tag-win">
                                    ✅ 赢
                                </span>

                              `

                            : `

                                <span class="tag-loss">
                                    ❌ 输
                                </span>

                              `
                    }

                </td>

            </tr>
        `;
    }


    /* =========================
       WIN RATE
    ========================== */

    const winRate =
        totalValid > 0

            ? (
                winCount /
                totalValid *
                100
            ).toFixed(2)

            : "0.00";


    const passQuality =
        passCount > 0
            ? (
                passCorrectCount /
                passCount *
                100
            ).toFixed(1)
            : "0.0";


    document
        .getElementById(
            "win-rate"
        )
        .innerHTML = `

        <div style="
            font-size:2rem;
            font-weight:800;
            color:#34d399;
        ">
            ${winRate}%
        </div>

        <div style="
            font-size:.8rem;
            color:#94a3b8;
            margin-top:4px;
        ">
            最近 50 局
        </div>

        <div style="
            display:flex;
            justify-content:center;
            gap:12px;
            margin-top:9px;
            font-size:.82rem;
        ">

            <span style="
                color:#10b981;
                font-weight:bold;
            ">
                WIN ${winCount}
            </span>

            <span style="
                color:#ef4444;
                font-weight:bold;
            ">
                LOSS ${lossCount}
            </span>

            <span style="
                color:#94a3b8;
                font-weight:bold;
            ">
                PASS ${passCount}
            </span>

        </div>

        <div style="
            margin-top:6px;
            font-size:.72rem;
            color:#64748b;
        ">
            有效预测 ${totalValid} 局
        </div>

        <div style="
            margin-top:5px;
            font-size:.72rem;
            color:#fbbf24;
        ">
            PASS有效率 ${passQuality}%
        </div>
    `;


    /* =========================
       UPDATE TABLE
    ========================== */

    document
        .getElementById(
            "draw-table"
        )
        .innerHTML =

        tableHtml ||

        `
            <tr>

                <td colspan="5">
                    暂无足够数据
                </td>

            </tr>
        `;
}


/* =====================================================
   BACCARAT DEMO DATA
===================================================== */

const baccaratData = {

    D51: {
        round: 128,
        history: [
            "B","B","P","P","B",
            "B","T","P","P","B",
            "P","B","B","P","P",
            "B","B","B","P","B"
        ]
    },

    D52: {
        round: 96,
        history: [
            "P","P","B","P","B",
            "B","P","P","B","B",
            "P","B","P","P","B",
            "B","P","B","B","P"
        ]
    },

    D53: {
        round: 142,
        history: [
            "B","P","B","B","P",
            "P","P","B","B","P",
            "B","B","P","B","P",
            "P","B","P","B","B"
        ]
    },

    D54: {
        round: 113,
        history: [
            "P","B","P","P","B",
            "B","B","P","P","B",
            "B","P","B","P","P",
            "B","P","B","B","P"
        ]
    },

    D55: {
        round: 87,
        history: [
            "B","B","B","P","P",
            "B","P","P","B","B",
            "P","P","B","B","P",
            "B","P","P","B","B"
        ]
    },

    D56: {
        round: 105,
        history: [
            "P","B","B","P","P",
            "P","B","P","B","B",
            "P","B","B","P","B",
            "P","P","B","B","P"
        ]
    },

    D57: {
        round: 76,
        history: [
            "B","P","P","B","B",
            "B","P","B","P","P",
            "B","B","P","P","B",
            "B","P","B","P","B"
        ]
    },

    D58: {
        round: 151,
        history: [
            "P","P","B","B","P",
            "B","B","B","P","P",
            "B","P","P","B","B",
            "P","B","P","B","B"
        ]
    }

};


/* =====================================================
   BACCARAT FUNCTIONS
===================================================== */

function switchBaccaratTable(table, element) {

    currentBaccaratTable = table;

    document
        .querySelectorAll(".baccarat-table-btn")
        .forEach(
            btn =>
                btn.classList.remove("active")
        );

    element.classList.add("active");

    renderBaccarat(table);
}


function baccaratResultName(result) {

    if (result === "B") {

        return {
            text: "庄",
            icon: "🔴",
            className: "banker-color"
        };

    }

    if (result === "P") {

        return {
            text: "闲",
            icon: "🔵",
            className: "player-color"
        };

    }

    return {
        text: "和",
        icon: "🟦",
        className: "tie-color"
    };
}


function getBaccaratStreak(history) {

    if (!history || history.length === 0) {

        return {
            type: null,
            count: 0
        };
    }

    const first = history[0];

    if (first === "T") {

        return {
            type: "T",
            count: 0
        };
    }

    let count = 0;

    for (const item of history) {

        if (item === first) {

            count++;

        } else {

            break;
        }
    }

    return {
        type: first,
        count
    };
}


function getMaxStreak(history, type) {

    let max = 0;
    let current = 0;

    for (const item of history) {

        if (item === type) {

            current++;

            max =
                Math.max(
                    max,
                    current
                );

        } else if (item !== "T") {

            current = 0;
        }
    }

    return max;
}


function predictBaccarat(history) {

    const clean =
        history.filter(
            x => x === "B" ||
                 x === "P"
        );

    const recent10 =
        clean.slice(0, 10);

    let bankerCount =
        recent10.filter(
            x => x === "B"
        ).length;

    let playerCount =
        recent10.filter(
            x => x === "P"
        ).length;

    const streak =
        getBaccaratStreak(history);

    let bankerScore = 0;
    let playerScore = 0;

    if (bankerCount > playerCount) {

        bankerScore += 1;

    } else if (playerCount > bankerCount) {

        playerScore += 1;
    }

    if (
        streak.type === "B" &&
        streak.count >= 2
    ) {

        bankerScore += .8;

    } else if (
        streak.type === "P" &&
        streak.count >= 2
    ) {

        playerScore += .8;
    }

    const last3 =
        clean.slice(0, 3);

    const last3B =
        last3.filter(
            x => x === "B"
        ).length;

    const last3P =
        last3.filter(
            x => x === "P"
        ).length;

    if (last3B > last3P) {

        bankerScore += .7;

    } else if (last3P > last3B) {

        playerScore += .7;
    }

    const difference =
        Math.abs(
            bankerScore -
            playerScore
        );

    let prediction = "PASS";

    let confidence = 0;

    if (difference >= 1.0) {

        prediction =
            bankerScore >
            playerScore
                ? "B"
                : "P";

        confidence =
            Math.min(
                85,
                55 +
                Math.round(
                    difference * 12
                )
            );

    } else {

        confidence = 50;
    }

    return {

        prediction,
        confidence,
        bankerScore,
        playerScore,
        bankerCount,
        playerCount,
        streak
    };
}


function renderBigRoad(history) {

    const container =
        document.getElementById(
            "big-road"
        );

    container.innerHTML = "";

    const display =
        history.slice(
            0,
            108
        );

    display.forEach(result => {

        const cell =
            document.createElement(
                "div"
            );

        cell.classList.add(
            "road-cell"
        );

        if (result === "B") {

            cell.classList.add(
                "road-banker"
            );

            cell.innerText = "庄";

        } else if (result === "P") {

            cell.classList.add(
                "road-player"
            );

            cell.innerText = "闲";

        } else {

            cell.classList.add(
                "road-tie"
            );

            cell.innerText = "和";
        }

        container.appendChild(cell);
    });
}


function renderSmallRoad(
    elementId,
    history,
    offset
) {

    const container =
        document.getElementById(
            elementId
        );

    container.innerHTML = "";

    const clean =
        history.filter(
            x =>
                x === "B" ||
                x === "P"
        );

    const max =
        Math.min(
            36,
            clean.length
        );

    for (
        let i = 0;
        i < max;
        i++
    ) {

        const cell =
            document.createElement(
                "div"
            );

        cell.classList.add(
            "small-cell"
        );

        const current =
            clean[i];

        const previous =
            clean[
                Math.max(
                    0,
                    i - 1
                )
            ];

        if (
            (i + offset) % 2 === 0
        ) {

            cell.classList.add(
                current === previous
                    ? "small-red"
                    : "small-blue"
            );

        } else {

            cell.classList.add(
                current === previous
                    ? "small-blue"
                    : "small-red"
            );
        }

        container.appendChild(cell);
    }
}


function renderBaccaratHistory(history) {

    const container =
        document.getElementById(
            "bc-history"
        );

    container.innerHTML = "";

    history
        .slice(0, 20)
        .forEach(result => {

            const div =
                document.createElement(
                    "div"
                );

            div.classList.add(
                "history-ball"
            );

            if (result === "B") {

                div.classList.add(
                    "history-banker"
                );

                div.innerText = "庄";

            } else if (result === "P") {

                div.classList.add(
                    "history-player"
                );

                div.innerText = "闲";

            } else {

                div.classList.add(
                    "history-tie"
                );

                div.innerText = "和";
            }

            container.appendChild(div);
        });
}


function renderBaccarat(table) {

    const data =
        baccaratData[table];

    if (!data) {
        return;
    }

    const history =
        data.history;

    const clean =
        history.filter(
            x =>
                x === "B" ||
                x === "P"
        );

    const bankerCount =
        clean.filter(
            x => x === "B"
        ).length;

    const playerCount =
        clean.filter(
            x => x === "P"
        ).length;

    const tieCount =
        history.filter(
            x => x === "T"
        ).length;

    const total =
        history.length;

    const recent10 =
        clean.slice(0, 10);

    const recent10Banker =
        recent10.filter(
            x => x === "B"
        ).length;

    const recent10Player =
        recent10.filter(
            x => x === "P"
        ).length;

    const recentTotal =
        recent10.length;

    const bankerRate =
        recentTotal
            ? Math.round(
                recent10Banker /
                recentTotal *
                100
            )
            : 0;

    const playerRate =
        recentTotal
            ? Math.round(
                recent10Player /
                recentTotal *
                100
            )
            : 0;

    const streak =
        getBaccaratStreak(history);

    const prediction =
        predictBaccarat(history);

    document
        .getElementById("bc-table-name")
        .innerText = table;

    document
        .getElementById("bc-round")
        .innerText = "#" + data.round;

    const latest =
        history[0];

    const latestInfo =
        baccaratResultName(latest);

    const latestEl =
        document.getElementById(
            "bc-latest"
        );

    latestEl.className =
        "baccarat-result " +
        latestInfo.className;

    latestEl.innerText =
        latestInfo.icon +
        " " +
        latestInfo.text;

    const streakEl =
        document.getElementById(
            "bc-streak"
        );

    if (streak.type === "B") {

        streakEl.className =
            "card-value banker-color";

        streakEl.innerText =
            "庄 " +
            streak.count +
            " 连";

    } else if (streak.type === "P") {

        streakEl.className =
            "card-value player-color";

        streakEl.innerText =
            "闲 " +
            streak.count +
            " 连";

    } else {

        streakEl.className =
            "card-value tie-color";

        streakEl.innerText =
            "和";
    }

    document
        .getElementById("big-road-title")
        .innerText =
        "📍 " +
        table +
        " 大路";

    document
        .getElementById("stats-title")
        .innerText =
        "📊 " +
        table +
        " 走势统计";

    document
        .getElementById("history-title")
        .innerText =
        "📜 " +
        table +
        " 最近20局";

    document
        .getElementById("prediction-table-name")
        .innerText =
        table;

    document
        .getElementById("eye-road-label")
        .innerText =
        table;

    document
        .getElementById("small-road-label")
        .innerText =
        table;

    document
        .getElementById("cockroach-road-label")
        .innerText =
        table;

    document
        .getElementById("bc-banker-count")
        .innerText =
        bankerCount;

    document
        .getElementById("bc-player-count")
        .innerText =
        playerCount;

    document
        .getElementById("bc-tie-count")
        .innerText =
        tieCount;

    document
        .getElementById("bc-banker-rate")
        .innerText =
        bankerRate + "%";

    document
        .getElementById("bc-player-rate")
        .innerText =
        playerRate + "%";

    document
        .getElementById("bc-current-streak")
        .innerText =
        streak.type === "B"
            ? "庄 " + streak.count
            : streak.type === "P"
                ? "闲 " + streak.count
                : "和";

    document
        .getElementById("bc-max-banker")
        .innerText =
        getMaxStreak(
            history,
            "B"
        );

    document
        .getElementById("bc-max-player")
        .innerText =
        getMaxStreak(
            history,
            "P"
        );

    document
        .getElementById("bc-total-rounds")
        .innerText =
        total;

    renderBigRoad(history);

    renderSmallRoad(
        "eye-road",
        history,
        0
    );

    renderSmallRoad(
        "small-road",
        history,
        1
    );

    renderSmallRoad(
        "cockroach-road",
        history,
        2
    );

    renderBaccaratHistory(history);

    const predictionEl =
        document.getElementById(
            "bc-prediction"
        );

    const actionEl =
        document.getElementById(
            "bc-action"
        );

    if (
        prediction.prediction ===
        "B"
    ) {

        predictionEl.className =
            "prediction-result banker-color";

        predictionEl.innerText =
            "🔴 庄";

        actionEl.className =
            "bet";

        actionEl.innerText =
            "BET";

    } else if (
        prediction.prediction ===
        "P"
    ) {

        predictionEl.className =
            "prediction-result player-color";

        predictionEl.innerText =
            "🔵 闲";

        actionEl.className =
            "bet";

        actionEl.innerText =
            "BET";

    } else {

        predictionEl.className =
            "prediction-result";

        predictionEl.innerText =
            "⚪ PASS";

        actionEl.className =
            "pass";

        actionEl.innerText =
            "PASS";
    }

    document
        .getElementById("bc-confidence")
        .innerText =
        "信心：" +
        prediction.confidence +
        "%";

    let reasonHtml = "";

    reasonHtml += `
        <div>
            ${prediction.bankerCount >
              prediction.playerCount
                ? "✓"
                : "○"}
            近10局：
            庄 ${prediction.bankerCount}
            /
            闲 ${prediction.playerCount}
        </div>
    `;

    reasonHtml += `
        <div>
            ${streak.type === "B"
                ? "✓"
                : "○"}
            当前庄连：
            ${
                streak.type === "B"
                    ? streak.count
                    : 0
            }
        </div>
    `;

    reasonHtml += `
        <div>
            ${streak.type === "P"
                ? "✓"
                : "○"}
            当前闲连：
            ${
                streak.type === "P"
                    ? streak.count
                    : 0
            }
        </div>
    `;

    reasonHtml += `
        <div>
            庄 Score：
            ${prediction.bankerScore.toFixed(1)}
        </div>
    `;

    reasonHtml += `
        <div>
            闲 Score：
            ${prediction.playerScore.toFixed(1)}
        </div>
    `;

    if (
        prediction.prediction ===
        "PASS"
    ) {

        reasonHtml += `
            <div style="color:#fbbf24;">
                ⚠️ 当前多指标分歧，系统选择观望
            </div>
        `;

    } else {

        reasonHtml += `
            <div style="color:#34d399;">
                ✓ 多指标方向达到 Demo 阈值
            </div>
        `;
    }

    document
        .getElementById("bc-reason")
        .innerHTML =
        reasonHtml +
        `
            <div class="demo-warning">
                ⚠️ 目前为 Demo 数据与示例路纸，
                不代表真实百家乐结果。
            </div>
        `;
}


/* =====================================================
   INITIALIZE
===================================================== */

renderBaccarat("D51");


/* =====================================================
   WINGO COUNTDOWN
===================================================== */

setInterval(
    () => {

        countdownVal--;

        if (
            countdownVal <= 0
        ) {

            countdownVal = 5;

            refreshDashboard();
        }

        document
            .getElementById(
                "countdown"
            )
            .innerText =
            countdownVal + "s";

    },
    1000
);


/* =====================================================
   INITIAL WINGO LOAD
===================================================== */

refreshDashboard();
