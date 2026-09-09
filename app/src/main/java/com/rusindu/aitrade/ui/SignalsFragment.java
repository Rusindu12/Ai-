package com.rusindu.aitrade.ui;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.Scanner;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.ScanResult;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.store.Journal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.util.Csv;
import com.rusindu.aitrade.util.Fmt;
import com.rusindu.aitrade.util.Watchlist;

import org.json.JSONObject;

import java.util.List;

/** Watchlist scanner plus the graded signal history. */
public class SignalsFragment extends Fragment implements TradeEngine.Listener {

    private static final int HISTORY_LIMIT = 50;

    private final SignalAdapter signalAdapter = new SignalAdapter();
    private final ScannerAdapter scannerAdapter = new ScannerAdapter();

    private MaterialButton btnScan;
    private LinearProgressIndicator progress;
    private TextView tvScanStatus;
    private TextView tvNoSignals;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_signals, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View root, @Nullable Bundle savedInstanceState) {
        btnScan = root.findViewById(R.id.btnScan);
        progress = root.findViewById(R.id.scanProgress);
        tvScanStatus = root.findViewById(R.id.tvScanStatus);
        tvNoSignals = root.findViewById(R.id.tvNoSignals);

        RecyclerView rvScanner = root.findViewById(R.id.rvScanner);
        rvScanner.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvScanner.setAdapter(scannerAdapter);

        RecyclerView rvSignals = root.findViewById(R.id.rvSignals);
        rvSignals.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvSignals.setAdapter(signalAdapter);

        scannerAdapter.setOnPick(symbol -> {
            Prefs.putString(requireContext(), Prefs.K_SYMBOL, symbol);
            TradeEngine.get().refreshNow();
            if (getActivity() instanceof com.rusindu.aitrade.MainActivity) {
                ((com.rusindu.aitrade.MainActivity) getActivity()).showMarket();
            }
        });

        btnScan.setOnClickListener(v -> startScan());
        root.findViewById(R.id.btnShare).setOnClickListener(v -> share());

        refreshHistory();
    }

    @Override
    public void onResume() {
        super.onResume();
        TradeEngine.get().addListener(this);
        refreshHistory();
    }

    @Override
    public void onPause() {
        TradeEngine.get().removeListener(this);
        super.onPause();
    }

    private void startScan() {
        List<String> symbols = Watchlist.get(requireContext());
        btnScan.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        progress.setProgressCompat(0, false);
        tvScanStatus.setText(getString(R.string.scanning, 0, symbols.size()));

        Scanner.scan(requireContext(), symbols, new Scanner.Callback() {
            @Override
            public void onProgress(int done, int total, String symbol) {
                if (getContext() == null) return;
                progress.setProgressCompat((int) (done * 100.0 / Math.max(1, total)), true);
                tvScanStatus.setText(getString(R.string.scanning, done, total));
            }

            @Override
            public void onResult(List<ScanResult> results) {
                if (getContext() == null) return;
                btnScan.setEnabled(true);
                progress.setVisibility(View.GONE);
                scannerAdapter.submit(results);
                tvScanStatus.setText(getString(R.string.scanner_updated, results.size(),
                        Fmt.time(System.currentTimeMillis())));
            }

            @Override
            public void onError(String message) {
                if (getContext() == null) return;
                btnScan.setEnabled(true);
                progress.setVisibility(View.GONE);
                tvScanStatus.setText(getString(R.string.scanner_failed, message));
            }
        });
    }

    private void refreshHistory() {
        if (getContext() == null) return;
        List<Signal> signals = Journal.get(requireContext()).signals();
        signalAdapter.submit(signals.subList(0, Math.min(HISTORY_LIMIT, signals.size())));
        tvNoSignals.setVisibility(signals.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private void share() {
        String csv = Csv.build(requireContext());
        if (csv.length() < 80) {
            tvScanStatus.setText(R.string.share_empty);
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, getString(R.string.share_subject));
        send.putExtra(Intent.EXTRA_TEXT, csv);
        startActivity(Intent.createChooser(send, getString(R.string.share_history)));
    }

    @Override
    public void onNewSignal(Signal signal) {
        refreshHistory();
    }

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
    }

    @Override
    public void onEngineMessage(String message) {
    }
}
