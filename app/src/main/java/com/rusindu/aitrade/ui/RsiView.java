package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.util.Fmt;

/** RSI oscillator strip with 30 / 70 bands, shaded by overbought / oversold. */
public class RsiView extends View {

    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint band = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mid = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint zoneUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint zoneDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();

    private double[] rsi = new double[0];
    private final float density;

    public RsiView(Context context) {
        this(context, null);
    }

    public RsiView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(dp(1.5f));
        line.setColor(ContextCompat.getColor(context, R.color.rsi_line));
        band.setColor(ContextCompat.getColor(context, R.color.grid));
        band.setStrokeWidth(dp(1));
        mid.setColor(ContextCompat.getColor(context, R.color.hairline));
        mid.setStrokeWidth(dp(1));
        text.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
        text.setTextSize(dp(9));
        zoneUp.setColor(ContextCompat.getColor(context, R.color.up_soft));
        zoneDown.setColor(ContextCompat.getColor(context, R.color.down_soft));
    }

    private float dp(float v) {
        return v * density;
    }

    public void setData(double[] rsi) {
        this.rsi = rsi == null ? new double[0] : rsi;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(heightMeasureSpec)
                : (int) dp(76);
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float padLeft = dp(6);
        float padRight = dp(36);
        float padTop = dp(4);
        float padBottom = dp(4);
        float w = getWidth() - padLeft - padRight;
        float h = getHeight() - padTop - padBottom;
        if (w <= 0 || h <= 0) return;

        float y70 = padTop + h * 0.3f;
        float y30 = padTop + h * 0.7f;
        float y50 = padTop + h * 0.5f;
        canvas.drawRect(padLeft, padTop, padLeft + w, y70, zoneUp);
        canvas.drawRect(padLeft, y30, padLeft + w, padTop + h, zoneDown);
        canvas.drawLine(padLeft, y70, padLeft + w, y70, band);
        canvas.drawLine(padLeft, y30, padLeft + w, y30, band);
        canvas.drawLine(padLeft, y50, padLeft + w, y50, mid);
        canvas.drawText("70", padLeft + w + dp(4), y70 + dp(3.5f), text);
        canvas.drawText("30", padLeft + w + dp(4), y30 + dp(3.5f), text);

        int n = rsi.length;
        if (n < 2) return;
        int count = Math.min(70, n);
        int start = n - count;
        float step = w / count;

        path.reset();
        boolean started = false;
        for (int i = start; i < n; i++) {
            double v = rsi[i];
            if (Double.isNaN(v)) {
                started = false;
                continue;
            }
            float x = padLeft + (i - start + 0.5f) * step;
            float y = (float) (padTop + (100 - v) / 100.0 * h);
            if (!started) {
                path.moveTo(x, y);
                started = true;
            } else {
                path.lineTo(x, y);
            }
        }
        if (started) canvas.drawPath(path, line);

        double lastV = rsi[n - 1];
        if (!Double.isNaN(lastV)) {
            canvas.drawText(Fmt.num(lastV, 0), padLeft + w + dp(4), padTop + h * 0.5f + dp(14), text);
        }
    }
}
