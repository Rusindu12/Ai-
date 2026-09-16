/**
 * Typed bridge to the app's custom Kotlin native modules.
 *
 *  - SecureStorage  : Android Keystore-backed EncryptedSharedPreferences
 *                     (AES256-SIV keys / AES256-GCM values) + SecureRandom.
 *  - BiometricAuth  : androidx.biometric BiometricPrompt wrapper.
 *
 * When running outside a device (unit tests, Storybook-style dev), graceful
 * in-memory fallbacks keep the app functional.
 */
import { NativeModules } from 'react-native';

export interface SecureStorageSpec {
  setItem(key: string, value: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  hasItem(key: string): Promise<boolean>;
  removeItem(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
  randomHex(byteLength: number): Promise<string>;
}

export interface BiometricAuthSpec {
  isAvailable(): Promise<boolean>;
  authenticate(title: string, subtitle: string): Promise<boolean>;
}

const NativeSecure = NativeModules.SecureStorage as SecureStorageSpec | undefined;
const NativeBio = NativeModules.BiometricAuth as BiometricAuthSpec | undefined;

export const hasNativeSecureStorage = !!NativeSecure;
export const hasNativeBiometrics = !!NativeBio;

let memStore: Record<string, string> = {};

const memoryFallback: SecureStorageSpec = {
  async setItem(key, value) {
    memStore[key] = value;
    return true;
  },
  async getItem(key) {
    return memStore[key] ?? null;
  },
  async hasItem(key) {
    return key in memStore;
  },
  async removeItem(key) {
    delete memStore[key];
    return true;
  },
  async clear() {
    memStore = {};
    return true;
  },
  async randomHex(byteLength) {
    let out = '';
    for (let i = 0; i < byteLength * 2; i++) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  },
};

export const SecureStorage: SecureStorageSpec = NativeSecure ?? memoryFallback;

export const BiometricAuth: BiometricAuthSpec = NativeBio ?? {
  async isAvailable() {
    return false;
  },
  async authenticate() {
    return true;
  },
};
