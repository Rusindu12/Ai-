package com.rusindu.aitrade.store;

import android.content.Context;

import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.model.Trade;
import com.rusindu.aitrade.util.Intervals;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Shared in-memory state: signal history, trade history and the adaptive model.
 * Both the activity and the background service use the same instance, and every mutation is
 * persisted so nothing is lost when the process dies.
 */
public class Journal {

    private static final int MAX_SIGNALS = 300;
    private static final int MAX_TRADES = 300;

    private static volatile Journal instance;

    private final AdaptiveModel model = new AdaptiveModel();
    private final List<Signal> signals = new ArrayList<>();
    private final List<Trade> trades = new ArrayList<>();

    private Journal() {
    }

    public static Journal get(Context c) {
        Journal j = instance;
        if (j == null) {
            synchronized (Journal.class) {
                j = instance;
                if (j == null) {
                    j = new Journal();
                    j.load(c.getApplicationContext());
                    instance = j;
                }
            }
        }
        return j;
    }

    public AdaptiveModel model() {
        return model;
    }

    // ------------------------------------------------------------------ signals

    public synchronized void addSignal(Signal s) {
        if (s == null) return;
        // One signal per candle; a re-fire on the same candle just refreshes the record.
        if (!signals.isEmpty()) {
            Signal head = signals.get(0);
            if (head.time == s.time && head.symbol.equals(s.symbol)
                    && head.interval.equals(s.interval)) {
                signals.set(0, s);
                return;
            }
        }
        signals.add(0, s);
        while (signals.size() > MAX_SIGNALS) signals.remove(signals.size() - 1);
    }

    public synchronized List<Signal> signals() {
        return new ArrayList<>(signals);
    }

    public synchronized void clearSignals() {
        signals.clear();
    }

    // ------------------------------------------------------------------ trades

    public synchronized void addTrade(Trade t) {
        if (t == null) return;
        trades.add(0, t);
        while (trades.size() > MAX_TRADES) trades.remove(trades.size() - 1);
    }

    public synchronized List<Trade> trades() {
        return new ArrayList<>(trades);
    }

    public synchronized void clearTrades() {
        trades.clear();
    }

    // ------------------------------------------------------------------ grading

    /**
     * Grades every ungraded signal whose horizon has elapsed, and feeds the result back into
     * the model.
     *
     * @param candleTime open time of the newest closed candle
     * @param price      latest price
     * @param horizon    how many candles the model gets to be right
     * @return number of signals graded in this pass
     */
    public synchronized int gradeDue(String symbol, String interval, long candleTime,
                                     double price, int horizon) {
        if (price <= 0) return 0;
        long horizonMs = Intervals.millis(interval) * Math.max(1, horizon);
        int count = 0;
        for (Signal s : signals) {
            if (s.graded) continue;
            if (!s.symbol.equals(symbol) || !s.interval.equals(interval)) continue;
            if (candleTime - s.time < horizonMs) continue;
            if (s.price <= 0) {
                s.graded = true;
                continue;
            }

            double r = (price - s.price) / s.price * 100.0;
            double volScale = Math.max(s.atrPct, 1e-6) * 1.5;
            double outcome = Math.max(-1, Math.min(1, r / volScale));
            boolean hit = s.direction * r > 0;

            model.learn(s.features, s.score, outcome, s.regime);
            model.recordGrade(hit, s.direction * r, r, s.regime);
            model.learnCalibration(s.calx, hit);

            s.graded = true;
            s.outcome = outcome;
            s.returnPct = r;
            s.correct = hit;
            count++;
        }
        return count;
    }

    // ------------------------------------------------------------------ persistence

    public synchronized void load(Context c) {
        signals.clear();
        trades.clear();
        String modelJson = Prefs.getString(c, Prefs.K_MODEL, "");
        model.copyFrom(AdaptiveModel.fromJson(modelJson));

        signals.addAll(readSignals(Prefs.getString(c, Prefs.K_SIGNALS, "")));
        trades.addAll(readTrades(Prefs.getString(c, Prefs.K_TRADES, "")));
    }

    public synchronized void save(Context c) {
        Prefs.putString(c, Prefs.K_MODEL, model.toJson());

        JSONArray sa = new JSONArray();
        for (Signal s : signals) sa.put(s.toJson());
        Prefs.putString(c, Prefs.K_SIGNALS, sa.toString());

        JSONArray ta = new JSONArray();
        for (Trade t : trades) ta.put(t.toJson());
        Prefs.putString(c, Prefs.K_TRADES, ta.toString());
    }

    private static List<Signal> readSignals(String json) {
        List<Signal> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null) out.add(Signal.fromJson(o));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private static List<Trade> readTrades(String json) {
        List<Trade> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null) out.add(Trade.fromJson(o));
            }
        } catch (Exception ignored) {
        }
        return out;
    }
}
