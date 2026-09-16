/**
 * TradesScreen — trade history, performance statistics and the virtual
 * (paper) bankroll used while live order placement is not armed.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn, Card, Pill, SectionTitle, Stat } from '../components/ui';
import { engine } from '../engine/engine';
import { useAppState } from '../state/AppState';
import { C, F } from '../theme';
import type { Position } from '../types';
import { fmtPct, fmtPrice, fmtQty, fmtUsd, fmtTime } from '../util/format';

function TradeRow({ t }: { t: Position }) {
  const win = (t.pnlUsd ?? 0) >= 0;
  return (
    <View style={styles.tradeRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.tradeHead}>
          <Text style={styles.tradeSym}>
            {t.symbol.replace('USDT', '')} <Text style={styles.tradeSide}>LONG</Text>
          </Text>
          <Pill text={t.paper ? 'PAPER' : 'LIVE'} color={t.paper ? C.blue : C.red} style={{ marginLeft: 8 }} />
        </View>
        <Text style={styles.tradeDetail}>
          {fmtQty(t.qty)} @ {fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice ?? NaN)} · {t.reason ?? ''}
        </Text>
        <Text style={styles.tradeTime}>{t.exitTime ? fmtTime(t.exitTime) : ''}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.tradePnl, { color: win ? C.green : C.red }]}>
          {win ? '+' : ''}{fmtUsd(t.pnlUsd ?? 0)}
        </Text>
        <Text style={[styles.tradePct, { color: win ? C.green : C.red }]}>
          {fmtPct(t.pnlPct ?? 0)}
        </Text>
      </View>
    </View>
  );
}

export default function TradesScreen() {
  const { bot } = useAppState();
  const stats = engine.stats();
  const bankrollDelta = bot.virtualEquity - bot.config.startVirtualUsd;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Trades</Text>

      <SectionTitle>Paper Portfolio</SectionTitle>
      <Card>
        <View style={styles.row}>
          <Stat label="Virtual bankroll" value={fmtUsd(bot.virtualEquity)} />
          <Stat
            label="Open exposure"
            value={fmtUsd(bot.positions.reduce((s, p) => s + p.costUsd, 0))}
            align="right"
          />
        </View>
        <View style={[styles.row, { marginTop: 12 }]}>
          <Stat
            label="Paper P&L"
            value={`${bankrollDelta >= 0 ? '+' : ''}${fmtUsd(bankrollDelta)}`}
            color={bankrollDelta >= 0 ? C.green : C.red}
          />
          <Stat
            label="Starting funds"
            value={fmtUsd(bot.config.startVirtualUsd)}
            align="right"
            valueStyle={{ color: C.textDim }}
          />
        </View>
      </Card>

      <SectionTitle>Performance</SectionTitle>
      <Card>
        <View style={styles.statGrid}>
          <Stat label="Closed trades" value={String(stats.trades)} align="center" />
          <Stat label="Win rate" value={`${stats.winRate.toFixed(0)}%`} color={stats.winRate >= 50 ? C.green : C.amber} align="center" />
          <Stat label="Total P&L" value={`${stats.totalPnlUsd >= 0 ? '+' : ''}${fmtUsd(stats.totalPnlUsd)}`} color={stats.totalPnlUsd >= 0 ? C.green : C.red} align="center" />
        </View>
        <View style={[styles.statGrid, { marginTop: 12 }]}>
          <Stat label="Wins" value={String(stats.wins)} color={C.green} align="center" />
          <Stat label="Losses" value={String(stats.losses)} color={C.red} align="center" />
          <Stat
            label="Best / Worst"
            value={`${stats.bestTradeUsd >= 0 ? '+' : ''}${Math.round(stats.bestTradeUsd)} / ${Math.round(stats.worstTradeUsd)}`}
            align="center"
            valueStyle={{ fontSize: F.small }}
          />
        </View>
      </Card>

      {bot.positions.length > 0 && (
        <>
          <SectionTitle>Open Now</SectionTitle>
          <Card>
            {bot.positions.map((p) => (
              <View key={p.id} style={styles.tradeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tradeSym}>
                    {p.symbol.replace('USDT', '')} <Text style={styles.tradeSide}>LONG</Text>
                  </Text>
                  <Text style={styles.tradeDetail}>
                    {fmtQty(p.qty)} @ {fmtPrice(p.entryPrice)} · SL {fmtPrice(p.stopLoss)} · TP {fmtPrice(p.takeProfit)}
                  </Text>
                </View>
                <Btn label="Close" small variant="danger" onPress={() => void engine.closePosition(p.id, 'MANUAL')} />
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>History ({bot.history.length})</SectionTitle>
      <Card style={{ paddingBottom: 8 }}>
        {bot.history.length === 0 && (
          <Text style={styles.empty}>
            No closed trades yet. Start the bot and it will paper-trade with the
            virtual bankroll until live orders are armed.
          </Text>
        )}
        {bot.history.map((t) => (
          <TradeRow key={t.id} t={t} />
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 44 },
  h1: { color: C.text, fontSize: F.h1, fontWeight: '800', marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  statGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  tradeRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    gap: 8,
    alignItems: 'center',
  },
  tradeHead: { flexDirection: 'row', alignItems: 'center' },
  tradeSym: { color: C.text, fontWeight: '800', fontSize: F.body },
  tradeSide: { color: C.green, fontSize: F.tiny, fontWeight: '800' },
  tradeDetail: { color: C.textDim, fontSize: F.small, marginTop: 3 },
  tradeTime: { color: C.textFaint, fontSize: F.tiny, marginTop: 2 },
  tradePnl: { fontWeight: '800', fontSize: F.body },
  tradePct: { fontSize: F.small, fontWeight: '700' },
  empty: { color: C.textFaint, fontSize: F.body, lineHeight: 20 },
});
