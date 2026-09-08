package com.rusindu.aitrade.ai;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;

/**
 * The learning part of the app.
 *
 * <p>A signal is a weighted linear combination of technical features. Every feature is
 * normalised to [-1, +1] (positive = bullish) and normalised by ATR where it is a price
 * distance, so the same weights work on every symbol and timeframe.</p>
 *
 * <p>After each signal, the app waits for the evaluation horizon, measures what the market
 * actually did and updates the weights with the delta rule
 * <pre>w_i &lt;- clip(w_i + lr * (outcome - prediction) * feature_i)</pre>
 * That is a real online learning loop: features that keep being wrong lose influence and
 * features that keep being right gain influence. Everything runs on the device.</p>
 */
public class AdaptiveModel {

    public static final String[] FEATURES = {"RSI", "EMA", "MACD", "BOLL", "STOCH", "MOM", "TREND"};

    private static final double W_MIN = 0.05;
    private static final double W_MAX = 5.0;

    private final double[] w;
    private double learningRate = 0.10;

    private int graded;
    private int correct;
    private double sumDirectionalReturn;
    private double sumAbsoluteReturn;

    public AdaptiveModel() {
        w = new double[FEATURES.length];
        Arrays.fill(w, 1.0);
    }

    public int size() {
        return w.length;
    }

    public double[] weights() {
        return Arrays.copyOf(w, w.length);
    }

    public void setWeights(double[] values) {
        for (int i = 0; i < w.length && i < values.length; i++) {
            w[i] = clip(values[i]);
        }
    }

    public double weight(int i) {
        return w[i];
    }

    public double learningRate() {
        return learningRate;
    }

    public void setLearningRate(double lr) {
        this.learningRate = Math.max(0.001, Math.min(1.0, lr));
    }

    /** Combined model output in [-1, +1]. */
    public double score(double[] f) {
        double num = 0;
        double den = 0;
        for (int i = 0; i < w.length; i++) {
            double v = (f != null && i < f.length && !Double.isNaN(f[i])) ? f[i] : 0;
            num += w[i] * v;
            den += Math.abs(w[i]);
        }
        return den == 0 ? 0 : Indicators.clamp(num / den, -1, 1);
    }

    /** One online gradient step. {@code outcome} is the volatility-normalised realised move. */
    public synchronized void learn(double[] f, double predicted, double outcome) {
        double target = Indicators.clamp(outcome, -1, 1);
        double err = target - Indicators.clamp(predicted, -1, 1);
        for (int i = 0; i < w.length; i++) {
            double v = (f != null && i < f.length && !Double.isNaN(f[i])) ? f[i] : 0;
            w[i] = clip(w[i] + learningRate * err * v);
        }
    }

    /** Bookkeeping for the scoreboard. */
    public synchronized void recordGrade(boolean hit, double directionalReturn, double absoluteReturn) {
        graded++;
        if (hit) correct++;
        sumDirectionalReturn += directionalReturn;
        sumAbsoluteReturn += Math.abs(absoluteReturn);
    }

    public int gradedCount() {
        return graded;
    }

    public int correctCount() {
        return correct;
    }

    /** Directional hit rate in [0, 1], or NaN when nothing has been graded yet. */
    public double accuracy() {
        return graded == 0 ? Double.NaN : (double) correct / graded;
    }

    /** Average % return of following the signals (long when BUY, short when SELL). */
    public double averageReturn() {
        return graded == 0 ? Double.NaN : sumDirectionalReturn / graded;
    }

    public double averageMove() {
        return graded == 0 ? Double.NaN : sumAbsoluteReturn / graded;
    }

    public double sumDirectionalReturn() {
        return sumDirectionalReturn;
    }

    public double sumAbsoluteReturn() {
        return sumAbsoluteReturn;
    }

    /** Restores the scoreboard after a restart. */
    public synchronized void restoreStats(int gradedCount, int correctCount,
                                          double sumDir, double sumAbs) {
        graded = Math.max(0, gradedCount);
        correct = Math.max(0, Math.min(graded, correctCount));
        sumDirectionalReturn = sumDir;
        sumAbsoluteReturn = sumAbs;
    }

    public synchronized void reset() {
        Arrays.fill(w, 1.0);
        graded = 0;
        correct = 0;
        sumDirectionalReturn = 0;
        sumAbsoluteReturn = 0;
    }

    private static double clip(double v) {
        if (Double.isNaN(v)) return 1.0;
        return Math.max(W_MIN, Math.min(W_MAX, v));
    }

    public String toJson() {
        JSONObject o = new JSONObject();
        try {
            JSONArray a = new JSONArray();
            for (double v : w) a.put(v);
            o.put("w", a);
            o.put("lr", learningRate);
            o.put("g", graded);
            o.put("c", correct);
            o.put("sr", sumDirectionalReturn);
            o.put("sa", sumAbsoluteReturn);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    public static AdaptiveModel fromJson(String json) {
        AdaptiveModel m = new AdaptiveModel();
        if (json == null || json.isEmpty()) return m;
        try {
            JSONObject o = new JSONObject(json);
            JSONArray a = o.optJSONArray("w");
            if (a != null) {
                for (int i = 0; i < m.w.length && i < a.length(); i++) {
                    m.w[i] = clip(a.optDouble(i, 1.0));
                }
            }
            m.learningRate = Math.max(0.001, Math.min(1.0, o.optDouble("lr", 0.10)));
            m.graded = o.optInt("g", 0);
            m.correct = o.optInt("c", 0);
            m.sumDirectionalReturn = o.optDouble("sr", 0);
            m.sumAbsoluteReturn = o.optDouble("sa", 0);
        } catch (Exception ignored) {
        }
        return m;
    }
}
