package com.rusindu.aitrade.util;

import android.content.Context;

import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.model.Trade;
import com.rusindu.aitrade.store.Journal;

import java.util.List;
import java.util.Locale;

/** Exports the signal and trade history as CSV text for sharing. */
public final class Csv {

    private Csv() {
    }

    public static String build(Context c) {
        Journal j = Journal.get(c);
        StringBuilder sb = new StringBuilder();
        sb.append("type,timestamp,symbol,interval,direction,side,score,confidence,")
                .append("price,qty,pnl,graded,correct,return_pct\n");

        List<Signal> signals = j.signals();
        for (Signal s : signals) {
            sb.append("signal,").append(s.time).append(',')
                    .append(esc(s.symbol)).append(',')
                    .append(esc(s.interval)).append(',')
                    .append(s.direction == 1 ? "BUY" : (s.direction == -1 ? "SELL" : "NEUTRAL"))
                    .append(",,")
                    .append(num(s.score)).append(',')
                    .append(num(s.confidence)).append(',')
                    .append(num(s.price)).append(",,")
                    .append(s.graded ? 1 : 0).append(',')
                    .append(s.graded ? (s.correct ? 1 : 0) : "").append(',')
                    .append(s.graded ? num(s.returnPct) : "")
                    .append('\n');
        }

        for (Trade t : j.trades()) {
            sb.append("trade,").append(t.time).append(',')
                    .append(esc(t.symbol)).append(",,")
                    .append(',')
                    .append(esc(t.side)).append(",,")
                    .append(',')
                    .append(num(t.price)).append(',')
                    .append(num(t.qty)).append(',')
                    .append(num(t.pnl)).append(",,,")
                    .append('\n');
        }
        return sb.toString();
    }

    private static String num(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "";
        return String.format(Locale.US, "%.8g", v);
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.contains(",") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }
}
