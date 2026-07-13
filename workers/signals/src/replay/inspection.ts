import type { ReplayObservation, ReplayObservationInspection } from './postgres-port.js';

const REPLAY_SCOPE = Object.freeze([
  Object.freeze({ symbol: 'AAPL', venue: 'XNAS' }),
  Object.freeze({ symbol: 'SPY', venue: 'ARCX' }),
]);

function appendIfPresent(lines: string[], label: string, current: string | number | null): void {
  if (current !== null) lines.push(`${label}: ${String(current)}`);
}

function appendReadyEvidence(lines: string[], observation: ReplayObservation): void {
  appendIfPresent(lines, 'close USD/share', observation.closePrice);
  appendIfPresent(lines, 'current volume shares', observation.currentVolume);
  appendIfPresent(lines, 'prior high USD/share', observation.priorHigh);
  appendIfPresent(lines, 'prior low USD/share', observation.priorLow);
  appendIfPresent(lines, 'breakout reference USD/share', observation.breakoutReference);
  appendIfPresent(lines, 'prior volume sum shares', observation.priorVolumeSum);
  appendIfPresent(lines, 'prior volume count', observation.priorCount);
  appendIfPresent(lines, 'volume multiplier', observation.volumeMultiplier);
  appendIfPresent(lines, 'window start', observation.windowStart);
  appendIfPresent(lines, 'window end', observation.windowEnd);
}

function appendObservation(lines: string[], observation: ReplayObservation, title: string): void {
  lines.push(
    '',
    title,
    `definition version: ${observation.definitionVersion}`,
    `configuration version: ${observation.configurationVersion}`,
    `configuration hash: ${observation.configurationHash}`,
    `outcome: ${observation.outcome}`,
    `reason: ${observation.reason}`,
    `evaluation bar: ${observation.evaluationBarStart}`,
    `observation as of: ${observation.observationAsOf}`,
    `knowledge as of: ${observation.knowledgeAsOf}`,
    `mode: ${observation.mode}`,
    `source: ${observation.sourceProvider}/${observation.sourceFeed}/${observation.sourceEntitlement} single-exchange evidence`,
  );
  appendReadyEvidence(lines, observation);
  if (observation.outcome === 'fired') {
    appendIfPresent(lines, 'direction', observation.direction);
    appendIfPresent(lines, 'invalidation', observation.invalidationCondition);
  }
}

export function renderReplayInspection(inspection: ReplayObservationInspection): string {
  const lines = [
    'REPLAY SIGNAL OBSERVATIONS — synthetic evidence, not recommendations or position actions',
    `REPLAY TARGET ${inspection.target.targetId}`,
    `state: ${inspection.target.state}`,
    `cursor: ${inspection.target.cursor}/${String(inspection.target.expectedCount)}`,
    `output checksum: ${inspection.target.outputChecksum ?? 'not completed'}`,
  ];
  if (inspection.target.failureCode !== null) {
    lines.push(`failure: ${inspection.target.failureCode}`);
  }

  const present = new Set(
    inspection.latest.map((observation) => `${observation.symbol}/${observation.venue}`),
  );
  for (const instrument of REPLAY_SCOPE) {
    if (!present.has(`${instrument.symbol}/${instrument.venue}`)) {
      lines.push(
        '',
        `${instrument.symbol}/${instrument.venue} replay observation: warming-up or missing`,
      );
    }
  }
  for (const observation of inspection.latest) {
    appendObservation(
      lines,
      observation,
      `${observation.symbol}/${observation.venue} latest replay observation — IEX single-exchange evidence`,
    );
  }
  for (const occurrence of inspection.latestValidFired) {
    appendObservation(
      lines,
      occurrence,
      `${occurrence.symbol}/${occurrence.venue} latest valid historical fired replay observation — IEX single-exchange evidence`,
    );
  }
  return `${lines.join('\n')}\n`;
}
