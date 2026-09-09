package com.rusindu.aitrade.util;

import android.content.Context;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.Snapshot;

/** Maps the machine-readable evidence codes coming from the engine onto localised strings. */
public final class Reasons {

    private Reasons() {
    }

    public static String text(Context c, Snapshot.Reason r) {
        int id;
        String value;
        switch (r.code) {
            case "rsi_oversold":
                id = R.string.rsi_oversold;
                value = Fmt.num(r.value, 1);
                break;
            case "rsi_overbought":
                id = R.string.rsi_overbought;
                value = Fmt.num(r.value, 1);
                break;
            case "rsi_mid":
                id = R.string.rsi_mid;
                value = Fmt.num(r.value, 1);
                break;
            case "ema_bullish":
                id = R.string.ema_bullish;
                value = Fmt.num(r.value, 2);
                break;
            case "ema_bearish":
                id = R.string.ema_bearish;
                value = Fmt.num(r.value, 2);
                break;
            case "macd_bullish":
                id = R.string.macd_bullish;
                value = Fmt.num(r.value, 4);
                break;
            case "macd_bearish":
                id = R.string.macd_bearish;
                value = Fmt.num(r.value, 4);
                break;
            case "boll_below_lower":
                id = R.string.boll_below_lower;
                value = "";
                break;
            case "boll_above_upper":
                id = R.string.boll_above_upper;
                value = "";
                break;
            case "boll_inside":
                id = R.string.boll_inside;
                value = Fmt.num(r.value, 0);
                break;
            case "stoch_up":
                id = R.string.stoch_up;
                value = "";
                break;
            case "stoch_down":
                id = R.string.stoch_down;
                value = "";
                break;
            case "momentum_up":
                id = R.string.momentum_up;
                value = Fmt.pct(r.value, 2);
                break;
            case "momentum_down":
                id = R.string.momentum_down;
                value = Fmt.pct(r.value, 2);
                break;
            case "trend_up":
                id = R.string.trend_up;
                value = "";
                break;
            case "trend_down":
                id = R.string.trend_down;
                value = "";
                break;
            case "adx_trending":
                id = R.string.adx_trending;
                value = Fmt.num(r.value, 1);
                break;
            case "adx_ranging":
                id = R.string.adx_ranging;
                value = Fmt.num(r.value, 1);
                break;
            case "volume_high":
                id = R.string.volume_high;
                value = Fmt.num(r.value, 2);
                break;
            case "volume_low":
                id = R.string.volume_low;
                value = Fmt.num(r.value, 2);
                break;
            case "regime_trend":
                id = R.string.regime_trend;
                value = Fmt.num(r.value, 0) + "%";
                break;
            case "regime_range":
                id = R.string.regime_range;
                value = Fmt.num(r.value, 0) + "%";
                break;
            case "htf_up":
                id = R.string.htf_up;
                value = Fmt.num(r.value, 2);
                break;
            case "htf_down":
                id = R.string.htf_down;
                value = Fmt.num(r.value, 2);
                break;
            case "div_bull":
                id = R.string.div_bull;
                value = Fmt.num(r.value, 2);
                break;
            case "div_bear":
                id = R.string.div_bear;
                value = Fmt.num(r.value, 2);
                break;
            case "press_high":
                id = R.string.press_high;
                value = Fmt.num(r.value, 2);
                break;
            case "press_low":
                id = R.string.press_low;
                value = Fmt.num(r.value, 2);
                break;
            case "cand_bull":
                id = R.string.cand_bull;
                value = Fmt.num(r.value, 2);
                break;
            case "cand_bear":
                id = R.string.cand_bear;
                value = Fmt.num(r.value, 2);
                break;
            default:
                return r.code;
        }
        return c.getString(id, value);
    }
}
