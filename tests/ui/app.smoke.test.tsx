import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// family-chart manipulates real SVG/DOM and d3 internals; mock the wrapper so
// the smoke test exercises our React wiring, not the third-party renderer.
vi.mock('@/render/familyChart', () => ({
  createFamilyChart: () => ({
    update: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
  }),
}));

import { App } from '@/App';

beforeEach(async () => {
  // Fresh IndexedDB per test. Await deletion so a prior test's data can't leak
  // (the provider closes its connection on unmount, so delete won't block).
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('family-tree');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('App smoke flow', () => {
  it('loads, shows the empty state, and adds the first person', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Empty state appears after async init.
    const startBtn = await screen.findByRole('button', {
      name: /add the first person/i,
    });
    await user.click(startBtn);

    // Person card opens for the new (unnamed) person.
    const card = await screen.findByRole('dialog');
    expect(card).toBeInTheDocument();
    expect(within(card).getByText(/Unnamed person/i)).toBeInTheDocument();
  });

  it('edits a name and it appears in the card title', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: /add the first person/i }),
    );
    const card = await screen.findByRole('dialog');
    const given = within(card).getByLabelText(/Given name/i);
    await user.type(given, 'Amina');

    await waitFor(() =>
      expect(within(card).getByRole('heading', { name: /Amina/ })).toBeInTheDocument(),
    );
  });

  it('adds a spouse via the big button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: /add the first person/i }),
    );
    let card = await screen.findByRole('dialog');
    await user.type(within(card).getByLabelText(/Given name/i), 'Dad');

    await user.click(within(card).getByRole('button', { name: /\+ Spouse/i }));

    // Card switches to the new spouse (unnamed); name Dad no longer the title.
    card = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(card).getByText(/Unnamed person/i)).toBeInTheDocument(),
    );
  });
});
