package com.rusindu.aitrade.core;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.SignalEngine;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.net.BinanceApi;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.trade.Portfolio;
import com.rusindu.aitrade.trade.TradeExecutor;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Polls Binance, runs the model, grades past signals and publishes the result.
 *
 * <p>One instance is shared by the activity and the foreground service, so the UI and the
 * notifications always describe the same state.</p>
 */
public class TradeEngine {

    public interface Listener {
        void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker);

        void onNewSignal(Signal signal);

        void onEngineMessage(String message);

        /** @param kind 1 = stop loss, 2 = take profit */
        default void onProtectionTriggered(int kind, double price) {
        }
    }

    private static final int KLINE_LIMIT = 300;

    private static volatile TradeEngine instance;

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    private volatile Context app;
    private volatile boolean running;
    private volatile java.util.concurrent.ScheduledFuture<?> loop;
    private int scheduledEvery = -1;
    private volatile List<Candle> candles = new ArrayList<>();
    private volatile Snapshot snapshot;
    private volatile JSONObject ticker;
    private volatile String lastError;
    private volatile long lastUpdate;

    private TradeEngine() {
    }

    public static TradeEngine get() {
        TradeEngine e = instance;
        if (e == null) {
            synchronized (TradeEngine.class) {
                e = instance;
                if (e == null) {
                    e = new TradeEngine();
                    instance = e;
                }
            }
        }
        return e;
    }

    public void addListener(Listener l) {
        if (l != null && !listeners.contains(l)) listeners.add(l);
    }

    public void removeListener(Listener l) {
        listeners.remove(l);
    }

    public boolean isRunning() {
        return running;
    }

    public List<Candle> candles() {
        return new ArrayList<>(candles);
    }

    public Snapshot snapshot() {
        return snapshot;
    }

    public JSONObject ticker() {
        return ticker;
    }

    public String lastError() {
        return lastError;
    }

    public long lastUpdate() {
        return lastUpdate;
    }

    /** Starts (or restarts) the polling loop with the current settings. */
    public synchronized void start(Context c) {
        app = c.getApplicationContext();
        running = true;
        scheduler.execute(this::tick);

        int every = Prefs.pollSeconds(app);
        if (every == scheduledEvery && loop != null) return; // already looping at this rate
        if (loop != null) loop.cancel(false);
        scheduledEvery = every;
        loop = scheduler.scheduleWithFixedDelay(() -> {
            if (running) tick();
        }, every, every, TimeUnit.SECONDS);
    }

    public synchronized void stop() {
        running = false;
    }

    /** One-off refresh, used by pull-to-refresh and by the notification action. */
    public void refreshNow() {
        scheduler.execute(this::tick);
    }

    /** Runs work on the single background thread (scanner, backtest, orders). */
    public void submit(Runnable r) {
        scheduler.execute(r);
    }

    /** Posts to the main thread. */
    public void postUi(Runnable r) {
        main.post(r);
    }

    // ------------------------------------------------------------------ loop

    private void tick() {
        Context c = app;
        if (c == null) return;
        final String symbol = Prefs.symbol(c);
        final String interval = Prefs.interval(c);
        final float threshold = Prefs.threshold(c);
        try {
            List<Candle> fresh = BinanceApi.klines(symbol, interval, KLINE_LIMIT);
            if (fresh.isEmpty()) throw new IllegalStateException("empty_klines");
            candles = fresh;

            JSONObject t = null;
            try {
                t = BinanceApi.ticker24h(symbol);
            } catch (Exception ignored) {
                // the ticker is decoration; klines are what the model needs
            }
            ticker = t;

            AdaptiveModel model = Journal.get(c).model();
            double effThreshold = model.effectiveThreshold(threshold);
            Snapshot snap = SignalEngine.evaluate(fresh, model, effThreshold, true);
            snapshot = snap;
            lastError = null;
            lastUpdate = System.currentTimeMillis();

            double livePrice = fresh.get(fresh.size() - 1).close;
            if (snap.valid) {
                int graded = Journal.get(c).gradeDue(symbol, interval, snap.candleTime, livePrice,
                        Prefs.horizonCandles(c));
                publishSignalIfNeeded(c, snap, symbol, interval, livePrice);
                if (graded > 0) Journal.get(c).save(c);
            }
            checkProtection(c, symbol, livePrice);

            final List<Candle> published = new ArrayList<>(fresh);
            final Snapshot publishedSnap = snap;
            final JSONObject publishedTicker = t;
            main.post(() -> {
                for (Listener l : listeners) {
                    l.onMarketUpdate(published, publishedSnap, publishedTicker);
                }
            });
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            lastError = msg;
            main.post(() -> {
                for (Listener l : listeners) l.onEngineMessage(msg);
            });
        }
    }

    /** Closes the paper position when a stop loss or take profit level is touched. */
    private void checkProtection(final Context c, final String symbol, final double price) {
        Portfolio p = Portfolio.load(c);
        final int hit = p.protectionHit(price);
        if (hit == 0) return;
        // clear first so a slow fill cannot trigger the same level twice
        p.clearProtection();
        p.save(c);
        TradeExecutor.execute(c, symbol, "SELL", 0, price, (ok, message) -> {
            if (ok) {
                for (Listener l : listeners) l.onProtectionTriggered(hit, price);
            } else {
                for (Listener l : listeners) l.onEngineMessage(message);
            }
        });
    }

    private void publishSignalIfNeeded(Context c, Snapshot snap, String symbol, String interval,
                                       double livePrice) {
        if (snap.direction == Direction.NEUTRAL) return;
        Journal journal = Journal.get(c);
        List<Signal> history = journal.signals();
        for (Signal old : history) {
            if (old.symbol.equals(symbol) && old.interval.equals(interval)
                    && old.time == snap.candleTime) {
                return; // already emitted for this candle
            }
            if (old.time < snap.candleTime) break;
        }

        Signal s = new Signal();
        s.time = snap.candleTime;
        s.symbol = symbol;
        s.interval = interval;
        s.direction = snap.direction;
        s.score = snap.score;
        s.confidence = snap.confidence;
        s.price = livePrice;
        s.atrPct = snap.atrPct;
        s.features = snap.features;
        s.regime = snap.regime;
        s.calx = snap.calx;
        s.reason = topReason(snap);
        journal.addSignal(s);
        journal.save(c);

        main.post(() -> {
            for (Listener l : listeners) l.onNewSignal(s);
        });

        maybeAutoTrade(c, s, livePrice);
    }

    private String topReason(Snapshot snap) {
        if (snap.reasons.isEmpty()) return "";
        int best = 0;
        double bestAbs = -1;
        for (int i = 0; i < snap.reasons.size(); i++) {
            double v = Math.abs(snap.reasons.get(i).value);
            if (v > bestAbs) {
                bestAbs = v;
                best = i;
            }
        }
        return snap.reasons.get(best).code;
    }

    private void maybeAutoTrade(final Context c, Signal s, double price) {
        if (!Prefs.autoTrade(c)) return;
        if (s.confidence < Prefs.minConfidence(c)) return;

        Portfolio p = Portfolio.load(c);
        String side;
        double notional;
        if (s.direction == Direction.BUY) {
            if (p.qty > 0) return; // already long
            side = "BUY";
            notional = p.cash * Prefs.autoPct(c) / 100.0;
        } else {
            if (p.qty <= 0) return; // nothing to close
            side = "SELL";
            notional = 0; // 0 = close the whole position
        }
        if (side.equals("BUY") && notional <= 0) return;

        TradeExecutor.execute(c, s.symbol, side, notional, price, (ok, message) -> {
            if (!ok) {
                for (Listener l : listeners) l.onEngineMessage(message);
            }
        });
    }
}
