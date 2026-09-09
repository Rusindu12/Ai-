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
    public static final double TP_ATR = 3.0;
    public static final double TRAIL_ATR = 1.5;

    public static class Decision {
        public final int action;
        public final String code; // localised-string code explaining the call

        public Decision(int action, String code) {
            this.action = action;
            this.code = code;
        }
    }

    private Policy() {
    }

    /**
     * @param snap       latest market evaluation (score, confidence, direction, ATR%)
     * @param threshold  effective score threshold from the adaptive model
     * @param minConf    minimum confidence gate
     * @param inPosition whether a spot position is currently open
     * @param entryPx    position entry price (ignored when flat)
     * @param peakPx     best price seen since entry (ignored when flat)
     */
    public static Decision decide(Snapshot snap, double threshold, double minConf,
                                  boolean inPosition, double entryPx, double peakPx) {
        if (snap == null || !snap.valid) return new Decision(HOLD, "act_wait");
        double price = snap.price;
        double atrPct = Math.max(snap.atrPct, 1e-9);

        if (!inPosition) {
            if (snap.direction == Direction.BUY && snap.confidence >= minConf) {
                return new Decision(BUY, "act_buy");
            }
            if (snap.direction == Direction.BUY) {
                return new Decision(HOLD, "act_wait_conf"); // right idea, not enough confidence
            }
            if (snap.direction == Direction.SELL) {
                return new Decision(HOLD, "act_flat_bear"); // spot cannot short: wait
            }
            return new Decision(HOLD, "act_wait");
        }

        if (entryPx <= 0 || price <= 0) return new Decision(HOLD, "act_hold");
        double upPct = (price - entryPx) / entryPx * 100.0;

        // model turned against the position
        if (snap.direction == Direction.SELL && Math.abs(snap.score) >= threshold) {
            return new Decision(SELL, "act_exit_reverse");
        }
        // hard stop
        if (upPct <= -SL_ATR * atrPct) {
            return new Decision(SELL, "act_exit_sl");
        }
        // take profit
        if (upPct >= TP_ATR * atrPct) {
            return new Decision(SELL, "act_exit_tp");
        }
        // trailing stop: give back trailAtr × ATR from the peak since entry
        double peak = Math.max(peakPx, price);
        if (peak > entryPx && (peak - price) / peak * 100.0 >= TRAIL_ATR * atrPct) {
            return new Decision(SELL, "act_exit_trail");
        }
        return new Decision(HOLD, "act_hold");
    }

    public static String key(int action) {
        if (action == BUY) return "BUY";
        if (action == SELL) return "SELL";
        return "HOLD";
    }
}
