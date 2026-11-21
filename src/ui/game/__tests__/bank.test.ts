// The bank chip shows the play view's price: a number, a dash when there is none, nothing for Exchange.

import { describe, it, expect } from 'vitest';
import { bankPrice } from '../bank';

describe('bank price display', () => {
  it('shows the price from the play view', () => {
    expect(bankPrice({ id: 'bank:buyMine', label: 'Buy a Mine', enabled: false, price: 18 })).toBe('18');
    expect(bankPrice({ id: 'bank:buyBelt', label: 'Buy a belt', enabled: true, price: 1 })).toBe('1');
  });
  it('shows a dash when there is nothing to buy, and no price for Exchange', () => {
    expect(bankPrice({ id: 'bank:buyMine', label: 'Buy a Mine', enabled: false })).toBe('—');
    expect(bankPrice({ id: 'bank:exchange', label: 'Exchange', enabled: true })).toBe('');
  });
});
