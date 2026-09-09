package com.rusindu.aitrade.ui;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.snackbar.Snackbar;
import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.AdaptiveModel;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.Backtester;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.BacktestResult;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.util.Fmt;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** The learning model: weights, live scoreboard and a walk-forward backtest. */
public class ModelFragment extends Fragment implements TradeEngine.Listener {

    private final List<BarMeterView> bars = new ArrayList<>();
    private final List<TextView> values = new ArrayList<>();

    private TextView tvAccuracy, tvGraded, tvAvgReturn, tvAvgMove, tvModelEmpty;
    private TextView tvRegime, tvThresholdEff, tvExpertTrend, tvExpertRange;
    private LinearProgressIndicator pbAccuracy;
    private LinearLayout weightsBox, backtestStats;
    private TextView tvBacktestStatus, tvBacktestHelp;
    private TextView tvBtTrades, tvBtWinRate, tvBtReturn, tvBtBuyHold, tvBtDrawdown, tvBtAvg;
    private EquityCurveView btEquity;
    private MaterialButton btnBacktest;

    private volatile boolean running;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_model, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View root, @Nullable Bundle savedInstanceState) {
        tvAccuracy = root.findViewById(R.id.tvAccuracy);
        tvGraded = root.findViewById(R.id.tvGraded);
        tvAvgReturn = root.findViewById(R.id.tvAvgReturn);
        tvAvgMove = root.findViewById(R.id.tvAvgMove);
        tvModelEmpty = root.findViewById(R.id.tvModelEmpty);
        pbAccuracy = root.findViewById(R.id.pbAccuracy);
        tvRegime = root.findViewById(R.id.tvRegime);
        tvThresholdEff = root.findViewById(R.id.tvThresholdEff);
        tvExpertTrend = root.findViewById(R.id.tvExpertTrend);
        tvExpertRange = root.findViewById(R.id.tvExpertRange);
        weightsBox = root.findViewById(R.id.weightsBox);
        backtestStats = root.findViewById(R.id.backtestStats);
        tvBacktestStatus = root.findViewById(R.id.tvBacktestStatus);
        tvBacktestHelp = root.findViewById(R.id.tvBacktestHelp);
        tvBtTrades = root.findViewById(R.id.tvBtTrades);
        tvBtWinRate = root.findViewById(R.id.tvBtWinRate);
        tvBtReturn = root.findViewById(R.id.tvBtReturn);
        tvBtBuyHold = root.findViewById(R.id.tvBtBuyHold);
        tvBtDrawdown = root.findViewById(R.id.tvBtDrawdown);
        tvBtAvg = root.findViewById(R.id.tvBtAvg);
        btEquity = root.findViewById(R.id.btEquity);
        btnBacktest = root.findViewById(R.id.btnBacktest);

        tvBacktestHelp.setText(getString(R.string.backtest_help, TradeEngine.get().candles().size()));

        buildWeightRows();
        renderScoreboard();
        renderWeights();

        MaterialButton reset = root.findViewById(R.id.btnResetModel);
        reset.setOnClickListener(v -> new MaterialAlertDialogBuilder(requireContext())
                .setMessage(R.string.reset_model_confirm)
                .setPositiveButton(R.string.reset_model, (d, w) -> {
                    Journal.get(requireContext()).model().reset();
                    Journal.get(requireContext()).save(requireContext());
                    renderScoreboard();
                    renderWeights();
                    Snackbar.make(requireView(), R.string.saved, Snackbar.LENGTH_SHORT).show();
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show());

        btnBacktest.setOnClickListener(v -> runBacktest());
    }

    @Override
    public void onResume() {
        super.onResume();
        TradeEngine.get().addListener(this);
        renderScoreboard();
        renderWeights();
    }

    @Override
    public void onPause() {
        TradeEngine.get().removeListener(this);
        super.onPause();
    }

    // ------------------------------------------------------------------ weights

    private void buildWeightRows() {
        weightsBox.removeAllViews();
        bars.clear();
        values.clear();
        LayoutInflater inflater = LayoutInflater.from(requireContext());
        for (String feature : AdaptiveModel.FEATURES) {
            View row = inflater.inflate(R.layout.item_weight, weightsBox, false);
            ((TextView) row.findViewById(R.id.wLabel)).setText(feature);
            weightsBox.addView(row);
            bars.add(row.findViewById(R.id.wBar));
            values.add(row.findViewById(R.id.wValue));
        }
    }

    private void renderWeights() {
        AdaptiveModel m = Journal.get(requireContext()).model();
        for (int i = 0; i < bars.size(); i++) {
            double w = m.weight(i);
            // 1.0 is the neutral starting weight; show it as a deviation around the middle
            bars.get(i).setValue((w - 1.0) / 2.0);
            values.get(i).setText(Fmt.num(w, 2));
        }
    }

    private void renderScoreboard() {
        AdaptiveModel m = Journal.get(requireContext()).model();
        tvGraded.setText(String.valueOf(m.gradedCount()));
        if (m.gradedCount() == 0) {
            tvAccuracy.setText("--");
            tvAvgReturn.setText("--");
            tvAvgMove.setText("--");
            pbAccuracy.setProgressCompat(0, false);
            tvModelEmpty.setVisibility(View.VISIBLE);
            return;
        }
        tvModelEmpty.setVisibility(View.GONE);
        double acc = m.accuracy();
        tvAccuracy.setText(Fmt.pct(Double.isNaN(acc) ? 0 : acc * 100, 1));
        tvAccuracy.setTextColor(ContextCompat.getColor(requireContext(),
                acc >= 0.5 ? R.color.up : R.color.down));
        pbAccuracy.setProgressCompat((int) Math.round((Double.isNaN(acc) ? 0 : acc) * 100), true);
        tvAvgReturn.setText(Fmt.pct(m.averageReturn(), 3));
        tvAvgReturn.setTextColor(ContextCompat.getColor(requireContext(),
                m.averageReturn() >= 0 ? R.color.up : R.color.down));
        tvAvgMove.setText(Fmt.pct(m.averageMove(), 3));
        renderAdaptive(m);
    }

    /** Regime, adaptive threshold and the two experts' hit rates. */
    private void renderAdaptive(AdaptiveModel m) {
        if (tvRegime == null) return;
        double regime = m.regime();
        tvRegime.setText(getString(regime >= 0.5 ? R.string.regime_trending : R.string.regime_ranging)
                + " · " + Fmt.num(regime * 100, 0));
        tvRegime.setTextColor(ContextCompat.getColor(requireContext(),
                regime >= 0.5 ? R.color.up : R.color.down));
        tvThresholdEff.setText(Fmt.num(m.effectiveThreshold(Prefs.threshold(requireContext())), 2));
        double accT = m.accuracyTrend();
        double accR = m.accuracyRange();
        tvExpertTrend.setText(m.gradedTrend() == 0 ? "--"
                : Fmt.pct(accT * 100, 0) + " (" + m.gradedTrend() + ")");
        tvExpertRange.setText(m.gradedRange() == 0 ? "--"
                : Fmt.pct(accR * 100, 0) + " (" + m.gradedRange() + ")");
    }

    // ------------------------------------------------------------------ backtest

    private void runBacktest() {
        if (running) return;
        final List<Candle> candles = TradeEngine.get().candles();
        if (candles.size() < 80) {
            tvBacktestStatus.setText(R.string.backtest_none);
            return;
        }
        running = true;
        btnBacktest.setEnabled(false);
        tvBacktestStatus.setText(getString(R.string.backtest_running, candles.size()));

        final double threshold = Prefs.threshold(requireContext());
        final int horizon = Prefs.horizonCandles(requireContext());
        final double minConf = Prefs.minConfidence(requireContext());
        final AdaptiveModel model = Journal.get(requireContext()).model();

        TradeEngine.get().submit(() -> {
            final BacktestResult r = Backtester.run(candles, model, threshold, horizon, minConf, true);
            TradeEngine.get().postUi(() -> {
                running = false;
                if (getContext() == null) return;
                btnBacktest.setEnabled(true);
                if (!r.enough) {
                    tvBacktestStatus.setText(R.string.backtest_none);
                    return;
                }
                tvBacktestStatus.setText(getString(R.string.backtest_done, r.trades));
                backtestStats.setVisibility(View.VISIBLE);
                tvBtTrades.setText(String.valueOf(r.trades));
                tvBtWinRate.setText(Fmt.num(r.winRatePct, 1) + "%");
                tvBtReturn.setText(Fmt.pct(r.totalReturnPct, 2));
                tvBtReturn.setTextColor(ContextCompat.getColor(requireContext(),
                        r.totalReturnPct >= 0 ? R.color.up : R.color.down));
                tvBtBuyHold.setText(Fmt.pct(r.buyHoldPct, 2));
                tvBtBuyHold.setTextColor(ContextCompat.getColor(requireContext(),
                        r.buyHoldPct >= 0 ? R.color.up : R.color.down));
                tvBtDrawdown.setText(Fmt.num(r.maxDrawdownPct, 2) + "%");
                tvBtAvg.setText(Fmt.pct(r.averageTradePct, 3));
                btEquity.setData(r.equity);
            });
        });
    }

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
        renderScoreboard();
        renderWeights();
    }

    @Override
    public void onNewSignal(Signal signal) {
    }

    @Override
    public void onEngineMessage(String message) {
    }
}
