/**
 * DashboardScreen — portfolio, P&L, bot quick actions, AI confidence,
 * market sentiment and the live top-10 ticker tape.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CandleChart, GaugeBar, SentimentMeter, Sparkline } from '../components/charts';
import { Btn, Card, KV, ModalBox, Pill, SectionTitle, Stat, StatusDot } from '../components/ui';
import { engine } from '../engine/engine';
import { useAppState } from '../state/AppState';
import { C, F, SIGNAL_COLORS } from '../theme';
import { timeAgo } from '../util/format';
import { fmtPct, fmtPrice, fmtUsd } from '../util/format';

function PnlChip({ label, value }: { label: string; value: number | null }) {
  const color = value === null ? C.textFaint : value >= 0 ? C.green : C.red;
  return (
    <View style={styles.pnlChip}>
      <Text style={styles.pnlLabel}>{label}</Text>
      <Text style={[styles.pnlValue, { color }]}>{value === null ? '—' : fmtPct(value)}</Text>
    </View>
  );
}

export default function DashboardScreen({ goBot }: { goBot: () => void }) {
  const app = useAppState();
  const { bot, balances, pnl, tickers, sentiment, connection } = app;
  const [emergencyModal, setEmergencyModal] = useState(false);

  const sig = bot.lastSignal;
  const activeTrades = bot.positions.length;
  const confidence = sig ? sig.confidence : 0;
  const open = bot.positions[0];
  const openPnl = open && sig ? (sig.snapshot.price - open.entryPrice) * open.qty : null;

  const sentimentColor =
    sentiment === 'Bullish' ? C.green : sentiment === 'Bearish' ? C.red : C.amber;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Dashboard</Text>
          <View style={styles.connRow}>
            <StatusDot ok={connection === 'checking' ? null : connection === 'ok'} checking={connection === 'checking'} size={8} />
            <Text style={styles.connText} numberOfLines={1}>
              {connection === 'checking' ? 'Checking connection…' : app.connectionDetail || 'Not connected'}
            </Text>
          </View>
        </View>
        <Pill
          text={app.mode === 'live' ? 'LIVE' : 'TESTNET'}
          color={app.mode === 'live' ? C.red : C.green}
        />
      </View>

      {/* Portfolio */}
      <SectionTitle>Portfolio</SectionTitle>
      <Card>
        <Text style={styles.totalLabel}>Total balance</Text>
        <Text style={styles.totalValue}>
          {balances ? fmtUsd(balances.totalUsd) : '—'}
        </Text>
        <Text style={styles.totalSub}>
          {balances ? `updated ${timeAgo(balances.ts)}` : 'waiting for account data…'}
        </Text>

        <View style={styles.assetRow}>
          <Stat label="USDT" value={balances ? balances.USDT.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'} color={C.text} valueStyle={styles.assetVal} />
          <Stat label="BTC" value={balances ? balances.BTC.toFixed(6) : '—'} color={C.gold} valueStyle={styles.assetVal} />
          <Stat label="ETH" value={balances ? balances.ETH.toFixed(5) : '—'} color={C.purple} valueStyle={styles.assetVal} />
        </View>

        <View style={styles.pnlRow}>
          <PnlChip label="Day" value={pnl.daily} />
          <PnlChip label="Week" value={pnl.weekly} />
          <PnlChip label="Month" value={pnl.monthly} />
          <PnlChip label="All-time" value={pnl.allTime} />
        </View>
      </Card>

      {/* Bot status + quick actions */}
      <SectionTitle
        right={
          <Pill
            text={bot.running ? 'RUNNING' : 'STOPPED'}
            color={bot.running ? C.green : C.textFaint}
          />
        }
      >
        AI Trading Bot
      </SectionTitle>
      <Card>
        <View style={styles.botGrid}>
          <View style={{ flex: 1.15 }}>
            <Text style={styles.statLabel}>AI confidence</Text>
            <Text style={[styles.confidence, { color: sig ? SIGNAL_COLORS[sig.signal] : C.textFaint }]}>
              {sig ? `${confidence}%` : '—'}
            </Text>
            <GaugeBar value={confidence} color={sig ? SIGNAL_COLORS[sig.signal] : C.textFaint} />
            <Text style={styles.confSub}>
              {sig
                ? `${sig.signal.replace('_', ' ')} · score ${sig.score} · ${sig.symbol} ${sig.timeframe}`
                : 'Start the bot to generate signals'}
            </Text>
          </View>
          <View style={styles.botRight}>
            <View>
              <Text style={styles.statLabel}>Market sentiment</Text>
              <Text style={{ color: sentimentColor, fontSize: F.h3, fontWeight: '800', marginVertical: 4 }}>
                {sentiment}
              </Text>
              <SentimentMeter sentiment={sentiment} />
            </View>
            <View style={{ marginTop: 12 }}>
              <Text style={styles.statLabel}>Active trades</Text>
              <Text style={{ color: C.text, fontSize: F.h2, fontWeight: '800' }}>{activeTrades}</Text>
            </View>
          </View>
        </View>

        {open && (
          <View style={styles.openTrade}>
            <Text style={styles.openTradeText} numberOfLines={1}>
              LONG {open.qty} {open.symbol.replace('USDT', '')} @ {fmtPrice(open.entryPrice)}
            </Text>
            <Text style={[styles.openTradeText, { color: (openPnl ?? 0) >= 0 ? C.green : C.red }]}>
              {openPnl === null ? '' : `${openPnl >= 0 ? '+' : ''}${fmtUsd(openPnl).replace('$', '$')}`}
            </Text>
          </View>
        )}

        <View style={styles.actionsRow}>
          <Btn
            label="▶ Start Bot"
            variant="success"
            onPress={() => {
              void engine.start();
            }}
            disabled={bot.running}
            style={{ flex: 1 }}
          />
          <Btn
            label="■ Stop Bot"
            variant="amber"
            onPress={() => void engine.stop()}
            disabled={!bot.running}
            style={{ flex: 1 }}
          />
          <Btn
            label="⛔ Emergency"
            variant="danger"
            onPress={() => setEmergencyModal(true)}
            style={{ flex: 1 }}
          />
        </View>
        {bot.lastError && <Text style={styles.botError}>⚠ {bot.lastError}</Text>}
      </Card>

      {/* Tickers */}
      <SectionTitle right={<Text style={styles.liveTag}>● live</Text>}>Top 10 markets</SectionTitle>
      <Card style={{ paddingBottom: 6 }}>
        {tickers.length === 0 && <Text style={styles.emptyTickers}>Loading live prices…</Text>}
        {tickers.map((t) => {
          const up = t.changePct >= 0;
          const color = up ? C.green : C.red;
          return (
            <View key={t.symbol} style={styles.tickerRow}>
              <View style={{ width: 58 }}>
                <Text style={styles.tickerBase}>{t.base}</Text>
                <Text style={styles.tickerQuote}>/USDT</Text>
              </View>
              <Sparkline data={t.spark} color={color} width={70} height={26} />
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.tickerPrice}>{fmtPrice(t.price)}</Text>
                <Text style={[styles.tickerPct, { color }]}>{fmtPct(t.changePct)}</Text>
              </View>
            </View>
          );
        })}
        <View style={{ marginTop: 8 }}>
          <Btn label="Open Bot Console →" variant="ghost" small onPress={goBot} />
        </View>
      </Card>

      {sig && (
        <Card>
          <KV k="Last signal" v={`${sig.signal.replace('_', ' ')} (${sig.score})`} vColor={SIGNAL_COLORS[sig.signal]} />
          <KV k="Symbol / timeframe" v={`${sig.symbol} · ${sig.timeframe}`} />
          <KV k="RSI · Stoch" v={`${sig.snapshot.rsi.toFixed(1)} · ${sig.snapshot.stochK.toFixed(0)}`} />
          <KV k="ATR volatility" v={`${sig.snapshot.atrPct.toFixed(2)}%`} />
          <KV k="Volume vs 20-avg" v={`${sig.snapshot.volumeRatio.toFixed(2)}×`} />
          <KV k="Analysed" v={timeAgo(sig.ts)} />
        </Card>
      )}

      <Text style={styles.riskNote}>
        Automated trading involves substantial risk of loss. Paper mode is active unless
        live order placement is armed in the Bot tab.
      </Text>

      {/* Emergency stop modal */}
      <ModalBox visible={emergencyModal} title="EMERGENCY STOP" onClose={() => setEmergencyModal(false)}>
        <Text style={styles.emText}>
          Immediately halts the engine. Choose whether open positions should also be
          closed at market.
        </Text>
        <View style={{ gap: 10, marginTop: 16 }}>
          <Btn
            label="Stop bot only (keep positions)"
            variant="amber"
            onPress={() => {
              setEmergencyModal(false);
              void engine.emergencyStop(false);
            }}
          />
          <Btn
            label="Stop bot & close all positions"
            variant="danger"
            onPress={() => {
              setEmergencyModal(false);
              void engine.emergencyStop(true);
            }}
          />
          <Btn label="Cancel" variant="ghost" onPress={() => setEmergencyModal(false)} />
        </View>
      </ModalBox>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 44 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  h1: { color: C.text, fontSize: F.h1, fontWeight: '800' },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, maxWidth: 250 },
  connText: { color: C.textDim, fontSize: F.small },
  totalLabel: { color: C.textDim, fontSize: F.small },
  totalValue: { color: C.text, fontSize: F.hero, fontWeight: '800', marginTop: 2 },
  totalSub: { color: C.textFaint, fontSize: F.tiny, marginBottom: 12 },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  assetVal: { fontSize: F.body },
  pnlRow: { flexDirection: 'row', gap: 8 },
  pnlChip: { flex: 1, backgroundColor: C.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  pnlLabel: { color: C.textFaint, fontSize: F.tiny, marginBottom: 2 },
  pnlValue: { color: C.text, fontSize: F.small, fontWeight: '800' },
  botGrid: { flexDirection: 'row', gap: 16 },
  botRight: { flex: 1 },
  statLabel: { color: C.textDim, fontSize: F.small, marginBottom: 4 },
  confidence: { fontSize: F.h1, fontWeight: '800', marginBottom: 6 },
  confSub: { color: C.textFaint, fontSize: F.tiny, marginTop: 8, lineHeight: 15 },
  openTrade: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    marginVertical: 12,
  },
  openTradeText: { color: C.text, fontSize: F.small, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  botError: { color: C.red, fontSize: F.small, marginTop: 10 },
  liveTag: { color: C.green, fontSize: F.tiny, fontWeight: '700' },
  emptyTickers: { color: C.textFaint, paddingVertical: 10 },
  tickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    gap: 10,
  },
  tickerBase: { color: C.text, fontWeight: '800', fontSize: F.body },
  tickerQuote: { color: C.textFaint, fontSize: F.tiny },
  tickerPrice: { color: C.text, fontWeight: '700', fontSize: F.body },
  tickerPct: { fontSize: F.small, fontWeight: '700' },
  riskNote: { color: C.textFaint, fontSize: F.tiny, textAlign: 'center', lineHeight: 16, marginTop: 6 },
  emText: { color: C.textDim, fontSize: F.body, lineHeight: 21 },
});
