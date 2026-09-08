package com.rusindu.aitrade;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.textfield.TextInputEditText;
import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.service.SignalService;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.trade.Portfolio;
import com.rusindu.aitrade.trade.TradeExecutor;
import com.rusindu.aitrade.ui.CandleChartView;
import com.rusindu.aitrade.ui.RsiView;
import com.rusindu.aitrade.ui.SignalAdapter;
import com.rusindu.aitrade.ui.TradeAdapter;
import com.rusindu.aitrade.util.Fmt;
import com.rusindu.aitrade.util.Intervals;

import org.json.JSONObject;

import java.util.List;

/** Main screen: live price, chart, the current signal, the model and the trading panel. */
public class MainActivity extends AppCompatActivity implements TradeEngine.Listener {

    private static final String[] SYMBOLS = {
            "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
            "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TONUSDT"
    };

    private static final int HISTORY_LIMIT = 40;
    private static final int PERMISSION_NOTIFICATIONS = 100;

    private TradeEngine engine;
    private Journal journal;

    private Spinner spinSymbol;
    private Spinner spinInterval;
    private TextView tvPrice;
    private TextView tvChange;
    private TextView tvStatus;
    private TextView tvSignal;
    private TextView tvSignalScore;
    private LinearProgressIndicator pbConfidence;
    private TextView tvModelStats;
    private TextView tvReasons;
    private CandleChartView chart;
    private RsiView rsi;
    private TextView tvRsi, tvMacd, tvEma, tvBoll, tvStoch, tvAdx, tvVol, tvAtr;
    private LinearLayout weightsBox;
    private TextView tvMode;
    private TextView tvAccount;
    private TextInputEditText etAmount;
    private MaterialSwitch switchAuto;
    private RecyclerView rvSignals;
    private RecyclerView rvTrades;
    private TextView tvNoSignals;
    private TextView tvNoTrades;

    private final SignalAdapter signalAdapter = new SignalAdapter();
    private final TradeAdapter tradeAdapter = new TradeAdapter();
    private final ProgressBar[] weightBars = new ProgressBar[AdaptiveModel.FEATURES.length];
    private final TextView[] weightValues = new TextView[AdaptiveModel.FEATURES.length];

    private double lastPrice;
    private boolean spinnerReady;

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(LocaleHelper.wrap(newBase));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        engine = TradeEngine.get();
        journal = Journal.get(this);

        bindViews();
        setupToolbar();
        setupSpinners();
        setupLists();
        buildWeightRows();
        setupTrading();

        tvStatus.setText(R.string.status_starting);
        maybeAskNotificationPermission();

