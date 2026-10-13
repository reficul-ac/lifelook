import { expect, it } from 'vitest';
import { within } from '@testing-library/dom';
import { appendProvenance } from '../../src/browser/views/issues';

it('shows user-supplied model sources as text alongside linked external references', () => {
  const root = document.createElement('section');
  const source = 'User-supplied Oceanside child expense planning budget (2026-10-13).';
  appendProvenance(root, [{ status: 'projected', ruleVersion: 'oceanside-child-planning.1', baselineYear: 2026, applicableYear: 2027,
    sources: [source, 'https://livingwage.mit.edu/counties/06073'], assumptions: ['Fixed age-based expenses in today’s dollars.'] }]);
  expect(within(root).getByText(source).closest('a')).toBeNull();
  const links = within(root).getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', 'https://livingwage.mit.edu/counties/06073');
});
