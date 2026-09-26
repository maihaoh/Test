/* =========================================================
   WinGo & Baccarat AI Dashboard
   STYLE.CSS
========================================================= */

* {
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

body {
    margin: 0;
    padding: 0;
    min-height: 100vh;

    background:
        radial-gradient(
            circle at top left,
            rgba(59, 130, 246, 0.12),
            transparent 35%
        ),
        radial-gradient(
            circle at top right,
            rgba(168, 85, 247, 0.10),
            transparent 35%
        ),
        #020617;

    color: #e5e7eb;

    font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Arial,
        sans-serif;
}


/* =========================================================
   SCROLLBAR
========================================================= */

::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: #020617;
}

::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
    background: #475569;
}


/* =========================================================
   MAIN CONTAINER
========================================================= */

.dashboard-container {
    width: 100%;
    max-width: 1500px;
    margin: 0 auto;
    padding: 20px;
}


/* =========================================================
   HEADER
========================================================= */

.dashboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    gap: 15px;

    margin-bottom: 20px;
    padding: 18px 20px;

    border: 1px solid #1e293b;
    border-radius: 18px;

    background:
        linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.96),
            rgba(15, 23, 42, 0.82)
        );

    box-shadow:
        0 15px 40px rgba(0, 0, 0, 0.25);
}

.dashboard-title {
    margin: 0;

    font-size: 1.35rem;
    font-weight: 800;

    color: #f8fafc;
}

.dashboard-subtitle {
    margin-top: 5px;

    font-size: 0.78rem;

    color: #64748b;
}


/* =========================================================
   STATUS
========================================================= */

.status-online {
    display: inline-flex;
    align-items: center;
    gap: 7px;

    padding: 7px 12px;

    border-radius: 999px;

    background: rgba(16, 185, 129, 0.10);
    border: 1px solid rgba(16, 185, 129, 0.25);

    color: #34d399;

    font-size: 0.75rem;
    font-weight: 700;
}

.status-online::before {
    content: "";

    width: 7px;
    height: 7px;

    border-radius: 50%;

    background: #10b981;

    box-shadow:
        0 0 10px rgba(16, 185, 129, 0.8);
}


/* =========================================================
   SECTION
========================================================= */

.dashboard-section {
    margin-bottom: 20px;
}

.section-title {
    margin-bottom: 12px;

    font-size: 1.05rem;
    font-weight: 800;

    color: #f8fafc;
}


/* =========================================================
   CARD GRID
========================================================= */

.card-grid {
    display: grid;

    grid-template-columns:
        repeat(
            4,
            minmax(0, 1fr)
        );

    gap: 14px;
}

.card {
    position: relative;

    padding: 18px;

    border: 1px solid #1e293b;
    border-radius: 16px;

    background:
        linear-gradient(
            145deg,
            rgba(15, 23, 42, 0.98),
            rgba(15, 23, 42, 0.88)
        );

    box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.18);
}

.card-title {
    margin-bottom: 8px;

    font-size: 0.78rem;
    font-weight: 600;

    color: #64748b;
}

.card-value {
    font-size: 1.7rem;
    font-weight: 900;

    color: #f8fafc;
}

.card-small {
    margin-top: 5px;

    font-size: 0.72rem;

    color: #64748b;
}


/* =========================================================
   WINGO MAIN GRID
========================================================= */

.wingo-grid {
    display: grid;

    grid-template-columns:
        repeat(
            4,
            minmax(0, 1fr)
        );

    gap: 14px;
}


/* =========================================================
   LATEST RESULT
========================================================= */

.latest-result {
    display: flex;

    align-items: center;
    justify-content: center;

    min-height: 65px;

    font-size: 2rem;
    font-weight: 900;
}


/* =========================================================
   NUMBER ICON
========================================================= */

.number-icon {
    display: inline-flex;

    align-items: center;
    justify-content: center;

    width: 38px;
    height: 38px;

    border-radius: 50%;

    font-size: 1rem;
    font-weight: 900;

    color: #ffffff;

    margin-right: 7px;

    box-shadow:
        inset 0 0 0 2px rgba(255, 255, 255, 0.08);
}


/* =========================================================
   BIG / SMALL TAG
========================================================= */

.tag-big,
.tag-small,
.tag-buy,
.tag-wait,
.tag-win,
.tag-loss {
    display: inline-flex;

    align-items: center;
    justify-content: center;

    padding: 4px 9px;

    border-radius: 7px;

    font-size: 0.72rem;
    font-weight: 800;

    white-space: nowrap;
}

