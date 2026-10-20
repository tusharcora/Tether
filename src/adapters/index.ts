import type { AgentAdapter } from '../types.js';
import { ClaudeAdapter } from './claude.js';
import { CliAdapter, codexSpec, customSpec, opencodeSpec, type CustomAdapterConfig } from './cli.js';
import { MockAdapter } from './mock.js';
import { LOCAL_ENDPOINTS, OpenAICompatAdapter, type EndpointConfig } from './openai.js';

export class AdapterRegistry {
  private m = new Map<string, AgentAdapter>();
  register(a: AgentAdapter): this {
    this.m.set(a.id, a);
    return this;
  }
  has(id: string): boolean {
    return this.m.has(id);
  }
  get(id: string): AgentAdapter {
    const a = this.m.get(id);
    if (!a) throw new Error(`unknown agent adapter "${id}" (known: ${this.ids().join(', ')})`);
    return a;
  }
  ids(): string[] {
    return [...this.m.keys()];
  }
}

export function defaultRegistry(custom: Record<string, CustomAdapterConfig> = {}, endpoints: Record<string, EndpointConfig> = {}): AdapterRegistry {
  const reg = new AdapterRegistry()
    .register(new ClaudeAdapter())
    .register(new CliAdapter(codexSpec))
    .register(new CliAdapter(opencodeSpec))
    .register(new MockAdapter());
  for (const [id, cfg] of Object.entries({ ...LOCAL_ENDPOINTS, ...endpoints })) reg.register(new OpenAICompatAdapter(id, cfg));
  for (const [id, cfg] of Object.entries(custom)) reg.register(new CliAdapter(customSpec(id, cfg)));
  return reg;
}

export { MockAdapter, ClaudeAdapter, OpenAICompatAdapter };
