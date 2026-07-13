import { createUtcTimestamp, type Clock, type UtcTimestamp } from '@daily-trader/domain';
import {
  createPortfolioRequestReceipt,
  fingerprintPortfolioSourceIdentifier,
  type PortfolioRequestReceipt,
  type PortfolioRequestResource,
} from '@daily-trader/portfolio';

import { AlpacaPaperApiError } from './errors.js';
import {
  ALPACA_PAPER_TRADING_API_BASE,
  type AlpacaFetch,
  type AlpacaFetchBody,
  type AlpacaFetchResponse,
  type AlpacaRawCapture,
  type AlpacaCaptureRequest,
  type AlpacaRawResponse,
  type AlpacaReadPath,
  type AlpacaResponseMetadata,
} from './types.js';

const DEFAULT_ORDER_PAGE_SIZE = 500;
const DEFAULT_FILL_PAGE_SIZE = 100;
const MAX_ORDER_PAGE_SIZE = 500;
const MAX_FILL_PAGE_SIZE = 100;
const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;
const DEFAULT_MAX_ORDER_PAGES = 20;
const DEFAULT_MAX_FILL_PAGES = 20;
const DEFAULT_MAX_POSITIONS = 1_000;
const DEFAULT_MAX_ORDERS = 5_000;
const DEFAULT_MAX_FILLS = 5_000;
const MAX_RESPONSE_BYTES = 16_777_216;
const MAX_PAGES = 100;
const MAX_COLLECTION_ITEMS = 50_000;
const MAX_RETRY_AFTER_MS = 86_400_000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const CONTENT_LENGTH = /^(?:0|[1-9]\d*)$/u;
// Alpaca's `after` filter is exclusive. Moving the lower created-at bound behind
// the prior exclusive cutover keeps an activity created exactly at that seam in
// the next query while immutable fill identities make the overlap idempotent.
const ACTIVITY_CREATED_AT_OVERLAP_MS = 1_000;
const MAX_CAPTURE_ATTEMPTS = 1_000;

export interface AlpacaPaperTradingClientOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly expectedAccountId: string;
  readonly fillPageSize?: number;
  readonly maxFillPages?: number;
  readonly maxFills?: number;
  readonly maxOrderPages?: number;
  readonly maxOrders?: number;
  readonly maxPositions?: number;
  readonly maxResponseBytes?: number;
  readonly orderPageSize?: number;
}

export interface AlpacaPaperTradingClientDependencies {
  readonly clock: Clock;
  readonly fetch: AlpacaFetch;
}

interface RequestEvidenceContext {
  readonly captureAttempt: number;
  readonly onRequestReceipt?: (receipt: PortfolioRequestReceipt) => Promise<void>;
  readonly pageOrdinal: number;
  readonly resource: PortfolioRequestResource;
  readonly signal?: AbortSignal;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new TypeError(`${name} must be a positive bounded integer`);
  }
  return candidate;
}

function credential(value: string, name: string): string {
  if (
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function retryAfterMilliseconds(value: string | null, now: UtcTimestamp): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/u.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds)) return undefined;
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  return Math.min(Math.max(0, instant - Date.parse(now)), MAX_RETRY_AFTER_MS);
}

async function cancelBody(response: AlpacaFetchResponse): Promise<void> {
  if (response.body === null) return;
  try {
    await response.body.getReader().cancel();
  } catch {
    // The bounded provider error remains authoritative if cancellation also fails.
  }
}

