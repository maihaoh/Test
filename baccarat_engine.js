/* Standard commission Punto Banco reference engine (read-only research).
 * Public rules: https://wizardofodds.com/games/baccarat/basics/
 * 8-deck reference frequencies: https://wizardofodds.com/games/baccarat/
 * No casino connection, wager placement, or forecasting of unseen cards.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BaccaratEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const REFERENCE_8_DECK = Object.freeze({B: 0.45859742, P: 0.44624661, T: 0.09515597});

    function numberInRange(value, low, high, name) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
            throw new RangeError(`${name} must be a finite number from ${low} to ${high}`);
        return value;
    }
    function configuration(opts = {}) {
        if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('Configuration must be an object');
        const decks = opts.decks ?? 8;
        if (!Number.isInteger(decks) || decks < 1 || decks > 12) throw new RangeError('Deck count must be 1..12');
        return {
            decks,
            bankerCommission: numberInRange(opts.bankerCommission ?? 0.05, 0, 1, 'Banker commission'),
            playerPayout: numberInRange(opts.playerPayout ?? 1, 0, 100, 'Player payout'),
            tiePayout: numberInRange(opts.tiePayout ?? 8, 0, 100, 'Tie payout')
        };
    }
    function makeShoe(decks = 8) {
        const {decks: count} = configuration({decks});
        // Baccarat face cards, tens -> 0; ace -> 1; two ... nine -> face value.
        return {counts: [16 * count, ...Array(9).fill(4 * count)], remaining: 52 * count};
    }
    function seededRandom(seed = 1) {
        if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be an integer');
        let state = seed >>> 0;
        return () => {
            state = (state + 0x6D2B79F5) >>> 0;
            let z = state;
            z = Math.imul(z ^ (z >>> 15), z | 1);
            z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
            return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
        };
    }
    function draw(shoe, random) {
        if (!shoe || !Array.isArray(shoe.counts) || shoe.counts.length !== 10 ||
            !Number.isInteger(shoe.remaining) || shoe.remaining < 1) throw new Error('Shoe is empty or invalid');
        const value = random();
        if (!(value >= 0 && value < 1)) throw new RangeError('Random source must return [0, 1)');
        let selection = Math.floor(value * shoe.remaining);
        for (let rank = 0; rank < shoe.counts.length; rank++) {
            selection -= shoe.counts[rank];
            if (selection < 0) {
                shoe.counts[rank]--;
                shoe.remaining--;
                return rank;
            }
        }
        throw new Error('Shoe counts do not match remaining card count');
    }
    function score(cards) { return cards.reduce((sum, rank) => sum + rank, 0) % 10; }
    function bankerDraws(total, playerThird) {
        if (!Number.isInteger(total) || total < 0 || total > 9) throw new RangeError('Invalid Banker total');
        if (playerThird === null) return total <= 5;
        if (!Number.isInteger(playerThird) || playerThird < 0 || playerThird > 9)
            throw new RangeError('Invalid Player third card');
        if (total <= 2) return true;
        if (total === 3) return playerThird !== 8;
        if (total === 4) return playerThird >= 2 && playerThird <= 7;
        if (total === 5) return playerThird >= 4 && playerThird <= 7;
        if (total === 6) return playerThird === 6 || playerThird === 7;
        return false;
    }
    function resolveHand(initialPlayer, initialBanker, nextCard) {
        if (![initialPlayer, initialBanker].every(cards => Array.isArray(cards) && cards.length === 2 &&
            cards.every(card => Number.isInteger(card) && card >= 0 && card <= 9)))
            throw new TypeError('The initial Banker and Player hands must have exactly two card point values each');
        if (typeof nextCard !== 'function') throw new TypeError('nextCard must be a function');
        const playerCards = initialPlayer.slice(), bankerCards = initialBanker.slice();
        let p = score(playerCards), b = score(bankerCards);
        const natural = p >= 8 || b >= 8;
        if (!natural) {
            let playerThird = null;
            if (p <= 5) {
                playerThird = nextCard();
                if (!Number.isInteger(playerThird) || playerThird < 0 || playerThird > 9)
                    throw new RangeError('Invalid Player third card');
                playerCards.push(playerThird);
                p = score(playerCards);
            }
            if (bankerDraws(b, playerThird)) {
                const bankerThird = nextCard();
                if (!Number.isInteger(bankerThird) || bankerThird < 0 || bankerThird > 9)
                    throw new RangeError('Invalid Banker third card');
                bankerCards.push(bankerThird);
                b = score(bankerCards);
            }
        }
        return {playerCards, bankerCards, playerTotal: p, bankerTotal: b,
            natural, winner: b > p ? 'B' : p > b ? 'P' : 'T'};
    }
    function dealHand(shoe, random = Math.random) {
        if (typeof random !== 'function') throw new TypeError('Random source must be a function');
        // Reserve enough cards for a legal complete hand. A new shoe must be
        // started between hands, not secretly midway through a hand.
        if (!shoe || shoe.remaining < 6) throw new Error('Reshuffle before dealing the next hand');
        const player = [draw(shoe, random)];
        const banker = [draw(shoe, random)];
        player.push(draw(shoe, random));
        banker.push(draw(shoe, random));
        return resolveHand(player, banker, () => draw(shoe, random));
    }
    function settleBet(bet, winner, amount = 1, options = {}) {
        if (!['B', 'P', 'T'].includes(bet) || !['B', 'P', 'T'].includes(winner))
            throw new TypeError('Bet and outcome must be B, P or T');
        numberInRange(amount, 0.000001, 1e12, 'Amount');
        const opts = configuration(options);
        if (bet === winner) return amount * (bet === 'B' ? 1 - opts.bankerCommission : bet === 'P' ? opts.playerPayout : opts.tiePayout);
        if (winner === 'T' && bet !== 'T') return 0; // Banker and Player PUSH on a tie.
        return -amount;
    }
    function referenceEV(options = {}) {
        const opts = configuration(options);
        if (opts.decks !== 8) return null; // No invented 1/2/6-deck exact probabilities.
        return {
            B: REFERENCE_8_DECK.B * (1 - opts.bankerCommission) - REFERENCE_8_DECK.P,
            P: REFERENCE_8_DECK.P * opts.playerPayout - REFERENCE_8_DECK.B,
            T: REFERENCE_8_DECK.T * opts.tiePayout - (1 - REFERENCE_8_DECK.T)
        };
    }
    function simulate(options = {}) {
        const config = configuration(options);
        const rounds = options.rounds ?? 1000;
        const bet = options.bet ?? 'B';
        const stake = options.stake ?? 1;
        const startingBankroll = options.bankroll ?? 1000;
        if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100000) throw new RangeError('Rounds must be 1..100000');
        if (!['B', 'P', 'T'].includes(bet)) throw new TypeError('Invalid bet');
        numberInRange(stake, 0.000001, 1e12, 'Stake');
        numberInRange(startingBankroll, stake, 1e15, 'Bankroll');
        const random = seededRandom(options.seed ?? 1);
        let shoe = makeShoe(config.decks);
        let bankroll = startingBankroll, peak = bankroll, maxDrawdown = 0;
        let wins = 0, losses = 0, pushes = 0, used = 0, totalWagered = 0, longestLossRun = 0, lossRun = 0;
        let hitStopLoss = false;
        const stopLoss = options.stopLoss ?? null;
        if (stopLoss !== null) numberInRange(stopLoss, 0, startingBankroll, 'Stop loss');
        for (let n = 0; n < rounds; n++) {
            if (bankroll < stake) break;
            if (stopLoss !== null && startingBankroll - bankroll >= stopLoss) { hitStopLoss = true; break; }
            if (shoe.remaining < 6) shoe = makeShoe(config.decks);
            const outcome = dealHand(shoe, random);
            const net = settleBet(bet, outcome.winner, stake, config);
            bankroll += net;
            totalWagered += stake;
            used++;
            if (net > 0) { wins++; lossRun = 0; }
            else if (net < 0) { losses++; lossRun++; longestLossRun = Math.max(longestLossRun, lossRun); }
            else pushes++;
            peak = Math.max(peak, bankroll);
            maxDrawdown = Math.max(maxDrawdown, peak - bankroll);
        }
        return {
            seed: options.seed ?? 1, decks: config.decks, bet, roundsRequested: rounds, roundsPlayed: used,
            wins, losses, pushes, hitStopLoss, depleted: bankroll < stake,
            endingBankroll: bankroll, netProfit: bankroll - startingBankroll, totalWagered,
            roi: totalWagered ? (bankroll - startingBankroll) / totalWagered : 0,
            maxDrawdown, longestLossRun, referenceEV: referenceEV(config)?.[bet] ?? null
        };
    }
    return Object.freeze({REFERENCE_8_DECK, configuration, makeShoe, seededRandom,
        bankerDraws, resolveHand, dealHand, settleBet, referenceEV, simulate});
});
