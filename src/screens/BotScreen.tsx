/**
 * BotScreen — live engine console: candlestick chart, indicator grid,
 * signal score breakdown, risk configuration and the activity log.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CandleChart, ScoreBar } from '../components/charts';
import { Btn, Card, KV, ModalBox, Pill, SectionTitle, StatusDot, Toggle } from '../components/ui';
import { getKlines } from '../api/binance';
import { engine } from '../engine/engine';
import { useAppState } from '../state/AppState';
import { C, F, SIGNAL_COLORS } from '../theme';
import { TIMEFRAMES, TOP_SYMBOLS } from '../types';
import type { Candle } from '../types';
import { fmtPrice, fmtQty, fmtUsd, timeAgo } from '../util/format';

const SYMBOL_CHOICES = TOP_SYMBOLS.slice(0, 6);

function Stepper({
  label,
  value,
  onChange,
  step,
  min,
  max,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  format?: (v: number) => string;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperCtrls}>
        <Btn label="−" small variant="ghost" onPress={() => onChange(Math.max(min, +(value - step).toFixed(2)))} style={{ width: 38 }} />
        <Text style={styles.stepperVal}>{format ? format(value) : value}</Text>
        <Btn label="+" small variant="ghost" onPress={() => onChange(Math.min(max, +(value + step).toFixed(2)))} style={{ width: 38 }} />
      </View>
    </View>
  );
}

function IndTile({ name, value, tone }: { name: string; value: string; tone?: string }) {
  return (
    <View style={styles.indTile}>
      <Text style={styles.indName}>{name}</Text>
      <Text style={[styles.indValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function BotScreen() {
  const app = useAppState();
  const { bot } = app;
  const cfg = bot.config;
  const [candles, setCandles] = useState<Candle[]>([]);
  const [liveArmModal, setLiveArmModal] = useState(false);
  const chartTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadChart = useCallback(async () => {
    try {
      const k = await getKlines(app.mode, cfg.symbol, cfg.timeframe, 120);
      setCandles(k);
    } catch {
      /* retry on next interval */
    }
  }, [app.mode, cfg.symbol, cfg.timeframe]);

  useEffect(() => {
    void loadChart();
    if (chartTimer.current) clearInterval(chartTimer.current);
    chartTimer.current = setInterval(() => void loadChart(), 20_000);
    return () => {
      if (chartTimer.current) clearInterval(chartTimer.current);
    };
  }, [loadChart]);

  const sig = bot.lastSignal;
  const snap = sig?.snapshot ?? null;
  const open = bot.positions[0];
  const liveMarketable = bot.hasCredentials;

  const onLiveToggle = (v: boolean) => {
    if (v) {
      setLiveArmModal(true);
    } else {
      engine.updateConfig({ liveOrdersEnabled: false });
      engine.setLiveConfirmed(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.h1}>Bot Console</Text>
        <View style={styles.headerRight}>
          <StatusDot ok={bot.running ? true : null} size={9} />
          <Text style={styles.headerStatus}>
            {bot.running ? (bot.busy ? 'analysing…' : 'running') : 'stopped'}
          </Text>
        </View>
      </View>

      {/* Symbol & timeframe selectors */}
      <SectionTitle>Market</SectionTitle>
      <Card>
        <View style={styles.chipRow}>
          {SYMBOL_CHOICES.map((s) => (
            <Btn
              key={s}
              small
              variant={cfg.symbol === s ? 'primary' : 'ghost'}
              label={s.replace('USDT', '')}
              onPress={() => engine.updateConfig({ symbol: s })}
            />
          ))}
        </View>
        <View style={[styles.chipRow, { marginTop: 8 }]}>
          {TIMEFRAMES.map((tf) => (
            <Btn
              key={tf}
              small
              variant={cfg.timeframe === tf ? 'success' : 'ghost'}
              label={tf}
              onPress={() => engine.updateConfig({ timeframe: tf })}
            />
          ))}
        </View>
        <View style={{ marginTop: 12 }}>
          <CandleChart candles={candles} height={200} count={54} />
        </View>
        <Text style={styles.chartNote}>
          {cfg.symbol} · {cfg.timeframe} · {candles.length} candles loaded
        </Text>
      </Card>

      {/* Live signal */}
      <SectionTitle right={sig ? <Text style={styles.agoText}>{timeAgo(sig.ts)}</Text> : null}>
        AI Signal
      </SectionTitle>
      <Card>
        {!sig && <Text style={styles.placeholder}>No signal yet — start the bot to run the AI engine.</Text>}
        {sig && (
          <>
            <View style={styles.signalHead}>
              <Pill text={sig.signal.replace('_', ' ')} color={SIGNAL_COLORS[sig.signal]} />
              <Text style={styles.scoreText}>score {sig.score}</Text>
              <Text style={styles.scoreText}>confidence {sig.confidence}%</Text>
            </View>
            <View style={{ marginTop: 12, gap: 10 }}>
              {sig.breakdown.map((b) => (
                <View key={b.name}>
                  <View style={styles.bdRow}>
                    <Text style={styles.bdName}>{b.name}</Text>
                    <Text style={[styles.bdScore, { color: b.score > 0 ? C.green : b.score < 0 ? C.red : C.textFaint }]}>
                      {b.score > 0 ? `+${b.score}` : b.score}
                    </Text>
                  </View>
                  <ScoreBar score={b.score} max={20} height={6} />
                  <Text style={styles.bdDetail} numberOfLines={1}>{b.detail}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      {/* Indicators */}
      {snap && (
        <>
          <SectionTitle>Indicators (real-time)</SectionTitle>
          <Card>
            <View style={styles.indGrid}>
              <IndTile name="RSI (14)" value={snap.rsi.toFixed(1)} tone={snap.rsi < 30 ? C.green : snap.rsi > 70 ? C.red : undefined} />
              <IndTile name="MACD hist" value={snap.macdHist.toFixed(3)} tone={snap.macdHist >= 0 ? C.green : C.red} />
              <IndTile name="Stoch K/D" value={`${snap.stochK.toFixed(0)}/${snap.stochD.toFixed(0)}`} />
              <IndTile name="ATR (14)" value={`${snap.atrPct.toFixed(2)}%`} />
              <IndTile name="EMA 9/21" value={`${fmtPrice(snap.ema9)}/${fmtPrice(snap.ema21)}`} />
              <IndTile name="EMA 50/200" value={`${fmtPrice(snap.ema50)}/${fmtPrice(snap.ema200)}`} />
              <IndTile name="BB %B" value={`${(snap.bbPercentB * 100).toFixed(0)}%`} />
              <IndTile name="VWAP" value={fmtPrice(snap.vwap)} tone={snap.price >= snap.vwap ? C.green : C.red} />
              <IndTile
                name="Ichimoku"
                value={snap.ichimoku.priceAboveCloud ? 'above ☁' : snap.ichimoku.priceInCloud ? 'in ☁' : 'below ☁'}
                tone={snap.ichimoku.priceAboveCloud ? C.green : snap.ichimoku.priceInCloud ? C.amber : C.red}
              />
              <IndTile name="Fib 61.8%" value={fmtPrice(snap.fibonacci.find((f) => f.ratio === 0.618)?.price ?? NaN)} />
              <IndTile name="Vol profile POC" value={fmtPrice(snap.volumeProfile.poc)} />
              <IndTile name="Volume" value={`${snap.volumeRatio.toFixed(2)}× avg`} tone={snap.volumeRatio > 1.5 ? C.amber : undefined} />
            </View>
          </Card>
        </>
      )}

      {/* Open position */}
      {open && (
        <>
          <SectionTitle right={<Pill text={open.paper ? 'PAPER' : 'LIVE'} color={open.paper ? C.blue : C.red} />}>
            Open Position
          </SectionTitle>
          <Card>
            <KV k="Entry" v={`${fmtQty(open.qty)} @ ${fmtPrice(open.entryPrice)}`} />
            <KV k="Value" v={fmtUsd(open.costUsd)} />
            <KV k="Stop-loss" v={fmtPrice(open.stopLoss)} vColor={C.red} />
            <KV k="Take-profit" v={fmtPrice(open.takeProfit)} vColor={C.green} />
            {snap && (
              <KV
                k="Unrealised P&L"
                v={`${(snap.price - open.entryPrice) * open.qty >= 0 ? '+' : ''}${fmtUsd((snap.price - open.entryPrice) * open.qty)} (${(((snap.price - open.entryPrice) / open.entryPrice) * 100).toFixed(2)}%)`}
                vColor={(snap.price - open.entryPrice) >= 0 ? C.green : C.red}
              />
            )}
            <Btn
              label="Close position at market"
              variant="danger"
              small
              style={{ marginTop: 12, alignSelf: 'stretch' }}
              onPress={() => void engine.closePosition(open.id, 'MANUAL')}
            />
          </Card>
        </>
      )}

      {/* Risk & execution config */}
      <SectionTitle>Risk & Execution</SectionTitle>
      <Card>
        <Stepper
          label="Position size (% of funds)"
          value={cfg.riskPct}
          step={1}
          min={1}
          max={25}
          onChange={(v) => engine.updateConfig({ riskPct: v })}
          format={(v) => `${v}%`}
        />
        <Stepper
          label="Stop-loss (ATR multiple)"
          value={cfg.slAtr}
          step={0.5}
          min={0.5}
          max={5}
          onChange={(v) => engine.updateConfig({ slAtr: v })}
          format={(v) => `${v}×`}
        />
        <Stepper
          label="Take-profit (ATR multiple)"
          value={cfg.tpAtr}
          step={0.5}
          min={0.5}
          max={8}
          onChange={(v) => engine.updateConfig({ tpAtr: v })}
          format={(v) => `${v}×`}
        />
        <Stepper
          label="Analysis interval"
          value={cfg.pollIntervalSec}
          step={10}
          min={10}
          max={300}
          onChange={(v) => engine.updateConfig({ pollIntervalSec: v })}
          format={(v) => `${v}s`}
        />

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.toggleLabel}>
              Live order placement {!liveMarketable && '(needs saved API keys)'}
            </Text>
            <Text style={styles.hint}>
              {cfg.liveOrdersEnabled && bot.liveConfirmed
                ? `ARMED — the bot places REAL ${app.mode === 'live' ? 'money orders on LIVE markets' : 'orders with testnet funds'}`
                : 'OFF — signals are simulated with the virtual $' + cfg.startVirtualUsd.toLocaleString() + ' paper bankroll'}
            </Text>
          </View>
          <Toggle value={cfg.liveOrdersEnabled && bot.liveConfirmed} disabled={!liveMarketable} onChange={onLiveToggle} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          {!bot.running ? (
            <Btn label="▶ Start Bot" variant="success" style={{ flex: 1 }} onPress={() => void engine.start()} />
          ) : (
            <Btn label="■ Stop Bot" variant="amber" style={{ flex: 1 }} onPress={() => void engine.stop()} />
          )}
          <Btn
            label="⛔ Emergency Stop"
            variant="danger"
            style={{ flex: 1 }}
            onPress={() => void engine.emergencyStop(true)}
            disabled={bot.positions.length === 0 && !bot.running}
          />
        </View>
      </Card>

      {/* Activity log */}
      <SectionTitle>Activity Log</SectionTitle>
      <Card>
        {bot.logs.length === 0 && <Text style={styles.placeholder}>No activity yet.</Text>}
        {bot.logs.slice(0, 40).map((l, i) => (
          <View key={`${l.ts}-${i}`} style={styles.logRow}>
            <Text
              style={[
                styles.logMsg,
                l.level === 'error' && { color: C.red },
                l.level === 'warn' && { color: C.amber },
                l.level === 'trade' && { color: C.blue },
              ]}
            >
              <Text style={styles.logTs}>{new Date(l.ts).toLocaleTimeString('en-US', { hour12: false })}  </Text>
              {l.message}
            </Text>
          </View>
        ))}
      </Card>

      {/* Live-arm confirmation */}
      <ModalBox visible={liveArmModal} title="Arm live order placement?" onClose={() => setLiveArmModal(false)}>
        <Text style={styles.modalText}>
          The engine will submit REAL market orders
          {app.mode === 'live'
            ? ' on LIVE Binance markets with REAL funds.'
            : ' on the Binance Testnet (simulated funds).'}
          {'\n\n'}Every entry uses {cfg.riskPct}% of available USDT with ATR stop-loss and
          take-profit. Emergency Stop is always available.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Btn label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setLiveArmModal(false)} />
          <Btn
            label="Arm live trading"
            variant={app.mode === 'live' ? 'danger' : 'success'}
            style={{ flex: 1 }}
            onPress={() => {
              setLiveArmModal(false);
              engine.updateConfig({ liveOrdersEnabled: true });
              engine.setLiveConfirmed(true);
            }}
          />
        </View>
      </ModalBox>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 44 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  h1: { color: C.text, fontSize: F.h1, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerStatus: { color: C.textDim, fontSize: F.small },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chartNote: { color: C.textFaint, fontSize: F.tiny, marginTop: 8 },
  placeholder: { color: C.textFaint, fontSize: F.body },
  signalHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreText: { color: C.textDim, fontSize: F.small, fontWeight: '600' },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  bdName: { color: C.text, fontSize: F.small, fontWeight: '700' },
  bdScore: { fontSize: F.small, fontWeight: '800' },
  bdDetail: { color: C.textFaint, fontSize: F.tiny, marginTop: 2 },
  indGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indTile: {
    width: '47.5%',
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
  },
  indName: { color: C.textFaint, fontSize: F.tiny, marginBottom: 3 },
  indValue: { color: C.text, fontSize: F.body, fontWeight: '700' },
  stepperRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  stepperLabel: { color: C.text, fontSize: F.body, flex: 1 },
  stepperCtrls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperVal: { color: C.blue, fontSize: F.body, fontWeight: '800', minWidth: 52, textAlign: 'center' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { color: C.text, fontSize: F.body, fontWeight: '600' },
  hint: { color: C.textFaint, fontSize: F.tiny, marginTop: 3, lineHeight: 16 },
  logRow: { paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  logMsg: { color: C.textDim, fontSize: F.small, lineHeight: 18 },
  logTs: { color: C.textFaint, fontSize: F.small },
  agoText: { color: C.textFaint, fontSize: F.tiny },
  modalText: { color: C.textDim, fontSize: F.body, lineHeight: 21 },
});
