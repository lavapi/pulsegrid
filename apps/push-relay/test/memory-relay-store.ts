import type { RelayStore } from '../src/relay-store';

export class MemoryRelayStore implements RelayStore {
  readonly installations = new Map<string, string>();
  readonly counts = new Map<string, number>();

  async saveInstallation(installationId: string, secretHash: string): Promise<void> {
    this.installations.set(installationId, secretHash);
  }

  async secretHashFor(installationId: string): Promise<string | null> {
    return this.installations.get(installationId) ?? null;
  }

  async countToday(counter: string, day: string, limit: number): Promise<boolean> {
    const key = `${counter}#${day}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= limit) return false;
    this.counts.set(key, count + 1);
    return true;
  }
}
