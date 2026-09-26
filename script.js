/* =========================================================
   CONFIG
========================================================= */

const WORKER_URL =
    "https://rapid-disk-cfwingo-api.j05stm24f008.workers.dev";

let myChart = null;
let countdownVal = 5;
let currentBaccaratTable = "D51";

const AI_LEARNING_KEY = "wingo_ai_learning_v2";


/* =========================================================
   AI SELF LEARNING
========================================================= */

const DEFAULT_AI_LEARNING = {
    version: 2,

    factors: {
        markov: {
            weight: 1.00,
            win: 0,
            loss: 0
        },

        mean: {
            weight: 1.00,
            win: 0,
            loss: 0
        },

        streak: {
            weight: 1.00,
            win: 0,
            loss: 0
        },

        frequency: {
            weight: 1.00,
            win: 0,
            loss: 0
        },

        balance: {
            weight: 1.00,
            win: 0,
            loss: 0
        }
    },

    stats: {
        total: 0,
        win: 0,
        loss: 0,
        pass: 0,

        passCorrect: 0,
        passMissed: 0
    },

    patterns: {
        recent: [],
        wrongPatterns: [],
        successfulPatterns: []
    },

    recentReviews: [],

    lastReviewedIssue: null,

    lastLearningMessage: "等待第一笔真实 Result 进行学习",

    confidenceBias: 0,

    passThreshold: 0.68
};


/* =========================================================
   AI STORAGE
========================================================= */

function loadAILearning() {

    try {

        const saved =
            localStorage.getItem(AI_LEARNING_KEY);

        if (!saved) {

            return structuredClone
                ? structuredClone(DEFAULT_AI_LEARNING)
                : JSON.parse(
                    JSON.stringify(DEFAULT_AI_LEARNING)
                );
        }

        const parsed = JSON.parse(saved);

        const base =
            structuredClone
                ? structuredClone(DEFAULT_AI_LEARNING)
                : JSON.parse(
                    JSON.stringify(DEFAULT_AI_LEARNING)
                );

        return deepMerge(base, parsed);

    } catch (e) {

        console.warn(
            "AI Learning Load Error:",
            e
        );

        return JSON.parse(
            JSON.stringify(DEFAULT_AI_LEARNING)
        );
    }
}


function deepMerge(base, source) {

    if (
        typeof base !== "object" ||
        base === null
    ) {
        return source;
    }

    if (
        typeof source !== "object" ||
        source === null
    ) {
        return base;
    }

    Object.keys(source).forEach(key => {

        if (
            typeof source[key] === "object" &&
            source[key] !== null &&
            !Array.isArray(source[key])
        ) {

            if (!base[key]) {
                base[key] = {};
            }

            deepMerge(
                base[key],
                source[key]
            );

        } else {

            base[key] = source[key];
        }

    });

    return base;
}


let aiLearning = loadAILearning();


