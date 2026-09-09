package com.rusindu.aitrade.trade;

import com.rusindu.aitrade.model.Trade;

import org.json.JSONObject;

/**
 * Paper-trading account. Fills happen at the live Binance price, with a 0.1% taker fee,
 * but no order is ever sent to the exchange.
 */
public class Portfolio {

    public static class Result {
        public final boolean ok;
        public final String errorKey;
        public final Trade trade;

        private Result(boolean ok, String errorKey, Trade trade) {
            this.ok = ok;
            this.errorKey = errorKey;
            this.trade = trade;
        }

        static Result fail(String key) {
            return new Result(false, key, null);
        }

        static Result ok(Trade t) {
            return new Result(true, null, t);
        }
    }

    public double cash;
    public double qty;
    public double entryPrice;
    public double realized;
    public double feeRate = 0.001;
    public double startCash;

    /** Absolute price levels, 0 = disabled. Checked by the polling loop. */
    public double stopLoss;
    public double takeProfit;

    public Portfolio(double startCash) {
        this.startCash = startCash;
        this.cash = startCash;
    }

    public double equity(double price) {
        return cash + qty * price;
    }

    public double unrealized(double price) {
        return qty > 0 ? qty * (price - entryPrice) : 0;
    }

    public double totalReturnPct(double price) {
        return startCash == 0 ? 0 : (equity(price) / startCash - 1) * 100;
    }

    public Result buy(double price, double amount, boolean live) {
        if (price <= 0) return Result.fail("bad_price");
        if (amount <= 0) return Result.fail("bad_qty");
        double cost = amount * price;
        double fee = cost * feeRate;
        if (cost + fee > cash + 1e-9) return Result.fail("insufficient_cash");

        double newQty = qty + amount;
        entryPrice = newQty == 0 ? 0 : (qty * entryPrice + cost) / newQty;
        qty = newQty;
        cash -= (cost + fee);

        Trade t = new Trade();
        t.time = System.currentTimeMillis();
        t.side = "BUY";
        t.qty = amount;
        t.price = price;
        t.fee = fee;
        t.pnl = 0;
        t.live = live;
        return Result.ok(t);
    }

    public Result sell(double price, double amount, boolean live) {
        if (price <= 0) return Result.fail("bad_price");
        if (amount <= 0) return Result.fail("bad_qty");
        if (amount > qty + 1e-9) return Result.fail("no_position");

        double proceeds = amount * price;
        double fee = proceeds * feeRate;
        double pnl = amount * (price - entryPrice) - fee;
        cash += proceeds - fee;
        qty -= amount;
        if (qty < 1e-12) {
            qty = 0;
            entryPrice = 0;
        }
        realized += pnl;

        Trade t = new Trade();
        t.time = System.currentTimeMillis();
        t.side = "SELL";
        t.qty = amount;
        t.price = price;
        t.fee = fee;
        t.pnl = pnl;
        t.live = live;
        return Result.ok(t);
    }

    public void clearProtection() {
        stopLoss = 0;
        takeProfit = 0;
    }

    public boolean hasProtection() {
        return qty > 0 && (stopLoss > 0 || takeProfit > 0);
    }

    /** @return {@code 1} stop loss, {@code 2} take profit, {@code 0} nothing triggered */
    public int protectionHit(double price) {
        if (qty <= 0 || price <= 0) return 0;
        if (stopLoss > 0 && price <= stopLoss) return 1;
        if (takeProfit > 0 && price >= takeProfit) return 2;
        return 0;
    }

    public void reset(double newStartCash) {
        startCash = newStartCash;
        cash = newStartCash;
        qty = 0;
        entryPrice = 0;
        realized = 0;
        stopLoss = 0;
        takeProfit = 0;
    }

    public String toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("cash", cash);
            o.put("qty", qty);
            o.put("entry", entryPrice);
            o.put("realized", realized);
            o.put("start", startCash);
            o.put("fee", feeRate);
            o.put("sl", stopLoss);
            o.put("tp", takeProfit);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    public static Portfolio fromJson(String json, double defaultStart) {
        try {
            JSONObject o = new JSONObject(json);
            Portfolio p = new Portfolio(o.optDouble("start", defaultStart));
            p.cash = o.optDouble("cash", p.startCash);
            p.qty = o.optDouble("qty", 0);
            p.entryPrice = o.optDouble("entry", 0);
            p.realized = o.optDouble("realized", 0);
            p.feeRate = o.optDouble("fee", 0.001);
            p.stopLoss = o.optDouble("sl", 0);
            p.takeProfit = o.optDouble("tp", 0);
            return p;
        } catch (Exception e) {
            return new Portfolio(defaultStart);
        }
    }

    public static Portfolio load(android.content.Context c) {
        String json = com.rusindu.aitrade.store.Prefs.getString(
                c, com.rusindu.aitrade.store.Prefs.K_PORTFOLIO, "");
        Portfolio p = fromJson(json, com.rusindu.aitrade.store.Prefs.startCash(c));
        if (json.isEmpty()) {
            p.feeRate = 0.001;
        }
        return p;
    }

    public void save(android.content.Context c) {
        com.rusindu.aitrade.store.Prefs.putString(
                c, com.rusindu.aitrade.store.Prefs.K_PORTFOLIO, toJson());
    }
}
