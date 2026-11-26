/** Where the relay keeps registered servers and its daily counters. It never keeps the notifications themselves. */
export interface RelayStore {
  saveInstallation(installationId: string, secretHash: string, createdAt: Date): Promise<void>;
  /** The stored hash of the installation's secret, or null when the relay doesn't know it. */
  secretHashFor(installationId: string): Promise<string | null>;
  /** Counts one more for today, and says false (counting nothing) once today's count has reached the limit. */
  countToday(counter: string, day: string, limit: number): Promise<boolean>;
}
