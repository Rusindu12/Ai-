package com.rusindu.aitrade.model;

import java.util.ArrayList;
import java.util.List;

/** Outcome of a walk-forward backtest. */
public class BacktestResult {
    public boolean enough;
    public int candles;
    public int trades;
    public int wins;
    public double winRatePct;
    public double totalReturnPct;
    public double buyHoldPct;
    public double maxDrawdownPct;
    public double averageTradePct;
    public final List<Double> equity = new ArrayList<>();

    public double edge() {
        return totalReturnPct - buyHoldPct;
    }
}
