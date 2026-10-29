/**
 * The OpenRouter account (free models spec §7.1): one approval in the browser hands Tether an API key through OpenRouter's
 * PKCE flow (no client id; the loopback listener and state check are pkce.ts's, the exchange is JSON). The key goes to the
 * SecretStore (the Keychain on a Mac) and process memory only; the `openrouter` endpoint reads it as `account:openrouter`.
 */
import { OpenAICompatAdapter } from '../adapters/openai.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Config } from '../config.js';
import { authUrl, exchangeKey } from '../openrouter.js';
import { useAccountEndpoint } from '../providers.js';
import { setAccountKey } from './keys.js';
import { CALLBACK_PATH, loopbackCode } from './pkce.js';
import { defaultStore, type SecretStore } from './secretStore.js';
import { accountOf, setAccount, type PublicAccount } from './store.js';

export type OrFlow = { state: 'idle' } | { state: 'pending'; url: string } | { state: 'connected'; bound: string[] } | { state: 'error'; error: string };

export interface OpenRouterDeps {
  /** The key exchange's fetch (tests fake OpenRouter). */
  fetch?: typeof fetch;
  store?: SecretStore;
  /** How long the browser has to come back (5 min by default). */
  timeoutMs?: number;
  /** Called after connect and disconnect (the server drops its agent caches). */
  onChange?: () => void;
}

export class OpenRouterAccount {
  private state: OrFlow = { state: 'idle' };
  /** The flow in flight: an older one that ends late must not overwrite a newer one's state. */
  private current?: object;

  constructor(
    private readonly cfg: Config,
    private readonly registry: AdapterRegistry,
    private readonly deps: OpenRouterDeps = {},
  ) {}

  private get store(): SecretStore {
    return this.deps.store ?? defaultStore(this.cfg.home);
  }

  account(): PublicAccount | undefined {
    return accountOf(this.cfg.home, 'openrouter');
  }

  flow(): OrFlow {
    return this.state;
  }

  /**
   * Start the approval: resolves with OpenRouter's page once the loopback listener is up (the caller opens it); the
   * callback, the exchange and the connection go on in the background, followed through `flow()`.
   */
  start(open?: (url: string) => unknown): Promise<{ url: string }> {
    const mine = {};
    this.current = mine;
    const set = (s: OrFlow) => void (this.current === mine && (this.state = s));
    return new Promise((resolve, reject) => {
      loopbackCode({
        // OpenRouter documents localhost callbacks on any port; the listener itself is on 127.0.0.1
        url: (port, pair) => authUrl({ callbackUrl: `http://localhost:${port}${CALLBACK_PATH}`, challenge: pair.challenge, state: pair.state }),
        open: (url) => {
          set({ state: 'pending', url });
          resolve({ url });
          return open?.(url);
        },
        timeoutMs: this.deps.timeoutMs,
      })
        .then(({ code, verifier }) => exchangeKey(code, verifier, this.deps.fetch))
        .then((key) => this.connect(key))
        .then((bound) => set({ state: 'connected', bound }))
        .catch((e: Error) => {
          set({ state: 'error', error: e.message });
          reject(e);
        });
    });
  }

  /** The new key into the SecretStore and memory, the account recorded, the `openrouter` endpoint pointed at it and registered. */
  private async connect(key: string): Promise<string[]> {
    await this.store.set('openrouter', key);
    setAccountKey(this.cfg.home, 'openrouter', key);
    setAccount(this.cfg.home, 'openrouter', { provider: 'openrouter', login: 'Tether', scopes: [], via: 'browser', connectedAt: Date.now() });
    useAccountEndpoint(this.cfg);
    this.registry.register(new OpenAICompatAdapter('openrouter', this.cfg.endpoints.openrouter!, this.cfg.home));
    this.deps.onChange?.();
    return [];
  }

  /** Forget the key and the account. The endpoint and bindings stay; they show "not connected" until a new approval. */
  async disconnect(): Promise<void> {
    this.current = undefined;
    await this.store.delete('openrouter');
    setAccountKey(this.cfg.home, 'openrouter', undefined);
    setAccount(this.cfg.home, 'openrouter', undefined);
    this.state = { state: 'idle' };
    this.deps.onChange?.();
  }
}
