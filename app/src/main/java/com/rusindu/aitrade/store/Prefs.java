package com.rusindu.aitrade.store;

import android.content.Context;
import android.content.SharedPreferences;

/** Thin typed wrapper over SharedPreferences - single source of truth for settings. */
public final class Prefs {

    public static final String FILE = "ai_trade_prefs";

    public static final String K_LANG = "lang";
    public static final String K_THEME = "theme";
    public static final String K_SYMBOL = "symbol";
    public static final String K_WATCHLIST = "watchlist";
    public static final String K_INTERVAL = "interval";
    public static final String K_THRESHOLD = "threshold";
    public static final String K_POLL = "poll_seconds";
    public static final String K_HORIZON = "horizon_candles";
    public static final String K_NOTIFY = "notify";
    public static final String K_WATCH = "watch_enabled";
    public static final String K_LIVE = "live_enabled";
    public static final String K_TESTNET = "use_testnet";
    public static final String K_API_KEY = "api_key";
    public static final String K_API_SECRET = "api_secret";
    public static final String K_START_CASH = "start_cash";
    public static final String K_AUTO = "auto_trade";
    public static final String K_AUTO_PCT = "auto_quote_pct";
    public static final String K_MIN_CONF = "min_confidence";
    public static final String K_EQ_PEAK = "equity_peak";
    public static final String K_COOLDOWN_UNTIL = "cooldown_until";
    public static final String K_MAX_DD = "max_drawdown_pct";
    public static final String K_MODEL = "model";
    public static final String K_SIGNALS = "signals";
    public static final String K_TRADES = "trades";
    public static final String K_PORTFOLIO = "portfolio";

    private Prefs() {
    }

    public static SharedPreferences of(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static String getString(Context c, String key, String def) {
        return of(c).getString(key, def);
    }

    public static void putString(Context c, String key, String value) {
        of(c).edit().putString(key, value).apply();
    }

    public static boolean getBool(Context c, String key, boolean def) {
        return of(c).getBoolean(key, def);
    }

    public static void putBool(Context c, String key, boolean value) {
        of(c).edit().putBoolean(key, value).apply();
    }

    public static int getInt(Context c, String key, int def) {
        return of(c).getInt(key, def);
    }

    public static void putInt(Context c, String key, int value) {
        of(c).edit().putInt(key, value).apply();
    }

    public static float getFloat(Context c, String key, float def) {
        return of(c).getFloat(key, def);
    }

    public static void putFloat(Context c, String key, float value) {
        of(c).edit().putFloat(key, value).apply();
    }

    // -------------------------------------------------------------- convenience

    public static String lang(Context c) {
        return getString(c, K_LANG, "system");
    }

    /** "system" | "light" | "dark" */
    public static String theme(Context c) {
        return getString(c, K_THEME, "system");
    }

    public static String symbol(Context c) {
        return getString(c, K_SYMBOL, "BTCUSDT");
    }

    public static String interval(Context c) {
        return getString(c, K_INTERVAL, "5m");
    }

    public static float threshold(Context c) {
        return getFloat(c, K_THRESHOLD, 0.22f);
    }

    public static int pollSeconds(Context c) {
        return Math.max(5, getInt(c, K_POLL, 20));
    }

    public static int horizonCandles(Context c) {
        return Math.max(1, getInt(c, K_HORIZON, 6));
    }

    public static boolean notify(Context c) {
        return getBool(c, K_NOTIFY, true);
    }

    public static boolean watchEnabled(Context c) {
        return getBool(c, K_WATCH, false);
    }

    public static boolean liveEnabled(Context c) {
        return getBool(c, K_LIVE, false);
    }

    public static boolean useTestnet(Context c) {
        return getBool(c, K_TESTNET, true);
    }

    /** Trading base URL: Binance Spot Testnet by default, real API only when opted in. */
    public static String tradingBase(Context c) {
        return useTestnet(c)
                ? com.rusindu.aitrade.net.BinanceApi.TESTNET_BASE
                : com.rusindu.aitrade.net.BinanceApi.LIVE_BASE;
    }

    public static String apiKey(Context c) {
        return getString(c, K_API_KEY, "");
    }

    public static String apiSecret(Context c) {
        return getString(c, K_API_SECRET, "");
    }

    public static float startCash(Context c) {
        return getFloat(c, K_START_CASH, 10000f);
    }

    /** Execute trades automatically when a signal fires. Off by default. */
    public static boolean autoTrade(Context c) {
        return getBool(c, K_AUTO, false);
    }

    /** Share of available cash used per automatic trade, in percent. */
    public static float autoPct(Context c) {
        return Math.max(1f, Math.min(100f, getFloat(c, K_AUTO_PCT, 20f)));
    }

    /** Confidence a signal must reach before it is traded automatically. */
    public static float minConfidence(Context c) {
        return Math.max(0f, Math.min(1f, getFloat(c, K_MIN_CONF, 0.45f)));
    }

    /** Remembered equity peak for the drawdown guard. */
    public static float equityPeak(Context c) {
        return getFloat(c, K_EQ_PEAK, 0f);
    }

    public static void putEquityPeak(Context c, double v) {
        putFloat(c, K_EQ_PEAK, (float) v);
    }

    /** Epoch ms until which the loss-streak cooldown blocks new entries. */
    public static long cooldownUntil(Context c) {
        try {
            return Long.parseLong(getString(c, K_COOLDOWN_UNTIL, "0"));
        } catch (Exception e) {
            return 0;
        }
    }

    public static void putCooldownUntil(Context c, long ms) {
        putString(c, K_COOLDOWN_UNTIL, String.valueOf(ms));
    }

    /** Equity drawdown percent that pauses auto-trading. */
    public static float maxDrawdownPct(Context c) {
        return Math.max(1f, Math.min(90f, getFloat(c, K_MAX_DD, 15f)));
    }
}