function classifyStatus(response: AlpacaFetchResponse, now: UtcTimestamp): AlpacaPaperApiError {
  const retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'), now);
  if (response.status === 401) {
    return new AlpacaPaperApiError({
      classification: 'authentication',
      code: 'ALPACA_AUTHENTICATION_REJECTED',
    });
  }
  if (response.status === 403) {
    return new AlpacaPaperApiError({
      classification: 'authorization',
      code: 'ALPACA_AUTHORIZATION_REJECTED',
    });
  }
  if (response.status === 429) {
    return new AlpacaPaperApiError({
      classification: 'rate_limited',
      code: 'ALPACA_RATE_LIMITED',
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  if (response.status >= 300 && response.status < 400) {
    return new AlpacaPaperApiError({
      classification: 'redirect_rejected',
      code: 'ALPACA_REDIRECT_REJECTED',
    });
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return new AlpacaPaperApiError({
      classification: 'invalid_request',
      code: 'ALPACA_REQUEST_REJECTED',
    });
  }
  if (response.status === 408 || response.status === 425 || response.status >= 500) {
    return new AlpacaPaperApiError({
      classification: 'retryable_transport',
      code: 'ALPACA_SERVICE_UNAVAILABLE',
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  return new AlpacaPaperApiError({
    classification: 'malformed_response',
    code: 'ALPACA_HTTP_STATUS_INVALID',
  });
}

function cancelledError(): AlpacaPaperApiError {
  return new AlpacaPaperApiError({ classification: 'cancelled', code: 'ALPACA_CANCELLED' });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function readBoundedBody(
  body: AlpacaFetchBody,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    if (isAborted(signal)) {
      await reader.cancel();
      throw cancelledError();
    }
    const chunk = await reader.read();
    if (isAborted(signal)) {
      await reader.cancel();
      throw cancelledError();
    }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new AlpacaPaperApiError({
        classification: 'resource_limit',
        code: 'ALPACA_RESPONSE_TOO_LARGE',
      });
    }
    chunks.push(chunk.value);
  }
  const complete = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    complete.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return complete;
}

function responseMetadata(
  response: AlpacaFetchResponse,
  receivedAt: UtcTimestamp,
): AlpacaResponseMetadata {
  const requestId = response.headers.get('x-request-id');
  if (requestId === null || !REQUEST_ID.test(requestId)) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_REQUEST_ID_INVALID',
    });
  }
  return Object.freeze({ receivedAt, requestId });
}

function arrayPayload(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_COLLECTION_INVALID',
    });
  }
  return Object.freeze(value);
}

function itemIdentifier(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_ITEM_INVALID',
    });
  }
  const identifier = (value as Record<string, unknown>).id;
  if (typeof identifier !== 'string' || identifier.length < 1 || identifier.length > 256) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_CURSOR_INVALID',
    });
  }
  return identifier;
}

function orderIdentifiers(value: unknown): readonly string[] {
  const identifier = itemIdentifier(value);
  const source = value as Record<string, unknown>;
  if (source.legs === null || source.legs === undefined) return Object.freeze([identifier]);
  if (!Array.isArray(source.legs)) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_ORDER_LEGS_INVALID',
    });
  }
  return Object.freeze([identifier, ...source.legs.map(itemIdentifier)]);
}

function accountIdentifier(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_ACCOUNT_INVALID',
    });
  }
  const identifier = (value as Record<string, unknown>).id;
  if (typeof identifier !== 'string' || identifier.length < 1 || identifier.length > 512) {
    throw new AlpacaPaperApiError({
      classification: 'malformed_response',
      code: 'ALPACA_ACCOUNT_ID_INVALID',
    });
  }
  return identifier;
}

/** GET-only transport for the exact Alpaca paper Trading API v2 boundary. */
export class AlpacaPaperTradingClient {
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #clock: Clock;
  readonly #expectedAccountId: string;
  readonly #fetch: AlpacaFetch;
  readonly #fillPageSize: number;
  readonly #maxFillPages: number;
  readonly #maxFills: number;
  readonly #maxOrderPages: number;
  readonly #maxOrders: number;
  readonly #maxPositions: number;
  readonly #maxResponseBytes: number;
  readonly #orderPageSize: number;

