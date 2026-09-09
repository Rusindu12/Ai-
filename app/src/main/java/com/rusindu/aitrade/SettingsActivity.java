package com.rusindu.aitrade;

import android.content.Context;
import android.os.Bundle;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputEditText;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.net.BinanceApi;
import com.rusindu.aitrade.service.SignalService;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.trade.Portfolio;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Every knob the model, the watcher and the trading mode expose. */
public class SettingsActivity extends AppCompatActivity {

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private TextInputEditText etPoll, etHorizon, etThreshold, etMinConf, etAutoPct, etLr,
            etApiKey, etApiSecret, etStartCash, etWatchlist;
    private TextView tvKeyStatus;
    private MaterialSwitch switchWatch, switchNotify, switchLive, switchTestnet;

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(LocaleHelper.wrap(newBase));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setNavigationOnClickListener(v -> finish());

        bindViews();
        populate();
        wireListeners();
    }

    private void bindViews() {
        etPoll = findViewById(R.id.etPoll);
        etHorizon = findViewById(R.id.etHorizon);
        etThreshold = findViewById(R.id.etThreshold);
        etMinConf = findViewById(R.id.etMinConf);
        etAutoPct = findViewById(R.id.etAutoPct);
        etLr = findViewById(R.id.etLr);
        etApiKey = findViewById(R.id.etApiKey);
        etApiSecret = findViewById(R.id.etApiSecret);
        etStartCash = findViewById(R.id.etStartCash);
        etWatchlist = findViewById(R.id.etWatchlist);
        tvKeyStatus = findViewById(R.id.tvKeyStatus);
        switchWatch = findViewById(R.id.switchWatch);
        switchNotify = findViewById(R.id.switchNotify);
        switchLive = findViewById(R.id.switchLive);
        switchTestnet = findViewById(R.id.switchTestnet);
    }

    private void populate() {
        String theme = Prefs.theme(this);
        RadioGroup rgTheme = findViewById(R.id.rgTheme);
        if ("light".equals(theme)) rgTheme.check(R.id.rbThemeLight);
        else if ("dark".equals(theme)) rgTheme.check(R.id.rbThemeDark);
        else rgTheme.check(R.id.rbThemeSystem);

        String lang = Prefs.lang(this);
        RadioGroup rg = findViewById(R.id.rgLang);
        if (LocaleHelper.SI.equals(lang)) rg.check(R.id.rbSi);
        else if (LocaleHelper.EN.equals(lang)) rg.check(R.id.rbEn);
        else rg.check(R.id.rbSystem);

        switchWatch.setChecked(Prefs.watchEnabled(this));
        switchNotify.setChecked(Prefs.notify(this));
        switchLive.setChecked(Prefs.liveEnabled(this));
        switchTestnet.setChecked(Prefs.useTestnet(this));

        etPoll.setText(String.valueOf(Prefs.pollSeconds(this)));
        etHorizon.setText(String.valueOf(Prefs.horizonCandles(this)));
        etThreshold.setText(String.valueOf(Prefs.threshold(this)));
        etMinConf.setText(String.valueOf(Prefs.minConfidence(this)));
        etAutoPct.setText(String.valueOf(Prefs.autoPct(this)));
        etLr.setText(String.valueOf(Journal.get(this).model().learningRate()));
        etApiKey.setText(Prefs.apiKey(this));
        etApiSecret.setText(Prefs.apiSecret(this));
        etStartCash.setText(String.valueOf(Prefs.startCash(this)));

        StringBuilder wl = new StringBuilder();
        for (String symbol : com.rusindu.aitrade.util.Watchlist.get(this)) {
            if (wl.length() > 0) wl.append(", ");
            wl.append(symbol);
        }
        etWatchlist.setText(wl.toString());
    }

    private void wireListeners() {
        RadioGroup rgTheme = findViewById(R.id.rgTheme);
        rgTheme.setOnCheckedChangeListener((group, checkedId) -> {
            String next = checkedId == R.id.rbThemeLight ? "light"
                    : (checkedId == R.id.rbThemeDark ? "dark" : "system");
            if (next.equals(Prefs.theme(this))) return;
            Prefs.putString(this, Prefs.K_THEME, next);
            App.applyTheme(this);
            recreate();
        });

        RadioGroup rg = findViewById(R.id.rgLang);
        rg.setOnCheckedChangeListener((group, checkedId) -> {
            String lang = checkedId == R.id.rbSi ? LocaleHelper.SI
                    : (checkedId == R.id.rbEn ? LocaleHelper.EN : LocaleHelper.SYSTEM);
            if (lang.equals(Prefs.lang(this))) return;
            LocaleHelper.set(this, lang);
            recreate();
        });

        switchWatch.setOnCheckedChangeListener((b, checked) -> {
            Prefs.putBool(this, Prefs.K_WATCH, checked);
            if (checked) SignalService.start(this);
            else SignalService.stop(this);
        });
        switchNotify.setOnCheckedChangeListener((b, checked) ->
                Prefs.putBool(this, Prefs.K_NOTIFY, checked));
        switchLive.setOnCheckedChangeListener((b, checked) ->
                Prefs.putBool(this, Prefs.K_LIVE, checked));
        switchTestnet.setOnCheckedChangeListener((b, checked) ->
                Prefs.putBool(this, Prefs.K_TESTNET, checked));

        MaterialButton test = findViewById(R.id.btnTestKeys);
        test.setOnClickListener(v -> testConnection());

        MaterialButton resetModel = findViewById(R.id.btnResetModel);
        resetModel.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
                .setMessage(R.string.reset_model_confirm)
                .setPositiveButton(R.string.reset_model, (d, w) -> {
                    saveModelSettings();
                    Journal.get(this).model().reset();
                    Journal.get(this).save(this);
                    toast(getString(R.string.saved));
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show());

        MaterialButton resetAccount = findViewById(R.id.btnResetAccount);
        resetAccount.setOnClickListener(v -> {
            save();
            Portfolio p = new Portfolio(Prefs.startCash(this));
            p.save(this);
            toast(getString(R.string.saved));
        });

        MaterialButton clearHistory = findViewById(R.id.btnClearHistory);
        clearHistory.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
                .setMessage(R.string.clear_history)
                .setPositiveButton(R.string.confirm_yes, (d, w) -> {
                    Journal j = Journal.get(this);
                    j.clearSignals();
                    j.clearTrades();
                    j.save(this);
                    toast(getString(R.string.cleared));
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show());
    }

    private void saveModelSettings() {
        float lr = floatOf(etLr, 0.10f);
        Journal.get(this).model().setLearningRate(lr);
    }

    private void save() {
        Prefs.putInt(this, Prefs.K_POLL, (int) floatOf(etPoll, 20f));
        Prefs.putInt(this, Prefs.K_HORIZON, (int) floatOf(etHorizon, 6f));
        Prefs.putFloat(this, Prefs.K_THRESHOLD, floatOf(etThreshold, 0.22f));
        Prefs.putFloat(this, Prefs.K_MIN_CONF, floatOf(etMinConf, 0.45f));
        Prefs.putFloat(this, Prefs.K_AUTO_PCT, floatOf(etAutoPct, 20f));
        Prefs.putString(this, Prefs.K_API_KEY, text(etApiKey));
        Prefs.putString(this, Prefs.K_API_SECRET, text(etApiSecret));
        Prefs.putFloat(this, Prefs.K_START_CASH, floatOf(etStartCash, 10000f));

        java.util.List<String> watch = new java.util.ArrayList<>();
        for (String part : text(etWatchlist).split(",")) {
            String t = part.trim().toUpperCase(java.util.Locale.US);
            if (!t.isEmpty() && !watch.contains(t)) watch.add(t);
        }
        if (!watch.isEmpty()) com.rusindu.aitrade.util.Watchlist.set(this, watch);
        saveModelSettings();
        Journal.get(this).save(this);
    }

    private void testConnection() {
        save();
        String base = Prefs.tradingBase(this);
        String key = Prefs.apiKey(this);
        String secret = Prefs.apiSecret(this);
        if (key.isEmpty() || secret.isEmpty()) {
            tvKeyStatus.setText(R.string.err_missing_api_key);
            return;
        }
        tvKeyStatus.setText(R.string.status_starting);
        io.execute(() -> {
            String message;
            try {
                BinanceApi.syncTime(base);
                JSONObject account = BinanceApi.account(base, key, secret);
                message = getString(R.string.test_ok, summarize(account));
            } catch (Exception e) {
                String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                message = getString(R.string.test_fail, m);
            }
            String finalMessage = message;
            runOnUiThread(() -> tvKeyStatus.setText(finalMessage));
        });
    }

    private String summarize(JSONObject account) {
        List<String> parts = new ArrayList<>();
        JSONArray balances = account.optJSONArray("balances");
        if (balances != null) {
            for (int i = 0; i < balances.length() && parts.size() < 5; i++) {
                JSONObject b = balances.optJSONObject(i);
                if (b == null) continue;
                double free = BinanceApi.parse(b.optString("free", "0"));
                double locked = BinanceApi.parse(b.optString("locked", "0"));
                if (free + locked > 0) {
                    parts.add(b.optString("asset") + " " + trim(free + locked));
                }
            }
        }
        if (parts.isEmpty()) return getString(R.string.mode_paper);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) sb.append(" · ");
            sb.append(parts.get(i));
        }
        return sb.toString();
    }

    private static String trim(double v) {
        if (v >= 1000) return String.format(java.util.Locale.US, "%.0f", v);
        return String.format(java.util.Locale.US, "%.4f", v);
    }

    private static String text(TextInputEditText e) {
        return e.getText() == null ? "" : e.getText().toString().trim();
    }

    private static float floatOf(TextInputEditText e, float fallback) {
        try {
            String s = e.getText() == null ? "" : e.getText().toString().trim();
            return s.isEmpty() ? fallback : Float.parseFloat(s);
        } catch (Exception ex) {
            return fallback;
        }
    }

    @Override
    protected void onPause() {
        save();
        super.onPause();
        // pick up new poll interval / thresholds right away
        if (Prefs.watchEnabled(this)) TradeEngine.get().refreshNow();
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
