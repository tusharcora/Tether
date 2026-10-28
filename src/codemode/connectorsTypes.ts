/** A Code Mode connector as Settings → Connectors draws it (shared with the dashboard, so no imports). */
export interface ConnectorView {
  name: string;
  summary: string;
  /** connected: green. needs: amber (an approval waits, or the account is not usable). off: gray and dashed. */
  status: 'connected' | 'needs' | 'off';
  note?: string;
  permissions: string[];
  recent: { at: number; what: string; kind: 'call' | 'approval'; state?: string }[];
}