  public constructor(
    options: AlpacaPaperTradingClientOptions,
    dependencies: AlpacaPaperTradingClientDependencies,
  ) {
    this.#apiKey = credential(options.apiKey, 'apiKey');
    this.#apiSecret = credential(options.apiSecret, 'apiSecret');
    this.#expectedAccountId = credential(options.expectedAccountId, 'expectedAccountId');
    this.#clock = dependencies.clock;
    this.#fetch = dependencies.fetch;
    this.#orderPageSize = boundedPositiveInteger(
      options.orderPageSize,
      DEFAULT_ORDER_PAGE_SIZE,
      MAX_ORDER_PAGE_SIZE,
      'orderPageSize',
    );
    this.#fillPageSize = boundedPositiveInteger(
      options.fillPageSize,
      DEFAULT_FILL_PAGE_SIZE,
      MAX_FILL_PAGE_SIZE,
      'fillPageSize',
    );
    this.#maxResponseBytes = boundedPositiveInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    this.#maxOrderPages = boundedPositiveInteger(
      options.maxOrderPages,
      DEFAULT_MAX_ORDER_PAGES,
      MAX_PAGES,
      'maxOrderPages',
    );
    this.#maxFillPages = boundedPositiveInteger(
      options.maxFillPages,
      DEFAULT_MAX_FILL_PAGES,
      MAX_PAGES,
      'maxFillPages',
    );
    this.#maxPositions = boundedPositiveInteger(
      options.maxPositions,
      DEFAULT_MAX_POSITIONS,
      MAX_COLLECTION_ITEMS,
      'maxPositions',
    );
    this.#maxOrders = boundedPositiveInteger(
      options.maxOrders,
      DEFAULT_MAX_ORDERS,
      MAX_COLLECTION_ITEMS,
      'maxOrders',
    );
    this.#maxFills = boundedPositiveInteger(
      options.maxFills,
      DEFAULT_MAX_FILLS,
      MAX_COLLECTION_ITEMS,
      'maxFills',
    );
  }

  public async capture(request: AlpacaCaptureRequest): Promise<AlpacaRawCapture> {
    const captureStartedAt = this.#clock.now();
    const captureAttempt = boundedPositiveInteger(
      request.captureAttempt,
      1,
      MAX_CAPTURE_ATTEMPTS,
      'captureAttempt',
    );
    if (
      request.previousActivityCutoverAt !== null &&
      request.previousActivityCutoverAt > captureStartedAt
    ) {
      throw new AlpacaPaperApiError({
        classification: 'invalid_request',
        code: 'ALPACA_ACTIVITY_CUTOVER_INVALID',
      });
    }
    const activityWindowStartedAt = createUtcTimestamp(
      new Date(
        Date.parse(request.previousActivityCutoverAt ?? captureStartedAt) -
          ACTIVITY_CREATED_AT_OVERLAP_MS,
      ).toISOString(),
    );
    const account = await this.#get('/account', undefined, {
      captureAttempt,
      ...(request.onRequestReceipt === undefined
        ? {}
        : { onRequestReceipt: request.onRequestReceipt }),
      pageOrdinal: 0,
      resource: 'account',
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (accountIdentifier(account.payload) !== this.#expectedAccountId) {
      throw new AlpacaPaperApiError({
        classification: 'account_mismatch',
        code: 'ALPACA_ACCOUNT_MISMATCH',
      });
    }
    const { fills, orders, positions } = await this.#captureCollections({
      activityWindowStartedAt,
      activityCutoverAt: captureStartedAt,
      captureAttempt,
      ...(request.onRequestReceipt === undefined
        ? {}
        : { onRequestReceipt: request.onRequestReceipt }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return Object.freeze({
      account,
      activityBaselineOnly: request.previousActivityCutoverAt === null,
      activityCutoverAt: captureStartedAt,
      activityWindowStartedAt,
      captureStartedAt,
      captureCompletedAt: this.#clock.now(),
      fills,
      orders,
      positions,
    });
  }

  async #captureCollections(input: {
    readonly activityWindowStartedAt: UtcTimestamp;
    readonly activityCutoverAt: UtcTimestamp;
    readonly captureAttempt: number;
    readonly onRequestReceipt?: (receipt: PortfolioRequestReceipt) => Promise<void>;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly fills: readonly AlpacaRawResponse<readonly unknown[]>[];
    readonly orders: readonly AlpacaRawResponse<readonly unknown[]>[];
    readonly positions: AlpacaRawResponse<readonly unknown[]>;
  }> {
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(input.signal?.reason);
    if (input.signal?.aborted === true) abortFromParent();
    else input.signal?.addEventListener('abort', abortFromParent, { once: true });

    const guard = async <T>(operation: Promise<T>): Promise<T> => {
      try {
        return await operation;
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    };

    try {
      const evidence = {
        captureAttempt: input.captureAttempt,
        ...(input.onRequestReceipt === undefined
          ? {}
          : { onRequestReceipt: input.onRequestReceipt }),
        signal: controller.signal,
      };
      const settled = await Promise.allSettled([
        guard(
          this.#get('/positions', undefined, {
            ...evidence,
            pageOrdinal: 0,
            resource: 'positions',
          }).then((response) =>
            Object.freeze({
              ...response,
              payload: this.#boundedCollection(
                arrayPayload(response.payload),
                this.#maxPositions,
                'ALPACA_POSITION_LIMIT_EXCEEDED',
              ),
            }),
          ),
        ),
        guard(this.#orders(evidence)),
        guard(this.#fills(input.activityWindowStartedAt, input.activityCutoverAt, evidence)),
      ]);
      if (settled.some((result) => result.status === 'rejected')) {
        throw controller.signal.reason;
      }
      const [positions, orders, fills] = settled;
      if (
        positions.status !== 'fulfilled' ||
        orders.status !== 'fulfilled' ||
        fills.status !== 'fulfilled'
      ) {
        throw new TypeError('unreachable portfolio resource settlement');
      }
      return Object.freeze({
        positions: positions.value,
        orders: orders.value,
        fills: fills.value,
      });
    } finally {
      input.signal?.removeEventListener('abort', abortFromParent);
    }
  }

  async #orders(
    evidence: Omit<RequestEvidenceContext, 'pageOrdinal' | 'resource'>,
  ): Promise<readonly AlpacaRawResponse<readonly unknown[]>[]> {
    const pages: AlpacaRawResponse<readonly unknown[]>[] = [];
    const identifiers = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < this.#maxOrderPages; page += 1) {
      const query = new URLSearchParams({
        direction: 'asc',
        limit: String(this.#orderPageSize),
        nested: 'true',
        status: 'all',
      });
      if (cursor !== undefined) query.set('after_order_id', cursor);
      const response = await this.#get('/orders', query, {
        ...evidence,
        pageOrdinal: page,
        resource: 'orders',
      });
      const payload = arrayPayload(response.payload);
      if (payload.length > this.#orderPageSize) {
        throw new AlpacaPaperApiError({
          classification: 'malformed_response',
          code: 'ALPACA_ORDER_PAGE_INVALID',
        });
      }
      for (const item of payload) {
        for (const identifier of orderIdentifiers(item)) {
          if (identifiers.has(identifier)) {
            throw new AlpacaPaperApiError({
              classification: 'malformed_response',
              code: 'ALPACA_ORDER_DUPLICATED',
            });
          }
          identifiers.add(identifier);
        }
      }
      if (identifiers.size > this.#maxOrders) {
        throw new AlpacaPaperApiError({
          classification: 'resource_limit',
          code: 'ALPACA_ORDER_LIMIT_EXCEEDED',
        });
      }
      pages.push(Object.freeze({ ...response, payload }));
      if (payload.length < this.#orderPageSize) return Object.freeze(pages);
      cursor = itemIdentifier(payload.at(-1));
    }
    throw new AlpacaPaperApiError({
      classification: 'resource_limit',
      code: 'ALPACA_ORDER_PAGE_LIMIT_EXCEEDED',
    });
  }

  async #fills(
    activityWindowStartedAt: UtcTimestamp,
    activityCutoverAt: UtcTimestamp,
    evidence: Omit<RequestEvidenceContext, 'pageOrdinal' | 'resource'>,
  ): Promise<readonly AlpacaRawResponse<readonly unknown[]>[]> {
    const pages: AlpacaRawResponse<readonly unknown[]>[] = [];
    const identifiers = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < this.#maxFillPages; page += 1) {
      const query = new URLSearchParams({
        after: activityWindowStartedAt,
        direction: 'asc',
        page_size: String(this.#fillPageSize),
        until: activityCutoverAt,
      });
      if (cursor !== undefined) query.set('page_token', cursor);
      const response = await this.#get('/account/activities/FILL', query, {
        ...evidence,
        pageOrdinal: page,
        resource: 'fills',
      });
      const payload = arrayPayload(response.payload);
      if (payload.length > this.#fillPageSize) {
        throw new AlpacaPaperApiError({
          classification: 'malformed_response',
          code: 'ALPACA_FILL_PAGE_INVALID',
        });
      }
      for (const item of payload) {
        const identifier = itemIdentifier(item);
        if (identifiers.has(identifier)) {
          throw new AlpacaPaperApiError({
            classification: 'malformed_response',
            code: 'ALPACA_FILL_DUPLICATED',
          });
        }
        identifiers.add(identifier);
      }
      if (identifiers.size > this.#maxFills) {
        throw new AlpacaPaperApiError({
          classification: 'resource_limit',
          code: 'ALPACA_FILL_LIMIT_EXCEEDED',
        });
      }
      pages.push(Object.freeze({ ...response, payload }));
      if (payload.length < this.#fillPageSize) return Object.freeze(pages);
      cursor = itemIdentifier(payload.at(-1));
    }
    throw new AlpacaPaperApiError({
      classification: 'resource_limit',
      code: 'ALPACA_FILL_PAGE_LIMIT_EXCEEDED',
    });
  }

  async #get(
    path: AlpacaReadPath,
    query: URLSearchParams | undefined,
    evidence: RequestEvidenceContext,
  ): Promise<AlpacaRawResponse<unknown>> {
    const { signal } = evidence;
    if (isAborted(signal)) throw cancelledError();
    const url = new URL(`${ALPACA_PAPER_TRADING_API_BASE}${path}`);
    if (query !== undefined) url.search = query.toString();
    let response: AlpacaFetchResponse;
    try {
      response = await this.#fetch(url.href, {
        headers: {
          Accept: 'application/json',
          'APCA-API-KEY-ID': this.#apiKey,
          'APCA-API-SECRET-KEY': this.#apiSecret,
        },
        method: 'GET',
        redirect: 'manual',
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new AlpacaPaperApiError({
        classification: isAborted(signal) ? 'cancelled' : 'retryable_transport',
        code: isAborted(signal) ? 'ALPACA_CANCELLED' : 'ALPACA_TRANSPORT_FAILED',
      });
    }
    if (isAborted(signal)) {
      await cancelBody(response);
      throw cancelledError();
    }
    if (response.status !== 200) {
      await cancelBody(response);
      throw classifyStatus(response, this.#clock.now());
    }
    if (response.body === null) {
      throw new AlpacaPaperApiError({
        classification: 'malformed_response',
        code: 'ALPACA_RESPONSE_BODY_MISSING',
      });
    }
    const contentType = response.headers.get('content-type');
    if (contentType === null || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
      await cancelBody(response);
      throw new AlpacaPaperApiError({
        classification: 'malformed_response',
        code: 'ALPACA_CONTENT_TYPE_INVALID',
      });
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      if (
        !CONTENT_LENGTH.test(declaredLength) ||
        BigInt(declaredLength) > BigInt(this.#maxResponseBytes)
      ) {
        await cancelBody(response);
        throw new AlpacaPaperApiError({
          classification: 'resource_limit',
          code: 'ALPACA_RESPONSE_TOO_LARGE',
        });
      }
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(response.body, this.#maxResponseBytes, signal);
    } catch (error) {
      if (error instanceof AlpacaPaperApiError) throw error;
      throw new AlpacaPaperApiError({
        classification: isAborted(signal) ? 'cancelled' : 'retryable_transport',
        code: isAborted(signal) ? 'ALPACA_CANCELLED' : 'ALPACA_BODY_READ_FAILED',
      });
    }
    const metadata = responseMetadata(response, this.#clock.now());
    await evidence.onRequestReceipt?.(
      createPortfolioRequestReceipt({
        requestFingerprint: fingerprintPortfolioSourceIdentifier('request', metadata.requestId),
        resource: evidence.resource,
        captureAttempt: evidence.captureAttempt,
        pageOrdinal: evidence.pageOrdinal,
        receivedAt: metadata.receivedAt,
        responseStatus: response.status,
      }),
    );
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new AlpacaPaperApiError({
        classification: 'malformed_response',
        code: 'ALPACA_JSON_INVALID',
      });
    }
    return Object.freeze({
      metadata,
      payload,
    });
  }

  #boundedCollection(
    values: readonly unknown[],
    maximum: number,
    code: string,
  ): readonly unknown[] {
    if (values.length > maximum) {
      throw new AlpacaPaperApiError({ classification: 'resource_limit', code });
    }
    return values;
  }
}
