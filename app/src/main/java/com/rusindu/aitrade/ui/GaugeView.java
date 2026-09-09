package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.util.Fmt;

/**
 * Half-dial that shows the model score from -1 (far left, bearish) to +1 (far right, bullish)
 * with a needle, plus the confidence as a filled arc.
 */
public class GaugeView extends View {

    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint zoneDown = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint zoneUp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint needle = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hub = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint confArc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint big = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint small = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tick = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final RectF confRect = new RectF();

    private double score;
    private double confidence;
    private double threshold = 0.22;
    private String label = "";
    private String sub = "";

    private final float density;

    public GaugeView(Context context) {
        this(context, null);
    }

    public GaugeView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        float stroke = dp(10);

        track.setStyle(Paint.Style.STROKE);
        track.setStrokeWidth(stroke);
        track.setStrokeCap(Paint.Cap.ROUND);
        track.setColor(color(R.color.surface_alt));

        zoneDown.setStyle(Paint.Style.STROKE);
        zoneDown.setStrokeWidth(stroke);
        zoneDown.setStrokeCap(Paint.Cap.BUTT);
        zoneDown.setColor(alpha(color(R.color.down), 110));

        zoneUp.setStyle(Paint.Style.STROKE);
        zoneUp.setStrokeWidth(stroke);
        zoneUp.setStrokeCap(Paint.Cap.BUTT);
        zoneUp.setColor(alpha(color(R.color.up), 110));

        confArc.setStyle(Paint.Style.STROKE);
        confArc.setStrokeWidth(dp(4));
        confArc.setStrokeCap(Paint.Cap.ROUND);
        confArc.setColor(color(R.color.accent));

        needle.setStyle(Paint.Style.STROKE);
        needle.setStrokeWidth(dp(3));
        needle.setStrokeCap(Paint.Cap.ROUND);
        needle.setColor(color(R.color.text_primary));

        hub.setStyle(Paint.Style.FILL);
        hub.setColor(color(R.color.text_primary));

        tick.setColor(color(R.color.text_tertiary));
        tick.setStrokeWidth(dp(1));

        big.setTextSize(dp(26));
        big.setTextAlign(Paint.Align.CENTER);
        big.setFakeBoldText(true);
        big.setColor(color(R.color.text_primary));

        small.setTextSize(dp(11));
        small.setTextAlign(Paint.Align.CENTER);
        small.setColor(color(R.color.text_secondary));
    }

    private int color(int res) {
        return ContextCompat.getColor(getContext(), res);
    }

    private static int alpha(int c, int a) {
        return (c & 0x00FFFFFF) | (a << 24);
    }

    private float dp(float v) {
        return v * density;
    }

    public void setThreshold(double t) {
        this.threshold = Math.max(0.01, Math.min(0.9, t));
        invalidate();
    }

    public void set(double score, double confidence, String label, String sub) {
        this.score = Math.max(-1, Math.min(1, score));
        this.confidence = Math.max(0, Math.min(1, confidence));
        this.label = label == null ? "" : label;
        this.sub = sub == null ? "" : sub;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(heightMeasureSpec)
                : (int) (w * 0.52f);
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float h = getHeight();
        float pad = dp(14);
        float cx = w / 2f;
        float radius = Math.min(w / 2f - pad, h - pad * 1.6f);
        if (radius <= dp(20)) return;
        float cy = h - pad * 0.6f - dp(14);

        rect.set(cx - radius, cy - radius, cx + radius, cy + radius);
        // 180 degrees == score -1 (left), 0 degrees == score +1 (right)
        canvas.drawArc(rect, 180f, 180f, false, track);

        double t = Math.max(0.01, threshold);
        float zoneDeg = (float) ((1 - t) / 2.0 * 180.0);
        canvas.drawArc(rect, 180f, (float) ((1 - t) / 2.0 * 180.0), false, zoneDown);
        canvas.drawArc(rect, 180f + 180f - zoneDeg, zoneDeg, false, zoneUp);

        // confidence arc, drawn just inside the dial
        float cr = radius - dp(13);
        confRect.set(cx - cr, cy - cr, cx + cr, cy + cr);
        float sweep = (float) (confidence * 180.0);
        canvas.drawArc(confRect, 270f - sweep / 2f, sweep, false, confArc);

        // ticks at -1, -0.5, 0, 0.5, 1
        for (int i = -2; i <= 2; i++) {
            double angle = Math.toRadians(180 - (i + 2) / 4.0 * 180);
            float inner = radius - dp(22);
            float x1 = cx + (float) Math.cos(angle) * inner;
            float y1 = cy - (float) Math.sin(angle) * inner;
            float x2 = cx + (float) Math.cos(angle) * (inner - dp(6));
            float y2 = cy - (float) Math.sin(angle) * (inner - dp(6));
            canvas.drawLine(x1, y1, x2, y2, tick);
        }

        // needle
        double a = Math.toRadians(180 - (score + 1) / 2.0 * 180);
        float len = radius - dp(26);
        float nx = cx + (float) Math.cos(a) * len;
        float ny = cy - (float) Math.sin(a) * len;
        canvas.drawLine(cx, cy, nx, ny, needle);
        canvas.drawCircle(cx, cy, dp(5), hub);

        canvas.drawText(Fmt.num(score, 2), cx, cy - dp(28), big);
        canvas.drawText(label, cx, cy - dp(12), small);
        canvas.drawText(sub, cx, h - dp(2), small);
    }
}
