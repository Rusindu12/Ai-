package com.rusindu.aitrade.trade;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.rusindu.aitrade.model.Trade;
import com.rusindu.aitrade.net.BinanceApi;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;

import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Executes a trade.
 *
 * <p>Paper mode (default): the fill is simulated locally at the live Binance price.</p>
 * <p>Live mode: only used when the user turned it on <em>and</em> entered an API key. The
 * base URL is the Binance Spot Testnet unless the user explicitly switched to the real
 * API.</p>
 */
public final class TradeExecutor {

    public interface Callback {
        void onDone(boolean ok, String message);
    }

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private TradeExecutor() {
    }

    public static boolean isLive(Context c) {
        return Prefs.liveEnabled(c) && !Prefs.apiKey(c).trim().isEmpty()
                && !Prefs.apiSecret(c).trim().isEmpty();
    }

    /**
     * @param side       "BUY" or "SELL"
     * @param usdtAmount notional size in USDT
     * @param price      current market price used for paper fills / sizing
     */
    public static void execute(final Context c, final String symbol, final String side,
                               final double usdtAmount, final double price, final Callback cb) {
        final Context app = c.getApplicationContext();
        IO.execute(() -> {
            String error = null;
            try {
                if (price <= 0) {
                    error = "bad_price";
                } else if (usdtAmount <= 0 && !"SELL".equals(side)) {
                    error = "bad_qty";
                } else {
                    error = run(app, symbol, side, usdtAmount, price);
                }
            } catch (Exception e) {
                error = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
            final String message = error;
            MAIN.post(() -> cb.onDone(message == null, message));
        });
    }

    private static String run(Context c, String symbol, String side,
                              double usdtAmount, double price) throws Exception {
        Journal journal = Journal.get(c);
        Portfolio portfolio = Portfolio.load(c);
        boolean live = isLive(c);

        double qty = usdtAmount / price;
        if ("SELL".equals(side) && usdtAmount <= 0) {
            qty = portfolio.qty; // close the whole position
        }
        if (qty <= 0) return "no_position";

        if (live) {
            String base = Prefs.tradingBase(c);
            String key = Prefs.apiKey(c);
            String secret = Prefs.apiSecret(c);
            try {
                BinanceApi.syncTime(base);
            } catch (Exception ignored) {
                // clock sync is best-effort; recvWindow is generous
            }
            JSONObject r = BinanceApi.marketOrder(base, key, secret, symbol, side, qty, null);

            double filled = r.optDouble("executedQty", qty);
            double quote = r.optDouble("cummulativeQuoteQty", filled * price);
            double avg = filled > 0 ? quote / filled : price;

            Trade t = new Trade();
            t.time = System.currentTimeMillis();
            t.symbol = symbol;
            t.side = side.toUpperCase(Locale.US);
            t.qty = filled;
            t.price = avg;
            t.fee = 0;
            t.live = true;
            t.note = r.optString("status", "");
            journal.addTrade(t);

            // mirror the fill into the local book so equity/PnL stay meaningful
            if ("BUY".equalsIgnoreCase(side)) {
                portfolio.buy(avg, filled, true);
            } else {
                portfolio.sell(avg, filled, true);
            }
            portfolio.save(c);
            journal.save(c);
            return null;
        }

        Portfolio.Result res = "BUY".equalsIgnoreCase(side)
                ? portfolio.buy(price, qty, false)
                : portfolio.sell(price, qty, false);
        if (!res.ok) return res.errorKey;
        res.trade.symbol = symbol;
        journal.addTrade(res.trade);
        portfolio.save(c);
        journal.save(c);
        return null;
    }
}
