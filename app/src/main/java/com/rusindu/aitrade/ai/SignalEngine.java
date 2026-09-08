package com.rusindu.aitrade.ai;

import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;

import java.util.List;

/**
 * Turns live Binance candles into a signal.
 *
 * <p>Seven ATR-normalised features are computed from the closed candles, the adaptive model
 * combines them into a score in [-1, +1], and the score is mapped to BUY / SELL / NEUTRAL
 * with a configurable threshold.</p>
 */
public final class SignalEngine {

    public static final int EMA_FAST = 9;
    public static final int EMA_SLOW = 21;
    public static final int EMA_TREND = 50;
    public static final int RSI_PERIOD = 14;
    public static final int ATR_PERIOD = 14;
    public static final int BB_PERIOD = 20;
    public static final double BB_MULT = 2.0;
    public static final int STOCH_K = 14;
    public static final int STOCH_SMOOTH = 3;
    public static final int STOCH_D = 3;
    public static final int ROC_PERIOD = 10;

    public static final double DEFAULT_THRESHOLD = 0.22;

    private SignalEngine() {
    }

    /**
     * @param candles   oldest first
     * @param model     the adaptive model supplying feature weights
     * @param threshold score needed to leave NEUTRAL
     * @param dropLast  ignore the still-forming candle so signals do not repaint
     */
    public static Snapshot evaluate(List<Candle> candles, AdaptiveModel model,
                                    double threshold, boolean dropLast) {
        Snapshot s = new Snapshot();
        int total = candles == null ? 0 : candles.size();
        int n = dropLast && total > 1 ? total - 1 : total;
        s.candleCount = n;

        if (n < EMA_TREND + 5) {
            s.problem = "not_enough_data";
            s.valid = false;
            if (total > 0) s.price = candles.get(total - 1).close;
            return s;
        }

        double[] close = new double[n];
        double[] high = new double[n];
        double[] low = new double[n];
        double[] open = new double[n];
        double[] volume = new double[n];
        for (int i = 0; i < n; i++) {
            Candle c = candles.get(i);
            open[i] = c.open;
            high[i] = c.high;
            low[i] = c.low;
            close[i] = c.close;
            volume[i] = c.volume;
        }
        s.price = close[n - 1];
        s.candleTime = candles.get(n - 1).openTime;

        double[] rsi = Indicators.rsi(close, RSI_PERIOD);
        double[] atrA = Indicators.atr(high, low, close, ATR_PERIOD);
        double[] adxA = Indicators.adx(high, low, close, ATR_PERIOD);
        double[] emaF = Indicators.ema(close, EMA_FAST);
        double[] emaS = Indicators.ema(close, EMA_SLOW);
        double[] emaT = Indicators.ema(close, EMA_TREND);
        double[] volSma = Indicators.sma(volume, BB_PERIOD);
        double[] rocA = Indicators.roc(close, ROC_PERIOD);
        double[] pctB = Indicators.bollingerPctB(close, BB_PERIOD, BB_MULT);
        double[] bw = Indicators.bollingerBandWidth(close, BB_PERIOD, BB_MULT);
        double[][] macd = Indicators.macd(close, 12, 26, 9);
        double[][] stoch = Indicators.stochastic(high, low, close, STOCH_K, STOCH_SMOOTH, STOCH_D);

        s.emaFastSeries = emaF;
        s.emaSlowSeries = emaS;
        s.rsiSeries = rsi;

        s.rsi = Indicators.last(rsi);
        s.atr = Indicators.last(atrA);
        s.adx = Indicators.last(adxA);
        s.emaFast = Indicators.last(emaF);
        s.emaSlow = Indicators.last(emaS);
        s.ema50 = Indicators.last(emaT);
        s.pctB = Indicators.last(pctB);
        s.stochK = Indicators.last(stoch[0]);
        s.stochD = Indicators.last(stoch[1]);
        s.macdHist = Indicators.last(macd[2]);
        s.roc10 = Indicators.last(rocA);
        s.bandWidth = Indicators.last(bw);
        s.volRatio = (Indicators.last(volSma) > 0) ? volume[n - 1] / Indicators.last(volSma) : 1;
        s.atrPct = s.price > 0 ? s.atr / s.price * 100 : 0;

        double atrSafe = s.atr > 0 ? s.atr : Math.max(s.price * 0.001, 1e-9);

        // ---- features, each in [-1, +1], positive = bullish -----------------
        double[] f = new double[AdaptiveModel.FEATURES.length];

        // 0 RSI: mean reversion around 50
        f[0] = Indicators.clamp((50 - s.rsi) / 25.0, -1, 1);

        // 1 EMA ribbon distance, scaled by volatility
        f[1] = Indicators.clamp((s.emaFast - s.emaSlow) / (1.5 * atrSafe), -1, 1);

        // 2 MACD histogram, scaled by volatility
        f[2] = Indicators.clamp(s.macdHist / (0.75 * atrSafe), -1, 1);

        // 3 Bollinger %B: mean reversion inside the bands
        f[3] = Indicators.clamp((0.5 - s.pctB) * 2.5, -1, 1);

        // 4 Stochastic %K with a small bonus for a fresh %K/%D cross
        double st = Indicators.clamp((50 - s.stochK) / 25.0, -1, 1);
        double kPrev = Indicators.prev(stoch[0]);
        double dPrev = Indicators.prev(stoch[1]);
        if (!Double.isNaN(kPrev) && !Double.isNaN(dPrev)) {
            if (kPrev < dPrev && s.stochK > s.stochD) st = Indicators.clamp(st + 0.3, -1, 1);
            if (kPrev > dPrev && s.stochK < s.stochD) st = Indicators.clamp(st - 0.3, -1, 1);
        }
        f[4] = st;

        // 5 Momentum, in ATR units
        f[5] = Indicators.clamp(s.roc10 / Math.max(s.atrPct, 1e-6) / 2.5, -1, 1);

        // 6 Distance from the trend EMA, in ATR units
        f[6] = Indicators.clamp((s.price - s.ema50) / (3.0 * atrSafe), -1, 1);

        s.features = f;
        s.score = model.score(f);
        s.direction = Direction.of(s.score, threshold);

        // ---- confidence ------------------------------------------------------
        double pos = 0, neg = 0;
        for (double v : f) {
            if (v > 0) pos += v;
            else neg += -v;
        }
        double tot = pos + neg;
        double agreement = tot == 0 ? 0 : Math.max(pos, neg) / tot;
        double volFactor = Indicators.clamp(s.volRatio / 2.0, 0, 1);
        double adxFactor = Indicators.clamp(s.adx / 40.0, 0, 1);
        double conf = 0.55 * Math.abs(s.score) + 0.25 * agreement + 0.20 * volFactor;
        conf *= (0.75 + 0.25 * adxFactor);
        s.confidence = Indicators.clamp(conf, 0, 0.98);

        // ---- evidence --------------------------------------------------------
        addReason(s, s.rsi < 30 ? "rsi_oversold" : (s.rsi > 70 ? "rsi_overbought" : "rsi_mid"), s.rsi);
        addReason(s, s.emaFast > s.emaSlow ? "ema_bullish" : "ema_bearish", (s.emaFast - s.emaSlow));
        addReason(s, s.macdHist > 0 ? "macd_bullish" : "macd_bearish", s.macdHist);
        addReason(s, s.pctB < 0.05 ? "boll_below_lower" : (s.pctB > 0.95 ? "boll_above_upper" : "boll_inside"), s.pctB * 100);
        addReason(s, s.stochK > s.stochD ? "stoch_up" : "stoch_down", s.stochK);
        addReason(s, s.roc10 >= 0 ? "momentum_up" : "momentum_down", s.roc10);
        addReason(s, s.price > s.ema50 ? "trend_up" : "trend_down", s.atrPct);
        addReason(s, s.adx >= 25 ? "adx_trending" : "adx_ranging", s.adx);
        addReason(s, s.volRatio >= 1 ? "volume_high" : "volume_low", s.volRatio);

        s.valid = true;
        return s;
    }

    private static void addReason(Snapshot s, String code, double value) {
        if (!Double.isNaN(value)) s.reasons.add(new Snapshot.Reason(code, value));
    }
}
