package com.rusindu.aitrade.ui;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.snackbar.Snackbar;
import com.google.android.material.textfield.TextInputEditText;
import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.model.Trade;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.trade.Portfolio;
import com.rusindu.aitrade.trade.TradeExecutor;
import com.rusindu.aitrade.util.Fmt;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Paper (or live) account: positions, protection levels, order panel, equity curve. */
public class TradeFragment extends Fragment implements TradeEngine.Listener {

    private static final int HISTORY_LIMIT = 40;

    private final TradeAdapter tradeAdapter = new TradeAdapter();

    private TextView tvMode, tvEquity, tvReturn, tvCash, tvPosition, tvUnrealized;
    private TextView tvRealized, tvPositionLine, tvSlHint, tvNoTrades;
    private TextInputEditText etAmount, etSl, etTp;
    private MaterialSwitch switchAuto;
    private EquityCurveView equityChart;

    private double lastPrice;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_trade, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View root, @Nullable Bundle savedInstanceState) {
        tvMode = root.findViewById(R.id.tvMode);
        tvEquity = root.findViewById(R.id.tvEquity);
        tvReturn = root.findViewById(R.id.tvReturn);
        tvCash = root.findViewById(R.id.tvCash);
        tvPosition = root.findViewById(R.id.tvPosition);
        tvUnrealized = root.findViewById(R.id.tvUnrealized);
        tvRealized = root.findViewById(R.id.tvRealized);
        tvPositionLine = root.findViewById(R.id.tvPositionLine);
        tvSlHint = root.findViewById(R.id.tvSlHint);
        tvNoTrades = root.findViewById(R.id.tvNoTrades);
        etAmount = root.findViewById(R.id.etAmount);
        etSl = root.findViewById(R.id.etSl);
        etTp = root.findViewById(R.id.etTp);
        switchAuto = root.findViewById(R.id.switchAuto);
        equityChart = root.findViewById(R.id.equityChart);

        RecyclerView rvTrades = root.findViewById(R.id.rvTrades);
        rvTrades.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvTrades.setAdapter(tradeAdapter);

        switchAuto.setChecked(Prefs.autoTrade(requireContext()));
        switchAuto.setOnCheckedChangeListener((b, checked) ->
                Prefs.putBool(requireContext(), Prefs.K_AUTO, checked));

        MaterialButton buy = root.findViewById(R.id.btnBuy);
        MaterialButton sell = root.findViewById(R.id.btnSell);
        buy.setOnClickListener(v -> placeOrder("BUY"));
        sell.setOnClickListener(v -> placeOrder("SELL"));

        View.OnClickListener pct = v -> {
            Portfolio p = Portfolio.load(requireContext());
            int id = v.getId();
            double fraction = id == R.id.btnPct25 ? 0.25 : (id == R.id.btnPct50 ? 0.5 : 1.0);
            etAmount.setText(Fmt.num(Math.max(0, p.cash * fraction), 2));
        };
        root.findViewById(R.id.btnPct25).setOnClickListener(pct);
        root.findViewById(R.id.btnPct50).setOnClickListener(pct);
        root.findViewById(R.id.btnPct100).setOnClickListener(pct);

        root.findViewById(R.id.btnSetProtection).setOnClickListener(v -> setProtection());
        root.findViewById(R.id.btnClearProtection).setOnClickListener(v -> {
            Portfolio p = Portfolio.load(requireContext());
            p.clearProtection();
            p.save(requireContext());
            render();
            snack(getString(R.string.sl_tp_cleared));
        });
        root.findViewById(R.id.btnClosePosition).setOnClickListener(v -> {
            if (lastPrice <= 0) {
                snack(getString(R.string.err_bad_price));
                return;
            }
            TradeExecutor.execute(requireContext(), Prefs.symbol(requireContext()), "SELL", 0,
                    lastPrice, (ok, message) -> {
                        if (ok) {
                            render();
                            snack(getString(R.string.trade_ok, Fmt.price(lastPrice)));
                        } else {
                            snack(translate(message));
                        }
                    });
        });

        Snapshot cached = TradeEngine.get().snapshot();
        if (cached != null) lastPrice = cached.price;
        render();
    }

    @Override
    public void onResume() {
        super.onResume();
        TradeEngine.get().addListener(this);
        switchAuto.setChecked(Prefs.autoTrade(requireContext()));
        Snapshot cached = TradeEngine.get().snapshot();
        if (cached != null) lastPrice = cached.price;
        render();
    }

    @Override
    public void onPause() {
        TradeEngine.get().removeListener(this);
        super.onPause();
    }

    // ------------------------------------------------------------------ actions

    private void placeOrder(String side) {
        if (lastPrice <= 0) {
            snack(getString(R.string.err_bad_price));
            return;
        }
        double amount = parse(etAmount);
        if ("BUY".equals(side) && amount <= 0) {
            snack(getString(R.string.err_bad_qty));
            return;
        }
        if (TradeExecutor.isLive(requireContext())) {
            new MaterialAlertDialogBuilder(requireContext())
                    .setTitle(R.string.confirm_live_title)
                    .setMessage(getString(R.string.confirm_live_message,
                            Prefs.tradingBase(requireContext())))
                    .setPositiveButton(R.string.confirm_yes, (d, w) -> send(side, amount))
                    .setNegativeButton(R.string.confirm_no, null)
                    .show();
        } else {
            send(side, amount);
        }
    }

    private void send(String side, double amount) {
        TradeExecutor.execute(requireContext(), Prefs.symbol(requireContext()), side, amount,
                lastPrice, (ok, message) -> {
                    if (ok) {
                        render();
                        snack(getString(R.string.trade_ok, Fmt.price(lastPrice)));
                    } else {
                        snack(translate(message));
                    }
                });
    }

    private void setProtection() {
        Portfolio p = Portfolio.load(requireContext());
        if (p.qty <= 0) {
            snack(getString(R.string.err_no_position));
            return;
        }
        p.stopLoss = parse(etSl);
        p.takeProfit = parse(etTp);
        p.save(requireContext());
        render();
        snack(getString(R.string.sl_tp_set,
                p.stopLoss > 0 ? Fmt.price(p.stopLoss) : "—",
                p.takeProfit > 0 ? Fmt.price(p.takeProfit) : "—"));
    }

    // ------------------------------------------------------------------ rendering

    private void render() {
        if (getContext() == null) return;
        Portfolio p = Portfolio.load(requireContext());
        double price = lastPrice > 0 ? lastPrice : p.entryPrice;

        boolean live = TradeExecutor.isLive(requireContext());
        tvMode.setText(live ? R.string.mode_live : R.string.mode_paper);
        tvMode.setTextColor(ContextCompat.getColor(requireContext(),
                live ? R.color.down : R.color.accent));

        tvEquity.setText(Fmt.money(p.equity(price)));
        double ret = p.totalReturnPct(price);
        tvReturn.setText(getString(R.string.stats_return) + "  " + Fmt.pct(ret, 2));
        tvReturn.setTextColor(ContextCompat.getColor(requireContext(),
                ret >= 0 ? R.color.up : R.color.down));
        tvCash.setText(Fmt.money(p.cash));
        tvPosition.setText(Fmt.qty(p.qty));
        double upnl = p.unrealized(price);
        tvUnrealized.setText(Fmt.money(upnl));
        tvUnrealized.setTextColor(ContextCompat.getColor(requireContext(),
                upnl >= 0 ? R.color.up : R.color.down));
        tvRealized.setText(Fmt.money(p.realized));
        tvRealized.setTextColor(ContextCompat.getColor(requireContext(),
                p.realized >= 0 ? R.color.up : R.color.down));

        tvPositionLine.setText(p.qty > 0
                ? getString(R.string.position_line, Fmt.qty(p.qty), Fmt.price(p.entryPrice))
                : getString(R.string.no_position));

        double atr = 0;
        Snapshot s = TradeEngine.get().snapshot();
        if (s != null && s.valid) atr = s.atr;
        double base = p.qty > 0 ? p.entryPrice : price;
        tvSlHint.setText(getString(R.string.sl_tp_hint,
                Fmt.price(Math.max(0, base - 1.5 * atr)),
                Fmt.price(base + 2.5 * atr)));
        if (etSl.getText() == null || etSl.getText().toString().isEmpty()) {
            etSl.setText(p.stopLoss > 0 ? Fmt.price(p.stopLoss) : "");
        }
        if (etTp.getText() == null || etTp.getText().toString().isEmpty()) {
            etTp.setText(p.takeProfit > 0 ? Fmt.price(p.takeProfit) : "");
        }

        List<Trade> trades = Journal.get(requireContext()).trades();
        tradeAdapter.submit(trades.subList(0, Math.min(HISTORY_LIMIT, trades.size())));
        tvNoTrades.setVisibility(trades.isEmpty() ? View.VISIBLE : View.GONE);

        List<Double> equity = new ArrayList<>();
        equity.add(p.startCash);
        double running = p.startCash;
        List<Trade> chronological = new ArrayList<>(trades);
        java.util.Collections.reverse(chronological);
        for (Trade t : chronological) {
            if ("SELL".equalsIgnoreCase(t.side)) running += t.pnl;
            equity.add(running);
        }
        equity.add(p.equity(price));
        equityChart.setData(equity);
    }

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
        if (snapshot != null) lastPrice = snapshot.price;
        render();
    }

    @Override
    public void onNewSignal(Signal signal) {
        render();
    }

    @Override
    public void onEngineMessage(String message) {
        snack(translate(message));
    }

    @Override
    public void onProtectionTriggered(int kind, double price) {
        if (getContext() == null) return;
        snack(getString(kind == 1 ? R.string.sl_hit : R.string.tp_hit, Fmt.price(price)));
        render();
    }

    // ------------------------------------------------------------------ helpers

    private static double parse(TextInputEditText e) {
        try {
            String s = e.getText() == null ? "" : e.getText().toString().trim();
            return s.isEmpty() ? 0 : Double.parseDouble(s);
        } catch (Exception ex) {
            return 0;
        }
    }

    private String translate(String message) {
        if (message == null || getContext() == null) return "";
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
            default:
                return getString(R.string.err_generic, message);
        }
    }

    private void snack(String text) {
        if (getView() == null || text == null || text.isEmpty()) return;
        Snackbar.make(getView(), text, Snackbar.LENGTH_SHORT).show();
    }
}
