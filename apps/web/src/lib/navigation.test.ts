import { describe, expect, it } from 'vitest';
import { allowedNav, MAIN_NAV, SETTINGS_NAV } from './navigation';

const hrefs = (items: { href: string }[]) => items.map(({ href }) => href);

describe('database access in the menu', () => {
  it('offers requesting to people who cannot grant access', () => {
    const access = { permissions: [], isOwner: false };
    expect(hrefs(allowedNav(MAIN_NAV, access))).toContain('/database-access');
    expect(hrefs(allowedNav(SETTINGS_NAV, access))).not.toContain('/settings/database-access');
  });

  it('gives approvers the settings page, with the waiting count, instead', () => {
    const access = { permissions: ['production.database_access.grant' as const], isOwner: false };
    expect(hrefs(allowedNav(MAIN_NAV, access))).not.toContain('/database-access');
    const settings = allowedNav(SETTINGS_NAV, access).find(({ href }) => href === '/settings/database-access');
    expect(settings?.countPath).toBe('/database-access/requests/waiting');
  });
});
