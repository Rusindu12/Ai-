package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.util.Fmt;

import java.util.ArrayList;
import java.util.List;

/**
 * Candlestick chart with two EMA overlays, a volume histogram and a touch crosshair.
 * Everything is drawn on a Canvas, so there is no charting dependency.
 */
public class CandleChartView extends View {

    public interface CrosshairListener {
        void onCrosshair(String text);
    }

    private final Paint wickUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint wickDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emaFastPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emaSlowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint crossPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint crossLabel = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emptyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path linePath = new Path();

    private List<Candle> candles = new ArrayList<>();
    private double[] emaFast = new double[0];
    private double[] emaSlow = new double[0];
    private int visibleCount = 70;

    private int crossIndex = -1;
    private float crossY = -1;
    private CrosshairListener listener;

    private final float density;

    public CandleChartView(Context context) {
        this(context, null);
    }

    public CandleChartView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;

        int up = ContextCompat.getColor(context, R.color.up);
        int down = ContextCompat.getColor(context, R.color.down);

        wickUp.setColor(up);
        wickDown.setColor(down);
        wickUp.setStrokeWidth(dp(1));
        wickDown.setStrokeWidth(dp(1));
        bodyUp.setColor(up);
        bodyDown.setColor(down);

        emaFastPaint.setStyle(Paint.Style.STROKE);
        emaFastPaint.setStrokeWidth(dp(1.5f));
        emaFastPaint.setColor(ContextCompat.getColor(context, R.color.ema_fast));
        emaSlowPaint.setStyle(Paint.Style.STROKE);
        emaSlowPaint.setStrokeWidth(dp(1.5f));
        emaSlowPaint.setColor(ContextCompat.getColor(context, R.color.ema_slow));

        gridPaint.setColor(ContextCompat.getColor(context, R.color.grid));
        gridPaint.setStrokeWidth(dp(1));

        textPaint.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
        textPaint.setTextSize(dp(9));

        crossPaint.setColor(ContextCompat.getColor(context, R.color.text_secondary));
        crossPaint.setStrokeWidth(dp(1));
        crossPaint.setPathEffect(new DashPathEffect(new float[]{dp(4), dp(4)}, 0));

        crossLabel.setColor(ContextCompat.getColor(context, R.color.surface));
        crossLabel.setTextSize(dp(9));
        crossLabel.setFakeBoldText(true);

