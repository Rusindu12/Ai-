package com.rusindu.aitrade.util;

import android.content.Context;

import com.rusindu.aitrade.store.Prefs;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** The set of pairs the scanner walks through. Stored as a comma separated list. */
public final class Watchlist {

    public static final String[] DEFAULT = {
            "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
            "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TONUSDT"
    };

    private Watchlist() {
    }

    public static List<String> get(Context c) {
        String raw = Prefs.getString(c, Prefs.K_WATCHLIST, "");
        if (raw.isEmpty()) return new ArrayList<>(Arrays.asList(DEFAULT));
        List<String> out = new ArrayList<>();
        for (String s : raw.split(",")) {
            String t = s.trim().toUpperCase(java.util.Locale.US);
            if (!t.isEmpty() && !out.contains(t)) out.add(t);
        }
        return out.isEmpty() ? new ArrayList<>(Arrays.asList(DEFAULT)) : out;
    }

    public static void set(Context c, List<String> symbols) {
        StringBuilder sb = new StringBuilder();
        for (String s : symbols) {
            if (sb.length() > 0) sb.append(',');
            sb.append(s.trim().toUpperCase(java.util.Locale.US));
        }
        Prefs.putString(c, Prefs.K_WATCHLIST, sb.toString());
    }

    public static boolean contains(Context c, String symbol) {
        return get(c).contains(symbol);
    }
}
