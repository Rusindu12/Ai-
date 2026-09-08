package com.rusindu.aitrade.model;

import org.json.JSONException;
import org.json.JSONObject;

/** One executed trade (paper or live). */
public class Trade {
    public long time;
    public String symbol;
    public String side;        // BUY / SELL
    public double qty;
    public double price;
    public double fee;
    public double pnl;         // realised pnl for a SELL that closes a position
    public boolean live;       // false = paper trading
    public String note;

    public JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("t", time);
            o.put("s", symbol);
            o.put("side", side);
            o.put("q", qty);
            o.put("p", price);
            o.put("fee", fee);
            o.put("pnl", pnl);
            o.put("live", live ? 1 : 0);
            o.put("n", note == null ? "" : note);
        } catch (JSONException ignored) {
        }
        return o;
    }

    public static Trade fromJson(JSONObject o) {
        Trade t = new Trade();
        t.time = o.optLong("t");
        t.symbol = o.optString("s");
        t.side = o.optString("side");
        t.qty = o.optDouble("q", 0);
        t.price = o.optDouble("p", 0);
        t.fee = o.optDouble("fee", 0);
        t.pnl = o.optDouble("pnl", 0);
        t.live = o.optInt("live", 0) == 1;
        t.note = o.optString("n", "");
        return t;
    }
}
