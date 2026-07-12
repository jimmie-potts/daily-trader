import { describe, expect, it } from 'vitest';

import {
  Phase2VerificationError,
  assertPhase2VerificationStateEqual,
  createPhase2VerificationState,
  parsePhase2VerificationState,
  serializePhase2VerificationState,
} from './phase2-verify-support.js';

const eventIds = ['1'.repeat(64), '2'.repeat(64)];

describe('Phase 2 verification state', () => {
  it('round-trips a small deterministic state file', () => {
    const state = createPhase2VerificationState({
      exportedRecording: 'deterministic-recording-bytes\n',
      recordingChecksum: 'a'.repeat(64),
      eventIds,
      terminalStatus: 'MARKET STATUS\nfixed',
    });
    const decoded = parsePhase2VerificationState(serializePhase2VerificationState(state));

    expect(decoded).toEqual(state);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.eventIds)).toBe(true);
    expect(() => assertPhase2VerificationStateEqual(state, decoded)).not.toThrow();
  });

  it('rejects corrupt state and any restart mismatch with a fixed safe code', () => {
    expect(() => parsePhase2VerificationState('{"eventIds":[]}')).toThrowError(
      new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID'),
    );
    const initial = createPhase2VerificationState({
      exportedRecording: 'initial',
      recordingChecksum: 'a'.repeat(64),
      eventIds,
      terminalStatus: 'status',
    });
    const changed = createPhase2VerificationState({
      exportedRecording: 'changed',
      recordingChecksum: 'a'.repeat(64),
      eventIds,
      terminalStatus: 'status',
    });

    expect(() => assertPhase2VerificationStateEqual(initial, changed)).toThrowError(
      new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH'),
    );
  });
});