.tag-big {
    color: #fb923c;

    background: rgba(249, 115, 22, 0.12);

    border: 1px solid rgba(249, 115, 22, 0.25);
}

.tag-small {
    color: #60a5fa;

    background: rgba(59, 130, 246, 0.12);

    border: 1px solid rgba(59, 130, 246, 0.25);
}

.tag-buy {
    color: #34d399;

    background: rgba(16, 185, 129, 0.12);

    border: 1px solid rgba(16, 185, 129, 0.25);
}

.tag-wait {
    color: #94a3b8;

    background: rgba(100, 116, 139, 0.12);

    border: 1px solid rgba(100, 116, 139, 0.25);
}

.tag-win {
    color: #34d399;

    background: rgba(16, 185, 129, 0.12);

    border: 1px solid rgba(16, 185, 129, 0.25);
}

.tag-loss {
    color: #f87171;

    background: rgba(239, 68, 68, 0.12);

    border: 1px solid rgba(239, 68, 68, 0.25);
}


/* =========================================================
   AI PREDICTION
========================================================= */

.prediction-box {
    display: flex;

    flex-direction: column;

    align-items: center;
    justify-content: center;

    min-height: 80px;
}

.prediction-main {
    display: flex;

    align-items: center;
    justify-content: center;

    gap: 8px;

    font-size: 1.5rem;
    font-weight: 900;
}

.prediction-score {
    margin-top: 7px;

    font-size: 0.72rem;

    color: #64748b;
}


/* =========================================================
   AI REVIEW
========================================================= */

.ai-review-box {
    padding: 18px;

    border-radius: 16px;

    border: 1px solid #1e293b;

    background:
        linear-gradient(
            145deg,
            rgba(15, 23, 42, 0.98),
            rgba(2, 6, 23, 0.95)
        );

    box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.18);
}

.ai-review-title {
    margin-bottom: 15px;

    font-size: 1rem;
    font-weight: 800;

    color: #f8fafc;
}

.ai-review-grid {
    display: grid;

    grid-template-columns:
        repeat(
            4,
            minmax(0, 1fr)
        );

    gap: 10px;
}

.ai-review-item {
    padding: 12px;

    border-radius: 10px;

    background: rgba(30, 41, 59, 0.45);

    border: 1px solid #1e293b;
}

.ai-review-label {
    margin-bottom: 6px;

    font-size: 0.68rem;

    color: #64748b;
}

.ai-review-value {
    font-size: 0.9rem;
    font-weight: 800;

    color: #e2e8f0;
}

.ai-review-message {
    margin-top: 12px;

    padding: 12px;

    border-radius: 10px;

    background: rgba(30, 41, 59, 0.35);

    color: #cbd5e1;

    font-size: 0.78rem;

    line-height: 1.6;
}


/* =========================================================
   ANALYSIS
========================================================= */

.analysis-grid {
    display: grid;

    grid-template-columns:
        repeat(
            4,
            minmax(0, 1fr)
        );

    gap: 10px;
}

.analysis-item {
    padding: 12px;

    border-radius: 10px;

    background: rgba(15, 23, 42, 0.75);

    border: 1px solid #1e293b;
}

.analysis-label {
    font-size: 0.68rem;

    color: #64748b;

    margin-bottom: 5px;
}

.analysis-value {
    font-size: 0.9rem;

    font-weight: 800;

    color: #e2e8f0;
}


/* =========================================================
   SCORE BAR
========================================================= */

.score-container {
    margin-top: 15px;
}

.score-header {
    display: flex;

    justify-content: space-between;

    margin-bottom: 7px;

    font-size: 0.75rem;

    color: #94a3b8;
}

.score-bar {
    width: 100%;
    height: 10px;

    overflow: hidden;

    border-radius: 999px;

    background: #1e293b;
}

.score-fill {
    width: 0%;

    height: 100%;

    border-radius: 999px;

    background:
        linear-gradient(
            90deg,
            #38bdf8,
            #34d399
        );

    transition:
        width 0.4s ease;
}


/* =========================================================
   CONTENT GRID
========================================================= */

.content-grid {
    display: grid;

    grid-template-columns:
        minmax(0, 1fr);

    gap: 14px;
}

