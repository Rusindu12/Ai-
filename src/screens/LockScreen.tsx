/**
 * LockScreen — biometric gate shown before any trading data is revealed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn, Card } from '../components/ui';
import { useAppState } from '../state/AppState';
import { C, F } from '../theme';

export function BotLogo({ size = 72 }: { size?: number }) {
  // Simple candlestick-mark logo drawn with Views.
  const bar = size * 0.14;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: C.cardAlt,
        borderWidth: 1,
        borderColor: C.border,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: size * 0.07,
      }}
    >
      {[0.34, 0.62, 0.9].map((h, i) => (
        <View key={i} style={{ alignItems: 'center' }}>
          <View style={{ width: 1.5, height: size * h * 0.55, backgroundColor: i === 2 ? C.green : C.textFaint }} />
          <View
            style={{
              width: bar,
              height: size * h * 0.42,
              borderRadius: 2,
              backgroundColor: i === 2 ? C.green : i === 1 ? C.blue : C.textDim,
              marginTop: -size * h * 0.28,
            }}
          />
        </View>
      ))}
    </View>
  );
}

export default function LockScreen() {
  const { actions, biometricsAvailable, biometricsEnabled } = useAppState();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  const tryUnlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await actions.unlock();
    setBusy(false);
    if (!ok) setFailed(true);
  }, [actions, busy]);

  // Auto-prompt biometrics once when the screen appears.
  useEffect(() => {
    if (biometricsEnabled && biometricsAvailable && !attempted.current) {
      attempted.current = true;
      const t = setTimeout(() => void tryUnlock(), 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [biometricsEnabled, biometricsAvailable, tryUnlock]);

  return (
    <View style={styles.root}>
      <BotLogo size={84} />
      <Text style={styles.title}>AI Trading Bot</Text>
      <Text style={styles.subtitle}>Locked — verify your identity to continue</Text>

      <Card style={styles.card}>
        <Text style={styles.cardText}>
          {biometricsEnabled && biometricsAvailable
            ? 'Use your fingerprint or face to unlock. Your Binance API credentials stay encrypted (AES-256) on this device.'
            : 'Biometric hardware is not available on this device. Tap unlock to continue.'}
        </Text>
        {failed && (
          <Text style={styles.failed}>
            Verification failed or was cancelled. Try again.
          </Text>
        )}
        <Btn
          label={biometricsEnabled && biometricsAvailable ? 'Unlock with Biometrics' : 'Unlock'}
          onPress={() => void tryUnlock()}
          variant="success"
          busy={busy}
          style={{ marginTop: 14 }}
        />
      </Card>

      <Text style={styles.footnote}>
        Credentials never leave this device unencrypted. Trading involves substantial risk.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  title: { color: C.text, fontSize: F.h1, fontWeight: '800', marginTop: 18 },
  subtitle: { color: C.textDim, fontSize: F.body, marginTop: 6, textAlign: 'center' },
  card: { marginTop: 26, width: '100%' },
  cardText: { color: C.textDim, fontSize: F.body, lineHeight: 21 },
  failed: { color: C.red, fontSize: F.small, marginTop: 10 },
  footnote: { color: C.textFaint, fontSize: F.tiny, textAlign: 'center', marginTop: 22, lineHeight: 16 },
});
