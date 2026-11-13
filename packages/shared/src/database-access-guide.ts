import type { DatabaseAccessConnect } from './database-access';

/** One thing to do: a short instruction, and what to copy or fill in. */
export interface GuideStep {
  title: string;
  text?: string;
  /** A command or file content to copy, shown as a code block. */
  code?: string;
  /** Values to fill in, such as a database client's connection settings. */
  fields?: { label: string; value: string }[];
}

export interface GuideSection {
  title: string;
  steps: GuideStep[];
  /** Short points, shown as a list after the steps. */
  notes?: string[];
}

export interface ConnectGuide {
  title: string;
  /** Who it's for and until when, in UTC so it reads the same wherever it's sent. */
  intro: string;
  sections: GuideSection[];
}

const SESSION_NAME = 'pulsegrid-db-access';

const endTime = (iso: string): string =>
  `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))} UTC`;

/** The person's AWS config: an SSO session and a profile for the read-only role. */
const awsConfig = (connect: DatabaseAccessConnect): string =>
  [
    `[sso-session ${SESSION_NAME}]`,
    `sso_start_url = ${connect.ssoStartUrl}`,
    `sso_region = ${connect.ssoRegion}`,
    'sso_registration_scopes = sso:account:access',
    '',
    `[profile ${connect.profile}]`,
    `sso_session = ${SESSION_NAME}`,
    `sso_account_id = ${connect.accountId}`,
    `sso_role_name = ${connect.roleName}`,
    `region = ${connect.region}`,
  ].join('\n');

/**
 * Everything a person needs to reach the production database with their grant: one-time setup, what to run each
 * time, and their database client's settings. The page and the shared messages are all built from this.
 */
export const connectGuide = (
  connect: DatabaseAccessConnect,
  grant: { userName: string; expiresAt: string },
): ConnectGuide => {
  const profile = `--profile ${connect.profile}`;
  return {
    title: 'Connecting to the production database (read-only)',
    intro: `Access for ${grant.userName} until ${endTime(grant.expiresAt)}.`,
    sections: [
      {
        title: 'One-time setup',
        steps: [
          {
            title: 'Install the tools',
            text: "AWS CLI v2 and the Session Manager plugin. On a Mac with Homebrew, run this; elsewhere, use AWS's install guides.",
            code: 'brew install awscli\nbrew install --cask session-manager-plugin',
          },
          {
            title: 'Add this to ~/.aws/config',
            text: `Or run aws configure sso, choose account ${connect.accountId} and role ${connect.roleName}, and name the profile ${connect.profile}.`,
            code: awsConfig(connect),
          },
        ],
      },
      {
        title: 'Each time you connect',
        steps: [
          {
            title: 'Sign in',
            text: 'A browser opens. The sign-in lasts 1 hour.',
            code: `aws sso login ${profile}`,
          },
          {
            title: 'Open the tunnel and leave this terminal running',
            code: `aws ssm start-session ${profile} --target ${connect.tunnelInstanceId} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=${connect.readerEndpoint},portNumber=${connect.port},localPortNumber=${connect.localPort}`,
          },
          {
            title: 'In a second terminal, get a password token',
            text: 'Copy the whole output: it is your password.',
            code: `aws rds generate-db-auth-token ${profile} --hostname ${connect.readerEndpoint} --port ${connect.port} --username ${connect.user} --region ${connect.region}`,
          },
          {
            title: 'Connect with DBeaver or Navicat',
            text: "Create a PostgreSQL connection, and turn SSL on with mode require. Don't save the password: the token changes each time.",
            fields: [
              { label: 'Host', value: 'localhost' },
              { label: 'Port', value: String(connect.localPort) },
              { label: 'Database', value: connect.database },
              { label: 'User', value: connect.user },
              { label: 'Password', value: 'the token from the step before' },
              { label: 'SSL mode', value: 'require' },
            ],
          },
        ],
        notes: [
          'A token opens connections for 15 minutes; connections already open stay up until access ends. Get a new token to reconnect.',
          `If a command says the session expired, run aws sso login ${profile} again.`,
          `The tunnel only listens on your computer (localhost:${connect.localPort}). Close it with Ctrl+C when you're done.`,
          'Access is read-only.',
        ],
      },
    ],
  };
};

const FENCE = '```';

const numbered = (sections: GuideSection[]) => {
  let number = 0;
  return sections.map((section) => ({
    ...section,
    steps: section.steps.map((step) => ({ ...step, number: (number += 1) })),
  }));
};

const lines = (guide: ConnectGuide, bold: (text: string) => string): string =>
  [
    bold(guide.title),
    guide.intro,
    ...numbered(guide.sections).flatMap((section) => [
      '',
      bold(section.title),
      ...section.steps.flatMap(({ number, title, text, code, fields }) => [
        `${number}. ${title}`,
        ...(text ? [text] : []),
        ...(code ? [`${FENCE}\n${code}\n${FENCE}`] : []),
        ...(fields ? fields.map(({ label, value }) => `• ${label}: ${value}`) : []),
      ]),
      ...(section.notes ?? []).map((note) => `• ${note}`),
    ]),
  ].join('\n');

/** For Slack: bold headings and code blocks, ready to paste into a message. */
export const guideForSlack = (guide: ConnectGuide): string => lines(guide, (text) => `*${text}*`);

/** For other messengers and email: the same text without Slack's bold marks. */
export const guideAsText = (guide: ConnectGuide): string => lines(guide, (text) => text);
