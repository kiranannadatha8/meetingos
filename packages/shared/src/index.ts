export const SERVICES = ['web', 'bff', 'orchestrator'] as const;

export type Service = (typeof SERVICES)[number];

export interface HealthResponse {
  service: Service;
  status: 'ok' | 'degraded' | 'error';
}