        emptyPaint.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
        emptyPaint.setTextSize(dp(12));
        emptyPaint.setTextAlign(Paint.Align.CENTER);
    }

    private float dp(float v) {
        return v * density;
    }

    public void setCrosshairListener(CrosshairListener l) {
        this.listener = l;
    }

    public void setVisibleCount(int count) {
        this.visibleCount = Math.max(10, Math.min(400, count));
        invalidate();
    }

    public void setData(List<Candle> data, double[] fast, double[] slow) {
        this.candles = data == null ? new ArrayList<>() : new ArrayList<>(data);
        this.emaFast = fast == null ? new double[0] : fast;
        this.emaSlow = slow == null ? new double[0] : slow;
        if (crossIndex >= this.candles.size()) crossIndex = -1;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(heightMeasureSpec)
                : (int) dp(230);
        setMeasuredDimension(w, h);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_MOVE:
                updateCrosshair(event.getX(), event.getY());
                performClick();
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                crossIndex = -1;
                crossY = -1;
                if (listener != null) listener.onCrosshair(null);
                invalidate();
                return true;
            default:
                return super.onTouchEvent(event);
        }
    }

    @Override
    public boolean performClick() {
        return super.performClick();
    }

    private void updateCrosshair(float x, float y) {
        int n = candles.size();
        if (n < 2) return;
        float padLeft = dp(6);
        float padRight = dp(66);
        float plotW = getWidth() - padLeft - padRight;
        int count = Math.min(visibleCount, n);
        int start = n - count;
        float cw = plotW / count;
        int idx = (int) ((x - padLeft) / cw);
        idx = Math.max(0, Math.min(count - 1, idx));
        crossIndex = start + idx;
        crossY = y;
        if (listener != null && crossIndex >= 0 && crossIndex < n) {
            Candle c = candles.get(crossIndex);
            listener.onCrosshair(getContext().getString(R.string.crosshair,
                    Fmt.dateTime(c.openTime), Fmt.price(c.close)));
        }
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int n = candles.size();
        if (n < 2) {
            canvas.drawText("· · ·", getWidth() / 2f, getHeight() / 2f, emptyPaint);
            return;
        }

        float padLeft = dp(6);
        float padRight = dp(66);
        float padTop = dp(10);
        float padBottom = dp(16);
        float plotW = getWidth() - padLeft - padRight;
        float plotH = getHeight() - padTop - padBottom;
        if (plotW <= 0 || plotH <= 0) return;

        float volH = plotH * 0.18f;
        float gap = dp(6);
        float priceH = plotH - volH - gap;

        int count = Math.min(visibleCount, n);
        int start = n - count;

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        double maxVol = 0;
        for (int i = start; i < n; i++) {
            Candle c = candles.get(i);
            if (c.low < min) min = c.low;
            if (c.high > max) max = c.high;
            if (c.volume > maxVol) maxVol = c.volume;
        }
        if (max <= min) max = min + 1;
        double span = (max - min) * 0.08;
        min -= span;
        max += span;
        double range = max - min;

        for (int g = 0; g <= 4; g++) {
            float y = padTop + priceH * g / 4f;
            canvas.drawLine(padLeft, y, padLeft + plotW, y, gridPaint);
            double value = max - range * g / 4.0;
            canvas.drawText(Fmt.price(value), padLeft + plotW + dp(6), y + dp(3.5f), textPaint);
        }

        float cw = plotW / count;
        float body = Math.max(dp(1), cw * 0.64f);

        for (int i = start; i < n; i++) {
            Candle c = candles.get(i);
            float x = padLeft + (i - start + 0.5f) * cw;
            boolean up = c.close >= c.open;
            Paint wick = up ? wickUp : wickDown;
            Paint fill = up ? bodyUp : bodyDown;
            float yHigh = (float) (padTop + (max - c.high) / range * priceH);
            float yLow = (float) (padTop + (max - c.low) / range * priceH);
            float yOpen = (float) (padTop + (max - c.open) / range * priceH);
            float yClose = (float) (padTop + (max - c.close) / range * priceH);
            canvas.drawLine(x, yHigh, x, yLow, wick);
            float top = Math.min(yOpen, yClose);
            float hgt = Math.max(dp(1), Math.abs(yClose - yOpen));
            canvas.drawRect(x - body / 2f, top, x + body / 2f, top + hgt, fill);

            if (maxVol > 0) {
                float vh = (float) (c.volume / maxVol * volH);
                Paint vp = new Paint(up ? bodyUp : bodyDown);
                vp.setAlpha(120);
                canvas.drawRect(x - body / 2f, padTop + priceH + gap + volH - vh,
                        x + body / 2f, padTop + priceH + gap + volH, vp);
            }
        }

        drawSeries(canvas, emaFast, start, n, padLeft, padTop, priceH, cw, max, range, emaFastPaint);
        drawSeries(canvas, emaSlow, start, n, padLeft, padTop, priceH, cw, max, range, emaSlowPaint);

        // last price marker
        double last = candles.get(n - 1).close;
        float yLast = (float) (padTop + (max - last) / range * priceH);
        canvas.drawLine(padLeft, yLast, padLeft + plotW, yLast, crossPaint);
        canvas.drawText(Fmt.price(last), padLeft + plotW + dp(6), yLast - dp(3), textPaint);

        // crosshair
        if (crossIndex >= start && crossIndex < n && crossY > 0) {
            float x = padLeft + (crossIndex - start + 0.5f) * cw;
            canvas.drawLine(x, padTop, x, padTop + plotH, crossPaint);
            canvas.drawLine(padLeft, crossY, padLeft + plotW, crossY, crossPaint);
            double priceAt = max - (crossY - padTop) / priceH * range;
            if (crossY <= padTop + priceH) {
                String label = Fmt.price(priceAt);
                float tw = crossLabel.measureText(label) + dp(8);
                canvas.drawRect(padLeft + plotW + dp(3), crossY - dp(7),
                        padLeft + plotW + dp(3) + tw, crossY + dp(7), crossPaint);
                canvas.drawText(label, padLeft + plotW + dp(7), crossY + dp(3), crossLabel);
            }
        }
    }

    private void drawSeries(Canvas canvas, double[] series, int start, int n, float padLeft,
                            float padTop, float plotH, float cw,
                            double max, double range, Paint paint) {
        if (series.length < n) return;
        linePath.reset();
        boolean started = false;
        for (int i = start; i < n; i++) {
            double v = series[i];
            if (Double.isNaN(v)) {
                started = false;
                continue;
            }
            float x = padLeft + (i - start + 0.5f) * cw;
            float y = (float) (padTop + (max - v) / range * plotH);
            if (!started) {
                linePath.moveTo(x, y);
                started = true;
            } else {
                linePath.lineTo(x, y);
            }
        }
        if (started) canvas.drawPath(linePath, paint);
    }
}