.content-card {
    padding: 18px;

    border: 1px solid #1e293b;
    border-radius: 16px;

    background:
        rgba(15, 23, 42, 0.92);
}

.content-card-title {
    margin-bottom: 14px;

    font-size: 0.95rem;
    font-weight: 800;

    color: #f8fafc;
}


/* =========================================================
   TABLE
========================================================= */

.table-wrapper {
    width: 100%;

    overflow-x: auto;

    border-radius: 10px;
}

table {
    width: 100%;

    border-collapse: collapse;

    min-width: 600px;
}

thead {
    background: rgba(30, 41, 59, 0.7);
}

th {
    padding: 11px 10px;

    text-align: center;

    font-size: 0.72rem;
    font-weight: 800;

    color: #94a3b8;

    border-bottom: 1px solid #1e293b;
}

td {
    padding: 11px 10px;

    text-align: center;

    font-size: 0.78rem;

    color: #cbd5e1;

    border-bottom: 1px solid rgba(30, 41, 59, 0.65);
}

tbody tr {
    transition:
        background 0.2s ease;
}

tbody tr:hover {
    background: rgba(30, 41, 59, 0.35);
}


/* =========================================================
   BACKTEST
========================================================= */

.backtest-summary {
    display: grid;

    grid-template-columns:
        repeat(
            4,
            minmax(0, 1fr)
        );

    gap: 10px;

    margin-bottom: 15px;
}

.backtest-stat {
    padding: 13px;

    text-align: center;

    border-radius: 10px;

    background: rgba(15, 23, 42, 0.7);

    border: 1px solid #1e293b;
}

.backtest-stat-label {
    font-size: 0.68rem;

    color: #64748b;
}

.backtest-stat-value {
    margin-top: 5px;

    font-size: 1.1rem;

    font-weight: 900;

    color: #f8fafc;
}


/* =========================================================
   LOSS REVIEW
========================================================= */

.loss-review {
    margin-top: 15px;

    padding: 14px;

    border-radius: 12px;

    border: 1px solid rgba(239, 68, 68, 0.18);

    background:
        rgba(127, 29, 29, 0.08);
}

.loss-review-title {
    margin-bottom: 10px;

    font-size: 0.85rem;
    font-weight: 800;

    color: #fca5a5;
}


/* =========================================================
   WIN REVIEW
========================================================= */

.win-review {
    margin-top: 15px;

    padding: 14px;

    border-radius: 12px;

    border: 1px solid rgba(16, 185, 129, 0.18);

    background:
        rgba(6, 78, 59, 0.08);
}

.win-review-title {
    margin-bottom: 10px;

    font-size: 0.85rem;
    font-weight: 800;

    color: #6ee7b7;
}


/* =========================================================
   PASS REVIEW
========================================================= */

.pass-review {
    margin-top: 15px;

    padding: 14px;

    border-radius: 12px;

    border: 1px solid rgba(100, 116, 139, 0.18);

    background:
        rgba(51, 65, 85, 0.08);
}

.pass-review-title {
    margin-bottom: 10px;

    font-size: 0.85rem;
    font-weight: 800;

    color: #cbd5e1;
}


/* =========================================================
   BACCARAT
========================================================= */

.baccarat-section {
    margin-top: 25px;
}

.baccarat-tabs {
    display: flex;

    flex-wrap: wrap;

    gap: 8px;

    margin-bottom: 14px;
}

.baccarat-tab {
    padding: 8px 13px;

    border-radius: 8px;

    border: 1px solid #334155;

    background: #0f172a;

    color: #94a3b8;

    font-size: 0.75rem;
    font-weight: 700;

    cursor: pointer;

    transition:
        all 0.2s ease;
}

.baccarat-tab:hover {
    background: #1e293b;

    color: #e2e8f0;
}

.baccarat-tab.active {
    background: #1e293b;

    border-color: #64748b;

    color: #ffffff;
}


/* =========================================================
   BACCARAT ROAD
========================================================= */

.road-container {
    width: 100%;

    overflow-x: auto;

    padding-bottom: 5px;
}

.big-road {
    display: grid;

    grid-auto-flow: column;

    grid-template-rows:
        repeat(
            6,
            28px
        );

    gap: 3px;

    min-width: max-content;
}

.road-cell {
    width: 25px;
    height: 25px;

    display: flex;

    align-items: center;
    justify-content: center;

    border-radius: 50%;

    font-size: 0.65rem;
    font-weight: 800;

    border: 1px solid #334155;
}

