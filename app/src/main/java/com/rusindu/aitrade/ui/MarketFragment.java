package com.rusindu.aitrade.ui;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.util.Fmt;
import com.rusindu.aitrade.util.Intervals;
import com.rusindu.aitrade.util.Reasons;
import com.rusindu.aitrade.util.Watchlist;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Live price, the current signal and the indicator panel. */
public class MarketFragment extends Fragment implements TradeEngine.Listener {

    private static final int[] INDICATOR_LABELS = {
            R.string.ind_rsi, R.string.ind_macd, R.string.ind_ema, R.string.ind_boll,
            R.string.ind_stoch, R.string.ind_trend, R.string.ind_adx, R.string.ind_vol,
            R.string.ind_atr
    };

    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final List<BarMeterView> bars = new ArrayList<>();
    private final List<TextView> values = new ArrayList<>();

    private SwipeRefreshLayout swipe;
    private TextView tvPair, tvPrice, tvChange, tvUpdated, tvCountdown;
    private TextView tvSignal, tvSignalMeta, tvReasons, tvCrosshair;
    private LinearLayout signalBox, indicatorBox;
    private GaugeView gauge;
    private CandleChartView chart;
    private RsiView rsi;
    private EquityCurveView sparkline;
    private ChipGroup chipSymbols, chipIntervals;

