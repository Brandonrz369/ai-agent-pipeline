import type { TaskEnvelope } from '../types/index.js';

export interface TTLCheckResult {
  expired: boolean;
  hopsRemaining: number;
  message: string;
}

export function checkTTL(envelope: TaskEnvelope): TTLCheckResult {
  const expired = envelope.hops >= envelope.ttl_max;
  const hopsRemaining = Math.max(0, envelope.ttl_max - envelope.hops);

  return {
    expired,
    hopsRemaining,
    message: expired
      ? `TTL expired: ${envelope.hops}/${envelope.ttl_max} hops used — sending to dead-letter`
      : `TTL OK: ${envelope.hops}/${envelope.ttl_max} hops used (${hopsRemaining} remaining)`,
  };
}

export function incrementHop(envelope: TaskEnvelope): TaskEnvelope {
  return {
    ...envelope,
    hops: envelope.hops + 1,
    last_hop_at: new Date().toISOString(),
  };
}
