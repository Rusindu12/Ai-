package com.rusindu.aitrade.ai;

import java.util.Arrays;

/**
 * Plain-Java technical indicator library.
 * Every method returns an array aligned with the input series; values that cannot be
 * computed yet (not enough history) are {@link Double#NaN}.
 */
public final class Indicators {

    private Indicators() {
    }

    public static double clamp(double v, double lo, double hi) {
        if (Double.isNaN(v)) return 0d;
        return Math.max(lo, Math.min(hi, v));
    }

    /** Last finite value of a series, or NaN. */
    public static double last(double[] a) {
        if (a == null || a.length == 0) return Double.NaN;
        return a[a.length - 1];
    }

    /** Previous value of a series, or NaN. */
    public static double prev(double[] a) {
        if (a == null || a.length < 2) return Double.NaN;
        return a[a.length - 2];
    }

    public static double[] sma(double[] src, int period) {
        int n = src.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        if (period <= 0) return out;
        double sum = 0;
        int cnt = 0;
        for (int i = 0; i < n; i++) {
            if (!Double.isNaN(src[i])) {
                sum += src[i];
                cnt++;
            }
            if (i >= period) {
                double drop = src[i - period];
                if (!Double.isNaN(drop)) {
                    sum -= drop;
                    cnt--;
                }
            }
            if (cnt == period) out[i] = sum / period;
        }
        return out;
    }

    public static double[] ema(double[] src, int period) {
        int n = src.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        if (n == 0 || period <= 0) return out;
        double k = 2.0 / (period + 1.0);
        double e = Double.NaN;
        for (int i = 0; i < n; i++) {
            if (Double.isNaN(src[i])) {
                out[i] = e;
                continue;
            }
            e = Double.isNaN(e) ? src[i] : src[i] * k + e * (1 - k);
            out[i] = e;
        }
        return out;
    }

