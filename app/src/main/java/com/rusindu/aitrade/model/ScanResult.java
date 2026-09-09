package com.rusindu.aitrade.model;

/** One row of the multi-symbol market scanner. */
public class ScanResult {
    public final String symbol;
    public final double price;
    public final double score;
    public final int direction;
    public final double confidence;
    public final double rsi;
    public final double atrPct;

    public ScanResult(String symbol, double price, double score, int direction,
                      double confidence, double rsi, double atrPct) {
        this.symbol = symbol;
        this.price = price;
        this.score = score;
        this.direction = direction;
        this.confidence = confidence;
        this.rsi = rsi;
        this.atrPct = atrPct;
    }
}
