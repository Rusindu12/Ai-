package com.rusindu.aitrade.ai;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;

/**
 * The learning part of the app — v3.
 *
 * <p>On top of the v2 regime-aware mixture of experts with AdaGrad steps, this version adds:
 * <ol>
 *   <li><b>Three more features</b> — RSI divergence, volume buying/selling pressure and a
 *       candlestick-pattern score (engulfing / hammer / shooting star) — bringing the
 *       ensemble to eleven inputs.</li>
 *   <li><b>Learned confidence.</b> Instead of a hand-tuned blend, a small online logistic
 *       regression over (|score|, feature agreement, volume factor, ADX factor, HTF
 *       agreement) is trained on every graded signal, so the confidence number becomes the
 *       model's own calibrated estimate of "this call wins".</li>
 *   <li><b>Per-expert adaptive thresholds.</b> Each expert keeps its own hit-rate EWMA; the
 *       effective threshold is the regime blend of the two expert factors, so a trend expert
 *       on a cold streak tightens trend entries without punishing range calls.</li>
 *   <li><b>Weight decay</b> towards the neutral weight on every step, so no feature can lock
 *       itself at the clip bounds forever.</li>
 * </ol>
 *
 * <p>Grading stays honest: after the horizon the volatility-normalised realised move is the
 * target for the delta rule, and a 1/0 hit is the target for the calibration. Everything runs
 * on the device.</p>
 */
public class AdaptiveModel {

    public static final String[] FEATURES = {"RSI", "EMA", "MACD", "BOLL", "STOCH", "MOM",
            "TREND", "HTF", "DIV", "PRESS", "CAND"};

    private static final double W_MIN = 0.05;
    private static final double W_MAX = 5.0;
    private static final double ADAGRAD_EPS = 1e-6;
    private static final double ACC_EW_DECAY = 0.8;
    private static final double WEIGHT_DECAY = 0.002;
    private static final double CALIB_LR = 0.05;
    private static final double[] CALIB_INIT = {3.0, 1.5, 0.8, 0.8, 0.5, -2.6};

    private final double[] wT; // trend-regime expert weights
    private final double[] wR; // range-regime expert weights
    private final double[] gT; // per-feature squared-gradient accumulators (AdaGrad)
    private final double[] gR;
    private final double[] calW; // logistic confidence calibration weights, bias last

    private double baseLr = 0.10;
    private double lastRegime = 0.5;

    // scoreboard
    private int graded;
    private int correct;
    private double sumDirectionalReturn;
    private double sumAbsoluteReturn;
    private double accEW = 0.5;  // global hit EWMA (kept for the UI / recent accuracy)
    private double accEWT = 0.5; // trend-expert hit EWMA
    private double accEWR = 0.5; // range-expert hit EWMA

    // per-expert scoreboard; the expert with regime majority owns the grade
    private int gradedT;
    private int correctT;
    private int gradedR;
    private int correctR;

    public AdaptiveModel() {
        wT = new double[FEATURES.length];
        wR = new double[FEATURES.length];
        gT = new double[FEATURES.length];
        gR = new double[FEATURES.length];
        calW = CALIB_INIT.clone();
        Arrays.fill(wT, 1.0);
        Arrays.fill(wR, 1.0);
    }

    public int size() {
        return wT.length;
    }

    // ------------------------------------------------------------------ scoring

    /** Blended score with the last seen regime; kept for callers without a regime at hand. */
    public double score(double[] f) {
        return score(f, lastRegime);
    }

    /**
     * Combined model output in [-1, +1]. {@code regime} in [0, 1]: 0 = ranging market
     * (range expert decides), 1 = trending market (trend expert decides).
     */
    public double score(double[] f, double regime) {
        lastRegime = Indicators.clamp(regime, 0, 1);
        double t = lin(wT, f);
        double r = lin(wR, f);
        return Indicators.clamp(lastRegime * t + (1 - lastRegime) * r, -1, 1);
    }

    private double lin(double[] w, double[] f) {
        double num = 0;
        double den = 0;
        for (int i = 0; i < w.length; i++) {
            double v = feat(f, i);
            num += w[i] * v;
            den += Math.abs(w[i]);
        }
        return den == 0 ? 0 : num / den;
    }

    private static double feat(double[] f, int i) {
        return (f != null && i < f.length && !Double.isNaN(f[i])) ? f[i] : 0;
    }

    // ------------------------------------------------------------------ calibrated confidence

    /**
     * Learned probability that the current call grades as a hit.
     * {@code x} = {|score|, feature agreement, volume factor, ADX factor, HTF agreement}.
     */
    public double confidence(double[] x) {
        double z = calW[calW.length - 1];
        for (int i = 0; i < x.length && i < calW.length - 1; i++) z += calW[i] * x[i];
        double p = 1.0 / (1.0 + Math.exp(-z));
        return Indicators.clamp(p, 0.02, 0.98);
    }

