import type { CloudAccount } from '@pulsegrid/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductionAccountProvider } from '@/lib/production-account';
import { ProductionNotice, useProductionTarget } from './production-notice';

const production = { name: 'Dreamzino Production' } as CloudAccount;

function Probe({ warn }: { warn: boolean | string | undefined }) {
  return createElement(ProductionNotice, { target: useProductionTarget(warn) });
}

const render = (account: CloudAccount | null, warn: boolean | string | undefined) =>
  renderToStaticMarkup(createElement(ProductionAccountProvider, { account, children: createElement(Probe, { warn }) }));

describe('ProductionNotice', () => {
  it('warns about the selected production account in dialogs that change it', () => {
    expect(render(production, true)).toContain('Production · Dreamzino Production');
  });

  it('stays quiet on other accounts and in dialogs that change nothing in the cloud', () => {
    expect(render(null, true)).toBe('');
    expect(render(production, undefined)).toBe('');
  });

  it('names a production pipeline even when the selected account is not production', () => {
    expect(render(null, 'Deploy api (production pipeline)')).toContain('Production · Deploy api (production pipeline)');
  });
});
