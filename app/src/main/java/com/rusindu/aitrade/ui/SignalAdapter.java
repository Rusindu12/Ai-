package com.rusindu.aitrade.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.util.Fmt;
import com.rusindu.aitrade.util.Intervals;

import java.util.ArrayList;
import java.util.List;

/** History of emitted signals with their graded outcome. */
public class SignalAdapter extends RecyclerView.Adapter<SignalAdapter.VH> {

    private final List<Signal> items = new ArrayList<>();

    public void submit(List<Signal> data) {
        items.clear();
        if (data != null) items.addAll(data);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_signal, parent, false);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        Signal s = items.get(position);
        boolean buy = s.direction == Direction.BUY;
        h.badge.setText(buy ? R.string.signal_buy : R.string.signal_sell);
        h.badge.setBackgroundResource(buy ? R.drawable.bg_badge_buy : R.drawable.bg_badge_sell);
        h.title.setText(Fmt.pair(s.symbol) + "  " + Intervals.label(s.interval));
        h.price.setText(Fmt.price(s.price));
        h.confidence.setText((int) Math.round(s.confidence * 100) + "%");
        h.time.setText(Fmt.dateTime(s.time));
        if (s.graded) {
            h.result.setText(Fmt.pct(s.returnPct, 2) + (s.correct ? "  \u2713" : "  \u2717"));
            h.result.setTextColor(h.itemView.getContext().getResources()
                    .getColor(s.correct ? R.color.up : R.color.down, null));
        } else {
            h.result.setText(R.string.pending);
            h.result.setTextColor(0x88FFFFFF);
        }
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class VH extends RecyclerView.ViewHolder {
        final TextView badge;
        final TextView title;
        final TextView price;
        final TextView confidence;
        final TextView time;
        final TextView result;

        VH(@NonNull View v) {
            super(v);
            badge = v.findViewById(R.id.sigBadge);
            title = v.findViewById(R.id.sigTitle);
            price = v.findViewById(R.id.sigPrice);
            confidence = v.findViewById(R.id.sigConfidence);
            time = v.findViewById(R.id.sigTime);
            result = v.findViewById(R.id.sigResult);
        }
    }
}
