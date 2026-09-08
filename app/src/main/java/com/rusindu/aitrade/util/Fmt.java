package com.rusindu.aitrade.util;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Display formatting helpers. */
public final class Fmt {

    private Fmt() {
    }

    /** Adaptive precision: cheap coins need more decimals than BTC. */
    public static String price(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "--";
        double a = Math.abs(v);
        String pattern;
        if (a >= 1000) pattern = "#,##0.00";
        else if (a >= 1) pattern = "#,##0.0000";
        else if (a >= 0.01) pattern = "#,##0.00000";
        else pattern = "#,##0.00000000";
        return new java.text.DecimalFormat(pattern,
                new java.text.DecimalFormatSymbols(Locale.US)).format(v);
    }

    public static String qty(double v) {
        if (Double.isNaN(v)) return "--";
        return new java.text.DecimalFormat("#,##0.########",
                new java.text.DecimalFormatSymbols(Locale.US)).format(v);
    }

    public static String num(double v, int decimals) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "--";
        StringBuilder p = new StringBuilder("#,##0");
        if (decimals > 0) {
            p.append('.');
            for (int i = 0; i < decimals; i++) p.append('0');
        }
        return new java.text.DecimalFormat(p.toString(),
                new java.text.DecimalFormatSymbols(Locale.US)).format(v);
    }

    public static String signed(double v, int decimals) {
        if (Double.isNaN(v)) return "--";
        String s = num(Math.abs(v), decimals);
        return (v >= 0 ? "+" : "-") + s;
    }

    public static String pct(double v, int decimals) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "--";
        return signed(v, decimals) + "%";
    }

    public static String money(double v) {
        return num(v, 2);
    }

    public static String time(long millis) {
        return new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date(millis));
    }

    public static String dateTime(long millis) {
        return new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(new Date(millis));
    }

    public static String clock(long millis) {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(millis));
    }

    /** Turns BTCUSDT into BTC/USDT for display. */
    public static String pair(String symbol) {
        if (symbol == null) return "";
        String[] quotes = {"USDT", "USDC", "BUSD", "BTC", "ETH", "BNB", "FDUSD", "TUSD"};
        String up = symbol.toUpperCase(Locale.US);
        for (String q : quotes) {
            if (up.endsWith(q) && up.length() > q.length()) {
                return up.substring(0, up.length() - q.length()) + "/" + q;
            }
        }
        return up;
    }
}
