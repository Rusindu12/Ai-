package com.rusindu.aitrade.model;

/** Direction of a signal. */
public final class Direction {
    public static final int BUY = 1;
    public static final int SELL = -1;
    public static final int NEUTRAL = 0;

    private Direction() {
    }

    public static int of(double score, double threshold) {
        if (score >= threshold) return BUY;
        if (score <= -threshold) return SELL;
        return NEUTRAL;
    }

    public static String key(int direction) {
        if (direction == BUY) return "BUY";
        if (direction == SELL) return "SELL";
        return "NEUTRAL";
    }
}
