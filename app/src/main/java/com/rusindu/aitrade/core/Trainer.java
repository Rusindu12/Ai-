package com.rusindu.aitrade.core;

import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.SignalEngine;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;

import java.util.ArrayList;
import java.util.List;

/**
 * On-device trainer.
 *
 * <p>Replays history walk-forward for several epochs — exactly the way the model learns
 * live (delta rule + AdaGrad + calibration, one graded outcome per signal) — over one or
 * several symbols, and after every epoch scores the model on held-out validation windows
 * and keeps the best weights by out-of-sample hit rate. If no epoch beats the model you
 * already have, nothing is applied. That early-stopping on validation accuracy is what
 * keeps this honest training instead of curve-fitting to history.</p>
 *
 * <p>Training across several symbols at once is deliberate: the features are all
 * ATR-normalised, so the same weights apply everywhere, and seeing many markets teaches
 * the experts which patterns generalise instead of memorising one chart.</p>
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

    public static Result run(List<List<Candle>> sets, AdaptiveModel seed, double threshold,
                             int horizon, double minConf, int maxEpochs, Progress cb) {
        Result r = new Result();
        int h = Math.max(1, horizon);

        List<int[]> bounds = new ArrayList<>(); // per usable set: {n, valStart}
        List<List<Candle>> usable = new ArrayList<>();
        if (sets != null) {
            for (List<Candle> all : sets) {
                if (all == null) continue;
                List<Candle> candles = all.subList(Math.max(0, all.size() - MAX_CANDLES), all.size());
                int n = candles.size();
                int valStart = n - n / 4;
                if (n < WARMUP + 4 * h + 40 || valStart <= WARMUP + h + 10) continue;
                usable.add(candles);
                bounds.add(new int[]{n, valStart});
            }
        }
        if (usable.isEmpty()) {
            r.enough = false;
            return r;
        }
        r.enough = true;

        AdaptiveModel model = new AdaptiveModel();
        model.copyFrom(seed);

        r.valBefore = validate(usable, bounds, model, threshold, h, minConf);
        double bestAcc = r.valBefore;
        String bestJson = model.toJson();

        int stale = 0;
        for (int epoch = 1; epoch <= maxEpochs; epoch++) {
            for (int s = 0; s < usable.size(); s++) {
                List<Candle> candles = usable.get(s);
                int valStart = bounds.get(s)[1];
                for (int i = WARMUP; i < valStart - h; i += TRAIN_STEP) {
                    Snapshot sn = SignalEngine.evaluate(candles.subList(0, i + 1), model,
                            model.effectiveThreshold(threshold), false);
                    if (!sn.valid || sn.direction == Direction.NEUTRAL) continue;
                    double exit = candles.get(i + h).close;
                    if (sn.price <= 0 || exit <= 0) continue;
                    double raw = sn.direction * (exit - sn.price) / sn.price * 100.0;
                    double outcome = clamp(raw / Math.max(sn.atrPct, 1e-6) / 1.5);
                    boolean hit = sn.direction * raw > 0;
                    model.learn(sn.features, sn.score, outcome, sn.regime);
                    model.recordGrade(hit, sn.direction * raw, raw, sn.regime);
                    model.learnCalibration(sn.calx, hit);
                    r.trainTrades++;
                }
            }

            double acc = validate(usable, bounds, model, threshold, h, minConf);
            r.epochsRun = epoch;
            if (cb != null) cb.onEpoch(epoch, acc);
            if (acc > bestAcc + 0.5) {
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

    /** Pooled walk-forward hit rate over the validation windows of all sets, no learning. */
    private static double validate(List<List<Candle>> usable, List<int[]> bounds,
                                   AdaptiveModel model, double threshold, int horizon,
                                   double minConf) {
        double hits = 0, signals = 0;
        for (int s = 0; s < usable.size(); s++) {
            List<Candle> candles = usable.get(s);
            int n = bounds.get(s)[0];
            int valStart = bounds.get(s)[1];
            for (int i = Math.max(WARMUP, valStart); i <= n - 1 - horizon; i += VAL_STEP) {
                Snapshot sn = SignalEngine.evaluate(candles.subList(0, i + 1), model,
                        model.effectiveThreshold(threshold), false);
                if (!sn.valid || sn.direction == Direction.NEUTRAL || sn.confidence < minConf) continue;
                double move = candles.get(i + horizon).close - candles.get(i).close;
                if (move == 0) continue;
                signals++;
                if (sn.direction * move > 0) hits++;
            }
        }
        return signals == 0 ? 0 : hits / signals * 100.0;
    }

    private static double clamp(double v) {
        return Math.max(-1, Math.min(1, v));
    }
}
