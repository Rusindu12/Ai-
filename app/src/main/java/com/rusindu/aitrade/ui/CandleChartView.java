package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.View;

import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.util.Fmt;

import java.util.ArrayList;
import java.util.List;

/** Lightweight candlestick chart with two EMA overlays. No charting library needed. */
public class CandleChartView extends View {

    private static final int UP = 0xFF26A69A;
    private static final int DOWN = 0xFFEF5350;

    private final Paint wickUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint wickDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emaFastPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emaSlowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint lastPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path emaPath = new Path();

    private List<Candle> candles = new ArrayList<>();
    private double[] emaFast = new double[0];
    private double[] emaSlow = new double[0];
    private int visibleCount = 70;

    private final float density;

    public CandleChartView(Context context) {
        this(context, null);
    }

    public CandleChartView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;

        wickUp.setColor(UP);
        wickDown.setColor(DOWN);
        wickUp.setStrokeWidth(dp(1));
        wickDown.setStrokeWidth(dp(1));
        bodyUp.setColor(UP);
        bodyDown.setColor(DOWN);

        emaFastPaint.setStyle(Paint.Style.STROKE);
        emaFastPaint.setStrokeWidth(dp(1.4f));
        emaFastPaint.setColor(0xFFFFC107);
        emaSlowPaint.setStyle(Paint.Style.STROKE);
        emaSlowPaint.setStrokeWidth(dp(1.4f));
        emaSlowPaint.setColor(0xFF42A5F5);

        gridPaint.setColor(0x22FFFFFF);
        gridPaint.setStrokeWidth(dp(1));

        textPaint.setColor(0x99FFFFFF);
        textPaint.setTextSize(dp(9));
        textPaint.setTextAlign(Paint.Align.LEFT);

        lastPaint.setColor(0xAAFFFFFF);
        lastPaint.setStrokeWidth(dp(1));
        lastPaint.setPathEffect(new DashPathEffect(new float[]{dp(4), dp(4)}, 0));
    }

    private float dp(float v) {
        return v * density;
    }

    public void setVisibleCount(int count) {
        this.visibleCount = Math.max(10, Math.min(400, count));
        invalidate();
    }

    public void setData(List<Candle> data, double[] fast, double[] slow) {
        this.candles = data == null ? new ArrayList<>() : new ArrayList<>(data);
        this.emaFast = fast == null ? new double[0] : fast;
        this.emaSlow = slow == null ? new double[0] : slow;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getSize(heightMeasureSpec);
        if (MeasureSpec.getMode(heightMeasureSpec) != MeasureSpec.EXACTLY) {
            h = (int) dp(210);
        }
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int n = candles.size();
        if (n < 2) {
            textPaint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText("...", getWidth() / 2f, getHeight() / 2f, textPaint);
            textPaint.setTextAlign(Paint.Align.LEFT);
            return;
        }

        float padLeft = dp(6);
        float padRight = dp(64);
        float padTop = dp(8);
        float padBottom = dp(14);
        float plotW = getWidth() - padLeft - padRight;
        float plotH = getHeight() - padTop - padBottom;
        if (plotW <= 0 || plotH <= 0) return;

        int count = Math.min(visibleCount, n);
        int start = n - count;

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        for (int i = start; i < n; i++) {
            Candle c = candles.get(i);
            if (c.low < min) min = c.low;
            if (c.high > max) max = c.high;
        }
        if (max <= min) max = min + 1;
        double span = (max - min) * 0.08;
        min -= span;
        max += span;

        // grid + price axis
        for (int g = 0; g <= 4; g++) {
            float y = padTop + plotH * g / 4f;
            canvas.drawLine(padLeft, y, padLeft + plotW, y, gridPaint);
            double value = max - (max - min) * g / 4.0;
            canvas.drawText(Fmt.price(value), padLeft + plotW + dp(6), y + dp(3.5f), textPaint);
        }

        float cw = plotW / count;
        float body = Math.max(dp(1), cw * 0.62f);
        double range = max - min;

        for (int i = start; i < n; i++) {
            Candle c = candles.get(i);
            float x = padLeft + (i - start + 0.5f) * cw;
            boolean up = c.close >= c.open;
            Paint wick = up ? wickUp : wickDown;
            Paint fill = up ? bodyUp : bodyDown;
            float yHigh = (float) (padTop + (max - c.high) / range * plotH);
            float yLow = (float) (padTop + (max - c.low) / range * plotH);
            float yOpen = (float) (padTop + (max - c.open) / range * plotH);
            float yClose = (float) (padTop + (max - c.close) / range * plotH);
            canvas.drawLine(x, yHigh, x, yLow, wick);
            float top = Math.min(yOpen, yClose);
            float h = Math.max(dp(1), Math.abs(yClose - yOpen));
            canvas.drawRect(x - body / 2f, top, x + body / 2f, top + h, fill);
        }

        drawSeries(canvas, emaFast, start, n, padLeft, padTop, plotW, plotH, cw, min, range, emaFastPaint);
        drawSeries(canvas, emaSlow, start, n, padLeft, padTop, plotW, plotH, cw, min, range, emaSlowPaint);

        double last = candles.get(n - 1).close;
        float yLast = (float) (padTop + (max - last) / range * plotH);
        canvas.drawLine(padLeft, yLast, padLeft + plotW, yLast, lastPaint);
        canvas.drawText(Fmt.price(last), padLeft + plotW + dp(6), yLast - dp(3), textPaint);
    }

    private void drawSeries(Canvas canvas, double[] series, int start, int n, float padLeft,
                            float padTop, float plotW, float plotH, float cw,
                            double min, double range, Paint paint) {
        if (series.length < n) return;
        emaPath.reset();
        boolean started = false;
        for (int i = start; i < n; i++) {
            double v = series[i];
            if (Double.isNaN(v)) {
                started = false;
                continue;
            }
            float x = padLeft + (i - start + 0.5f) * cw;
            float y = (float) (padTop + (max(v, min, min + range) - min) / range * plotH);
            if (!started) {
                emaPath.moveTo(x, y);
                started = true;
            } else {
                emaPath.lineTo(x, y);
            }
        }
        if (started) canvas.drawPath(emaPath, paint);
    }

    private static double max(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** Colours used by the legend. */
    public static int emaFastColor() {
        return 0xFFFFC107;
    }

    public static int emaSlowColor() {
        return 0xFF42A5F5;
    }

    public static int upColor() {
        return UP;
    }

    public static int downColor() {
        return DOWN;
    }

    public static int neutralColor() {
        return Color.GRAY;
    }
}
