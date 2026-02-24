import type { TaskEnvelope } from '../types/index.js';
import { hashFiles } from '../utils/hash.js';

export interface BackflowCheckResult {
  detected: boolean;
  matchedHash?: string;
  matchedHop?: number;
  message: string;
}

export function checkBackflow(envelope: TaskEnvelope, currentHash: string): BackflowCheckResult {
  const matchIndex = envelope.state_hashes.indexOf(currentHash);

  if (matchIndex >= 0) {
    return {
      detected: true,
      matchedHash: currentHash,
      matchedHop: matchIndex,
      message: `Backflow detected: current state hash matches hop ${matchIndex} — A-B-A cycle`,
    };
  }

  return {
    detected: false,
    message: `No backflow: hash ${currentHash.slice(0, 12)}… is unique across ${envelope.state_hashes.length} previous hops`,
  };
}

export function recordStateHash(envelope: TaskEnvelope, hash: string): TaskEnvelope {
  return {
    ...envelope,
    state_hashes: [...envelope.state_hashes, hash],
  };
}

export async function computeStateHash(filePaths: string[]): Promise<string> {
  return hashFiles(filePaths);
}
