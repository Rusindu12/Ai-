/**
 * AI Trading Bot — root component.
 *
 * Boot flow:
 *   loading → setup (no credentials saved)
 *           → locked (biometric gate)
 *           → ready (tab navigator: Dashboard · Bot · Trades · Setup)
 */
import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppStateProvider, useAppState } from './src/state/AppState';
import LockScreen from './src/screens/LockScreen';
import SetupScreen from './src/screens/SetupScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import BotScreen from './src/screens/BotScreen';
import TradesScreen from './src/screens/TradesScreen';
import { C, F } from './src/theme';

type Tab = 'dashboard' | 'bot' | 'trades' | 'setup';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'bot', label: 'Bot', icon: '🤖' },
  { id: 'trades', label: 'Trades', icon: '⇄' },
  { id: 'setup', label: 'Setup', icon: '🔑' },
];

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { bot } = useAppState();
  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = tab === t.id;
        const dot = t.id === 'bot' && bot.running;
        return (
          <Pressable key={t.id} style={styles.tabBtn} onPress={() => setTab(t.id)}>
            <Text style={[styles.tabIcon, active && { color: C.green }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, active && { color: C.text }]}>{t.label}</Text>
            {dot && <View style={styles.runDot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function Main() {
  const { phase } = useAppState();
  const [tab, setTab] = useState<Tab>('dashboard');

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>AI Trading Bot</Text>
        <Text style={styles.loadingSub}>decrypting secure vault…</Text>
      </View>
    );
  }
  if (phase === 'setup') return <SetupScreen />;
  if (phase === 'locked') return <LockScreen />;

  return (
    <SafeAreaView style={styles.safe}>
      {tab === 'dashboard' && <DashboardScreen goBot={() => setTab('bot')} />}
      {tab === 'bot' && <BotScreen />}
      {tab === 'trades' && <TradesScreen />}
      {tab === 'setup' && <SetupScreen embedded />}
      <TabBar tab={tab} setTab={setTab} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Main />
    </AppStateProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: C.text, fontSize: F.h2, fontWeight: '800' },
  loadingSub: { color: C.textFaint, fontSize: F.small, marginTop: 6 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingBottom: 6,
    paddingTop: 6,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    position: 'relative',
  },
  tabIcon: { fontSize: 18, color: C.textFaint },
  tabLabel: { fontSize: F.tiny, color: C.textFaint, marginTop: 3, fontWeight: '600' },
  runDot: {
    position: 'absolute',
    top: 3,
    right: '26%',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.green,
  },
});
