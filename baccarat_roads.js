/* Baccarat roadmaps: historical scoreboards only, never next-hand predictions.
 * A tie overlays the latest Big Road entry and has its own Bead Plate cell.
 * Six-row dragontails are presentation only. Derived roads use logical streak
 * lengths, ensuring a tail collision cannot change historical derived marks.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BaccaratRoads = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    function validate(history) {
        if (!Array.isArray(history) || history.some(x => x !== 'B' && x !== 'P' && x !== 'T'))
            throw new TypeError('Expected an array of B/P/T');
        return history;
    }
    function stack(codes) {
        const cells = [], occupied = new Set();
        let lastCode = null, lastCol = -1, lastRow = 0, startCol = -1;
        for (const [index, code] of codes.entries()) {
            let col, row;
            if (code !== lastCode) {
                startCol += 1;
                while (occupied.has(`${startCol},0`)) startCol++;
                col = startCol; row = 0;
            } else {
                col = lastCol; row = lastRow;
                if (row < 5 && !occupied.has(`${col},${row + 1}`)) row++;
                else {
                    col++;
                    while (occupied.has(`${col},${row}`)) col++;
                }
            }
            occupied.add(`${col},${row}`);
            cells.push({code, col, row, index, ties: 0});
            lastCode = code; lastCol = col; lastRow = row;
        }
        return cells;
    }
    function build(history) {
        validate(history);
        const bead = history.map((code, index) => ({code, index, col: Math.floor(index / 6), row: index % 6}));
        const runs = [], decisive = [];
        let pendingTies = 0;
        for (const code of history) {
            if (code === 'T') {
                if (decisive.length) decisive[decisive.length - 1].ties++;
                else pendingTies++;
                continue;
            }
            const cell = {code, ties: pendingTies}; pendingTies = 0;
            decisive.push(cell);
            if (runs.length && runs[runs.length - 1].code === code) runs[runs.length - 1].cells.push(cell);
            else runs.push({code, cells: [cell]});
        }
        const big = stack(decisive.map(x => x.code)).map((x, i) => ({...x, ties: decisive[i].ties}));
        const derived = {};
        for (const [name, offset] of [['bigEyeBoy', 1], ['smallRoad', 2], ['cockroachRoad', 3]]) {
            const marks = [];
            for (let col = 0; col < runs.length; col++) {
                for (let row = 0; row < runs[col].cells.length; row++) {
                    let red;
                    if (row === 0) {
                        if (col < offset + 1) continue;
                        red = runs[col - 1].cells.length === runs[col - 1 - offset].cells.length;
                    } else {
                        if (col < offset) continue;
                        const comparisonLength = runs[col - offset].cells.length;
                        red = comparisonLength >= row + 1 || comparisonLength < row;
                    }
                    marks.push(red ? 'R' : 'U'); // R regular, U irregular; not B/P.
                }
            }
            derived[name] = stack(marks);
        }
        return {bead, big, bigEyeBoy: derived.bigEyeBoy, smallRoad: derived.smallRoad,
            cockroachRoad: derived.cockroachRoad, runs: runs.map(run => ({code: run.code, length: run.cells.length})),
            unplacedLeadingTies: decisive.length ? 0 : pendingTies};
    }
    return Object.freeze({build});
});
