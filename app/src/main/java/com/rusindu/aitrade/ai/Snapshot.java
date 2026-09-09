package com.rusindu.aitrade.ai;

import java.util.ArrayList;
import java.util.List;

/** Everything the UI needs from one evaluation of the market. */
public class Snapshot {

    /** Human-readable evidence behind the signal. {@code code} maps to a string resource. */
    public static class Reason {
        public final String code;
        public final double value;

        public Reason(String code, double value) {
            this.code = code;
            this.value = value;
        }
    }

    public double[] features = new double[0];
    public double score;
    public int direction;
    public double confidence;
    /** 0 = ranging market, 1 = trending market; blends the two model experts. */
    public double regime = 0.5;
    /** The score threshold actually applied to this evaluation. */
    public double threshold;

    public double price;
    public double atr;
    public double atrPct;
    public double rsi = Double.NaN;
    public double macdHist = Double.NaN;
    public double emaFast = Double.NaN;
    public double emaSlow = Double.NaN;
    public double ema50 = Double.NaN;
    public double pctB = Double.NaN;
    public double stochK = Double.NaN;
    public double stochD = Double.NaN;
    public double adx = Double.NaN;
    public double volRatio = Double.NaN;
    public double roc10 = Double.NaN;
    public double bandWidth = Double.NaN;

    public double[] emaFastSeries = new double[0];
    public double[] emaSlowSeries = new double[0];
    public double[] rsiSeries = new double[0];

    public long candleTime;
    public int candleCount;
    public final List<Reason> reasons = new ArrayList<>();

    public boolean valid;
    public String problem;
}
