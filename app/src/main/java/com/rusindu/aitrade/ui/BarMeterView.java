package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.rusindu.aitrade.R;

/** Centre-out bar for a feature value in [-1, +1]: right is bullish, left is bearish. */
public class BarMeterView extends View {

    private final Paint trackPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint centrePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();

    private double value;
    private final float density;

    public BarMeterView(Context context) {
        this(context, null);
    }

    public BarMeterView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        trackPaint.setColor(ContextCompat.getColor(context, R.color.surface_alt));
        centrePaint.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
    }

    public void setValue(double v) {
        this.value = Math.max(-1, Math.min(1, Double.isNaN(v) ? 0 : v));
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(heightMeasureSpec)
                : (int) dp(8);
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float h = getHeight();
        float rad = h / 2f;
        r.set(0, 0, w, h);
        canvas.drawRoundRect(r, rad, rad, trackPaint);

        float cx = w / 2f;
        float half = (w / 2f) * (float) Math.abs(value);
        if (half > dp(1.5f)) {
            fillPaint.setColor(ContextCompat.getColor(getContext(),
                    value >= 0 ? R.color.up : R.color.down));
            float left = value >= 0 ? cx : cx - half;
            r.set(left, 0, left + half, h);
            canvas.drawRoundRect(r, rad, rad, fillPaint);
        }
        canvas.drawRect(cx - dp(0.75f), 0, cx + dp(0.75f), h, centrePaint);
    }

    private float dp(float v) {
        return v * density;
    }
}
