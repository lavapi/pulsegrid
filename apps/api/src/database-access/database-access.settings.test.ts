import { describe, expect, it } from 'vitest';
import { loadDatabaseAccessSetup } from './database-access.settings';

const REQUIRED = {
  DB_ACCESS_GRANT_STATE_MACHINE_ARN: 'arn:aws:states:eu-central-1:200000000000:stateMachine:db-access-grant',
  DB_ACCESS_REVOKE_STATE_MACHINE_ARN: 'arn:aws:states:eu-central-1:200000000000:stateMachine:db-access-revoke',
  DB_ACCESS_SCHEDULE_GROUP: 'db-access',
};
const CONNECT = {
  DB_ACCESS_SSO_START_URL: 'https://example.awsapps.com/start',
  DB_ACCESS_TUNNEL_INSTANCE_ID: 'i-0abc',
  DB_ACCESS_READER_ENDPOINT: 'db.cluster-ro-x.eu-central-1.rds.amazonaws.com',
  DB_ACCESS_DATABASE: 'game',
};

describe('loadDatabaseAccessSetup', () => {
  it('reads the workflows, and the account and region from their ARNs', () => {
    const setup = loadDatabaseAccessSetup({ ...REQUIRED, ...CONNECT });
    expect(setup.ready && setup.settings).toMatchObject({
      accountId: '200000000000',
      region: 'eu-central-1',
      scheduleGroup: 'db-access',
      missingConnect: [],
      connect: {
        roleName: 'ProductionDatabaseReadOnly',
        user: 'readonly_access',
        port: 5432,
        database: 'game',
        ssoRegion: 'eu-central-1',
        profile: 'production-db',
      },
    });
  });

  it('works without the connect values, and says which are missing', () => {
    const setup = loadDatabaseAccessSetup({ ...REQUIRED, DB_ACCESS_DATABASE: 'game' });
    expect(setup.ready && setup.settings).toMatchObject({
      connect: null,
      missingConnect: ['DB_ACCESS_SSO_START_URL', 'DB_ACCESS_TUNNEL_INSTANCE_ID', 'DB_ACCESS_READER_ENDPOINT'],
    });
  });

  it('names the settings that are missing or wrong', () => {
    expect(loadDatabaseAccessSetup({})).toEqual({
      ready: false,
      problems: ['DB_ACCESS_GRANT_STATE_MACHINE_ARN', 'DB_ACCESS_REVOKE_STATE_MACHINE_ARN', 'DB_ACCESS_SCHEDULE_GROUP'],
    });
    const elsewhere = REQUIRED.DB_ACCESS_REVOKE_STATE_MACHINE_ARN.replace('200000000000', '300000000000');
    expect(loadDatabaseAccessSetup({ ...REQUIRED, DB_ACCESS_REVOKE_STATE_MACHINE_ARN: elsewhere })).toEqual({
      ready: false,
      problems: ['DB_ACCESS_REVOKE_STATE_MACHINE_ARN'],
    });
  });

  it('takes another Identity Center region and profile name', () => {
    const setup = loadDatabaseAccessSetup({
      ...REQUIRED,
      ...CONNECT,
      DB_ACCESS_SSO_REGION: 'us-east-1',
      DB_ACCESS_PROFILE: 'prod-db',
    });
    expect(setup.ready && setup.settings.connect).toMatchObject({ ssoRegion: 'us-east-1', profile: 'prod-db' });
    expect(loadDatabaseAccessSetup({ ...REQUIRED, DB_ACCESS_PROFILE: 'bad name!' })).toEqual({
      ready: false,
      problems: ['DB_ACCESS_PROFILE'],
    });
  });
});
