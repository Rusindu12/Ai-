package com.rusindu.aitrade.trade;

import android.content.Context;

import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.util.Intervals;

import java.util.List;

/**
 * Safety rails for live AI trading.
 *
 * <p>Two independent guards, checked every tick before the policy is allowed to place an
 * order: a <b>drawdown guard</b> (paper-or-live equity more than {@code maxDrawdownPct}
 * under its remembered peak pauses auto-trading until it recovers) and a
 * <b>loss-streak cooldown</b> (three graded misses in a row pause new entries for three
 * candles so a confused model cannot machine-gun orders).</p>
 */
public final class RiskManager {

    private static final int STREAK_LIMIT = 3;
    private static final int COOLDOWN_CANDLES = 3;

    private RiskManager() {
    }

    /**
     * @return a string-resource code describing why auto-trading is blocked, or null
     *         when the policy may trade.
     */
    public static String blocked(Context c, Portfolio p, double price) {
        if (price <= 0 || p == null) return null;
        double equity = p.equity(price);
        double peak = Prefs.equityPeak(c);
        if (equity > peak) {
            peak = equity;
            Prefs.putEquityPeak(c, peak);
        }
        if (peak > 0) {
            double dd = (peak - equity) / peak * 100.0;
            if (dd > Prefs.maxDrawdownPct(c)) return "risk_blocked_dd";
        }
        if (System.currentTimeMillis() < Prefs.cooldownUntil(c)) return "risk_blocked_cool";
        return null;
    }

    /** After a grading pass: three consecutive misses start a cooldown. */
    public static void noteGrades(Context c, List<Signal> signals, long nowMs) {
        int streak = 0;
        for (Signal s : signals) {
            if (!s.graded) continue;
            if (s.correct) break;
            streak++;
        }
        if (streak >= STREAK_LIMIT && nowMs >= Prefs.cooldownUntil(c)) {
            long candleMs = Intervals.millis(Prefs.interval(c));
            Prefs.putCooldownUntil(c, nowMs + COOLDOWN_CANDLES * candleMs);
        }
    }
}