    /** One logistic-gradient step on a graded signal: target 1 on a hit, 0 on a miss. */
    public synchronized void learnCalibration(double[] x, boolean hit) {
        if (x == null || x.length == 0) return;
        double p = confidence(x);
        double err = (hit ? 1.0 : 0.0) - p;
        for (int i = 0; i < x.length && i < calW.length - 1; i++) calW[i] += CALIB_LR * err * x[i];
        calW[calW.length - 1] += CALIB_LR * err;
        for (int i = 0; i < calW.length; i++) calW[i] = Math.max(-10, Math.min(10, calW[i]));
    }

    // ------------------------------------------------------------------ learning

    public synchronized void learn(double[] f, double predicted, double outcome) {
        learn(f, predicted, outcome, lastRegime);
    }

    /**
     * One online step per expert. Each expert's responsibility is the regime mixture at
     * signal time; AdaGrad scales the per-feature step by the gradient history and a small
     * decay keeps pulling weights back towards neutral.
     */
    public synchronized void learn(double[] f, double predicted, double outcome, double regime) {
        double r = Indicators.clamp(regime, 0, 1);
        double target = Indicators.clamp(outcome, -1, 1);
        double err = target - Indicators.clamp(predicted, -1, 1);
        for (int i = 0; i < wT.length; i++) {
            double v = feat(f, i);
            double grad = err * v;
            double gg = grad * grad;

            gT[i] += gg;
            double nT = wT[i] + baseLr * r / Math.sqrt(ADAGRAD_EPS + gT[i]) * grad;
            wT[i] = clip(nT + WEIGHT_DECAY * (1 - nT));

            gR[i] += gg;
            double nR = wR[i] + baseLr * (1 - r) / Math.sqrt(ADAGRAD_EPS + gR[i]) * grad;
            wR[i] = clip(nR + WEIGHT_DECAY * (1 - nR));
        }
    }

    // ------------------------------------------------------------------ adaptive threshold

    /**
     * The score threshold the engine should actually use: the regime blend of the two
     * per-expert factors. A cold expert pushes its factor towards ×1.35 (wait for stronger
     * setups); a hot streak relaxes it towards ×0.7.
     */
    public double effectiveThreshold(double base) {
        double fT = Indicators.clamp(1.35 - 0.7 * accEWT, 0.65, 1.35);
        double fR = Indicators.clamp(1.35 - 0.7 * accEWR, 0.65, 1.35);
        return base * (lastRegime * fT + (1 - lastRegime) * fR);
    }

    /** EWMA of the directional hit rate in [0, 1]. */
    public double recentAccuracy() {
        return accEW;
    }

    // ------------------------------------------------------------------ scoreboard

