package com.rusindu.aitrade.util;

/** Candle intervals offered by the app. */
public final class Intervals {

    public static final String[] VALUES = {"1m", "5m", "15m", "1h", "4h", "1d"};
    public static final String[] LABELS = {"1m", "5m", "15m", "1H", "4H", "1D"};

    private Intervals() {
    }

    public static long millis(String interval) {
        if (interval == null) return 60_000L;
        switch (interval) {
            case "1m":
                return 60_000L;
            case "5m":
                return 300_000L;
            case "15m":
                return 900_000L;
            case "1h":
                return 3_600_000L;
            case "4h":
                return 14_400_000L;
            case "1d":
                return 86_400_000L;
            default:
                return 60_000L;
        }
    }

    public static String label(String value) {
        for (int i = 0; i < VALUES.length; i++) {
            if (VALUES[i].equals(value)) return LABELS[i];
        }
        return value;
    }

    public static int index(String value) {
        for (int i = 0; i < VALUES.length; i++) {
            if (VALUES[i].equals(value)) return i;
        }
        return 1;
    }
}
