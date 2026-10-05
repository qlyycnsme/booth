import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import Redis from "ioredis";

const MEMBER_TTL_MS = Number(process.env.MEMBER_CACHE_MS || 60_000);
const RATE_WINDOW_MS = 3_000;
const RATE_MAX = 5;

/** @type {Map<string, { ok: boolean; until: number }>} */
const memberCache = new Map();
/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

export function memberKey(clubId, address) {
  return `${clubId}:${String(address).toLowerCase()}`;
}

export function getCachedMember(clubId, address) {
  const hit = memberCache.get(memberKey(clubId, address));
  if (!hit) return null;
  if (Date.now() > hit.until) {
    memberCache.delete(memberKey(clubId, address));
    return null;
  }
  return hit.ok;
}

export function setCachedMember(clubId, address, ok, expiresAtSec = 0) {
  const chainMs = expiresAtSec > 0 ? expiresAtSec * 1000 : Date.now() + MEMBER_TTL_MS;
  const until = Math.min(Date.now() + MEMBER_TTL_MS, chainMs);
  memberCache.set(memberKey(clubId, address), { ok, until });
}

export function clearCachedMember(clubId, address) {
  memberCache.delete(memberKey(clubId, address));
}

export function allowMessage(address) {
  const key = String(address).toLowerCase();
  const now = Date.now();
  const prev = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    rateBuckets.set(key, prev);
    return false;
  }
  prev.push(now);
  rateBuckets.set(key, prev);
  return true;
}

function jsonlPath(dataDir, clubId) {
  return join(dataDir, `${clubId}.jsonl`);
}

function legacyPath(dataDir, clubId) {
  return join(dataDir, `${clubId}.json`);
}

export async function loadHistory(dataDir, history, clubId, maxHistory) {
  if (history.has(clubId)) return history.get(clubId);

  let msgs = [];
  try {
    const raw = await readFile(jsonlPath(dataDir, clubId), "utf8");
    msgs = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    try {
      const legacy = JSON.parse(await readFile(legacyPath(dataDir, clubId), "utf8"));
      msgs = Array.isArray(legacy) ? legacy : [];
    } catch {
      msgs = [];
    }
  }

  msgs = msgs.slice(-maxHistory);
  history.set(clubId, msgs);
  return msgs;
}

/** @type {Map<string, number>} */
const appendCounts = new Map();

export async function appendHistory(dataDir, history, clubId, msg, maxHistory) {
  await mkdir(dataDir, { recursive: true });
  const list = history.get(clubId) || [];
  list.push(msg);
  const trimmed = list.slice(-maxHistory);
  history.set(clubId, trimmed);
  await appendFile(jsonlPath(dataDir, clubId), `${JSON.stringify(msg)}\n`);

  const n = (appendCounts.get(clubId) || 0) + 1;
  appendCounts.set(clubId, n);
  if (n >= maxHistory) {
    appendCounts.set(clubId, 0);
    const tmp = `${jsonlPath(dataDir, clubId)}.tmp`;
    await writeFile(tmp, `${trimmed.map((m) => JSON.stringify(m)).join("\n")}\n`);
    await rename(tmp, jsonlPath(dataDir, clubId));
  }
}

/**
 * Cross-process chat bus. Uses Redis pub/sub when REDIS_URL is set;
 * otherwise an in-process EventEmitter (single instance only).
 */
export async function createBus(channelPrefix = "booth:chat") {
  const url = process.env.REDIS_URL || "";
  const local = new EventEmitter();
  local.setMaxListeners(0);

  /** @type {((clubId: string, payload: object) => void) | null} */
  let handler = null;

  const deliver = (body) => {
    try {
      const { clubId, payload } = JSON.parse(body);
      handler?.(clubId, payload);
    } catch {
      /* ignore */
    }
  };

  const api = {
    mode: "memory",
    onMessage(fn) {
      handler = fn;
    },
    async publish(clubId, payload) {
      const body = JSON.stringify({ clubId: String(clubId), payload });
      if (api.mode === "memory") {
        local.emit("msg", body);
        return;
      }
      await pub.publish(`${channelPrefix}:room`, body);
    },
    async close() {
      if (pub) await pub.quit().catch(() => {});
      if (sub) await sub.quit().catch(() => {});
    },
  };

  let pub = null;
  let sub = null;

  local.on("msg", deliver);

  if (!url) return api;

  try {
    pub = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true, enableOfflineQueue: false });
    sub = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true, enableOfflineQueue: false });
    await pub.connect();
    await sub.connect();
    await sub.subscribe(`${channelPrefix}:room`);
    sub.on("message", (_ch, body) => deliver(body));
    api.mode = "redis";
    return api;
  } catch (err) {
    console.warn("[booth] Redis unavailable, falling back to memory bus:", err?.message || err);
    try {
      await pub?.quit();
      await sub?.quit();
    } catch {
      /* ignore */
    }
    pub = null;
    sub = null;
    api.mode = "memory";
    return api;
  }
}
