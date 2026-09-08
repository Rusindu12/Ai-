package com.rusindu.aitrade.model;

/** One OHLCV candle returned by the Binance klines endpoint. */
public class Candle {
    public final long openTime;
    public final double open;
    public final double high;
    public final double low;
    public final double close;
    public final double volume;

    public Candle(long openTime, double open, double high, double low, double close, double volume) {
        this.openTime = openTime;
        this.open = open;
        this.high = high;
        this.low = low;
        this.close = close;
        this.volume = volume;
    }

    public double range() {
        return Math.max(high - low, 1e-12);
    }
}
