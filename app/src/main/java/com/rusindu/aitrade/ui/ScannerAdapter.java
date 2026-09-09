package com.rusindu.aitrade.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.ScanResult;
import com.rusindu.aitrade.util.Fmt;

import java.util.ArrayList;
import java.util.List;

/** Ranked watchlist produced by {@link com.rusindu.aitrade.core.Scanner}. */
public class ScannerAdapter extends RecyclerView.Adapter<ScannerAdapter.VH> {

    public interface OnPick {
        void onPick(String symbol);
    }

    private final List<ScanResult> items = new ArrayList<>();
    private OnPick pick;

    public void setOnPick(OnPick l) {
        this.pick = l;
    }

    public void submit(List<ScanResult> data) {
        items.clear();
        if (data != null) items.addAll(data);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_scanner, parent, false);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        ScanResult r = items.get(position);
        boolean buy = r.direction == Direction.BUY;
        boolean sell = r.direction == Direction.SELL;
        int color = ContextCompat.getColor(h.itemView.getContext(),
                buy ? R.color.up : (sell ? R.color.down : R.color.neutral));

        h.badge.setText(buy ? R.string.signal_buy : (sell ? R.string.signal_sell : "—"));
        h.badge.setBackgroundResource(buy ? R.drawable.bg_badge_buy
                : (sell ? R.drawable.bg_badge_sell : R.drawable.bg_badge_neutral));
        h.symbol.setText(Fmt.pair(r.symbol));
        h.price.setText(Fmt.price(r.price));
        h.score.setText(Fmt.num(r.score, 2));
        h.score.setTextColor(color);
        h.bar.setValue(r.score);
        h.meta.setText(h.itemView.getContext().getString(R.string.signal_confidence,
                (int) Math.round(r.confidence * 100))
                + " · RSI " + Fmt.num(r.rsi, 0)
                + " · ATR " + Fmt.num(r.atrPct, 2) + "%");
        h.itemView.setOnClickListener(v -> {
            if (pick != null) pick.onPick(r.symbol);
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class VH extends RecyclerView.ViewHolder {
        final TextView badge;
        final TextView symbol;
        final TextView price;
        final TextView score;
        final TextView meta;
        final BarMeterView bar;

        VH(@NonNull View v) {
            super(v);
            badge = v.findViewById(R.id.scBadge);
            symbol = v.findViewById(R.id.scSymbol);
            price = v.findViewById(R.id.scPrice);
            score = v.findViewById(R.id.scScore);
            meta = v.findViewById(R.id.scMeta);
            bar = v.findViewById(R.id.scBar);
        }
    }
}
