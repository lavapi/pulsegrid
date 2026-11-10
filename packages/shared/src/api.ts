import type { UserPermission } from './permissions';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roleName: string;
  permissions: UserPermission[];
  isOwner: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  tenant: { id: string; slug: string; name: string } | null;
}

export const NO_PROJECT = "You haven't been added to a project yet. Ask your super admin to add you.";

export interface Project {
  id: string;
  name: string;
}

export interface ProjectList {
  currentId: string | null;
  projects: Project[];
}

export interface PersonProject {
  id: string;
  name: string;
  roleName: string;
}

export interface Person {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  pendingPassword: boolean;
  projects: PersonProject[];
}

export interface NewPerson {
  firstName: string;
  lastName: string;
  email: string;
}

export interface MemberAssignment {
  accountId: string;
  roleId: string;
}

export interface SignInResult {
  twoFactorRequired: boolean;
}

export const SETUP_CODE_EXPIRED = 'That setup code has expired. A new code is in the server log.';

export interface AuthMethods {
  google: boolean;
  setupRequired: boolean;
}

export interface TwoFactorSetup {
  secret: string;
  qrCode: string;
}

export interface TwoFactorEnabled {
  backupCodes: string[];
}

export interface AccountSettings {
  email: string;
  displayName: string;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  backupCodesLeft: number;
}

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  lastLoginAt: string;
}

export interface TemporaryPassword {
  password: string;
  expiresAt: string;
}

export interface Team {
  members: TeamMember[];
}

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const SIGN_IN_ERRORS = {
  google_failed: 'We could not sign you in with Google. Please try again.',
  google_unverified: 'Your Google email is not verified.',
  no_access: 'That Google account has no access. Ask your super admin to add you.',
} as const;

export const signInErrorMessage = (code: string | undefined): string | null =>
  code !== undefined && code in SIGN_IN_ERRORS
    ? SIGN_IN_ERRORS[code as keyof typeof SIGN_IN_ERRORS]
    : null;

export interface AuditEvent {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export const ACTIVITY_CATEGORIES = {
  secrets: { label: 'Secrets', prefixes: ['secret.'] },
  changes: {
    label: 'Deploys, reboots and experiments',
    prefixes: ['cloud.action.', 'cloud.activity.', 'cloud.experiment.'],
  },
  pipelines: { label: 'Pipelines', prefixes: ['pipeline.'] },
  people: { label: 'People', prefixes: ['team.', 'people.', 'project.'] },
  signIns: { label: 'Sign-ins', prefixes: ['auth.'] },
  settings: { label: 'Settings', prefixes: ['cloud.account.', 'aws.account.', 'git.', 'environment.'] },
  refused: { label: 'Refused', prefixes: ['access.'] },
} as const;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export const isActivityCategory = (value: string): value is ActivityCategory =>
  Object.hasOwn(ACTIVITY_CATEGORIES, value);

export interface AuditEventPage {
  events: AuditEvent[];
  nextCursor: string | null;
}
