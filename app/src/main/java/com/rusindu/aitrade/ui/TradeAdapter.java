package com.rusindu.aitrade.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.model.Trade;
import com.rusindu.aitrade.util.Fmt;

import java.util.ArrayList;
import java.util.List;

/** Fills from the paper (or live) account. */
public class TradeAdapter extends RecyclerView.Adapter<TradeAdapter.VH> {

    private final List<Trade> items = new ArrayList<>();

    public void submit(List<Trade> data) {
        items.clear();
        if (data != null) items.addAll(data);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_trade, parent, false);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        Trade t = items.get(position);
        boolean buy = "BUY".equalsIgnoreCase(t.side);
        h.side.setText(buy ? R.string.buy : R.string.sell);
        h.side.setTextColor(h.itemView.getContext().getResources()
                .getColor(buy ? R.color.up : R.color.down, null));
        h.qty.setText(Fmt.qty(t.qty));
        h.price.setText(Fmt.price(t.price));
        h.pnl.setText("SELL".equalsIgnoreCase(t.side) ? Fmt.money(t.pnl) : "--");
        h.pnl.setTextColor(t.pnl >= 0
                ? h.itemView.getContext().getResources().getColor(R.color.up, null)
                : h.itemView.getContext().getResources().getColor(R.color.down, null));
        h.time.setText(Fmt.time(t.time));
        h.mode.setText(t.live ? R.string.mode_live : R.string.mode_paper);
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class VH extends RecyclerView.ViewHolder {
        final TextView side;
        final TextView qty;
        final TextView price;
        final TextView pnl;
        final TextView time;
        final TextView mode;

        VH(@NonNull View v) {
            super(v);
            side = v.findViewById(R.id.trSide);
            qty = v.findViewById(R.id.trQty);
            price = v.findViewById(R.id.trPrice);
            pnl = v.findViewById(R.id.trPnl);
            time = v.findViewById(R.id.trTime);
            mode = v.findViewById(R.id.trMode);
        }
    }
}