function saveAILearning() {

    try {

        localStorage.setItem(
            AI_LEARNING_KEY,
            JSON.stringify(aiLearning)
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

function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );
}


function safeNumber(value) {

    const n = Number(value);

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


function getSizeFromDirection(direction) {

    return direction >= 0
        ? "大"
        : "小";
}


/* =========================================================
   MYT CLOCK
========================================================= */

function updateMYTClock() {

    const now = new Date();

    const myt =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Asia/Kuala_Lumpur",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            }
        ).format(now);

    const el =
        document.getElementById(
            "myt-time"
        );

    if (el) {
        el.textContent = myt;
    }
}


/* =========================================================
   MAIN TAB
========================================================= */

function switchMainTab(tab, button) {

    document
        .querySelectorAll(".main-section")
        .forEach(section => {

            section.classList.remove(
                "active"
            );
        });

    document
        .querySelectorAll(".main-tab")
        .forEach(btn => {

            btn.classList.remove(
                "active"
            );
        });

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
}


/* =========================================================
   NUMBER ICON
========================================================= */

function getNumberIconHtml(num) {

    const n = Number(num);

    let cls = "";

    if (n === 0) {
        cls = "number-red";
    } else if (n === 5) {
        cls = "number-green";
    } else if (n % 2 === 0) {
        cls = "number-red";
    } else {
        cls = "number-green";
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

        return {
            markov: 0,
            mean: 0,
            streak: 0,
            frequency: 0,
            balance: 0
        };
    }


    const nums =
        draws.map(d =>
            safeNumber(d.number)
        );

    const sizes =
        draws.map(d =>
            d.size === "大"
                ? "大"
                : "小"
        );


    /* -----------------------------------------------------
       MARKOV
    ----------------------------------------------------- */

    const lastNum =
        nums[0];

    let bigTransitions = 0;
    let smallTransitions = 0;

    let totalTransitions = 0;

    for (
        let i = 1;
        i < nums.length;
        i++
    ) {

        if (
            nums[i] === lastNum
        ) {

            totalTransitions++;

            if (
                sizes[i - 1] === "大"
            ) {

                bigTransitions++;

            } else {

                smallTransitions++;
            }
        }
    }


    let markov = 0;

    if (totalTransitions > 0) {

        markov =
            (
                bigTransitions -
                smallTransitions
            ) /
            totalTransitions;
    }


    /* -----------------------------------------------------
       MEAN REVERSION
    ----------------------------------------------------- */

    const recent10 =
        sizes.slice(
            0,
            Math.min(10, sizes.length)
        );

    const big10 =
        recent10.filter(
            x => x === "大"
        ).length;

    const small10 =
        recent10.length -
        big10;

    let mean = 0;

    if (
        recent10.length >= 5
    ) {

        const ratio =
            (
                big10 -
                small10
            ) /
            recent10.length;

        mean = -ratio;
    }


    /* -----------------------------------------------------
       STREAK
    ----------------------------------------------------- */

    let streak = 1;

    for (
        let i = 1;
        i < sizes.length;
        i++
    ) {

        if (
            sizes[i] === sizes[0]
        ) {

            streak++;

        } else {

            break;
        }
    }


    let streakSignal = 0;

    if (streak >= 2) {

        const currentDirection =
            getDirectionFromSize(
                sizes[0]
            );

        /*
         * IMPORTANT:
         * Streak is not automatically reversed.
         *
         * The AI will decide whether
         * following the streak or reversing
         * it has worked better historically.
         */

        streakSignal =
            currentDirection *
            Math.min(
                1,
                streak / 5
            );
    }


    /* -----------------------------------------------------
       FREQUENCY
    ----------------------------------------------------- */

    const recent20 =
        sizes.slice(
            0,
            Math.min(20, sizes.length)
        );

    const big20 =
        recent20.filter(
            x => x === "大"
        ).length;

    const frequency =
        recent20.length > 0
            ? (
                big20 -
                (recent20.length - big20)
            ) /
            recent20.length
            : 0;


    /* -----------------------------------------------------
       BALANCE
    ----------------------------------------------------- */

    const recent50 =
        sizes.slice(
            0,
            Math.min(50, sizes.length)
        );

    const big50 =
        recent50.filter(
            x => x === "大"
        ).length;

    const balance =
        recent50.length > 0
            ? (
                big50 -
                (recent50.length - big50)
            ) /
            recent50.length
            : 0;


    return {

        markov:
            clamp(markov, -1, 1),

        mean:
            clamp(mean, -1, 1),

        streak:
            clamp(streakSignal, -1, 1),

        frequency:
            clamp(frequency, -1, 1),

        balance:
            clamp(balance, -1, 1)
    };
}


/* =========================================================
   PATTERN MEMORY
========================================================= */

function getCurrentPattern(draws) {

    if (!draws || draws.length < 6) {
        return "";
    }

    const sizes =
        draws
            .slice(0, 6)
            .map(d =>
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
        time: Date.now()
    };

    aiLearning.patterns.recent.unshift(
        item
    );

    aiLearning.patterns.recent =
        aiLearning.patterns.recent.slice(
            0,
            100
        );


    if (outcome === "WIN") {

        aiLearning.patterns.successfulPatterns.unshift(
            item
        );

        aiLearning.patterns.successfulPatterns =
            aiLearning.patterns.successfulPatterns.slice(
                0,
                50
            );
    }


    if (outcome === "LOSS") {

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
    prediction
) {

    const pattern =
        getCurrentPattern(draws);

    if (!pattern) {

        return {
            bonus: 0,
            samples: 0,
            wins: 0,
            losses: 0
        };
    }


    const records =
        aiLearning.patterns.recent.filter(
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

    records.forEach(item => {

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
    });


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


    const accuracy =
        wins / total;


    /*
     * Pattern memory does NOT directly force
     * Big/Small.
     *
     * It only adjusts confidence.
     */

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
   RESULT-DRIVEN / ADAPTIVE
========================================================= */

function getLearnedPrediction(
    draws,
    learning = aiLearning
) {

    if (
        !draws ||
        draws.length < 10
    ) {

        return {

            num: null,
            size: "PASS",
            signal: "等待",
            confidence: 0,
            bigScore: 0,
            smallScore: 0,
            streakCnt: 0,
            markovSize: "等待",
            meanSize: "等待",
            isSpecial: false,
            features: {},
            weightedScore: 0,
            rawScore: 0,
            passReason: "历史数据不足",
            factorContributions: {}
        };
    }


    const nums =
        draws.map(d =>
            safeNumber(d.number)
        );

    const sizes =
        draws.map(d =>
            d.size === "大"
                ? "大"
                : "小"
        );


    const features =
        getFeatureSnapshot(draws);


    /*
     * =====================================================
     * LEARNING WEIGHTS
     *
     * These are NOT fixed.
     * They change according to Result.
     * =====================================================
     */

    const factors =
        learning.factors;


    let score = 0;

    const contributions = {};


    Object.keys(features).forEach(
        key => {

            const feature =
                safeNumber(
                    features[key]
                );

            const weight =
                clamp(
                    safeNumber(
                        factors[key]?.weight
                    ) || 1,
                    0.20,
                    2.00
                );


            const contribution =
                feature *
                weight;

            contributions[key] =
                contribution;

            score +=
                contribution;
        }
    );


    /*
     * =====================================================
     * CURRENT RESULT MEMORY
     * =====================================================
     */

    const latest =
        sizes[0];


    const previous =
        sizes[1];


    /*
     * The latest Result is not blindly followed.
     *
     * It checks how often the current transition
     * worked in previous history.
     */

    let transitionScore = 0;

    let transitionSamples = 0;

    for (
        let i = 2;
        i < sizes.length - 1;
        i++
    ) {

        if (
            sizes[i] === latest &&
            sizes[i + 1]
        ) {

            transitionSamples++;

            if (
                sizes[i + 1] === "大"
            ) {

                transitionScore++;

            } else {

                transitionScore--;
            }
        }
    }


    if (
        transitionSamples >= 2
    ) {

        transitionScore =
            transitionScore /
            transitionSamples;

        score +=
            transitionScore *
            0.80;
    }


    /*
     * =====================================================
     * PATTERN MEMORY
     * =====================================================
     */

    const temporaryPrediction =
        score >= 0
            ? "大"
            : "小";

    const patternMemory =
        getPatternExperience(
            draws,
            temporaryPrediction
        );


    if (
        patternMemory.samples >= 2
    ) {

        score +=
            patternMemory.bonus *
            Math.min(
                1.20,
                0.35 +
                patternMemory.samples *
                0.05
            );
    }


    /*
     * =====================================================
     * RECENT RESULT MOMENTUM
     * =====================================================
     */

    let momentum = 0;

    if (
        latest === previous
    ) {

        const dir =
            getDirectionFromSize(
                latest
            );

        momentum =
            dir *
            0.20;
    }


    score += momentum;


    /*
     * =====================================================
     * SELF CONFIDENCE
     *
     * If recent AI predictions are losing,
     * reduce confidence.
     * =====================================================
     */

    const recentReviews =
        learning.recentReviews
            .slice(0, 10)
            .filter(
                x =>
                    x.outcome === "WIN" ||
                    x.outcome === "LOSS"
            );


    let selfConfidence = 0;


    if (
        recentReviews.length >= 3
    ) {

        const wins =
            recentReviews.filter(
                x =>
                    x.outcome === "WIN"
            ).length;

        const losses =
            recentReviews.filter(
                x =>
                    x.outcome === "LOSS"
            ).length;

        const total =
            wins + losses;

        const accuracy =
            wins / total;

        selfConfidence =
            (
                accuracy -
                0.5
            ) *
            0.8;

        score +=
            selfConfidence;
    }


    /*
     * =====================================================
     * DIRECTION
     * =====================================================
     */

    let direction =
        score >= 0
            ? 1
            : -1;


    let prediction =
        getSizeFromDirection(
            direction
        );


    /*
     * =====================================================
     * CONFIDENCE
     * =====================================================
     */

    const confidenceRaw =
        Math.abs(score);


    let confidence =
        50 +
        confidenceRaw *
        22;


    confidence =
        clamp(
            confidence,
            50,
            92
        );


    /*
     * Learning state affects confidence.
     */

    confidence +=
        safeNumber(
            learning.confidenceBias
        );


    confidence =
        clamp(
            confidence,
            50,
            94
        );


    /*
     * =====================================================
     * PASS
     *
     * PASS is based on uncertainty,
     * not a fixed formula.
     * =====================================================
     */

    const threshold =
        clamp(
            safeNumber(
                learning.passThreshold
            ),
            0.45,
            1.25
        );


    let isPass =
        Math.abs(score) <
        threshold;


    /*
     * If AI has recently been wrong repeatedly,
     * become more conservative.
     */

    const recentLosses =
        learning.recentReviews
            .slice(0, 5)
            .filter(
                x =>
                    x.outcome === "LOSS"
            ).length;


    if (
        recentLosses >= 3
    ) {

        isPass =
            Math.abs(score) <
            threshold * 1.18;
    }


    /*
     * =====================================================
     * SPECIAL NUMBERS
     * =====================================================
     */

    const lastNum =
        nums[0];

    const isSpecial =
        lastNum === 0 ||
        lastNum === 5;


    /*
     * Special result is a caution,
     * NOT automatic PASS.
     */

    if (
        isSpecial &&
        Math.abs(score) <
        threshold * 1.25
    ) {

        isPass = true;
    }


    /*
     * =====================================================
     * TARGET NUMBER
     * =====================================================
     */

    let predictedNum =
        null;


    const transitionCounts = {};


    for (
        let i = 1;
        i < nums.length;
        i++
    ) {

        if (
            nums[i] === lastNum
        ) {

            const next =
                nums[i - 1];

            transitionCounts[next] =
                (
                    transitionCounts[next] ||
                    0
                ) + 1;
        }
    }


    const transitionEntries =
        Object.entries(
            transitionCounts
        );


    if (
        transitionEntries.length
    ) {

        transitionEntries.sort(
            (a, b) =>
                b[1] - a[1]
        );

        predictedNum =
            Number(
                transitionEntries[0][0]
            );
    }


    /*
     * fallback frequency
     */

    if (
        predictedNum === null ||
        Number.isNaN(predictedNum)
    ) {

        const freq = {};

        nums.forEach(n => {

            freq[n] =
                (
                    freq[n] || 0
                ) + 1;
        });


        const entries =
            Object.entries(freq);

        entries.sort(
            (a, b) =>
                b[1] - a[1]
        );


        if (entries.length) {

            predictedNum =
                Number(
                    entries[0][0]
                );
        }
    }


    return {

        num:
            predictedNum,

        size:
            isPass
                ? "PASS"
                : prediction,

        signal:
            isPass
                ? "PASS"
                : prediction === "大"
                    ? "BIG"
                    : "SMALL",

        confidence:
            Math.round(
                confidence
            ),

        bigScore:
            Math.max(
                score,
                0
            ),

        smallScore:
            Math.max(
                -score,
                0
            ),

        streakCnt:
            getCurrentStreak(
                sizes
            ),

        markovSize:
            features.markov >= 0
                ? "大"
                : "小",

        meanSize:
            features.mean >= 0
                ? "大"
                : "小",

        isSpecial,

        features,

        weightedScore:
            score,

        rawScore:
            score,

        passReason:
            isPass
                ? getPassReason(
                    score,
                    threshold,
                    recentLosses
                )
                : "",

        factorContributions:
            contributions,

        patternMemory,

        transitionScore,

        selfConfidence
    };
}


/* =========================================================
   PASS REASON
========================================================= */

function getPassReason(
    score,
    threshold,
    recentLosses
) {

    if (
        recentLosses >= 3 &&
        Math.abs(score) <
        threshold * 1.18
    ) {

        return "近期预测连续失误，AI 自动降低下注信心";
    }

    if (
        Math.abs(score) <
        threshold * 0.55
    ) {

        return "当前 Result 模式没有明显方向";
    }

    return "多个历史判断互相冲突";
}


/* =========================================================
   OLD COMPATIBILITY FUNCTION
========================================================= */

function getPredictionForDraw(draws) {

    return getLearnedPrediction(
        draws
    );
}


/* =========================================================
   CURRENT STREAK
========================================================= */

function getCurrentStreak(sizes) {

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
   COUNTERFACTUAL PASS
========================================================= */

function getCounterfactualResult(
    prediction,
    actualSize
) {

    if (
        !prediction ||
        prediction.size === "PASS"
    ) {

        return "NONE";
    }

    return prediction.size ===
        actualSize
        ? "WIN"
        : "LOSS";
}


function getForcedCounterfactual(
    draws
) {

    const prediction =
        getLearnedPrediction(
            draws
        );

    if (
        !prediction ||
        !prediction.size
    ) {

        return null;
    }


    if (
        prediction.size === "PASS"
    ) {

        /*
         * Recalculate without PASS threshold
         * to see what AI would have chosen.
         */

        const fakeLearning =
            JSON.parse(
                JSON.stringify(
                    aiLearning
                )
            );

        fakeLearning.passThreshold =
            0;

        const forced =
            getLearnedPrediction(
                draws,
                fakeLearning
            );

        return forced;
    }


    return prediction;
}


/* =========================================================
   LEARNING ENGINE
========================================================= */

function learnFromReview(
    review
) {

    if (!review) {
        return;
    }


    const actualDirection =
        getDirectionFromSize(
            review.actualSize
        );


    /*
     * -----------------------------------------------------
     * NORMAL WIN / LOSS
     * -----------------------------------------------------
     */

    if (
        review.outcome === "WIN" ||
        review.outcome === "LOSS"
    ) {

        const correct =
            review.outcome === "WIN";


        aiLearning.stats.total++;


        if (correct) {

            aiLearning.stats.win++;

        } else {

            aiLearning.stats.loss++;
        }


        /*
         * Update each factor separately.
         *
         * A factor is not simply "good" or "bad".
         * Its current contribution is compared
         * with the actual Result.
         */

        Object.keys(
            aiLearning.factors
        ).forEach(key => {

            const feature =
                safeNumber(
                    review.featureSnapshot?.[key]
                );


            if (
                Math.abs(feature) <
                0.08
            ) {
                return;
            }


            const factor =
                aiLearning.factors[key];


            const factorDirection =
                feature >= 0
                    ? 1
                    : -1;


            const aligned =
                factorDirection ===
                actualDirection;


            /*
             * If this factor pointed to the
             * actual Result, reward it.
             *
             * If it pointed opposite, punish it.
             */

            if (aligned === correct) {

                factor.weight +=
                    correct
                        ? 0.035
                        : 0.020;

            } else {

                factor.weight -=
                    correct
                        ? 0.020
                        : 0.040;
            }


            factor.weight =
                clamp(
                    factor.weight,
                    0.25,
                    2.00
                );


            if (correct) {

                factor.win++;

            } else {

                factor.loss++;
            }

        });


        /*
         * Confidence adaptation
         */

        if (correct) {

            aiLearning.confidenceBias +=
                0.35;

        } else {

            aiLearning.confidenceBias -=
                0.55;
        }


        aiLearning.confidenceBias =
            clamp(
                aiLearning.confidenceBias,
                -8,
                8
            );


        rememberPattern(
            review.pattern,
            review.predictionSize,
            review.actualSize,
            review.outcome
        );


        aiLearning.lastLearningMessage =
            correct

                ? `Result ${review.actualNum} 与 AI 判断一致，AI 提高了本次有效判断因素的权重。`

                : `Result ${review.actualNum} 与 AI 判断相反，AI 已降低近期失效判断因素的权重。`;
    }


    /*
     * -----------------------------------------------------
     * PASS
     * -----------------------------------------------------
     */

    if (
        review.outcome === "PASS"
    ) {

        aiLearning.stats.pass++;


        if (
            review.counterfactual === "WIN"
        ) {

            aiLearning.stats.passMissed++;

            /*
             * PASS was too conservative.
             * Slowly lower threshold.
             */

            aiLearning.passThreshold -=
                0.025;

            aiLearning.lastLearningMessage =
                `本次 PASS 如果强制判断会 WIN，AI 会稍微降低 PASS 门槛。`;

        } else if (
            review.counterfactual === "LOSS"
        ) {

            aiLearning.stats.passCorrect++;

            /*
             * PASS protected the system.
             */

            aiLearning.passThreshold +=
                0.025;

            aiLearning.lastLearningMessage =
                `本次 PASS 避开了错误判断，AI 保持更谨慎。`;

        } else {

            aiLearning.lastLearningMessage =
                `本次 PASS 没有足够方向，AI 保持观察。`;
        }


        aiLearning.passThreshold =
            clamp(
                aiLearning.passThreshold,
                0.45,
                1.25
            );


        rememberPattern(
            review.pattern,
            review.predictionSize,
            review.actualSize,
            "PASS"
        );
    }


    /*
     * Recent reviews
     */

    aiLearning.recentReviews.unshift(
        review
    );

    aiLearning.recentReviews =
        aiLearning.recentReviews.slice(
            0,
            100
        );


    aiLearning.lastReviewedIssue =
        review.issue;


    saveAILearning();
}


/* =========================================================
   REVIEW NEW RESULT
========================================================= */

function reviewNewOutcome(draws) {

    if (
        !draws ||
        draws.length < 12
    ) {
        return null;
    }


    /*
     * draws[0] = latest real result
     *
     * draws[1...] = information available
     * before latest result
     */

    const actual =
        draws[0];


    if (!actual) {
        return null;
    }


    if (
        aiLearning.lastReviewedIssue ===
        actual.issue
    ) {

        return null;
    }


    const history =
        draws.slice(1);


    /*
     * This is the prediction that would have
     * been made BEFORE actual Result appeared.
     */

    const prediction =
        getLearnedPrediction(
            history
        );


    if (!prediction) {
        return null;
    }


    const actualSize =
        actual.size === "大"
            ? "大"
            : "小";


    let outcome =
        "PASS";


    let counterfactual =
        "NONE";


    if (
        prediction.size === "PASS"
    ) {

        const forced =
            getForcedCounterfactual(
                history
            );


        if (forced) {

            counterfactual =
                forced.size === actualSize
                    ? "WIN"
                    : "LOSS";
        }

    } else {

        outcome =
            prediction.size ===
                actualSize
                ? "WIN"
                : "LOSS";
    }


    const review = {

        issue:
            actual.issue,

        predictionSize:
            prediction.size,

        predictedNum:
            prediction.num,

        signal:
            prediction.signal,

        actualSize,

        actualNum:
            actual.number,

        outcome,

        counterfactual,

        pattern:
            getCurrentPattern(
                history
            ),

        featureSnapshot:
            prediction.features,

        weightBefore:
            getCurrentWeights(),

        weightAfter:
            null,

        timestamp:
            Date.now()
    };


    learnFromReview(
        review
    );


    review.weightAfter =
        getCurrentWeights();


    /*
     * Save updated review with weightAfter.
     */

    if (
        aiLearning.recentReviews[0]
    ) {

        aiLearning.recentReviews[0]
            .weightAfter =
            review.weightAfter;

        saveAILearning();
    }


    return review;
}


/* =========================================================
   CURRENT WEIGHTS
========================================================= */

function getCurrentWeights() {

    return {

        markov:
            Number(
                aiLearning.factors.markov.weight
            ).toFixed(2),

        mean:
            Number(
                aiLearning.factors.mean.weight
            ).toFixed(2),

        streak:
            Number(
                aiLearning.factors.streak.weight
            ).toFixed(2),

        frequency:
            Number(
                aiLearning.factors.frequency.weight
            ).toFixed(2),

        balance:
            Number(
                aiLearning.factors.balance.weight
            ).toFixed(2)
    };
}


/* =========================================================
   AI LEARNING DASHBOARD
========================================================= */

function updateAILearningDashboard() {

    const stats =
        aiLearning.stats;


    const total =
        stats.win +
        stats.loss;


    const accuracy =
        total > 0
            ? (
                stats.win /
                total *
                100
            )
            : 0;


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
        "ai-learning-status",
        "🧠 自适应学习中"
    );


    setText(
        "ai-state",
        "ACTIVE"
    );


    setText(
        "ai-learning-count",
        stats.total
    );


    setText(
        "ai-learning-win",
        stats.win
    );


    setText(
        "ai-learning-loss",
        stats.loss
    );


    setText(
        "ai-learning-pass",
        stats.pass
    );


    const passTotal =
        stats.passCorrect +
        stats.passMissed;


    const passQuality =
        passTotal > 0
            ? (
                stats.passCorrect /
                passTotal *
                100
            )
            : 0;


    setText(
        "ai-pass-quality",
        `${passQuality.toFixed(0)}%`
    );


    setText(
        "ai-weight-markov",
        Number(
            aiLearning.factors.markov.weight
        ).toFixed(2)
    );


    setText(
        "ai-weight-mean",
        Number(
            aiLearning.factors.mean.weight
        ).toFixed(2)
    );


    setText(
        "ai-weight-streak",
        Number(
            aiLearning.factors.streak.weight
        ).toFixed(2)
    );


    setText(
        "ai-weight-frequency",
        Number(
            aiLearning.factors.frequency.weight
        ).toFixed(2)
    );


    setText(
        "ai-weight-balance",
        Number(
            aiLearning.factors.balance.weight
        ).toFixed(2)
    );


    setText(
        "ai-pass-threshold",
        Number(
            aiLearning.passThreshold
        ).toFixed(2)
    );


    setText(
        "ai-last-learning",
        aiLearning.lastLearningMessage
    );
}


/* =========================================================
   AI REVIEW DISPLAY
========================================================= */

function renderAIReview(
    draws
) {

    if (
        !draws ||
        draws.length < 12
    ) {
        return;
    }


    const actual =
        draws[0];


    const history =
        draws.slice(1);


    const prediction =
        getLearnedPrediction(
            history
        );


    const status =
        document.getElementById(
            "review-status"
        );


    const predEl =
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


    if (
        predEl
    ) {

        predEl.textContent =
            prediction.size === "PASS"

                ? "PASS"

                : `${prediction.size} / ${prediction.confidence}%`;
    }


    if (
        actualEl
    ) {

        actualEl.textContent =
            `${actual.number} / ${actual.size}`;
    }


    if (
        prediction.size === "PASS"
    ) {

        const forced =
            getForcedCounterfactual(
                history
            );


        const counter =
            forced &&
            forced.size === actual.size
                ? "PASS → 如果强制判断：WIN"
                : forced
                    ? "PASS → 如果强制判断：LOSS"
                    : "PASS";


        if (status) {

            status.textContent =
                "PASS";

            status.className =
                "review-status review-pass";
        }


        if (resultEl) {
            resultEl.textContent =
                counter;
        }


        if (messageEl) {

            messageEl.textContent =
                `AI 选择观察。${prediction.passReason || ""}`;
        }

    } else {

        const win =
            prediction.size ===
            actual.size;


        if (status) {

            status.textContent =
                win
                    ? "WIN"
                    : "LOSS";

            status.className =
                win
                    ? "review-status review-win"
                    : "review-status review-loss";
        }


        if (resultEl) {

            resultEl.textContent =
                win
                    ? "✓ 判断正确"
                    : "✕ 判断错误";
        }


        if (messageEl) {

            messageEl.textContent =
                win

                    ? "真实 Result 与 AI 判断一致，本次使用的有效因素会得到强化。"

                    : "真实 Result 与 AI 判断相反，AI 会降低近期失效因素的权重。";
        }
    }
}


/* =========================================================
   FETCH WINGO
========================================================= */

async function fetchDraws() {

    try {

        const random =
            Array.from(
                crypto.getRandomValues(
                    new Uint8Array(16)
                )
            )
                .map(
                    b =>
                        b.toString(16)
                            .padStart(2, "0")
                )
                .join("");


        const timestamp =
            Math.floor(
                Date.now() / 1000
            );


        const signObj = {

            language: 0,

            pageNo: 1,

            pageSize: 60,

            random,

            typeId: 30
        };


        const signRaw =
            JSON.stringify(
                signObj
            );


        const sign =
            CryptoJS.MD5(
                signRaw
            )
                .toString()
                .toUpperCase();


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
                        JSON.stringify({

                            ...signObj,

                            timestamp,

                            sign
                        })
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        const json =
            await response.json();


        const list =
            json?.data?.list;


        if (
            !Array.isArray(list)
        ) {

            console.warn(
                "Worker 返回没有开奖列表"
            );

            return [];
        }


        return list
            .map(item => {

                const number =
                    safeNumber(
                        item.number
                    );


                return {

                    issue:
                        String(
                            item.issueNumber ??
                            item.issue ??
                            ""
                        ),

                    number,

                    size:
                        number >= 5
                            ? "大"
                            : "小",

                    colour:
                        item.colour ??
                        item.color ??
                        ""
                };
            })
            .filter(
                x =>
                    x.issue &&
                    Number.isFinite(
                        x.number
                    )
            );

    } catch (error) {

        console.error(
            "Worker 请求解析失败:",
            error
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


    if (
        issueEl
    ) {

        issueEl.textContent =
            latest.issue;
    }


    if (
        resultEl
    ) {

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


    if (
        prediction.size === "PASS"
    ) {

        el.innerHTML = `
            <span class="tag-wait">
                ⏸ PASS
            </span>
        `;

        return;
    }


    el.innerHTML = `
        <strong>
            ${prediction.size}
        </strong>
        <span>
            ${prediction.confidence}%
        </span>
    `;
}


/* =========================================================
   MARKET ANALYSIS
========================================================= */

function updateMarketAnalysis(
    draws,
    prediction
) {

    const sizes =
        draws.map(
            d => d.size
        );


    const nums =
        draws.map(
            d =>
                safeNumber(
                    d.number
                )
        );


    const streak =
        getCurrentStreak(
            sizes
        );


    const features =
        prediction.features ||
        getFeatureSnapshot(
            draws
        );


    const recent10 =
        sizes.slice(
            0,
            10
        );


    const recent50 =
        sizes.slice(
            0,
            50
        );


    const big10 =
        recent10.filter(
            x =>
                x === "大"
        ).length;


    const small10 =
        recent10.length -
        big10;


    const big50 =
        recent50.filter(
            x =>
                x === "大"
        ).length;


    const small50 =
        recent50.length -
        big50;


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
        "analysis-streak",
        `${streak} 连${sizes[0] || ""}`
    );


    setText(
        "analysis-markov",
        features.markov >= 0
            ? "大"
            : "小"
    );


    setText(
        "analysis-mean",
        features.mean >= 0
            ? "大"
            : "小"
    );


    setText(
        "analysis-number",
        nums[0]
    );


    setText(
        "analysis-big10",
        big10
    );


    setText(
        "analysis-small10",
        small10
    );


    setText(
        "analysis-big50",
        big50
    );


    setText(
        "analysis-small50",
        small50
    );


    const score =
        safeNumber(
            prediction.weightedScore
        );


    setText(
        "score-text",
        score.toFixed(2)
    );


    const fill =
        document.getElementById(
            "score-fill"
        );


    if (fill) {

        const percentage =
            clamp(
                50 +
                score * 15,
                5,
                95
            );

        fill.style.width =
            `${percentage}%`;
    }
}


/* =========================================================
   BACKTEST
========================================================= */

function runBacktest(
    draws
) {

    if (
        !draws ||
        draws.length < 12
    ) {

        return {

            win: 0,

            loss: 0,

            pass: 0,

            valid: 0,

            rate: 0
        };
    }


    let win = 0;
    let loss = 0;
    let pass = 0;


    const maxRows =
        Math.min(
            50,
            draws.length - 10
        );


    /*
     * IMPORTANT:
     *
     * Backtest uses a COPY of current learning.
     *
     * It does NOT modify live AI memory.
     */

    const simulatedLearning =
        JSON.parse(
            JSON.stringify(
                aiLearning
            )
        );


    for (
        let i = 0;
        i < maxRows;
        i++
    ) {

        const currentDraw =
            draws[i];


        const history =
            draws.slice(
                i + 1
            );


        const prediction =
            getLearnedPrediction(
                history,
                simulatedLearning
            );


        if (
            prediction.size ===
            "PASS"
        ) {

            pass++;

        } else if (
            prediction.size ===
            currentDraw.size
        ) {

            win++;

        } else {

            loss++;
        }
    }


    const valid =
        win + loss;


    const rate =
        valid > 0
            ? (
                win /
                valid *
                100
            )
            : 0;


    return {

        win,

        loss,

        pass,

        valid,

        rate
    };
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
            · PASS ${result.pass}
        </div>
    `;
}


/* =========================================================
   DRAW TABLE
========================================================= */

function renderDrawTable(
    draws
) {

    const table =
        document.getElementById(
            "draw-table"
        );


    if (!table) {
        return;
    }


    const rows =
        draws
            .slice(0, 50)
            .map(
                (draw, index) => {

                    return `
                        <tr>
                            <td>
                                ${draw.issue}
                            </td>

                            <td>
                                ${getNumberIconHtml(
                                    draw.number
                                )}
                                ${draw.number}
                            </td>

                            <td>
                                ${draw.size}
                            </td>

                            <td>
                                ${draw.colour || "-"}
                            </td>
                        </tr>
                    `;
                }
            )
            .join("");


    table.innerHTML = `
        <div class="table-wrapper">
            <table>

                <thead>
                    <tr>
                        <th>期号</th>
                        <th>号码</th>
                        <th>大小</th>
                        <th>颜色</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>

            </table>
        </div>
    `;
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


    if (
        myChart
    ) {

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
                type: "line",

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

    const draws =
        await fetchDraws();


    if (
        !draws.length
    ) {

        return;
    }


    /*
     * Sort latest first
     */

    draws.sort(
        (a, b) =>
            String(b.issue)
                .localeCompare(
                    String(a.issue)
                )
    );


    /*
     * FIRST:
     * Learn from newly arrived Result.
     */

    reviewNewOutcome(
        draws
    );


    /*
     * THEN:
     * Generate next prediction.
     */

    const prediction =
        getLearnedPrediction(
            draws
        );


    const latest =
        draws[0];


    updateLatestCard(
        latest
    );


    updatePredictionCard(
        prediction
    );


    updateMarketAnalysis(
        draws,
        prediction
    );


    renderAIReview(
        draws
    );


    updateAILearningDashboard();


    const backtest =
        runBacktest(
            draws
        );


    updateWinRate(
        backtest
    );


    renderDrawTable(
        draws
    );


    renderNumberChart(
        draws
    );
}


/* =========================================================
   BACCARAT DATA
========================================================= */

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

    if (result === "B") {
        return "庄";
    }

    if (result === "P") {
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

    if (
        !history ||
        history.length < 3
    ) {

        return {

            result: "PASS",

            confidence: 50,

            action: "PASS",

            reason: "数据不足"
        };
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
            x => x === "B"
        ).length;


    const player =
        history.filter(
            x => x === "P"
        ).length;


    const tie =
        history.filter(
            x => x === "T"
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
        history.slice(0, 10),
        "small-road"
    );


    renderSmallRoad(
        history.slice(0, 10),
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
                    : "pass";
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
   COUNTDOWN
========================================================= */

setInterval(
    () => {

        countdownVal--;

        if (
            countdownVal <= 0
        ) {

            countdownVal = 5;

            refreshDashboard();
        }


        const el =
            document.getElementById(
                "countdown"
            );


        if (el) {

            el.textContent =
                countdownVal;
        }

    },
    1000
);


/* =========================================================
   INIT
========================================================= */

setInterval(
    updateMYTClock,
    1000
);


updateMYTClock();


renderBaccarat(
    "D51"
);


updateAILearningDashboard();


refreshDashboard();