    public synchronized void recordGrade(boolean hit, double directionalReturn,
                                         double absoluteReturn, double regime) {
        graded++;
        if (hit) correct++;
        sumDirectionalReturn += directionalReturn;
        sumAbsoluteReturn += Math.abs(absoluteReturn);
        accEW = ACC_EW_DECAY * accEW + (1 - ACC_EW_DECAY) * (hit ? 1 : 0);
        if (Indicators.clamp(regime, 0, 1) >= 0.5) {
            accEWT = ACC_EW_DECAY * accEWT + (1 - ACC_EW_DECAY) * (hit ? 1 : 0);
            gradedT++;
            if (hit) correctT++;
        } else {
            accEWR = ACC_EW_DECAY * accEWR + (1 - ACC_EW_DECAY) * (hit ? 1 : 0);
            gradedR++;
            if (hit) correctR++;
        }
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

    public int gradedTrend() {
        return gradedT;
    }

    public int gradedRange() {
        return gradedR;
    }

    public double accuracyTrend() {
        return gradedT == 0 ? Double.NaN : (double) correctT / gradedT;
    }

    public double accuracyRange() {
        return gradedR == 0 ? Double.NaN : (double) correctR / gradedR;
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

    public double regime() {
        return lastRegime;
    }

    // ------------------------------------------------------------------ weights

    /** Effective (regime-blended) weight of feature {@code i}. */
    public double weight(int i) {
        if (i < 0 || i >= wT.length) return 1.0;
        return lastRegime * wT[i] + (1 - lastRegime) * wR[i];
    }

    /** Effective weights, for persistence-compatible callers and the UI. */
    public double[] weights() {
        double[] out = new double[wT.length];
        for (int i = 0; i < out.length; i++) out[i] = weight(i);
        return out;
    }

    public void setWeights(double[] values) {
        for (int i = 0; i < wT.length && i < values.length; i++) {
            wT[i] = clip(values[i]);
            wR[i] = clip(values[i]);
        }
    }

    public double learningRate() {
        return baseLr;
    }

    public void setLearningRate(double lr) {
        this.baseLr = Math.max(0.001, Math.min(1.0, lr));
    }

    public synchronized void restoreStats(int gradedCount, int correctCount,
                                          double sumDir, double sumAbs) {
        graded = Math.max(0, gradedCount);
        correct = Math.max(0, Math.min(graded, correctCount));
        sumDirectionalReturn = sumDir;
        sumAbsoluteReturn = sumAbs;
    }

    public synchronized void copyFrom(AdaptiveModel o) {
        System.arraycopy(o.wT, 0, wT, 0, wT.length);
        System.arraycopy(o.wR, 0, wR, 0, wR.length);
        System.arraycopy(o.gT, 0, gT, 0, gT.length);
        System.arraycopy(o.gR, 0, gR, 0, gR.length);
        System.arraycopy(o.calW, 0, calW, 0, calW.length);
        baseLr = o.baseLr;
        lastRegime = o.lastRegime;
        graded = o.graded;
        correct = o.correct;
        sumDirectionalReturn = o.sumDirectionalReturn;
        sumAbsoluteReturn = o.sumAbsoluteReturn;
        accEW = o.accEW;
        accEWT = o.accEWT;
        accEWR = o.accEWR;
        gradedT = o.gradedT;
        correctT = o.correctT;
        gradedR = o.gradedR;
        correctR = o.correctR;
    }

    public synchronized void reset() {
        Arrays.fill(wT, 1.0);
        Arrays.fill(wR, 1.0);
        Arrays.fill(gT, 0);
        Arrays.fill(gR, 0);
        System.arraycopy(CALIB_INIT, 0, calW, 0, calW.length);
        graded = 0;
        correct = 0;
        sumDirectionalReturn = 0;
        sumAbsoluteReturn = 0;
        accEW = 0.5;
        accEWT = 0.5;
        accEWR = 0.5;
        gradedT = 0;
        correctT = 0;
        gradedR = 0;
        correctR = 0;
    }

    private static double clip(double v) {
        if (Double.isNaN(v)) return 1.0;
        return Math.max(W_MIN, Math.min(W_MAX, v));
    }

    // ------------------------------------------------------------------ persistence

    public String toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("wT", arr(wT));
            o.put("wR", arr(wR));
            o.put("gT", arr(gT));
            o.put("gR", arr(gR));
            o.put("cw", arr(calW));
            o.put("lr", baseLr);
            o.put("rg", lastRegime);
            o.put("g", graded);
            o.put("c", correct);
            o.put("sr", sumDirectionalReturn);
            o.put("sa", sumAbsoluteReturn);
            o.put("ae", accEW);
            o.put("aet", accEWT);
            o.put("aer", accEWR);
            o.put("gTn", gradedT);
            o.put("cTn", correctT);
            o.put("gRn", gradedR);
            o.put("cRn", correctR);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static JSONArray arr(double[] v) {
        JSONArray a = new JSONArray();
        for (double d : v) {
            try {
                a.put(d);
            } catch (Exception ignored) {
            }
        }
        return a;
    }

    private static void readArr(JSONArray a, double[] out) {
        if (a == null) return;
        for (int i = 0; i < out.length && i < a.length(); i++) out[i] = a.optDouble(i, out[i]);
    }

    public static AdaptiveModel fromJson(String json) {
        AdaptiveModel m = new AdaptiveModel();
        if (json == null || json.isEmpty()) return m;
        try {
            JSONObject o = new JSONObject(json);
            JSONArray aT = o.optJSONArray("wT");
            JSONArray aR = o.optJSONArray("wR");
            if (aT != null && aR != null) {
                readArr(aT, m.wT);
                readArr(aR, m.wR);
                for (int i = 0; i < m.wT.length; i++) {
                    m.wT[i] = clip(m.wT[i]);
                    m.wR[i] = clip(m.wR[i]);
                }
            } else {
                // v1 model: one weight vector — seed both experts from it
                JSONArray a = o.optJSONArray("w");
                if (a != null) {
                    for (int i = 0; i < m.wT.length && i < a.length(); i++) {
                        double v = clip(a.optDouble(i, 1.0));
                        m.wT[i] = v;
                        m.wR[i] = v;
                    }
                }
            }
            readArr(o.optJSONArray("gT"), m.gT);
            readArr(o.optJSONArray("gR"), m.gR);
            readArr(o.optJSONArray("cw"), m.calW);
            m.baseLr = Math.max(0.001, Math.min(1.0, o.optDouble("lr", 0.10)));
            m.lastRegime = Indicators.clamp(o.optDouble("rg", 0.5), 0, 1);
            m.graded = o.optInt("g", 0);
            m.correct = o.optInt("c", 0);
            m.sumDirectionalReturn = o.optDouble("sr", 0);
            m.sumAbsoluteReturn = o.optDouble("sa", 0);
            m.accEW = Indicators.clamp(o.optDouble("ae", 0.5), 0, 1);
            m.accEWT = Indicators.clamp(o.optDouble("aet", 0.5), 0, 1);
            m.accEWR = Indicators.clamp(o.optDouble("aer", 0.5), 0, 1);
            m.gradedT = o.optInt("gTn", 0);
            m.correctT = o.optInt("cTn", 0);
            m.gradedR = o.optInt("gRn", 0);
            m.correctR = o.optInt("cRn", 0);
        } catch (Exception ignored) {
        }
        return m;
    }
}
