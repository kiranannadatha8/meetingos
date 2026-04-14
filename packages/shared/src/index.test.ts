import { describe, it, expect, expectTypeOf } from 'vitest';
import type { HealthResponse, Service } from './index.js';
import { SERVICES } from './index.js';

describe('shared types', () => {
  it('exposes the three service names', () => {
    expect(SERVICES).toEqual(['web', 'bff', 'orchestrator']);
  });

  it('HealthResponse has service + status', () => {
    const sample: HealthResponse = { service: 'bff', status: 'ok' };
    expectTypeOf(sample).toEqualTypeOf<HealthResponse>();
    expectTypeOf(sample.service).toEqualTypeOf<Service>();
  });
});
