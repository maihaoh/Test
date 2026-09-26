const WORKER_URL =
    "https://rapid-disk-cfwingo-api.j05stm24f008.workers.dev";

let myChart = null;
let countdownVal = 5;
let currentBaccaratTable = "D51";


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
   WINGO STRONG PREDICTOR
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
            isSpecial: false
        };
    }

    const nums =
        draws.map(d => Number(d.number));

    const sizes =
        draws.map(d => d.size);

    const lastNum = nums[0];

    const lastSize = sizes[0];


    /* LONG STREAK */

    let streakCnt = 0;

    for (const s of sizes) {

        if (s === lastSize) {

            streakCnt++;

        } else {

            break;
        }
    }


    /* MARKOV */

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
        Math.max(...transitionCounts);

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


    /* MEAN REVERSION */

    const recent10 =
        nums.slice(0, 10);

    const bigCount =
        recent10.filter(
            n => n >= 5
        ).length;

    let meanSize = "平";

    if (bigCount >= 7) {

        meanSize = "小";

    } else if (bigCount <= 3) {

        meanSize = "大";
    }


    /* SPECIAL */

    const isSpecial =
        lastNum === 0 ||
        lastNum === 5;


    /* SCORE */

    let bigScore = 0;

    let smallScore = 0;

    if (markovSize === "大") {

        bigScore += 1.5;

    } else if (markovSize === "小") {

        smallScore += 1.5;
    }

    if (meanSize === "大") {

        bigScore += 1;

    } else if (meanSize === "小") {

        smallScore += 1;
    }

    if (streakCnt >= 3) {

        if (lastSize === "大") {

            bigScore += 1.2;

        } else {

            smallScore += 1.2;
        }
    }


    /* FINAL */

    let finalSize = null;

    let signal = "观望";

    let confidence = "低";

    const scoreDifference =
        Math.abs(
            bigScore - smallScore
        );

    if (
        scoreDifference < 0.8 ||
        isSpecial
    ) {

        signal = "观望";

        confidence = "避险";

    } else if (
        bigScore > smallScore
    ) {

        finalSize = "大";

        signal = "BUY";

        confidence =
            bigScore >= 2.5
                ? "🔥高确信"
                : "普通";

    } else {

        finalSize = "小";

        signal = "BUY";

        confidence =
            smallScore >= 2.5
                ? "🔥高确信"
                : "普通";
    }


    /* TARGET NUMBER */

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

        for (
            let i = start;
            i < end;
            i++
        ) {

            if (
                transitionCounts[i]
                > maxScore
            ) {

                maxScore =
                    transitionCounts[i];

                targetNum = i;
            }
        }

        if (
            maxTransition === 0
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
                    freq[i] > maxScore
                ) {

                    maxScore = freq[i];

                    targetNum = i;
                }
            }
        }
    }

    return {

        num: targetNum,

        size: finalSize,

        signal,

        confidence,

        bigScore,

        smallScore,

        streakCnt,

        markovSize,

        meanSize,

        isSpecial
    };
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
   AI REVIEW
===================================================== */

function renderAIReview(draws) {

    if (!draws || draws.length < 11) {
        return;
    }

    const actual =
        draws[0];

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

    if (
        previousPrediction.signal !== "BUY" ||
        previousPrediction.num === null
    ) {

        statusEl.className =
            "review-status review-wait";

        statusEl.innerText =
            "PASS / 未下注";

        predictionEl.innerHTML =
            `<span class="tag-wait">PASS</span>`;

        actualEl.innerHTML =
            getNumberIconHtml(
                previousActual.number
            ) +
            ` ${previousActual.size}`;

        resultEl.innerText =
            "不计入胜负";

        messageEl.innerHTML =
            `
            上一期系统判断为 <b>PASS</b>，
            因此不把这一局计算成输。
            系统继续观察下一期数据。
            `;

        return;
    }

    const isWin =
        previousActual.size ===
        previousPrediction.size;

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

    if (isWin) {

        statusEl.className =
            "review-status review-win";

        statusEl.innerText =
            "✅ WIN";

        resultEl.innerHTML =
            '<span class="tag-win">预测成功</span>';

        messageEl.innerHTML =
            `
            ✓ 上一期预测方向
            <b>${previousPrediction.size}</b>
            正确。
            <br>
            Markov：${previousPrediction.markovSize}
            ／ 均值回归：${previousPrediction.meanSize}
            ／ 当前长龙：${previousPrediction.streakCnt} 连。
            <br>
            系统保留这次成功组合，继续观察下一期是否仍然成立。
            `;

    } else {

        statusEl.className =
            "review-status review-loss";

        statusEl.innerText =
            "❌ LOSS";

        resultEl.innerHTML =
            '<span class="tag-loss">预测错误</span>';

        let reasons = [];

        if (
            previousPrediction.markovSize !==
            previousPrediction.size
        ) {

            reasons.push(
                "Markov 与最终方向不一致"
            );
        }

        if (
            previousPrediction.meanSize !==
            previousPrediction.size
        ) {

            reasons.push(
                "均值回归与最终方向不一致"
            );
        }

        if (
            previousPrediction.streakCnt >= 3
        ) {

            reasons.push(
                "长龙因素可能造成方向追随"
            );
        }

        if (
            reasons.length === 0
        ) {

            reasons.push(
                "历史模式在该期没有延续"
            );
        }

        messageEl.innerHTML =
            `
            <b style="color:#f87171;">
                ❌ 本期预测没有命中。
            </b>
            <br>
            实际：${previousActual.number}
            (${previousActual.size})
            ／
            预测：${previousPrediction.num}
            (${previousPrediction.size})
            <br><br>

            <b>复盘原因：</b>
            ${reasons.map(
                x => "• " + x
            ).join("<br>")}

            <br><br>

            <b style="color:#fbbf24;">
                🔄 下一期处理：
            </b>
            不直接追上一期方向，
            重新计算最新 Markov、均值回归、
            长龙及 50 期数据。
            `;
    }
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

                        <span class="tag-wait">
                            不计
                        </span>

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
