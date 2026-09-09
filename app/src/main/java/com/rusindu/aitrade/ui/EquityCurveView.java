package com.rusindu.aitrade.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.rusindu.aitrade.R;
import com.rusindu.aitrade.util.Fmt;

import java.util.ArrayList;
import java.util.List;

/** Filled line chart used for the paper account equity curve and the backtest curve. */
public class EquityCurveView extends View {

    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint base = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path line = new Path();
    private final Path area = new Path();

    private final List<Double> values = new ArrayList<>();
    private final float density;
    private boolean drawn;

    public EquityCurveView(Context context) {
        this(context, null);
    }

    public EquityCurveView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(dp(2));
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        base.setStrokeWidth(dp(1));
        base.setPathEffect(new android.graphics.DashPathEffect(new float[]{dp(4), dp(4)}, 0));
        base.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
        label.setTextSize(dp(9));
        label.setColor(ContextCompat.getColor(context, R.color.text_tertiary));
    }

    private float dp(float v) {
        return v * density;
    }

    public void setData(List<Double> data) {
        values.clear();
        if (data != null) {
            for (Double d : data) values.add(d == null ? 0d : d);
        }
        drawn = false;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(heightMeasureSpec)
                : (int) dp(120);
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float padL = dp(6);
        float padR = dp(48);
        float padT = dp(10);
        float padB = dp(10);
        float w = getWidth() - padL - padR;
        float h = getHeight() - padT - padB;
        if (w <= 0 || h <= 0 || values.size() < 2) {
            canvas.drawText("· · ·", getWidth() / 2f, getHeight() / 2f, label);
            return;
        }

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        for (double v : values) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
        double startValue = values.get(0);
        min = Math.min(min, startValue);
        max = Math.max(max, startValue);
        if (max - min < 1e-9) {
            max = min + Math.max(Math.abs(min) * 0.01, 1);
        }
        double pad = (max - min) * 0.12;
        min -= pad;
        max += pad;
        double range = max - min;

        boolean profitable = values.get(values.size() - 1) >= startValue;
        int color = ContextCompat.getColor(getContext(), profitable ? R.color.up : R.color.down);
        stroke.setColor(color);

        if (!drawn) {
            fill.setShader(new LinearGradient(0, padT, 0, padT + h,
                    (color & 0x00FFFFFF) | (0x55 << 24),
                    (color & 0x00FFFFFF) | (0x00 << 24),
                    Shader.TileMode.CLAMP));
            drawn = true;
        }

        float step = w / (values.size() - 1);
        line.reset();
        area.reset();
        for (int i = 0; i < values.size(); i++) {
            float x = padL + i * step;
            float y = (float) (padT + (max - values.get(i)) / range * h);
            if (i == 0) {
                line.moveTo(x, y);
                area.moveTo(x, padT + h);
                area.lineTo(x, y);
            } else {
                line.lineTo(x, y);
                area.lineTo(x, y);
            }
        }
        area.lineTo(padL + (values.size() - 1) * step, padT + h);
        area.close();
        canvas.drawPath(area, fill);
        canvas.drawPath(line, stroke);

        float yBase = (float) (padT + (max - startValue) / range * h);
        canvas.drawLine(padL, yBase, padL + w, yBase, base);
        canvas.drawText(Fmt.money(max), padL + w + dp(4), padT + dp(8), label);
        canvas.drawText(Fmt.money(min), padL + w + dp(4), padT + h, label);
    }
}
