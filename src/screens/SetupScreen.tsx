/**
 * SetupScreen — Binance API credentials, network mode, connection test,
 * biometric enrollment toggle, and encrypted-storage explainer.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { testConnection } from '../api/binance';
import { BotLogo } from './LockScreen';
import {
  Btn,
  Card,
  Field,
  KV,
  ModalBox,
  SectionTitle,
  StatusDot,
  Toggle,
} from '../components/ui';
import { useAppState } from '../state/AppState';
import { C, F } from '../theme';
import type { NetworkMode } from '../types';

export default function SetupScreen({ embedded = false }: { embedded?: boolean }) {
  const app = useAppState();
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [mode, setMode] = useState<NetworkMode>(app.mode);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  useEffect(() => {
    setMode(app.mode);
  }, [app.mode]);

  const doTest = async () => {
    setTesting(true);
    if (apiKey && secretKey) {
      const res = await testConnection(mode, apiKey.trim(), secretKey.trim());
      setResult(res);
    } else {
      await app.actions.testConnectionNow(undefined, undefined, mode);
      setResult(null);
    }
    setTesting(false);
  };

  const doSave = async () => {
    if (!apiKey.trim() || !secretKey.trim()) return;
    if (mode === 'live') {
      setConfirmLive(true);
      return;
    }
    await persist();
  };

  const persist = async () => {
    setSaving(true);
    const res = await app.actions.saveAndConnect(apiKey.trim(), secretKey.trim(), mode);
    setResult(res);
    setSaving(false);
    if (!res.ok && embedded) {
      // stay on screen, error shown
    }
  };

  const shownResult = result ?? (app.connection !== 'unknown'
    ? { ok: app.connection === 'ok', detail: app.connectionDetail }
    : null);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {!embedded && (
        <View style={{ alignItems: 'center', marginBottom: 18, marginTop: 24 }}>
          <BotLogo size={64} />
          <Text style={styles.welcome}>Welcome to AI Trading Bot</Text>
          <Text style={styles.welcomeSub}>
            Connect your Binance account to begin. Testnet is recommended first.
          </Text>
        </View>
      )}

      {/* Network mode */}
      <SectionTitle>1 · Network</SectionTitle>
      <Card>
        <View style={styles.segRow}>
          {(['testnet', 'live'] as NetworkMode[]).map((m) => (
            <Btn
              key={m}
              small
              variant={mode === m ? (m === 'live' ? 'danger' : 'success') : 'ghost'}
              label={m === 'testnet' ? '🧪 Binance Testnet' : '🔴 LIVE Trading'}
              onPress={() => setMode(m)}
              style={{ flex: 1, marginHorizontal: 3 }}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          {mode === 'testnet'
            ? 'testnet.binance.vision — paper-real environment with fake funds. Get testnet keys from testnet.binance.vision.'
            : '⚠ api.binance.com — REAL money. Automated trading can lose funds quickly. Proceed only if you understand the risks.'}
        </Text>
      </Card>

      {/* Credentials */}
      <SectionTitle>2 · API Credentials</SectionTitle>
      <Card>
        <Field
          label="Binance API Key"
          value={apiKey}
          onChange={setApiKey}
          placeholder="e.g. 9fX3kQ…"
          autoCapitalize="none"
        />
        <Field
          label="Binance Secret Key"
          value={secretKey}
          onChange={setSecretKey}
          placeholder="••••••••••••••••••••"
          secure
        />
        <Text style={styles.hint}>
          Tip: create a key with “Spot Trading” only — never enable withdrawals.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Btn
            label="Test Connection"
            variant="ghost"
            onPress={() => void doTest()}
            busy={testing}
            style={{ flex: 1 }}
          />
          <Btn
            label="Save & Encrypt"
            variant="success"
            onPress={() => void doSave()}
            disabled={!apiKey.trim() || !secretKey.trim()}
            busy={saving}
            style={{ flex: 1 }}
          />
        </View>

        {shownResult && (
          <View style={[styles.statusRow, { borderColor: shownResult.ok ? C.green : C.red }]}>
            <StatusDot ok={shownResult.ok} checking={testing} />
            <Text style={[styles.statusText, { color: shownResult.ok ? C.green : C.red }]} numberOfLines={3}>
              {shownResult.detail}
            </Text>
          </View>
        )}
      </Card>

      {/* Security */}
      <SectionTitle>3 · Security</SectionTitle>
      <Card>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.toggleLabel}>Biometric unlock (fingerprint / face)</Text>
            <Text style={styles.hint}>
              {app.biometricsAvailable
                ? 'Require biometrics every time the app opens.'
                : 'No biometric hardware / not enrolled on this device.'}
            </Text>
          </View>
          <Toggle
            value={app.biometricsEnabled}
            disabled={!app.biometricsAvailable}
            onChange={(v) => void app.actions.setBiometricsEnabled(v)}
          />
        </View>
        <View style={styles.divider} />
        <KV k="Credential storage" v="AES-256 envelope" vColor={C.green} />
        <KV k="Disk layer" v="Android Keystore (AES-256-GCM)" vColor={C.green} />
        <KV k="Master key" v="SecureRandom · Keystore-resident" vColor={C.green} />
        <KV k="Network" v={mode === 'live' ? 'Binance LIVE' : 'Binance Testnet'} vColor={mode === 'live' ? C.red : C.green} />
        {app.credentials && (
          <Btn
            label="Disconnect & Wipe Keys"
            variant="danger"
            small
            onPress={() => setConfirmClear(true)}
            style={{ marginTop: 14, alignSelf: 'stretch' }}
          />
        )}
      </Card>

      <Card>
        <Text style={styles.disclaimer}>
          ⚠ Risk disclosure: this app places automated trades based on technical
          analysis. No profit is guaranteed and losses can be substantial. Use the
          Testnet and small position sizes until you trust the behaviour. This is a
          tool, not financial advice.
        </Text>
      </Card>

      {/* Confirm live modal */}
      <ModalBox
        visible={confirmLive}
        title="Enable LIVE trading keys?"
        onClose={() => setConfirmLive(false)}
      >
        <Text style={styles.modalText}>
          You are saving keys for Binance LIVE markets. The bot can trade REAL funds
          with this account (paper trading still remains the default until you arm
          live order placement in the Bot tab).
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Btn label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setConfirmLive(false)} />
          <Btn
            label="I understand, save"
            variant="danger"
            style={{ flex: 1 }}
            onPress={() => {
              setConfirmLive(false);
              void persist();
            }}
          />
        </View>
      </ModalBox>

      {/* Confirm clear modal */}
      <ModalBox
        visible={confirmClear}
        title="Wipe stored credentials?"
        onClose={() => setConfirmClear(false)}
      >
        <Text style={styles.modalText}>
          This stops the bot, deletes the AES-256 encrypted API keys from this device
          and returns to the setup screen.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Btn label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setConfirmClear(false)} />
          <Btn
            label="Wipe keys"
            variant="danger"
            style={{ flex: 1 }}
            onPress={() => {
              setConfirmClear(false);
              void app.actions.clearAll();
            }}
          />
        </View>
      </ModalBox>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  welcome: { color: C.text, fontSize: F.h2, fontWeight: '800', marginTop: 12 },
  welcomeSub: { color: C.textDim, fontSize: F.body, marginTop: 6, textAlign: 'center' },
  segRow: { flexDirection: 'row', marginHorizontal: -3, marginBottom: 10 },
  hint: { color: C.textFaint, fontSize: F.small, lineHeight: 18, marginTop: 6 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: C.bg,
  },
  statusText: { flex: 1, fontSize: F.small, lineHeight: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { color: C.text, fontSize: F.body, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  disclaimer: { color: C.textDim, fontSize: F.small, lineHeight: 19 },
  modalText: { color: C.textDim, fontSize: F.body, lineHeight: 21 },
});
