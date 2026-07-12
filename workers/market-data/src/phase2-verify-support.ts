import { createHash } from 'node:crypto';

export const PHASE2_VERIFICATION_STATE_VERSION = 'daily-trader.phase2.verify-state.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/u;

export interface Phase2VerificationState {
  readonly version: typeof PHASE2_VERIFICATION_STATE_VERSION;
  readonly recordingBytesSha256: string;
  readonly recordingChecksum: string;
  readonly eventCount: number;
  readonly eventIds: readonly string[];
  readonly statusSha256: string;
}

export type Phase2VerificationErrorCode =
  | 'PHASE2_VERIFY_CLEANUP_FAILED'
  | 'PHASE2_VERIFY_CONFIGURATION_INVALID'
  | 'PHASE2_VERIFY_CONSUMER_FAILED'
  | 'PHASE2_VERIFY_PERSISTENCE_FAILED'
  | 'PHASE2_VERIFY_RECORDING_INVALID'
  | 'PHASE2_VERIFY_REDIS_FAILED'
  | 'PHASE2_VERIFY_REPLAY_FAILED'
  | 'PHASE2_VERIFY_STATE_INVALID'
  | 'PHASE2_VERIFY_TIMED_OUT'
  | 'PHASE2_VERIFY_UNKNOWN_FAILED'
  | 'PHASE2_VERIFY_VERIFICATION_MISMATCH';

export class Phase2VerificationError extends Error {
  public readonly code: Phase2VerificationErrorCode;

  public constructor(code: Phase2VerificationErrorCode) {
    super(`Phase 2 verification failed: ${code}`);
    this.name = 'Phase2VerificationError';
    this.code = code;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createPhase2VerificationState(input: {
  readonly exportedRecording: string;
  readonly recordingChecksum: string;
  readonly eventIds: readonly string[];
  readonly terminalStatus: string;
}): Phase2VerificationState {
  if (
    !SHA256.test(input.recordingChecksum) ||
    input.eventIds.length === 0 ||
    input.eventIds.some((eventId) => !SHA256.test(eventId)) ||
    new Set(input.eventIds).size !== input.eventIds.length
  ) {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
  return Object.freeze({
    version: PHASE2_VERIFICATION_STATE_VERSION,
    recordingBytesSha256: sha256(input.exportedRecording),
    recordingChecksum: input.recordingChecksum,
    eventCount: input.eventIds.length,
    eventIds: Object.freeze([...input.eventIds]),
    statusSha256: sha256(input.terminalStatus),
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
  return value as Readonly<Record<string, unknown>>;
}

export function parsePhase2VerificationState(serialized: string): Phase2VerificationState {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
  const state = record(decoded);
  if (
    Object.keys(state).length !== 6 ||
    state.version !== PHASE2_VERIFICATION_STATE_VERSION ||
    typeof state.recordingBytesSha256 !== 'string' ||
    !SHA256.test(state.recordingBytesSha256) ||
    typeof state.recordingChecksum !== 'string' ||
    !SHA256.test(state.recordingChecksum) ||
    typeof state.eventCount !== 'number' ||
    !Number.isSafeInteger(state.eventCount) ||
    state.eventCount < 1 ||
    !Array.isArray(state.eventIds) ||
    state.eventIds.length !== state.eventCount ||
    typeof state.statusSha256 !== 'string' ||
    !SHA256.test(state.statusSha256)
  ) {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
  const eventIds: string[] = [];
  for (const eventId of state.eventIds as unknown[]) {
    if (typeof eventId !== 'string' || !SHA256.test(eventId)) {
      throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
    }
    eventIds.push(eventId);
  }
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
  return Object.freeze({
    version: PHASE2_VERIFICATION_STATE_VERSION,
    recordingBytesSha256: state.recordingBytesSha256,
    recordingChecksum: state.recordingChecksum,
    eventCount: state.eventCount,
    eventIds: Object.freeze(eventIds),
    statusSha256: state.statusSha256,
  });
}

export function assertPhase2VerificationStateEqual(
  expected: Phase2VerificationState,
  actual: Phase2VerificationState,
): void {
  if (
    expected.recordingBytesSha256 !== actual.recordingBytesSha256 ||
    expected.recordingChecksum !== actual.recordingChecksum ||
    expected.eventCount !== actual.eventCount ||
    expected.statusSha256 !== actual.statusSha256 ||
    expected.eventIds.length !== actual.eventIds.length ||
    expected.eventIds.some((eventId, index) => eventId !== actual.eventIds[index])
  ) {
    throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
  }
}

export function serializePhase2VerificationState(state: Phase2VerificationState): string {
  return `${JSON.stringify(state)}\n`;
}
