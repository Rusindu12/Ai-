package com.rusindu.aitrade.core;

import android.content.Context;

import com.rusindu.aitrade.ai.SignalEngine;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.ScanResult;
import com.rusindu.aitrade.net.BinanceApi;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Scores a whole watchlist with the same model the live loop uses and ranks the pairs by how
 * strongly the model is signalling right now.
 */
public final class Scanner {

    public interface Callback {
        void onProgress(int done, int total, String symbol);

        void onResult(List<ScanResult> results);

        void onError(String message);
    }

    private static final int KLINE_LIMIT = 140;

    private Scanner() {
    }

    public static void scan(final Context c, final List<String> symbols, final Callback cb) {
        final Context app = c.getApplicationContext();
        TradeEngine.get().submit(() -> {
            final String interval = Prefs.interval(app);
            final float threshold = Prefs.threshold(app);
            final List<ScanResult> out = new ArrayList<>();
            String failure = null;
            int total = symbols.size();
            for (int i = 0; i < total; i++) {
                final String symbol = symbols.get(i);
                final int done = i + 1;
                TradeEngine.get().postUi(() -> cb.onProgress(done, total, symbol));
                try {
                    List<Candle> candles = BinanceApi.klines(symbol, interval, KLINE_LIMIT);
                    Snapshot s = SignalEngine.evaluate(candles, Journal.get(app).model(),
                            threshold, true);
                    if (s.valid) {
                        out.add(new ScanResult(symbol, s.price, s.score, s.direction,
                                s.confidence, s.rsi, s.atrPct));
                    }
                } catch (Exception e) {
                    if (failure == null) {
                        failure = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                    }
                }
            }
            Collections.sort(out, new Comparator<ScanResult>() {
                @Override
                public int compare(ScanResult a, ScanResult b) {
                    return Double.compare(Math.abs(b.score), Math.abs(a.score));
                }
            });
            final String error = failure;
            final List<ScanResult> results = out;
            TradeEngine.get().postUi(() -> {
                if (results.isEmpty() && error != null) cb.onError(error);
                else cb.onResult(results);
            });
        });
    }
}
