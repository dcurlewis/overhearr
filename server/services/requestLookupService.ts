/**
 * requestLookupService — small, pure data-access helpers for "does THIS
 * user already have a request for this MBID?".
 *
 * Used by the search and detail routes to enrich every result row with a
 * `requestStatus` field. The shape is the wire-level `RequestStatusInfo`
 * from `src/types/api.ts` — we serialise `createdAt` to an ISO string here
 * so route handlers never have to remember to.
 *
 * No HTTP concerns live here; route handlers deal with response shape and
 * errors. This module only knows about Prisma and the user id.
 */

import { prisma } from '../db/prisma';
import type {
  RequestStatusInfo,
  RequestStatusValue,
  RequestTypeValue,
} from '../../src/types/api';

interface BatchItem {
  mbid: string;
  type: RequestTypeValue;
}

function batchKey(type: RequestTypeValue, mbid: string): string {
  return `${type}:${mbid}`;
}

/**
 * Look up a single MBID for the given user. Returns the most recent row
 * if any (a retry of a FAILED request typically bumps the same row in
 * place, but ordering by createdAt desc is the correct tie-break).
 */
export async function getRequestStatus(
  userId: number,
  mbid: string,
  type: RequestTypeValue
): Promise<RequestStatusInfo> {
  const row = await prisma.musicRequest.findFirst({
    where: { userId, mbid, type },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, type: true, createdAt: true },
  });
  if (!row) return { exists: false };
  return {
    exists: true,
    id: row.id,
    status: row.status as RequestStatusValue,
    type: row.type as RequestTypeValue,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Batched lookup. A single Prisma query fetches every relevant row, then
 * we collapse to the most-recent per (mbid,type) pair locally. Items with
 * no row map to `{exists: false}`.
 *
 * The returned Map is keyed by `${type}:${mbid}` so callers can't accidentally
 * collide ALBUM and ARTIST mbids that happen to coincide.
 */
export async function getRequestStatusBatch(
  userId: number,
  items: BatchItem[]
): Promise<Map<string, RequestStatusInfo>> {
  const result = new Map<string, RequestStatusInfo>();
  if (items.length === 0) return result;

  // Dedupe input — callers may legitimately pass duplicates (e.g. an album
  // appearing in both "top albums" and "new releases"), and we don't want
  // to bloat the OR clause.
  const seen = new Set<string>();
  const unique: BatchItem[] = [];
  for (const it of items) {
    const k = batchKey(it.type, it.mbid);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }

  // Pre-fill all keys with "not requested" so the Map is closed over the
  // input set; the DB query just upgrades hits.
  for (const it of unique) {
    result.set(batchKey(it.type, it.mbid), { exists: false });
  }

  const rows = await prisma.musicRequest.findMany({
    where: {
      userId,
      OR: unique.map((it) => ({ mbid: it.mbid, type: it.type })),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, mbid: true, status: true, type: true, createdAt: true },
  });

  // Because rows are ordered desc by createdAt, the FIRST row we see for a
  // given key is the most recent. Skip later rows.
  const filledKeys = new Set<string>();
  for (const row of rows) {
    const key = batchKey(row.type as RequestTypeValue, row.mbid);
    if (filledKeys.has(key)) continue;
    filledKeys.add(key);
    result.set(key, {
      exists: true,
      id: row.id,
      status: row.status as RequestStatusValue,
      type: row.type as RequestTypeValue,
      createdAt: row.createdAt.toISOString(),
    });
  }

  return result;
}

/** Exposed for callers that want to compute the same key shape themselves. */
export function requestStatusKey(
  type: RequestTypeValue,
  mbid: string
): string {
  return batchKey(type, mbid);
}
