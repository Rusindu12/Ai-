'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import api from '../lib/api';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function PriceChart({ symbol, interval, onChangeInterval, theme, klineEvent }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const lastCandleRef = useRef(null);

  // create / resize chart
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme === 'dark' ? '#9ca3af' : '#6b7280',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
        horzLines: { color: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });

    const candle = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const onResize = () => chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);
    onResize();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  // fetch historical candles
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return;
    let cancelled = false;
    api
      .klines(symbol, interval, 300)
      .then((data) => {
        if (cancelled) return;
        const candles = data.klines.map((k) => ({
          time: Math.floor(k.openTime / 1000),
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));
        const volumes = data.klines.map((k) => ({
          time: Math.floor(k.openTime / 1000),
          value: k.volume,
          color: k.close >= k.open ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)',
        }));
        candleRef.current.setData(candles);
        volumeRef.current.setData(volumes);
        lastCandleRef.current = candles[candles.length - 1];
        chartRef.current?.timeScale().scrollToRealTime();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  // live-update the last candle from the websocket
  useEffect(() => {
    if (!klineEvent || !candleRef.current || !volumeRef.current) return;
    if (klineEvent.symbol !== symbol || klineEvent.interval !== interval) return;
    const time = Math.floor(klineEvent.startTime / 1000);
    const candle = {
      time,
      open: klineEvent.open,
      high: klineEvent.high,
      low: klineEvent.low,
      close: klineEvent.close,
    };
    const last = lastCandleRef.current;
    if (last && last.time === time) {
      candleRef.current.update(candle);
    } else {
      candleRef.current.update(candle);
    }
    lastCandleRef.current = candle;
  }, [klineEvent, symbol, interval]);

  return (
    <div className="card flex flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-lg font-semibold">{symbol}</span>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">Binance</span>
        </div>
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => onChangeInterval(iv)}
              className={
                'rounded px-2 py-1 text-xs font-medium ' +
                (interval === iv
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800')
              }
            >
              {iv}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="h-[380px] w-full" />
    </div>
  );
}