.road-banker {
    color: #f87171;

    border-color: #ef4444;

    background: rgba(239, 68, 68, 0.10);
}

.road-player {
    color: #60a5fa;

    border-color: #3b82f6;

    background: rgba(59, 130, 246, 0.10);
}

.road-tie {
    color: #34d399;

    border-color: #10b981;

    background: rgba(16, 185, 129, 0.10);
}


/* =========================================================
   BACCARAT HISTORY
========================================================= */

.baccarat-history {
    display: flex;

    flex-wrap: wrap;

    gap: 7px;
}

.baccarat-history-item {
    display: inline-flex;

    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;

    border-radius: 50%;

    font-size: 0.7rem;
    font-weight: 800;
}


/* =========================================================
   COUNTDOWN
========================================================= */

.countdown {
    display: inline-flex;

    align-items: center;
    justify-content: center;

    min-width: 45px;
    height: 28px;

    padding: 0 9px;

    border-radius: 8px;

    background: rgba(30, 41, 59, 0.8);

    border: 1px solid #334155;

    color: #cbd5e1;

    font-size: 0.75rem;
    font-weight: 800;
}


/* =========================================================
   EMPTY STATE
========================================================= */

.empty-state {
    padding: 30px;

    text-align: center;

    color: #64748b;

    font-size: 0.8rem;
}


/* =========================================================
   LOADING
========================================================= */

.loading {
    opacity: 0.6;

    pointer-events: none;
}

.loading-spinner {
    width: 18px;
    height: 18px;

    border: 2px solid #334155;

    border-top-color: #38bdf8;

    border-radius: 50%;

    animation:
        dashboard-spin 0.8s linear infinite;
}

@keyframes dashboard-spin {

    from {
        transform: rotate(0deg);
    }

    to {
        transform: rotate(360deg);
    }
}


/* =========================================================
   AI LEARNING
========================================================= */

.ai-learning-grid {
    display: grid;

    grid-template-columns:
        repeat(
            3,
            minmax(0, 1fr)
        );

    gap: 10px;
}

.ai-learning-card {
    padding: 13px;

    border-radius: 10px;

    background: rgba(15, 23, 42, 0.7);

    border: 1px solid #1e293b;
}

.ai-learning-name {
    font-size: 0.78rem;

    font-weight: 800;

    color: #e2e8f0;
}

.ai-learning-rate {
    margin-top: 5px;

    font-size: 0.72rem;

    color: #94a3b8;
}

.ai-learning-weight {
    margin-top: 7px;

    font-size: 1rem;

    font-weight: 900;

    color: #38bdf8;
}


/* =========================================================
   RESPONSIVE
========================================================= */

@media (max-width: 1100px) {

    .card-grid,
    .wingo-grid {
        grid-template-columns:
            repeat(
                2,
                minmax(0, 1fr)
            );
    }

    .analysis-grid {
        grid-template-columns:
            repeat(
                2,
                minmax(0, 1fr)
            );
    }

    .ai-review-grid {
        grid-template-columns:
            repeat(
                2,
                minmax(0, 1fr)
            );
    }

    .backtest-summary {
        grid-template-columns:
            repeat(
                2,
                minmax(0, 1fr)
            );
    }
}


@media (max-width: 700px) {

    .dashboard-container {
        padding: 10px;
    }

    .dashboard-header {
        flex-direction: column;

        align-items: flex-start;
    }

    .card-grid,
    .wingo-grid,
    .analysis-grid,
    .ai-review-grid,
    .backtest-summary,
    .ai-learning-grid {
        grid-template-columns:
            1fr;
    }

    .dashboard-title {
        font-size: 1.1rem;
    }

    .card-value {
        font-size: 1.45rem;
    }

    .content-card,
    .card,
    .ai-review-box {
        padding: 14px;
    }

    table {
        min-width: 560px;
    }
}


/* =========================================================
   UTILITY
========================================================= */

.text-green {
    color: #34d399 !important;
}

.text-red {
    color: #f87171 !important;
}

.text-blue {
    color: #60a5fa !important;
}

.text-yellow {
    color: #facc15 !important;
}

.text-gray {
    color: #94a3b8 !important;
}

.text-white {
    color: #ffffff !important;
}

.font-bold {
    font-weight: 800 !important;
}

.text-center {
    text-align: center !important;
}
