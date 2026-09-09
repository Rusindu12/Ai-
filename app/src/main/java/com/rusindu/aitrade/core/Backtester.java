package com.rusindu.aitrade.core;

import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.SignalEngine;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.model.BacktestResult;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;

import java.util.List;

/**
 * Walk-forward replay of the model over historical candles.
 *
 * <p>One position at a time, held for the grading horizon, 0.1% taker fee each way, long and
 * short treated symmetrically. When {@code learn} is true the model starts from uniform
 * weights and updates itself as the replay progresses — which is exactly how it behaves live,
 * so the result measures the learning loop and not a look-ahead oracle.</p>
 */
public final class Backtester {

    private static final int WARMUP = 60;
    private static final double FEE_PCT = 0.1;

    private Backtester() {
    }

    public static BacktestResult run(List<Candle> candles, AdaptiveModel seed, double threshold,
                                     int horizon, double minConfidence, boolean learn) {
        BacktestResult r = new BacktestResult();
        int n = candles == null ? 0 : candles.size();
        r.candles = n;
        if (n < WARMUP + horizon + 5) {
            r.enough = false;
            return r;
        }
        r.enough = true;

        AdaptiveModel model = learn
                ? new AdaptiveModel()
                : AdaptiveModel.fromJson(seed == null ? "" : seed.toJson());

        double equity = 1.0;
        double peak = 1.0;
        r.equity.add(1.0);

        boolean inPosition = false;
        int direction = 0;
        double entry = 0;
        double atrPctAtEntry = 0;
        double scoreAtEntry = 0;
        double[] featuresAtEntry = new double[0];
        int exitAt = 0;
        double sumReturn = 0;

        int last = n - horizon - 1;
        for (int i = WARMUP; i <= last; i++) {
            double close = candles.get(i).close;

            if (inPosition) {
                if (i >= exitAt) {
                    double exit = candles.get(i).close;
                    double raw = direction * (exit - entry) / entry * 100.0;
                    double net = raw - 2 * FEE_PCT;
                    equity *= (1 + net / 100.0);
                    r.trades++;
                    sumReturn += net;
                    if (net > 0) r.wins++;

                    if (learn) {
                        double outcome = Math.max(-1, Math.min(1, raw / Math.max(atrPctAtEntry, 1e-6) / 1.5));
                        model.learn(featuresAtEntry, scoreAtEntry, outcome);
                    }
                    inPosition = false;
                }
                r.equity.add(equity);
                if (equity > peak) peak = equity;
                double dd = (peak - equity) / peak * 100.0;
                if (dd > r.maxDrawdownPct) r.maxDrawdownPct = dd;
                continue;
            }

            Snapshot s = SignalEngine.evaluate(candles.subList(0, i + 1), model, threshold, false);
            if (!s.valid || s.direction == Direction.NEUTRAL) {
                r.equity.add(equity);
                if (equity > peak) peak = equity;
                double dd = (peak - equity) / peak * 100.0;
                if (dd > r.maxDrawdownPct) r.maxDrawdownPct = dd;
                continue;
            }
            if (s.confidence < minConfidence) {
                r.equity.add(equity);
                continue;
            }

            inPosition = true;
            direction = s.direction;
            entry = close;
            atrPctAtEntry = s.atrPct;
            scoreAtEntry = s.score;
            featuresAtEntry = s.features;
            exitAt = i + Math.max(1, horizon);
        }

        // close whatever is still open at the end of the window
        if (inPosition) {
            double exit = candles.get(n - 1).close;
            double raw = direction * (exit - entry) / entry * 100.0;
            double net = raw - 2 * FEE_PCT;
            equity *= (1 + net / 100.0);
            r.trades++;
            sumReturn += net;
            if (net > 0) r.wins++;
            r.equity.add(equity);
            if (equity > peak) peak = equity;
            double dd = (peak - equity) / peak * 100.0;
            if (dd > r.maxDrawdownPct) r.maxDrawdownPct = dd;
        }

        r.totalReturnPct = (equity - 1) * 100.0;
        r.winRatePct = r.trades == 0 ? 0 : (double) r.wins / r.trades * 100.0;
        r.averageTradePct = r.trades == 0 ? 0 : sumReturn / r.trades;

        double first = candles.get(WARMUP).close;
        double lastClose = candles.get(n - 1).close;
        r.buyHoldPct = first == 0 ? 0 : (lastClose / first - 1) * 100.0;
        return r;
    }
}
