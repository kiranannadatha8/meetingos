import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Home from './page';

describe('Home', () => {
  it('renders the MeetingOS landmark heading', () => {
    render(<Home />);
    expect(
      screen.getByRole('heading', { level: 1, name: /meetingos/i })
    ).toBeInTheDocument();
  });
});
