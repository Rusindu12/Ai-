package com.rusindu.aitrade.net;

import com.rusindu.aitrade.model.Candle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Minimal Binance REST client built on {@link HttpURLConnection} so the app has no
 * third-party network dependency.
 *
 * <p>Market data uses the public endpoints (no API key). Trading uses SIGNED endpoints and
 * therefore needs an API key; the default base URL is the Binance Spot <b>Testnet</b>
 * (https://testnet.binance.vision) so the live order path can be exercised without real
 * money.</p>
 */
public final class BinanceApi {

    /** Public market data mirrors, tried in order. */
    public static final String[] MARKET_HOSTS = {
            "https://api.binance.com",
            "https://api-gcp.binance.com",
            "https://api1.binance.com",
            "https://api2.binance.com",
            "https://api3.binance.com",
            "https://data-api.binance.vision"
    };

    public static final String TESTNET_BASE = "https://testnet.binance.vision";
    public static final String LIVE_BASE = "https://api.binance.com";

    private static final int CONNECT_TIMEOUT = 12_000;
    private static final int READ_TIMEOUT = 15_000;

    private static volatile String marketHost = MARKET_HOSTS[0];

    /** {@code serverTime - localTime}, refreshed by {@link #syncTime(String)}. */
    private static volatile long timeOffset = 0;

    private BinanceApi() {
    }

    public static long adjustedNow() {
        return System.currentTimeMillis() + timeOffset;
    }

    /** Aligns the signing clock with the exchange so recvWindow is never exceeded. */
    public static long syncTime(String base) throws IOException, BinanceException {
        long t0 = System.currentTimeMillis();
        long server = serverTime(base);
        long t1 = System.currentTimeMillis();
        long localMid = (t0 + t1) / 2;
        timeOffset = server - localMid;
        return timeOffset;
    }

    public static String currentMarketHost() {
        return marketHost;
    }

    // ------------------------------------------------------------------ market data

    /** Candlesticks, oldest first. */
    public static List<Candle> klines(String symbol, String interval, int limit)
            throws IOException, BinanceException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("symbol", symbol.toUpperCase());
        q.put("interval", interval);
        q.put("limit", String.valueOf(Math.max(5, Math.min(1000, limit))));
        String body = publicGet("/api/v3/klines", q);
        JSONArray arr = new JSONArray(body);
        List<Candle> out = new ArrayList<>(arr.length());
        for (int i = 0; i < arr.length(); i++) {
            JSONArray k = arr.getJSONArray(i);
            out.add(new Candle(
                    k.getLong(0),
                    parse(k.getString(1)),
                    parse(k.getString(2)),
                    parse(k.getString(3)),
                    parse(k.getString(4)),
                    parse(k.getString(5))));
        }
        return out;
    }

    /** 24h rolling statistics for one symbol. */
    public static JSONObject ticker24h(String symbol) throws IOException, BinanceException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("symbol", symbol.toUpperCase());
        return new JSONObject(publicGet("/api/v3/ticker/24hr", q));
    }

    public static double price(String symbol) throws IOException, BinanceException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("symbol", symbol.toUpperCase());
        JSONObject o = new JSONObject(publicGet("/api/v3/ticker/price", q));
        return parse(o.getString("price"));
    }

    /** Symbols that are actually trading, so the picker never shows a dead pair. */
    public static List<String> tradingSymbols(String quote) throws IOException, BinanceException {
        JSONObject o = new JSONObject(publicGet("/api/v3/exchangeInfo", new LinkedHashMap<>()));
        JSONArray arr = o.getJSONArray("symbols");
        List<String> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.getJSONObject(i);
            if (!"TRADING".equals(s.optString("status"))) continue;
            if (quote != null && !quote.equalsIgnoreCase(s.optString("quoteAsset"))) continue;
            if (!"SPOT".equals(s.optString("type", "SPOT"))) continue;
            out.add(s.getString("symbol"));
        }
        return out;
    }

    // ------------------------------------------------------------------ signed / trading

    /** Exchange clock, used to avoid recvWindow rejections. */
    public static long serverTime(String base) throws IOException, BinanceException {
        JSONObject o = new JSONObject(publicGetOn(base, "/api/v3/time", new LinkedHashMap<>()));
        return o.getLong("serverTime");
    }

    public static JSONObject account(String base, String key, String secret)
            throws IOException, BinanceException {
        return new JSONObject(signed(base, "/api/v3/account", new LinkedHashMap<>(), key, secret, false));
    }

    /**
     * Place a MARKET order.
     *
     * @param side BUY or SELL
     */
    public static JSONObject marketOrder(String base, String key, String secret, String symbol,
                                         String side, double quantity, String newClientOrderId)
            throws IOException, BinanceException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("symbol", symbol.toUpperCase());
        q.put("side", side.toUpperCase());
        q.put("type", "MARKET");
        q.put("quantity", trim(quantity));
        if (newClientOrderId != null && !newClientOrderId.isEmpty()) {
            q.put("newClientOrderId", newClientOrderId);
        }
        return new JSONObject(signed(base, "/api/v3/order", q, key, secret, true));
    }

    // ------------------------------------------------------------------ plumbing

    private static String publicGet(String path, Map<String, String> query)
            throws IOException, BinanceException {
        IOException last = null;
        // Rotate through the mirrors; remember the first one that works.
        for (int i = 0; i < MARKET_HOSTS.length; i++) {
            String host = MARKET_HOSTS[(indexOf(marketHost) + i) % MARKET_HOSTS.length];
            try {
                String body = request("GET", host + path, query, null, false, null);
                marketHost = host;
                return body;
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new IOException("No Binance host reachable");
    }

    private static String publicGetOn(String base, String path, Map<String, String> query)
            throws IOException, BinanceException {
        return request("GET", base + path, query, null, false, null);
    }

    private static String signed(String base, String path, Map<String, String> query,
                                 String key, String secret, boolean post)
            throws IOException, BinanceException {
        if (key == null || key.trim().isEmpty() || secret == null || secret.trim().isEmpty()) {
            throw new BinanceException("missing_api_key", "API key / secret not configured");
        }
        Map<String, String> q = new LinkedHashMap<>(query);
        q.put("recvWindow", "10000");
        q.put("timestamp", String.valueOf(adjustedNow()));
        String qs = encode(q);
        String signature = hmacSha256(qs, secret.trim());
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-MBX-APIKEY", key.trim());
        if (post) {
            return request("POST", base + path, null, qs + "&signature=" + signature, true, headers);
        }
        return request("GET", base + path + "?" + qs + "&signature=" + signature, null, null, false, headers);
    }

    private static String request(String method, String url, Map<String, String> query,
                                  String body, boolean formBody, Map<String, String> headers)
            throws IOException, BinanceException {
        String full = url;
        if (query != null && !query.isEmpty()) {
            full += (full.contains("?") ? "&" : "?") + encode(query);
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(full).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "AITradeSignals/1.0 (Android)");
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            if (body != null) {
                conn.setDoOutput(true);
                if (formBody) {
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                }
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            String text = read(status >= 400 ? conn.getErrorStream() : conn.getInputStream());
            if (status >= 400) {
                int code = 0;
                String msg = text;
                try {
                    JSONObject o = new JSONObject(text);
                    code = o.optInt("code", 0);
                    msg = o.optString("msg", text);
                } catch (Exception ignored) {
                }
                throw new BinanceException(code, "HTTP " + status + " " + msg);
            }
            return text;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    public static String encode(Map<String, String> q) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : q.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(enc(e.getKey())).append('=').append(enc(e.getValue()));
        }
        return sb.toString();
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    public static String hmacSha256(String data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(raw.length * 2);
            for (byte b : raw) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC failed", e);
        }
    }

    /** Binance rejects trailing zeros in some quantity formats; keep it compact. */
    public static String trim(double v) {
        String s = String.format(java.util.Locale.US, "%.8f", v);
        if (s.contains(".")) {
            s = s.replaceAll("0+$", "");
            s = s.replaceAll("\\.$", "");
        }
        return s.isEmpty() ? "0" : s;
    }

    public static double parse(String s) {
        try {
            return Double.parseDouble(s);
        } catch (Exception e) {
            return Double.NaN;
        }
    }

    private static int indexOf(String host) {
        for (int i = 0; i < MARKET_HOSTS.length; i++) {
            if (MARKET_HOSTS[i].equals(host)) return i;
        }
        return 0;
    }
}
