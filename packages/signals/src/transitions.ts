import { SIGNAL_TRANSITION_SCHEMA_VERSION } from './configuration.js';
import type { SignalEvaluation, SignalEvaluationTransition } from './contracts.js';
import { SignalError } from './errors.js';
import { requireIdentifier, requireSha256 } from './identity.js';
import { signalTransitionIdentity } from './serialization.js';

export interface CreateSignalTransitionInput {
  readonly signalRunId: unknown;
  readonly triggeringRevisionId: unknown;
  readonly processingPosition: unknown;
  readonly current: SignalEvaluation;
  readonly predecessor?: SignalEvaluation;
}

function occurrenceId(evaluation: SignalEvaluation): string | undefined {
  return evaluation.outcome === 'fired' ? evaluation.occurrence.occurrenceId : undefined;
}

/** Creates run-scoped supersession history without changing global evaluation identity. */
export function createSignalTransition(
  input: CreateSignalTransitionInput,
): SignalEvaluationTransition {
  const signalRunId = requireIdentifier(input.signalRunId);
  const triggeringRevisionId = requireSha256(input.triggeringRevisionId);
  if (
    typeof input.processingPosition !== 'string' ||
    !/^(?:0|[1-9]\d*)$/u.test(input.processingPosition)
  ) {
    throw new SignalError('transition_invalid');
  }
  const predecessor = input.predecessor;
  if (predecessor?.evaluationId === input.current.evaluationId) {
    throw new SignalError('transition_invalid');
  }
  const retractedOccurrenceId =
    predecessor?.outcome === 'fired' && input.current.outcome !== 'fired'
      ? predecessor.occurrence.occurrenceId
      : undefined;
  const kind =
    predecessor === undefined
      ? ('initial' as const)
      : retractedOccurrenceId === undefined
        ? ('supersession' as const)
        : ('retraction' as const);
  const currentOccurrenceId = occurrenceId(input.current);
  const withoutIdentity = {
    schemaVersion: SIGNAL_TRANSITION_SCHEMA_VERSION,
    kind,
    signalRunId,
    triggeringRevisionId,
    processingPosition: input.processingPosition,
    currentEvaluationId: input.current.evaluationId,
    ...(predecessor === undefined ? {} : { predecessorEvaluationId: predecessor.evaluationId }),
    ...(currentOccurrenceId === undefined ? {} : { currentOccurrenceId }),
    ...(retractedOccurrenceId === undefined ? {} : { retractedOccurrenceId }),
    latestRevisionState:
      kind === 'initial'
        ? ('current' as const)
        : kind === 'retraction'
          ? ('retracted' as const)
          : ('superseded' as const),
  };
  const provisional = { ...withoutIdentity, transitionId: '' } as SignalEvaluationTransition;
  return Object.freeze({
    ...withoutIdentity,
    transitionId: signalTransitionIdentity(provisional),
  });
}
