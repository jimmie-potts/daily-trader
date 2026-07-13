import { writeFile } from 'node:fs/promises';

import { createOneMinuteBarEvent } from '@daily-trader/market-data';
import {
  createSignalConfiguration,
  createSignalReplayRecording,
  projectVerifiedSignalReplay,
  verifySignalReplayRecording,
} from '@daily-trader/signals';

const configuration = createSignalConfiguration({
  configurationVersion: 'phase3-synthetic-replay-v1',
  lookbackBars: 3,
  volumeMultiplier: '1.5',
  freshnessThresholdMs: 120_000,
});

/**
 * @param {'AAPL' | 'SPY'} symbol
 * @param {number} minute
 * @param {Pick<import('@daily-trader/market-data').OneMinuteBarEventInput, 'open' | 'high' | 'low' | 'close' | 'volume'>} values
 * @param {string} receivedAt
 * @returns {import('@daily-trader/market-data').OneMinuteBarEvent}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript uses the JSDoc return contract above.
function bar(symbol, minute, values, receivedAt) {
  const venue = symbol === 'AAPL' ? 'XNAS' : 'ARCX';
  const providerTimestamp = `2026-07-13T13:${String(30 + minute).padStart(2, '0')}:00Z`;
  return createOneMinuteBarEvent({
    symbol,
    venue,
    providerTimestamp,
    receivedAt,
    processedAt: receivedAt,
    ...values,
  });
}

const aapl = {
  warm0: bar(
    'AAPL',
    0,
    { open: '100', high: '101', low: '99', close: '100', volume: '200' },
    '2026-07-13T13:31:00.100Z',
  ),
  warm1: bar(
    'AAPL',
    1,
    { open: '101', high: '102', low: '100', close: '101', volume: '200' },
    '2026-07-13T13:32:00.100Z',
  ),
  warm2: bar(
    'AAPL',
    2,
    { open: '102', high: '103', low: '101', close: '102', volume: '200' },
    '2026-07-13T13:33:00.100Z',
  ),
  nonfire: bar(
    'AAPL',
    3,
    { open: '102', high: '103', low: '101', close: '102', volume: '200' },
    '2026-07-13T13:34:00.100Z',
  ),
  upward: bar(
    'AAPL',
    4,
    { open: '103', high: '105', low: '102', close: '104', volume: '300' },
    '2026-07-13T13:35:00.100Z',
  ),
  gapFill: bar(
    'AAPL',
    5,
    { open: '103', high: '104', low: '102', close: '103', volume: '200' },
    '2026-07-13T13:40:00.100Z',
  ),
  afterGap: bar(
    'AAPL',
    6,
    { open: '101', high: '103', low: '100', close: '100', volume: '350' },
    '2026-07-13T13:37:00.100Z',
  ),
  winner: bar(
    'AAPL',
    4,
    { open: '102', high: '103', low: '101', close: '102', volume: '200' },
    '2026-07-13T13:41:00.100Z',
  ),
  loser: bar(
    'AAPL',
    4,
    { open: '103', high: '104', low: '102', close: '103.5', volume: '300' },
    '2026-07-13T13:35:30.100Z',
  ),
};

const spy = {
  warm0: bar(
    'SPY',
    0,
    { open: '500', high: '501', low: '499', close: '500', volume: '100' },
    '2026-07-13T13:31:00.200Z',
  ),
  warm1: bar(
    'SPY',
    1,
    { open: '499', high: '500', low: '498', close: '499', volume: '100' },
    '2026-07-13T13:32:00.200Z',
  ),
  warm2: bar(
    'SPY',
    2,
    { open: '498', high: '499', low: '497', close: '498', volume: '100' },
    '2026-07-13T13:33:00.200Z',
  ),
  downward: bar(
    'SPY',
    3,
    { open: '497', high: '498', low: '495', close: '496', volume: '150' },
    '2026-07-13T13:34:00.200Z',
  ),
  nonfire: bar(
    'SPY',
    4,
    { open: '497', high: '499', low: '496', close: '498', volume: '100' },
    '2026-07-13T13:35:00.200Z',
  ),
};

const events = [
  aapl.warm0,
  aapl.warm1,
  aapl.warm2,
  aapl.nonfire,
  aapl.upward,
  aapl.gapFill,
  aapl.afterGap,
  aapl.winner,
  aapl.loser,
  spy.warm0,
  spy.warm1,
  spy.warm2,
  spy.downward,
  spy.nonfire,
];
const schedule = [
  aapl.warm0,
  spy.warm0,
  aapl.warm1,
  spy.warm1,
  aapl.warm2,
  aapl.warm2,
  spy.warm2,
  aapl.nonfire,
  spy.downward,
  aapl.upward,
  spy.nonfire,
  aapl.afterGap,
  aapl.gapFill,
  aapl.winner,
  aapl.loser,
].map(({ eventId }) => eventId);

const input = {
  events,
  scheduleEventIds: schedule,
  configuration,
  sourceDescription:
    'Synthetic AAPL and SPY canonical revisions for deterministic Phase 3 signal replay.',
};
const placeholder = createSignalReplayRecording({
  ...input,
  expectedOutputChecksum: '0'.repeat(64),
});
const expectedOutputChecksum = projectVerifiedSignalReplay(
  verifySignalReplayRecording(placeholder, configuration),
).output.checksum;
const recording = createSignalReplayRecording({ ...input, expectedOutputChecksum });

await writeFile(
  new URL('./recordings/synthetic-phase3-signal-session-v1.json', import.meta.url),
  recording,
  'utf8',
);
