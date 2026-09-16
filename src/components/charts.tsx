/**
 * charts.tsx — dependency-free chart rendering.
 *
 * Sparklines, candlestick charts and score gauges are drawn with plain
 * React Native Views so the app has zero native chart dependencies.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';
import type { Candle } from '../types';
import { fmtPrice } from '../util/format';

/** Tiny bar-style sparkline fed from recent poll history. */
export function Sparkline({
  data,
  color,
  width = 84,
  height = 30,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const barW = Math.max(1, Math.floor(width / data.length) - 1);
  return (
    <View style={{ width, height, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
      {data.map((v, i) => {
        const h = Math.max(2, ((v - min) / range) * height);
        const faded = i < data.length - 4 ? 0.45 : 1;
        return (
          <View
            key={i}
            style={{
              width: barW,
              height: h,
              backgroundColor: color,
              opacity: faded,
              borderRadius: 1,
            }}
          />
        );
      })}
    </View>
  );
}

/** Candlestick chart with grid lines and price range labels. */
export function CandleChart({
  candles,
  height = 210,
  count = 48,
}: {
  candles: Candle[];
  height?: number;
  count?: number;
}) {
  const view = useMemo(() => candles.slice(-count), [candles, count]);

  if (view.length < 2) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: C.textFaint }}>Waiting for market data…</Text>
      </View>
    );
  }

  let min = Infinity;
  let max = -Infinity;
  for (const c of view) {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  }
  const pad = (max - min) * 0.06 || 1;
  min -= pad;
  max += pad;
  const range = max - min;
  const y = (price: number) => ((max - price) / range) * height;

  return (
    <View>
      <View style={{ height, flexDirection: 'row' }}>
        {view.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? C.green : C.red;
          const slotFlex = 1;
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyHeight = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
          const wickTop = y(c.high);
          const wickHeight = Math.max(1, y(c.low) - y(c.high));
          return (
            <View key={c.openTime || i} style={{ flex: slotFlex }}>
              <View
                style={{
                  position: 'absolute',
                  left: '47%',
                  width: 1.5,
                  top: wickTop,
                  height: wickHeight,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  left: '15%',
                  right: '15%',
                  top: bodyTop,
                  height: bodyHeight,
                  backgroundColor: color,
                  borderRadius: 1,
                }}
              />
            </View>
          );
        })}
        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <View
            key={g}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: height * g,
              height: StyleSheet.hairlineWidth,
              backgroundColor: C.border,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={styles.axisLabel}>▲ {fmtPrice(max)}</Text>
        <Text style={styles.axisLabel}>{fmtPrice((max + min) / 2)}</Text>
        <Text style={styles.axisLabel}>▼ {fmtPrice(min)}</Text>
      </View>
    </View>
  );
}

/** Horizontal score bar, e.g. AI confidence 0-100. */
export function GaugeBar({
  value,
  max = 100,
  color,
  height = 10,
}: {
  value: number;
  max?: number;
  color: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <View style={{ backgroundColor: C.cardAlt, borderRadius: height / 2, height, overflow: 'hidden' }}>
      <View
        style={{
          width: `${pct * 100}%`,
          backgroundColor: color,
          height,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

/** Two-sided score bar used for signal breakdown items (-max … +max). */
export function ScoreBar({
  score,
  max,
  height = 8,
}: {
  score: number;
  max: number;
  height?: number;
}) {
  const pct = Math.min(1, Math.abs(score) / max) * 50; // half of the track
  const positive = score >= 0;
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: C.cardAlt }}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        {!positive && (
          <View style={{ width: `${pct * 2}%`, backgroundColor: C.red, height }} />
        )}
      </View>
      <View style={{ width: 1.5, backgroundColor: C.textFaint }} />
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-start' }}>
        {positive && score !== 0 && (
          <View style={{ width: `${pct * 2}%`, backgroundColor: C.green, height }} />
        )}
      </View>
    </View>
  );
}

/** Sentiment meter: bearish ← neutral → bullish. */
export function SentimentMeter({ sentiment }: { sentiment: 'Bullish' | 'Bearish' | 'Neutral' }) {
  const idx = sentiment === 'Bearish' ? 0 : sentiment === 'Neutral' ? 1 : 2;
  const colors = [C.red, C.amber, C.green];
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {['Bearish', 'Neutral', 'Bullish'].map((label, i) => (
        <View
          key={label}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === idx ? colors[i] : C.cardAlt,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  axisLabel: { color: C.textFaint, fontSize: F.tiny },
});
