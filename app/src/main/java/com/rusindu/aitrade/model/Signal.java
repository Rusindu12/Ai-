package com.rusindu.aitrade.model;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** A signal emitted by the engine, persisted so the adaptive model can grade itself later. */
public class Signal {
    public long time;
    public String symbol;
    public String interval;
    public int direction;
    public double score;
    public double confidence;
    public double price;
    public double atrPct;
    public double[] features;
    public double regime = 0.5; // market regime at signal time; grades go to the right expert
    public double[] calx = new double[0]; // confidence-calibration inputs at signal time
    public String reason;

    // Graded after the evaluation horizon has passed.
    public boolean graded;
    public double outcome;      // volatility-normalised realised move, in [-1, 1]
    public double returnPct;    // raw % move of the price over the horizon
    public boolean correct;

    public Signal() {
        this.features = new double[0];
    }

    public JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("t", time);
            o.put("s", symbol);
            o.put("i", interval);
            o.put("d", direction);
            o.put("sc", score);
            o.put("c", confidence);
            o.put("p", price);
            o.put("a", atrPct);
            o.put("g", graded ? 1 : 0);
            o.put("o", outcome);
            o.put("r", returnPct);
            o.put("ok", correct ? 1 : 0);
            o.put("why", reason == null ? "" : reason);
            o.put("rg", regime);
            JSONArray arr = new JSONArray();
            for (double f : features) arr.put(f);
            o.put("f", arr);
            JSONArray cx = new JSONArray();
            for (double f : calx) cx.put(f);
            o.put("cx", cx);
        } catch (JSONException ignored) {
        }
        return o;
    }

    public static Signal fromJson(JSONObject o) {
        Signal s = new Signal();
        s.time = o.optLong("t");
        s.symbol = o.optString("s");
        s.interval = o.optString("i");
        s.direction = o.optInt("d");
        s.score = o.optDouble("sc", 0);
        s.confidence = o.optDouble("c", 0);
        s.price = o.optDouble("p", 0);
        s.atrPct = o.optDouble("a", 0);
        s.graded = o.optInt("g", 0) == 1;
        s.outcome = o.optDouble("o", 0);
        s.returnPct = o.optDouble("r", 0);
        s.correct = o.optInt("ok", 0) == 1;
        s.reason = o.optString("why", "");
        s.regime = o.optDouble("rg", 0.5);
        JSONArray cx = o.optJSONArray("cx");
        if (cx != null) {
            s.calx = new double[cx.length()];
            for (int i = 0; i < cx.length(); i++) s.calx[i] = cx.optDouble(i, 0);
        }
        JSONArray arr = o.optJSONArray("f");
        if (arr != null) {
            s.features = new double[arr.length()];
            for (int i = 0; i < arr.length() && i < s.features.length; i++) {
                s.features[i] = arr.optDouble(i, 0);
            }
        }
        return s;
    }
}
