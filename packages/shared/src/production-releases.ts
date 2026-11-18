export const PRODUCTION_RELEASE_STATUSES = [
  'STARTED',
  'SWITCH',
  'HOLD',
  'FINISH',
  'SUCCEEDED',
  'ABORT',
  'ROLLED_BACK',
  'FAILED',
] as const;
export type ProductionReleaseStatus = (typeof PRODUCTION_RELEASE_STATUSES)[number];

export type ProductionReleaseDecision = 'FINISH' | 'ROLLBACK';

/** What a person sends to decide; who decides always comes from their session. */
export type ProductionReleaseChoice = 'finish' | 'rollback';

export interface ProductionReleaseComponent {
  name: string;
  tag: string;
}

export interface ProductionRelease {
  id: string;
  /** The status as the release records it; an unknown one is shown as it is. */
  status: ProductionReleaseStatus | string;
  components: ProductionReleaseComponent[];
  requestedBy: string | null;
  createdAt: string | null;
  holdStartedAt: string | null;
  holdUntil: string | null;
  decision: ProductionReleaseDecision | null;
  decidedBy: string | null;
  snapshot: string | null;
}

/** The page: whether it's set up, and the release in progress, if any. */
export type ProductionReleasesView =
  | { ready: false }
  | { ready: true; current: ProductionRelease | null };

export interface ProductionReleaseDecisionResult {
  releaseId: string;
  decision: ProductionReleaseDecision;
  decidedBy: string;
}
