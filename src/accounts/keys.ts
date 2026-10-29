/**
 * API keys a connected account holds (an endpoint whose key is `account:<provider>`): read from the SecretStore once per
 * process, then kept in memory only, never written anywhere else. Connect and disconnect set it.
 */
import { defaultStore, type SecretStore } from './secretStore.js';

const keys = new Map<string, Promise<string | undefined>>();
const slot = (home: string, provider: string) => `${home}\0${provider}`;

export function accountKey(home: string, provider: string, store?: SecretStore): Promise<string | undefined> {
  const k = slot(home, provider);
  let v = keys.get(k);
  // a failed read (a locked Keychain) is not remembered: the next call asks again
  if (!v) keys.set(k, (v = (store ?? defaultStore(home)).get(provider).catch(() => (keys.delete(k), undefined))));
  return v;
}

export function setAccountKey(home: string, provider: string, value: string | undefined): void {
  keys.set(slot(home, provider), Promise.resolve(value));
}
