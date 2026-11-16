import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboundAddress } from './outbound-address';

describe('OutboundAddress', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks AWS once, then keeps the address for 10 minutes', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '3.120.255.207\n' });
    vi.stubGlobal('fetch', fetch);
    const outbound = new OutboundAddress();
    expect(await outbound.current()).toBe('3.120.255.207');
    expect(await outbound.current()).toBe('3.120.255.207');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://checkip.amazonaws.com');
  });

  it("gives no address when AWS can't be reached or answers something else", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { name: 'TimeoutError' })));
    expect(await new OutboundAddress().current()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>' }));
    expect(await new OutboundAddress().current()).toBeNull();
  });
});