    private TradeEngine engine;
    private double lastPrice;
    private boolean buildingChips;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_market, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View root, @Nullable Bundle savedInstanceState) {
        engine = TradeEngine.get();

        swipe = root.findViewById(R.id.swipe);
        tvPair = root.findViewById(R.id.tvPair);
        tvPrice = root.findViewById(R.id.tvPrice);
        tvChange = root.findViewById(R.id.tvChange);
        tvUpdated = root.findViewById(R.id.tvUpdated);
        tvCountdown = root.findViewById(R.id.tvCountdown);
        tvSignal = root.findViewById(R.id.tvSignal);
        tvSignalMeta = root.findViewById(R.id.tvSignalMeta);
        tvReasons = root.findViewById(R.id.tvReasons);
        tvCrosshair = root.findViewById(R.id.tvCrosshair);
        signalBox = root.findViewById(R.id.signalBox);
        indicatorBox = root.findViewById(R.id.indicatorBox);
        gauge = root.findViewById(R.id.gauge);
        chart = root.findViewById(R.id.chart);
        rsi = root.findViewById(R.id.rsi);
        sparkline = root.findViewById(R.id.sparkline);
        chipSymbols = root.findViewById(R.id.chipSymbols);
        chipIntervals = root.findViewById(R.id.chipIntervals);

        swipe.setColorSchemeColors(ContextCompat.getColor(requireContext(), R.color.accent));
        swipe.setOnRefreshListener(() -> {
            engine.refreshNow();
            ticker.postDelayed(() -> swipe.setRefreshing(false), 1200);
        });

        chart.setCrosshairListener(text -> tvCrosshair.setText(text == null ? "" : text));
        gauge.setThreshold(Prefs.threshold(requireContext()));

        buildIndicatorRows();
        buildChips();

        Snapshot cached = engine.snapshot();
        if (cached != null) onMarketUpdate(engine.candles(), cached, engine.ticker());
    }

    @Override
    public void onResume() {
        super.onResume();
        engine.addListener(this);
        engine.start(requireContext());
        gauge.setThreshold(Prefs.threshold(requireContext()));
        Snapshot cached = engine.snapshot();
        if (cached != null) onMarketUpdate(engine.candles(), cached, engine.ticker());
        ticker.post(countdown);
    }

    @Override
    public void onPause() {
        engine.removeListener(this);
        ticker.removeCallbacksAndMessages(null);
        super.onPause();
    }

    private final Runnable countdown = new Runnable() {
        @Override
        public void run() {
            if (tvCountdown == null || getContext() == null) return;
            int every = Prefs.pollSeconds(getContext());
            long elapsed = (System.currentTimeMillis() - engine.lastUpdate()) / 1000L;
            long left = Math.max(0, every - elapsed);
            tvCountdown.setText(getString(R.string.next_update, (int) left));
            ticker.postDelayed(this, 1000);
        }
    };

    // ------------------------------------------------------------------ construction

    private void buildIndicatorRows() {
        indicatorBox.removeAllViews();
        bars.clear();
        values.clear();
        LayoutInflater inflater = LayoutInflater.from(requireContext());
        for (int label : INDICATOR_LABELS) {
            View row = inflater.inflate(R.layout.item_indicator, indicatorBox, false);
            ((TextView) row.findViewById(R.id.indLabel)).setText(label);
            indicatorBox.addView(row);
            bars.add(row.findViewById(R.id.indBar));
            values.add(row.findViewById(R.id.indValue));
        }
    }

    private void buildChips() {
        buildingChips = true;
        chipSymbols.removeAllViews();
        chipIntervals.removeAllViews();

        String currentSymbol = Prefs.symbol(requireContext());
        for (String symbol : Watchlist.get(requireContext())) {
            Chip chip = new Chip(requireContext());
            chip.setText(Fmt.pair(symbol));
            chip.setCheckable(true);
            chip.setChecked(symbol.equals(currentSymbol));
            chip.setTag(symbol);
            chip.setOnClickListener(v -> {
                if (buildingChips) return;
                Prefs.putString(requireContext(), Prefs.K_SYMBOL, (String) v.getTag());
                engine.refreshNow();
            });
            chipSymbols.addView(chip);
        }

        String currentInterval = Prefs.interval(requireContext());
        for (int i = 0; i < Intervals.VALUES.length; i++) {
            final String value = Intervals.VALUES[i];
            Chip chip = new Chip(requireContext());
            chip.setText(Intervals.LABELS[i]);
            chip.setCheckable(true);
            chip.setChecked(value.equals(currentInterval));
            chip.setOnClickListener(v -> {
                if (buildingChips) return;
                Prefs.putString(requireContext(), Prefs.K_INTERVAL, value);
                engine.refreshNow();
            });
            chipIntervals.addView(chip);
        }
        buildingChips = false;
    }

    // ------------------------------------------------------------------ rendering

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
        if (snapshot == null || getContext() == null) return;
        lastPrice = snapshot.price;
        swipe.setRefreshing(false);

        String symbol = Prefs.symbol(getContext());
        tvPair.setText(Fmt.pair(symbol) + " · " + Intervals.label(Prefs.interval(getContext())));
        tvPrice.setText(Fmt.price(snapshot.price));

        if (ticker != null) {
            double changePct = ticker.optDouble("priceChangePercent", Double.NaN);
            tvChange.setText(getString(R.string.change_24h, Fmt.pct(changePct, 2)));
        }
        tvUpdated.setText(getString(R.string.hero_updated, Fmt.time(System.currentTimeMillis())));

        List<Double> closes = new ArrayList<>();
        int from = Math.max(0, candles.size() - 60);
        for (int i = from; i < candles.size(); i++) closes.add(candles.get(i).close);
        sparkline.setData(closes);

        chart.setData(candles, snapshot.emaFastSeries, snapshot.emaSlowSeries);
        rsi.setData(snapshot.rsiSeries);

        if (!snapshot.valid) {
            tvSignal.setText(R.string.signal_neutral);
            tvSignalMeta.setText(R.string.empty_no_data);
            signalBox.setBackgroundResource(R.drawable.bg_signal_glow_neutral);
            tvSignal.setTextColor(ContextCompat.getColor(getContext(), R.color.neutral));
            gauge.set(0, 0, getString(R.string.signal_neutral), "");
            return;
        }

        boolean buy = snapshot.direction == Direction.BUY;
        boolean sell = snapshot.direction == Direction.SELL;
        int color = ContextCompat.getColor(getContext(),
                buy ? R.color.up : (sell ? R.color.down : R.color.neutral));
        tvSignal.setText(buy ? R.string.signal_buy : (sell ? R.string.signal_sell : R.string.signal_neutral));
        tvSignal.setTextColor(color);
        signalBox.setBackgroundResource(buy ? R.drawable.bg_signal_glow_up
                : (sell ? R.drawable.bg_signal_glow_down : R.drawable.bg_signal_glow_neutral));
        tvSignalMeta.setText(getString(R.string.signal_score, Fmt.num(snapshot.score, 3))
                + "  ·  " + getString(R.string.signal_confidence,
                (int) Math.round(snapshot.confidence * 100))
                + "  ·  " + getString(R.string.signal_atr, Fmt.num(snapshot.atrPct, 2)));

        gauge.set(snapshot.score, snapshot.confidence,
                getString(buy ? R.string.signal_buy : (sell ? R.string.signal_sell : R.string.signal_neutral)),
                getString(R.string.signal_confidence, (int) Math.round(snapshot.confidence * 100)));

        StringBuilder reasons = new StringBuilder();
        for (Snapshot.Reason r : snapshot.reasons) {
            if (reasons.length() > 0) reasons.append("\n");
            reasons.append("• ").append(Reasons.text(getContext(), r));
        }
        tvReasons.setText(reasons.toString());

        renderIndicators(snapshot);
    }

    private void renderIndicators(Snapshot s) {
        setIndicator(0, s.features.length > 0 ? s.features[0] : 0, Fmt.num(s.rsi, 1));
        setIndicator(1, s.features.length > 2 ? s.features[2] : 0, Fmt.num(s.macdHist, 4));
        setIndicator(2, s.features.length > 1 ? s.features[1] : 0,
                Fmt.signed(s.emaFast - s.emaSlow, 2));
        setIndicator(3, s.features.length > 3 ? s.features[3] : 0, Fmt.num(s.pctB, 2));
        setIndicator(4, s.features.length > 4 ? s.features[4] : 0, Fmt.num(s.stochK, 0));
        setIndicator(5, s.features.length > 6 ? s.features[6] : 0,
                Fmt.signed(s.price - s.ema50, 2));
        setIndicator(6, 0, Fmt.num(s.adx, 1));
        setIndicator(7, 0, Fmt.num(s.volRatio, 2) + "×");
        setIndicator(8, 0, Fmt.num(s.atrPct, 2) + "%");

        if (bars.size() > 6) {
            bars.get(6).setValue(Math.max(-1, Math.min(1, (s.adx - 25) / 25.0)));
            bars.get(7).setValue(Math.max(-1, Math.min(1, s.volRatio - 1)));
            bars.get(8).setValue(Math.max(-1, Math.min(1, s.atrPct / 3.0)));
        }
    }

    private void setIndicator(int index, double bar, String text) {
        if (index >= bars.size()) return;
        bars.get(index).setValue(bar);
        values.get(index).setText(text);
    }

    @Override
    public void onNewSignal(Signal signal) {
        // the Signals tab owns the history list
    }

    @Override
    public void onEngineMessage(String message) {
        if (tvUpdated == null || getContext() == null) return;
        tvUpdated.setText(getString(R.string.status_error,
                message == null ? "" : message));
    }
}
