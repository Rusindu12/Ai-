package com.rusindu.aitrade.ai;

import com.rusindu.aitrade.model.Direction;

/**
 * Position-aware spot-trading policy: every tick the AI answers one question —
 * <b>BUY, HOLD or SELL?</b> — with the open position taken into account.
 *
 * <p>Spot rules are honoured: with no position a bearish call is a HOLD (there is no
 * shorting), and SELL only ever means "close the long we own". Exits are managed three
 * ways, all in ATR multiples so they scale with volatility: a model flip against the
 * position, a take-profit target, a hard stop, and a trailing stop that lets winners run
 * until they give back {@code trailAtr} × ATR from the peak since entry.</p>
 */
public final class Policy {

    public static final int HOLD = 0;
    public static final int BUY = 1;
    public static final int SELL = 2;

    /** Exit levels, in ATR multiples of the entry price. */
    public static final double SL_ATR = 2.0;
    public static final double TP1_ATR = 2.0; // first target: book half
    public static final double TP_ATR = 3.0;  // full target for the remainder
    public static final double TRAIL_ATR = 1.5;
    public static final double BE_ATR = 1.0;  // once +1×ATR reached, never accept a loss
    public static final int DEAD_CANDLES = 12;
    public static final double DEAD_ATR = 0.5;

    public static class Decision {
        public final int action;
        public final String code; // localised-string code explaining the call
        public final double fraction; // of the open position to close (1 = everything)

        public Decision(int action, String code, double fraction) {
            this.action = action;
            this.code = code;
            this.fraction = fraction;
        }
    }

    private Policy() {
    }

    /**
     * @param snap         latest market evaluation (score, confidence, direction, ATR%)
     * @param threshold    effective score threshold from the adaptive model
     * @param minConf      minimum confidence gate
     * @param inPosition   whether a spot position is currently open
     * @param entryPx      position entry price (ignored when flat)
     * @param peakPx       best price seen since entry (ignored when flat)
     * @param partialTaken whether the first take-profit has already been booked
     * @param candlesHeld  candles the position has been open
     */
    public static Decision decide(Snapshot snap, double threshold, double minConf,
                                  boolean inPosition, double entryPx, double peakPx,
                                  boolean partialTaken, int candlesHeld) {
        if (snap == null || !snap.valid) return new Decision(HOLD, "act_wait", 1);
        double price = snap.price;
        double atrPct = Math.max(snap.atrPct, 1e-9);

        if (!inPosition) {
            if (snap.direction == Direction.BUY && snap.confidence >= minConf) {
                return new Decision(BUY, "act_buy", 1);
            }
            if (snap.direction == Direction.BUY) {
                return new Decision(HOLD, "act_wait_conf", 1); // right idea, not enough confidence
            }
            if (snap.direction == Direction.SELL) {
                return new Decision(HOLD, "act_flat_bear", 1); // spot cannot short: wait
            }
            return new Decision(HOLD, "act_wait", 1);
        }

        if (entryPx <= 0 || price <= 0) return new Decision(HOLD, "act_hold", 1);
        double upPct = (price - entryPx) / entryPx * 100.0;
        double peak = Math.max(peakPx, price);
        double peakUpPct = (peak - entryPx) / entryPx * 100.0;

        // model turned against the position
        if (snap.direction == Direction.SELL && Math.abs(snap.score) >= threshold) {
            return new Decision(SELL, "act_exit_reverse", 1);
        }
        // hard stop (after the first target this is effectively a break-even floor)
        if (upPct <= -SL_ATR * atrPct) {
            return new Decision(SELL, "act_exit_sl", 1);
        }
        // break-even stop: once the trade was +1×ATR, never let it turn into a loss
        if (peakUpPct >= BE_ATR * atrPct && upPct <= 0) {
            return new Decision(SELL, "act_exit_be", 1);
        }
        // first take-profit: book half, let the rest run
        if (!partialTaken && upPct >= TP1_ATR * atrPct) {
            return new Decision(SELL, "act_exit_tp1", 0.5);
        }
        // full take-profit for what is left
        if (upPct >= TP_ATR * atrPct) {
            return new Decision(SELL, "act_exit_tp", 1);
        }
        // trailing stop: give back trailAtr × ATR from the peak since entry
        if (peak > entryPx && (peak - price) / peak * 100.0 >= TRAIL_ATR * atrPct) {
            return new Decision(SELL, "act_exit_trail", 1);
        }
        // dead trade: capital asleep for too long — free it for the next setup
        if (candlesHeld >= DEAD_CANDLES && Math.abs(upPct) < DEAD_ATR * atrPct) {
            return new Decision(SELL, "act_exit_dead", 1);
        }
        return new Decision(HOLD, "act_hold", 1);
    }

    public static String key(int action) {
        if (action == BUY) return "BUY";
        if (action == SELL) return "SELL";
        return "HOLD";
    }
}