        // Paint whatever we already know before the first network round trip.
        Snapshot cached = engine.snapshot();
        if (cached != null) onMarketUpdate(engine.candles(), cached, engine.ticker());
        refreshLists();
        renderAccount();
    }

    @Override
    protected void onResume() {
        super.onResume();
        engine.addListener(this);
        engine.start(this);
        syncWatchToggle();
        renderMode();
        switchAuto.setChecked(Prefs.autoTrade(this));
        Snapshot cached = engine.snapshot();
        if (cached != null) onMarketUpdate(engine.candles(), cached, engine.ticker());
        refreshLists();
        renderAccount();
    }

    @Override
    protected void onPause() {
        engine.removeListener(this);
        super.onPause();
    }

    // ------------------------------------------------------------------ wiring

    private void bindViews() {
        spinSymbol = findViewById(R.id.spinSymbol);
        spinInterval = findViewById(R.id.spinInterval);
        tvPrice = findViewById(R.id.tvPrice);
        tvChange = findViewById(R.id.tvChange);
        tvStatus = findViewById(R.id.tvStatus);
        tvSignal = findViewById(R.id.tvSignal);
        tvSignalScore = findViewById(R.id.tvSignalScore);
        pbConfidence = findViewById(R.id.pbConfidence);
        tvModelStats = findViewById(R.id.tvModelStats);
        tvReasons = findViewById(R.id.tvReasons);
        chart = findViewById(R.id.chart);
        rsi = findViewById(R.id.rsi);
        tvRsi = findViewById(R.id.tvRsi);
        tvMacd = findViewById(R.id.tvMacd);
        tvEma = findViewById(R.id.tvEma);
        tvBoll = findViewById(R.id.tvBoll);
        tvStoch = findViewById(R.id.tvStoch);
        tvAdx = findViewById(R.id.tvAdx);
        tvVol = findViewById(R.id.tvVol);
        tvAtr = findViewById(R.id.tvAtr);
        weightsBox = findViewById(R.id.weightsBox);
        tvMode = findViewById(R.id.tvMode);
        tvAccount = findViewById(R.id.tvAccount);
        etAmount = findViewById(R.id.etAmount);
        switchAuto = findViewById(R.id.switchAuto);
        rvSignals = findViewById(R.id.rvSignals);
        rvTrades = findViewById(R.id.rvTrades);
        tvNoSignals = findViewById(R.id.tvNoSignals);
        tvNoTrades = findViewById(R.id.tvNoTrades);

        MaterialButton refresh = findViewById(R.id.btnRefresh);
        refresh.setOnClickListener(v -> {
            tvStatus.setText(R.string.status_starting);
            engine.refreshNow();
        });

        MaterialButton resetModel = findViewById(R.id.btnResetModel);
        resetModel.setOnClickListener(v -> confirmResetModel());
    }

    private void setupToolbar() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.inflateMenu(R.menu.menu_main);
        toolbar.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_lang) {
                toggleLanguage();
                return true;
            }
            if (id == R.id.action_watch) {
                boolean on = !Prefs.watchEnabled(this);
                Prefs.putBool(this, Prefs.K_WATCH, on);
                if (on) {
                    SignalService.start(this);
                    toast(getString(R.string.notif_ongoing_title));
                } else {
                    SignalService.stop(this);
                }
                syncWatchToggle();
                return true;
            }
            if (id == R.id.action_settings) {
                startActivity(new Intent(this, SettingsActivity.class));
                return true;
            }
            return false;
        });
    }

    private void syncWatchToggle() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        android.view.MenuItem item = toolbar.getMenu().findItem(R.id.action_watch);
        if (item != null) item.setChecked(Prefs.watchEnabled(this));
    }

    private void setupSpinners() {
        ArrayAdapter<String> symbolAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, SYMBOLS);
        symbolAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinSymbol.setAdapter(symbolAdapter);
        int symbolIndex = 0;
        for (int i = 0; i < SYMBOLS.length; i++) {
            if (SYMBOLS[i].equals(Prefs.symbol(this))) {
                symbolIndex = i;
                break;
            }
        }
        spinSymbol.setSelection(symbolIndex);

        ArrayAdapter<String> intervalAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, Intervals.LABELS);
        spinInterval.setAdapter(intervalAdapter);
        spinInterval.setSelection(Intervals.index(Prefs.interval(this)));

        AdapterView.OnItemSelectedListener listener = new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (!spinnerReady) return;
                if (parent == spinSymbol) {
                    Prefs.putString(MainActivity.this, Prefs.K_SYMBOL, SYMBOLS[position]);
                } else {
                    Prefs.putString(MainActivity.this, Prefs.K_INTERVAL, Intervals.VALUES[position]);
                }
                tvStatus.setText(R.string.status_starting);
                engine.refreshNow();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        };
        spinSymbol.setOnItemSelectedListener(listener);
        spinInterval.setOnItemSelectedListener(listener);
        spinSymbol.post(() -> spinnerReady = true);
        spinInterval.post(() -> spinnerReady = true);
    }

    private void setupLists() {
        rvSignals.setLayoutManager(new LinearLayoutManager(this));
        rvSignals.setAdapter(signalAdapter);
        rvTrades.setLayoutManager(new LinearLayoutManager(this));
        rvTrades.setAdapter(tradeAdapter);
    }

    private void buildWeightRows() {
        weightsBox.removeAllViews();
        float density = getResources().getDisplayMetrics().density;
        for (int i = 0; i < AdaptiveModel.FEATURES.length; i++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, (int) (2 * density), 0, (int) (2 * density));

            TextView label = new TextView(this);
            label.setText(AdaptiveModel.FEATURES[i]);
            label.setTextSize(11);
            label.setTextColor(ContextCompat.getColor(this, R.color.text_secondary));
            label.setWidth((int) (54 * density));
            row.addView(label);

            ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
                    (int) (10 * density), 1f);
            lp.topMargin = (int) (4 * density);
            bar.setLayoutParams(lp);
            bar.setMax(100);
            row.addView(bar);

            TextView value = new TextView(this);
            value.setTextSize(11);
            value.setTextColor(ContextCompat.getColor(this, R.color.text_primary));
            value.setWidth((int) (44 * density));
            value.setGravity(android.view.Gravity.END);
            row.addView(value);

            weightsBox.addView(row);
            weightBars[i] = bar;
            weightValues[i] = value;
        }
        renderWeights();
    }

    private void setupTrading() {
        switchAuto.setOnCheckedChangeListener((button, checked) ->
                Prefs.putBool(this, Prefs.K_AUTO, checked));

        MaterialButton buy = findViewById(R.id.btnBuy);
        MaterialButton sell = findViewById(R.id.btnSell);
        buy.setOnClickListener(v -> placeOrder("BUY"));
        sell.setOnClickListener(v -> placeOrder("SELL"));

        View.OnClickListener pct = v -> {
            Portfolio p = Portfolio.load(this);
            int id = v.getId();
            double fraction = id == R.id.btnPct25 ? 0.25 : (id == R.id.btnPct50 ? 0.50 : 1.0);
            etAmount.setText(Fmt.num(Math.max(0, p.cash * fraction), 2));
        };
        findViewById(R.id.btnPct25).setOnClickListener(pct);
        findViewById(R.id.btnPct50).setOnClickListener(pct);
        findViewById(R.id.btnPct100).setOnClickListener(pct);
    }

    // ------------------------------------------------------------------ actions

    private void placeOrder(String side) {
        if (lastPrice <= 0) {
            toast(getString(R.string.err_bad_price));
            return;
        }
        double amount = parseAmount();
        if ("BUY".equals(side) && amount <= 0) {
            toast(getString(R.string.err_bad_qty));
            return;
        }
        if (TradeExecutor.isLive(this)) {
            String base = Prefs.tradingBase(this);
            new MaterialAlertDialogBuilder(this)
                    .setTitle(R.string.confirm_live_title)
                    .setMessage(getString(R.string.confirm_live_message, base))
                    .setPositiveButton(R.string.confirm_yes, (d, w) -> sendOrder(side, amount))
                    .setNegativeButton(R.string.confirm_no, null)
                    .show();
        } else {
            sendOrder(side, amount);
        }
    }

    private void sendOrder(String side, double amount) {
        tvStatus.setText(R.string.status_starting);
        TradeExecutor.execute(this, Prefs.symbol(this), side, amount, lastPrice, (ok, message) -> {
            if (ok) {
                toast(getString(R.string.trade_ok, Fmt.price(lastPrice)));
                renderAccount();
                refreshLists();
            } else {
                toast(translateError(message));
            }
            tvStatus.setText(getString(R.string.status_connected,
                    Fmt.pair(Prefs.symbol(this)), Fmt.time(System.currentTimeMillis())));
        });
    }

    private double parseAmount() {
        try {
            String s = etAmount.getText() == null ? "" : etAmount.getText().toString().trim();
            return s.isEmpty() ? 0 : Double.parseDouble(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private void confirmResetModel() {
        new MaterialAlertDialogBuilder(this)
                .setMessage(R.string.reset_model_confirm)
                .setPositiveButton(R.string.reset_model, (d, w) -> {
                    journal.model().reset();
                    journal.save(this);
                    renderWeights();
                    toast(getString(R.string.saved));
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show();
    }

    private void toggleLanguage() {
        String current = Prefs.lang(this);
        String next = LocaleHelper.SI.equals(current) ? LocaleHelper.EN : LocaleHelper.SI;
        LocaleHelper.set(this, next);
        recreate();
    }

    // ------------------------------------------------------------------ rendering

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
        if (snapshot == null) return;
        lastPrice = snapshot.price;

        tvPrice.setText(Fmt.price(snapshot.price));
        if (ticker != null) {
            double changePct = ticker.optDouble("priceChangePercent", Double.NaN);
            tvChange.setText(getString(R.string.change_24h, Fmt.pct(changePct, 2)));
            tvChange.setTextColor(ContextCompat.getColor(this,
                    changePct >= 0 ? R.color.up : R.color.down));
        }

        chart.setData(candles, snapshot.emaFastSeries, snapshot.emaSlowSeries);
        rsi.setData(snapshot.rsiSeries);

        if (!snapshot.valid) {
            tvSignal.setText(R.string.signal_neutral);
            tvSignal.setTextColor(ContextCompat.getColor(this, R.color.neutral));
            tvSignalScore.setText(getString(R.string.err_generic,
                    snapshot.problem == null ? "" : snapshot.problem));
            pbConfidence.setProgressCompat(0, false);
            return;
        }

        boolean buy = snapshot.direction == Direction.BUY;
        boolean sell = snapshot.direction == Direction.SELL;
        tvSignal.setText(buy ? R.string.signal_buy : (sell ? R.string.signal_sell : R.string.signal_neutral));
        tvSignal.setTextColor(ContextCompat.getColor(this,
                buy ? R.color.up : (sell ? R.color.down : R.color.neutral)));
        tvSignalScore.setText(getString(R.string.signal_score,
                Fmt.num(snapshot.score, 3),
                (int) Math.round(snapshot.confidence * 100),
                Fmt.num(snapshot.atrPct, 2)));
        pbConfidence.setProgressCompat((int) Math.round(snapshot.confidence * 100), true);

        tvRsi.setText(getString(R.string.ind_rsi, Fmt.num(snapshot.rsi, 1)));
        tvMacd.setText(getString(R.string.ind_macd, Fmt.num(snapshot.macdHist, 4)));
        tvEma.setText(getString(R.string.ind_ema, Fmt.num(snapshot.emaFast - snapshot.emaSlow, 2)));
        tvBoll.setText(getString(R.string.ind_boll, Fmt.num(snapshot.pctB, 2)));
        tvStoch.setText(getString(R.string.ind_stoch, Fmt.num(snapshot.stochK, 1)));
        tvAdx.setText(getString(R.string.ind_adx, Fmt.num(snapshot.adx, 1)));
        tvVol.setText(getString(R.string.ind_vol, Fmt.num(snapshot.volRatio, 2)));
        tvAtr.setText(getString(R.string.ind_atr, Fmt.num(snapshot.atrPct, 2)));

        StringBuilder reasons = new StringBuilder();
        for (Snapshot.Reason r : snapshot.reasons) {
            if (reasons.length() > 0) reasons.append("\n");
            reasons.append("\u2022 ").append(reasonText(r));
        }
        tvReasons.setText(reasons.toString());

        renderModelStats();
        renderWeights();
        renderAccount();

        tvStatus.setText(getString(R.string.status_connected,
                Fmt.pair(Prefs.symbol(this)) + " " + Intervals.label(Prefs.interval(this)),
                Fmt.time(System.currentTimeMillis())));
    }

    @Override
    public void onNewSignal(Signal signal) {
        refreshLists();
    }

    @Override
    public void onEngineMessage(String message) {
        tvStatus.setText(getString(R.string.status_error, translateError(message)));
    }

    private String reasonText(Snapshot.Reason r) {
        int id;
        String value;
        switch (r.code) {
            case "rsi_oversold":
                id = R.string.rsi_oversold;
                value = Fmt.num(r.value, 1);
                break;
            case "rsi_overbought":
                id = R.string.rsi_overbought;
                value = Fmt.num(r.value, 1);
                break;
            case "rsi_mid":
                id = R.string.rsi_mid;
                value = Fmt.num(r.value, 1);
                break;
            case "ema_bullish":
                id = R.string.ema_bullish;
                value = Fmt.num(r.value, 2);
                break;
            case "ema_bearish":
                id = R.string.ema_bearish;
                value = Fmt.num(r.value, 2);
                break;
            case "macd_bullish":
                id = R.string.macd_bullish;
                value = Fmt.num(r.value, 4);
                break;
            case "macd_bearish":
                id = R.string.macd_bearish;
                value = Fmt.num(r.value, 4);
                break;
            case "boll_below_lower":
                id = R.string.boll_below_lower;
                value = Fmt.num(r.value, 0);
                break;
            case "boll_above_upper":
                id = R.string.boll_above_upper;
                value = Fmt.num(r.value, 0);
                break;
            case "boll_inside":
                id = R.string.boll_inside;
                value = Fmt.num(r.value, 0);
                break;
            case "stoch_up":
                id = R.string.stoch_up;
                value = "";
                break;
            case "stoch_down":
                id = R.string.stoch_down;
                value = "";
                break;
            case "momentum_up":
                id = R.string.momentum_up;
                value = Fmt.pct(r.value, 2);
                break;
            case "momentum_down":
                id = R.string.momentum_down;
                value = Fmt.pct(r.value, 2);
                break;
            case "trend_up":
                id = R.string.trend_up;
                value = "";
                break;
            case "trend_down":
                id = R.string.trend_down;
                value = "";
                break;
            case "adx_trending":
                id = R.string.adx_trending;
                value = Fmt.num(r.value, 1);
                break;
            case "adx_ranging":
                id = R.string.adx_ranging;
                value = Fmt.num(r.value, 1);
                break;
            case "volume_high":
                id = R.string.volume_high;
                value = Fmt.num(r.value, 2);
                break;
            case "volume_low":
                id = R.string.volume_low;
                value = Fmt.num(r.value, 2);
                break;
            default:
                return r.code;
        }
        // Always go through the formatter so escaped %% in the resource is unescaped.
        return getString(id, value);
    }

    private void renderModelStats() {
        AdaptiveModel m = journal.model();
        if (m.gradedCount() == 0) {
            tvModelStats.setText(R.string.model_stats_empty);
            return;
        }
        double acc = m.accuracy();
        tvModelStats.setText(getString(R.string.model_stats,
                Fmt.pct(Double.isNaN(acc) ? 0 : acc * 100, 1),
                m.gradedCount(),
                Fmt.pct(m.averageReturn(), 3)));
    }

    private void renderWeights() {
        AdaptiveModel m = journal.model();
        for (int i = 0; i < weightBars.length; i++) {
            if (weightBars[i] == null) continue;
            double w = m.weight(i);
            weightBars[i].setProgress((int) Math.round(w / 5.0 * 100));
            weightValues[i].setText(Fmt.num(w, 2));
        }
    }

    private void renderAccount() {
        Portfolio p = Portfolio.load(this);
        double price = lastPrice > 0 ? lastPrice : p.entryPrice;
        tvAccount.setText(getString(R.string.account_summary,
                Fmt.money(p.equity(price)),
                Fmt.money(p.cash),
                Fmt.pct(p.totalReturnPct(price), 2))
                + "\n"
                + (p.qty > 0
                ? getString(R.string.position_line,
                Fmt.qty(p.qty), Fmt.price(p.entryPrice), Fmt.money(p.unrealized(price)))
                : getString(R.string.no_position)));
        renderMode();
    }

    private void renderMode() {
        boolean live = TradeExecutor.isLive(this);
        tvMode.setText(live ? R.string.mode_live : R.string.mode_paper);
        tvMode.setTextColor(ContextCompat.getColor(this, live ? R.color.down : R.color.accent));
    }

    private void refreshLists() {
        List<Signal> signals = journal.signals();
        List<com.rusindu.aitrade.model.Trade> trades = journal.trades();
        signalAdapter.submit(signals.subList(0, Math.min(HISTORY_LIMIT, signals.size())));
        tradeAdapter.submit(trades.subList(0, Math.min(HISTORY_LIMIT, trades.size())));
        tvNoSignals.setVisibility(signals.isEmpty() ? View.VISIBLE : View.GONE);
        tvNoTrades.setVisibility(trades.isEmpty() ? View.VISIBLE : View.GONE);
        renderModelStats();
    }

    // ------------------------------------------------------------------ helpers

    private String translateError(String message) {
        if (message == null) return getString(R.string.err_generic, "");
        if (message.startsWith("missing_api_key")) return getString(R.string.err_missing_api_key);
        switch (message) {
            case "insufficient_cash":
                return getString(R.string.err_insufficient_cash);
            case "no_position":
                return getString(R.string.err_no_position);
            case "bad_price":
                return getString(R.string.err_bad_price);
            case "bad_qty":
                return getString(R.string.err_bad_qty);
            case "missing_api_key":
                return getString(R.string.err_missing_api_key);
            default:
                return getString(R.string.err_generic, message);
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private void maybeAskNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_NOTIFICATIONS
                && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            toast(getString(R.string.permission_needed));
        }
    }
}
