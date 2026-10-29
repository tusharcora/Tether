/**
 * The NVIDIA account: a key made by hand on build.nvidia.com, pasted once, checked with one model call, then kept in the
 * SecretStore (the Keychain on a Mac) and process memory only; the `nvidia` endpoint reads it as `account:nvidia`. No free
 * defaults are bound here: OpenRouter stays the default for new installs.
 */
import { OpenAICompatAdapter } from '../adapters/openai.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Config } from '../config.js';
import { KeyRejected, NV_API, chatModels, checkKey, verifyKey } from '../nvidia.js';
import { useAccountEndpoint } from '../providers.js';
import { AccountError } from './github.js';
import { setAccountKey } from './keys.js';
import { defaultStore, type SecretStore } from './secretStore.js';
import { accountOf, setAccount, type PublicAccount } from './store.js';

export interface NvidiaDeps {
  /** NVIDIA's API (tests fake it). */
  fetch?: typeof fetch;
  store?: SecretStore;
  /** Called after connect and disconnect (the server drops its agent caches). */
  onChange?: () => void;
}

/** How long the models list is kept. */
const MODELS_MS = 3_600_000;

export class NvidiaAccount {
  private cache?: { at: number; models: string[] };

  constructor(
    private readonly cfg: Config,
    private readonly registry: AdapterRegistry,
    private readonly deps: NvidiaDeps = {},
  ) {}

  private get store(): SecretStore {
    return this.deps.store ?? defaultStore(this.cfg.home);
  }

  account(): PublicAccount | undefined {
    return accountOf(this.cfg.home, 'nvidia');
  }

  /** A pasted key: refused unless it is an nvapi- key NVIDIA accepts; then stored, and the `nvidia` endpoint pointed at it and registered. */
  async connect(input: string): Promise<PublicAccount> {
    let key: string;
    try {
      key = checkKey(input);
      await verifyKey(key, this.deps.fetch);
    } catch (e) {
      const m = (e as Error).message;
      // a wrong key is the person's to fix (400); anything else is NVIDIA's side or the network (502)
      throw e instanceof KeyRejected ? new AccountError(m) : new AccountError(m.startsWith('NVIDIA') ? m : "can't reach NVIDIA", 'upstream');
    }
    await this.store.set('nvidia', key);
    setAccountKey(this.cfg.home, 'nvidia', key);
    setAccount(this.cfg.home, 'nvidia', { provider: 'nvidia', login: 'Tether', scopes: [], via: 'key', connectedAt: Date.now() });
    useAccountEndpoint(this.cfg, 'nvidia');
    this.registry.register(new OpenAICompatAdapter('nvidia', this.cfg.endpoints.nvidia!, this.cfg.home));
    this.deps.onChange?.();
    return this.account()!;
  }

  /** NVIDIA's chat models, fetched without a key and kept an hour; offline, the last list. */
  async models(): Promise<{ models: string[]; error?: string }> {
    if (this.cache && Date.now() - this.cache.at < MODELS_MS) return { models: this.cache.models };
    try {
      const res = await (this.deps.fetch ?? fetch)(`${NV_API}/models`, { signal: AbortSignal.timeout(10_000) });
      const models = res.ok ? chatModels(await res.json()) : [];
      if (!models.length) throw new Error(`HTTP ${res.status}`);
      this.cache = { at: Date.now(), models };
      return { models };
    } catch {
      return { models: this.cache?.models ?? [], error: "can't reach NVIDIA" };
    }
  }

  /** Forget the key and the account. The endpoint and bindings stay; they show "not connected" until a key is pasted again. */
  async disconnect(): Promise<void> {
    await this.store.delete('nvidia');
    setAccountKey(this.cfg.home, 'nvidia', undefined);
    setAccount(this.cfg.home, 'nvidia', undefined);
    this.deps.onChange?.();
  }
}