    /** Wilder's RSI. */
    public static double[] rsi(double[] close, int period) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        if (n <= period || period <= 0) return out;
        double gain = 0, loss = 0;
        for (int i = 1; i <= period; i++) {
            double d = close[i] - close[i - 1];
            if (d >= 0) gain += d;
            else loss -= d;
        }
        gain /= period;
        loss /= period;
        out[period] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
        for (int i = period + 1; i < n; i++) {
            double d = close[i] - close[i - 1];
            double g = d > 0 ? d : 0;
            double l = d < 0 ? -d : 0;
            gain = (gain * (period - 1) + g) / period;
            loss = (loss * (period - 1) + l) / period;
            out[i] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
        }
        return out;
    }

    public static double[] trueRange(double[] high, double[] low, double[] close) {
        int n = close.length;
        double[] tr = new double[n];
        for (int i = 0; i < n; i++) {
            if (i == 0) {
                tr[i] = high[i] - low[i];
            } else {
                double a = high[i] - low[i];
                double b = Math.abs(high[i] - close[i - 1]);
                double c = Math.abs(low[i] - close[i - 1]);
                tr[i] = Math.max(a, Math.max(b, c));
            }
        }
        return tr;
    }

    /** Wilder's ATR. */
    public static double[] atr(double[] high, double[] low, double[] close, int period) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        double[] tr = trueRange(high, low, close);
        if (n <= period || period <= 0) return out;
        double sum = 0;
        for (int i = 1; i <= period; i++) sum += tr[i];
        double a = sum / period;
        out[period] = a;
        for (int i = period + 1; i < n; i++) {
            a = (a * (period - 1) + tr[i]) / period;
            out[i] = a;
        }
        return out;
    }

    /** Average Directional Index (Wilder). */
    public static double[] adx(double[] high, double[] low, double[] close, int period) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        if (period <= 0 || n < 2 * period + 1) return out;

        double[] tr = trueRange(high, low, close);
        double[] pdm = new double[n];
        double[] mdm = new double[n];
        for (int i = 1; i < n; i++) {
            double up = high[i] - high[i - 1];
            double dn = low[i - 1] - low[i];
            pdm[i] = (up > dn && up > 0) ? up : 0;
            mdm[i] = (dn > up && dn > 0) ? dn : 0;
        }

        double str = 0, spdm = 0, smdm = 0;
        for (int i = 1; i <= period; i++) {
            str += tr[i];
            spdm += pdm[i];
            smdm += mdm[i];
        }

        double[] dx = new double[n];
        Arrays.fill(dx, Double.NaN);
        for (int i = period; i < n; i++) {
            if (i > period) {
                str = str - str / period + tr[i];
                spdm = spdm - spdm / period + pdm[i];
                smdm = smdm - smdm / period + mdm[i];
            }
            double pdi = str == 0 ? 0 : 100 * spdm / str;
            double mdi = str == 0 ? 0 : 100 * smdm / str;
            double both = pdi + mdi;
            dx[i] = both == 0 ? 0 : 100 * Math.abs(pdi - mdi) / both;
        }

        double dxSum = 0;
        for (int i = period; i < 2 * period; i++) dxSum += dx[i];
        double adx = dxSum / period;
        out[2 * period - 1] = adx;
        for (int i = 2 * period; i < n; i++) {
            adx = (adx * (period - 1) + dx[i]) / period;
            out[i] = adx;
        }
        return out;
    }

    /** Rate of change in percent. */
    public static double[] roc(double[] close, int period) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        if (period <= 0) return out;
        for (int i = period; i < n; i++) {
            if (close[i - period] != 0) out[i] = (close[i] / close[i - period] - 1) * 100;
        }
        return out;
    }

    private static double[] rollingStd(double[] src, int period) {
        int n = src.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        for (int i = period - 1; i < n; i++) {
            double mean = 0;
            for (int j = i - period + 1; j <= i; j++) mean += src[j];
            mean /= period;
            double var = 0;
            for (int j = i - period + 1; j <= i; j++) {
                double d = src[j] - mean;
                var += d * d;
            }
            out[i] = Math.sqrt(var / period);
        }
        return out;
    }

    /** Bollinger %B: 0 = lower band, 1 = upper band. */
    public static double[] bollingerPctB(double[] close, int period, double mult) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        double[] mid = sma(close, period);
        double[] sd = rollingStd(close, period);
        for (int i = 0; i < n; i++) {
            if (Double.isNaN(mid[i]) || Double.isNaN(sd[i])) continue;
            double upper = mid[i] + mult * sd[i];
            double lower = mid[i] - mult * sd[i];
            double width = upper - lower;
            out[i] = width == 0 ? 0.5 : (close[i] - lower) / width;
        }
        return out;
    }

    /** Bollinger bandwidth as a fraction of the middle band. */
    public static double[] bollingerBandWidth(double[] close, int period, double mult) {
        int n = close.length;
        double[] out = new double[n];
        Arrays.fill(out, Double.NaN);
        double[] mid = sma(close, period);
        double[] sd = rollingStd(close, period);
        for (int i = 0; i < n; i++) {
            if (Double.isNaN(mid[i]) || Double.isNaN(sd[i]) || mid[i] == 0) continue;
            out[i] = (2 * mult * sd[i]) / mid[i];
        }
        return out;
    }

    /**
     * Stochastic oscillator.
     *
     * @return [0] = %K (smoothed), [1] = %D
     */
    public static double[][] stochastic(double[] high, double[] low, double[] close,
                                        int kPeriod, int smooth, int dPeriod) {
        int n = close.length;
        double[] rawK = new double[n];
        Arrays.fill(rawK, Double.NaN);
        for (int i = kPeriod - 1; i < n; i++) {
            double hh = Double.NEGATIVE_INFINITY;
            double ll = Double.POSITIVE_INFINITY;
            for (int j = i - kPeriod + 1; j <= i; j++) {
                if (high[j] > hh) hh = high[j];
                if (low[j] < ll) ll = low[j];
            }
            double range = hh - ll;
            rawK[i] = range == 0 ? 50 : 100 * (close[i] - ll) / range;
        }
        double[] k = sma(rawK, smooth);
        double[] d = sma(k, dPeriod);
        return new double[][]{k, d};
    }

    /**
     * MACD.
     *
     * @return [0] = MACD line, [1] = signal line, [2] = histogram
     */
    public static double[][] macd(double[] close, int fast, int slow, int signal) {
        int n = close.length;
        double[] ef = ema(close, fast);
        double[] es = ema(close, slow);
        double[] line = new double[n];
        for (int i = 0; i < n; i++) line[i] = ef[i] - es[i];
        double[] sig = ema(line, signal);
        double[] hist = new double[n];
        for (int i = 0; i < n; i++) hist[i] = line[i] - sig[i];
        return new double[][]{line, sig, hist};
    }
}
