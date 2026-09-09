package com.rusindu.aitrade.core;

import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.SignalEngine;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;

import java.util.List;

/**
 * On-device trainer.
 *
 * <p>Replays the recent history walk-forward for several epochs — exactly the way the
 * model learns live (delta rule + AdaGrad + calibration, one graded outcome per signal) —
 * but after every epoch it scores the model on a held-out validation window and keeps the
 * best weights by out-of-sample hit rate. If no epoch beats the model you already have,
 * nothing is applied. That early-stopping on validation accuracy is what keeps this
 * honest training instead of curve-fitting to history.</p>
 */
public final class Trainer {

    public interface Progress {
        void onEpoch(int epoch, double valAccuracyPct);
    }

    public static class Result {
        public boolean enough;
        public int epochsRun;
        public int bestEpoch;
        public double valBefore; // validation hit rate % of the current model
        public double valBest;   // best validation hit rate % seen
        public int trainTrades;  // graded learning events across all epochs
        public boolean improved;
        public String bestJson = "";
    }

    private static final int WARMUP = 60;
    private static final int MAX_CANDLES = 500;
    private static final int TRAIN_STEP = 2;
    private static final int VAL_STEP = 3;

    private Trainer() {
    }

    public static Result run(List<Candle> all, AdaptiveModel seed, double threshold,
                             int horizon, double minConf, int maxEpochs, Progress cb) {
        Result r = new Result();
        int total = all == null ? 0 : all.size();
        List<Candle> candles = all.subList(Math.max(0, total - MAX_CANDLES), total);
        int n = candles.size();
        int valStart = n - n / 4;
        if (n < WARMUP + 4 * horizon + 40 || valStart <= WARMUP + horizon + 10) {
            r.enough = false;
            return r;
        }
        r.enough = true;
        int h = Math.max(1, horizon);

        AdaptiveModel model = new AdaptiveModel();
        model.copyFrom(seed);

        double[] pre = measure(candles, model, valStart, n - 1 - h, threshold, h, minConf);
        r.valBefore = pct(pre);
        double bestAcc = r.valBefore;
        String bestJson = model.toJson();

        int stale = 0;
        for (int epoch = 1; epoch <= maxEpochs; epoch++) {
            for (int i = WARMUP; i < valStart - h; i += TRAIN_STEP) {
                Snapshot s = SignalEngine.evaluate(candles.subList(0, i + 1), model,
                        model.effectiveThreshold(threshold), false);
                if (!s.valid || s.direction == Direction.NEUTRAL) continue;
                double exit = candles.get(i + h).close;
                if (s.price <= 0 || exit <= 0) continue;
                double raw = s.direction * (exit - s.price) / s.price * 100.0;
                double outcome = clamp(raw / Math.max(s.atrPct, 1e-6) / 1.5);
                boolean hit = s.direction * raw > 0;
                model.learn(s.features, s.score, outcome, s.regime);
                model.recordGrade(hit, s.direction * raw, raw, s.regime);
                model.learnCalibration(s.calx, hit);
                r.trainTrades++;
            }

            double[] vm = measure(candles, model, valStart, n - 1 - h, threshold, h, minConf);
            double acc = pct(vm);
            r.epochsRun = epoch;
            if (cb != null) cb.onEpoch(epoch, acc);
            if (vm[1] >= 5 && acc > bestAcc + 0.5) {
                bestAcc = acc;
                bestJson = model.toJson();
                r.bestEpoch = epoch;
                r.improved = true;
                stale = 0;
            } else {
                stale++;
                if (stale >= 2) break;
            }
        }

        r.valBest = bestAcc;
        r.bestJson = bestJson;
        return r;
    }

    /** Walk-forward hit rate over [from, to], no learning. Returns {hits, signals}. */
    private static double[] measure(List<Candle> candles, AdaptiveModel model,
                                    int from, int to, double threshold, int horizon,
                                    double minConf) {
        double hits = 0, signals = 0;
        int n = candles.size();
        for (int i = Math.max(WARMUP, from); i <= to; i += VAL_STEP) {
            Snapshot s = SignalEngine.evaluate(candles.subList(0, i + 1), model,
                    model.effectiveThreshold(threshold), false);
            if (!s.valid || s.direction == Direction.NEUTRAL || s.confidence < minConf) continue;
            double move = candles.get(i + horizon).close - candles.get(i).close;
            if (move == 0) continue;
            signals++;
            if (s.direction * move > 0) hits++;
        }
        return new double[]{hits, signals};
    }

    private static double pct(double[] hitsSignals) {
        return hitsSignals[1] == 0 ? 0 : hitsSignals[0] / hitsSignals[1] * 100.0;
    }

    private static double clamp(double v) {
        return Math.max(-1, Math.min(1, v));
    }
}
