/**
 * ui.tsx — small design-system primitives (dark trading theme).
 */
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { C, F } from '../theme';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({
  children,
  right,
  style,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Stat({
  label,
  value,
  sub,
  color,
  align = 'left',
  valueStyle,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valueStyle?: TextStyle;
}) {
  return (
    <View style={{ alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null, valueStyle]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export function Pill({
  text,
  color,
  bg,
  style,
}: {
  text: string;
  color: string;
  bg?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: bg ?? `${color}22` }, style]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

/** Green / red connection dot with soft pulse. */
export function StatusDot({
  ok,
  checking,
  size = 10,
}: {
  ok: boolean | null;
  checking?: boolean;
  size?: number;
}) {
  const color = checking ? C.amber : ok === null ? C.textFaint : ok ? C.green : C.red;
  return (
    <View style={{ width: size + 6, height: size + 6, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: size + 6,
          height: size + 6,
          borderRadius: (size + 6) / 2,
          backgroundColor: `${color}33`,
          position: 'absolute',
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.toggle,
        { backgroundColor: value ? C.green : C.cardAlt, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <View
        style={[
          styles.toggleKnob,
          { transform: [{ translateX: value ? 18 : 0 }] },
        ]}
      />
    </Pressable>
  );
}

type BtnVariant = 'primary' | 'success' | 'danger' | 'ghost' | 'amber';

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  small,
  style,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  small?: boolean;
  style?: ViewStyle;
  busy?: boolean;
}) {
  const bgMap: Record<BtnVariant, string> = {
    primary: C.blue,
    success: C.green,
    danger: C.red,
    ghost: 'transparent',
    amber: C.amber,
  };
  const bg = bgMap[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: variant === 'ghost' ? C.border : 'transparent',
          borderWidth: variant === 'ghost' ? 1 : 0,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          paddingVertical: small ? 8 : 13,
          paddingHorizontal: small ? 12 : 18,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={[styles.btnText, small && { fontSize: F.small }, variant === 'ghost' && { color: C.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  autoCapitalize = 'none',
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: 'none' | 'characters';
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.textFaint}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={styles.input}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function ModalBox({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <Text style={styles.modalTitle}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={[styles.kvV, vColor ? { color: vColor } : null]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    color: C.textDim,
    fontSize: F.small,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statLabel: { color: C.textDim, fontSize: F.small, marginBottom: 2 },
  statValue: { color: C.text, fontSize: F.h2, fontWeight: '700' },
  statSub: { color: C.textFaint, fontSize: F.tiny, marginTop: 2 },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: F.small, fontWeight: '800', letterSpacing: 0.5 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  btn: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: F.body },
  fieldLabel: { color: C.textDim, fontSize: F.small, fontWeight: '600', marginBottom: 6 },
  fieldHint: { color: C.textFaint, fontSize: F.tiny, marginTop: 4 },
  input: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: F.body,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,7,14,0.78)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },
  modalTitle: { color: C.text, fontSize: F.h3, fontWeight: '800', marginBottom: 12 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  kvK: { color: C.textDim, fontSize: F.body },
  kvV: { color: C.text, fontSize: F.body, fontWeight: '600' },
});
