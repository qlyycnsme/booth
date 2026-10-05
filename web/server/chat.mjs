import { createServer } from "node:http";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createPublicClient, http, parseAbiItem, recoverMessageAddress } from "viem";
import {
  allowMessage,
  appendHistory,
  createBus,
  getCachedMember,
  loadHistory as loadHistoryStore,
  setCachedMember,
} from "./scale.mjs";

const PORT = Number(process.env.CHAT_PORT || 8787);
const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.io";
const CLUB = process.env.BOOTH_CLUB || "0x0a7038198fEf3B8fB6825A732DACE28Df0B7d527";
const MAX_HISTORY = 100;
const MAX_TEXT = 500;
const MAX_NAME = 40;
const MAX_BIO = 200;
const MAX_NICK = 24;
const MAX_AVATAR = 200 * 1024;
const MUTE_MS = 3 * 24 * 60 * 60 * 1000;

const clubsAbi = [
  {
    type: "function",
    name: "clubs",
    stateMutability: "view",
    inputs: [{ name: "clubId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "monthlyPrice", type: "uint96" },
      { name: "periodStart", type: "uint40" },
      { name: "createUnlockAt", type: "uint40" },
      { name: "epoch", type: "uint32" },
      { name: "memberCount", type: "uint32" },
      { name: "stakerCount", type: "uint32" },
      { name: "feePool", type: "uint128" },
      { name: "createStake", type: "uint128" },
      { name: "active", type: "bool" },
    ],
  },
];

const membershipAbi = [
  {
    type: "function",
    name: "memberships",
    stateMutability: "view",
    inputs: [
      { name: "clubId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "paid", type: "uint128" },
      { name: "joinedAt", type: "uint40" },
      { name: "expiresAt", type: "uint40" },
    ],
  },
];

const vaultAbi = [
  {
    type: "function",
    name: "stakersOf",
    stateMutability: "view",
    inputs: [{ name: "clubId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "minVaultStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingWeight",
    stateMutability: "view",
    inputs: [
      { name: "clubId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "vaults",
    stateMutability: "view",
    inputs: [
      { name: "clubId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint128" },
      { name: "lockUntil", type: "uint40" },
      { name: "lastAccrue", type: "uint40" },
      { name: "epoch", type: "uint32" },
      { name: "listIndex", type: "uint32" },
      { name: "weight", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "servedEpoch",
    stateMutability: "view",
    inputs: [
      { name: "clubId", type: "uint256" },
      { name: "epoch", type: "uint32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "nextClubId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const joinedEvent = parseAbiItem(
  "event Joined(uint256 indexed clubId, address indexed user, uint256 paid, uint40 expiresAt)",
);
const settledEvent = parseAbiItem(
  "event Settled(uint256 indexed clubId, address indexed user, uint256 used, uint256 refund, uint256 opsFee, uint256 toPool)",
);

const client = createPublicClient({ transport: http(RPC) });
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "data");
const rooms = new Map();
const history = new Map();
const staffCache = new Map();
const bus = await createBus();

bus.onMessage((clubId, payload) => {
  for (const peer of rooms.get(String(clubId)) || []) {
    send(peer, payload);
  }
});

function signBody(clubId, nonce) {
  return `Booth chat\nclub: ${clubId}\nnonce: ${nonce}`;
}

function metaSignBody(clubId, nonce) {
  return `Booth meta\nclub: ${clubId}\nnonce: ${nonce}`;
}

function muteSignBody(clubId, target, nonce) {
  return `Booth mute\nclub: ${clubId}\nuser: ${target}\nnonce: ${nonce}`;
}

function profileSignBody(nonce) {
  return `Booth profile\nnonce: ${nonce}`;
}

function twitterSignBody(addr, nonce, tweetUrl) {
  return `Booth twitter\naddr: ${addr.toLowerCase()}\nnonce: ${nonce}\nurl: ${tweetUrl}`;
}

function twitterProof(addr) {
  return `booth:${addr.toLowerCase()}`;
}

const metaFile = join(dataDir, "meta.json");
let metaCache = null;
const muteFile = join(dataDir, "mutes.json");
let muteCache = null;
const profileFile = join(dataDir, "profiles.json");
const avatarDir = join(dataDir, "avatars");
let profileCache = null;

async function loadMeta() {
  if (metaCache) return metaCache;
  try {
    metaCache = JSON.parse(await readFile(metaFile, "utf8"));
  } catch {
    metaCache = {};
  }
  return metaCache;
}

async function saveMeta() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(metaFile, JSON.stringify(metaCache || {}, null, 2));
}

async function loadMutes() {
  if (muteCache) return muteCache;
  try {
    muteCache = JSON.parse(await readFile(muteFile, "utf8"));
  } catch {
    muteCache = {};
  }
  return muteCache;
}

async function saveMutes() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(muteFile, JSON.stringify(muteCache || {}, null, 2));
}

async function loadProfiles() {
  if (profileCache) return profileCache;
  try {
    profileCache = JSON.parse(await readFile(profileFile, "utf8"));
  } catch {
    profileCache = {};
  }
  return profileCache;
}

async function saveProfiles() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(profileFile, JSON.stringify(profileCache || {}, null, 2));
}

function publicProfile(addr, row) {
  if (!row) return { name: "", bio: "", avatar: "", twitter: "" };
  return {
    name: row.name || "",
    bio: row.bio || "",
    avatar: row.mime ? `/avatar/${addr}` : "",
    twitter: row.twitter || "",
  };
}

function parseAvatar(dataUrl) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new Error("avatar must be jpeg/png/webp/gif");
  const buf = Buffer.from(m[3].replace(/\s/g, ""), "base64");
  if (!buf.length) throw new Error("empty avatar");
  if (buf.length > MAX_AVATAR) throw new Error("avatar too large");
  return { mime: m[1], buf };
}

function normalizeTweetUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("invalid tweet url");
  }
  if (!["twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com"].includes(u.hostname)) {
    throw new Error("url must be x.com / twitter.com");
  }
  const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
  if (!m) throw new Error("url must point to a tweet");
  return { id: m[1], url: `https://x.com/i/status/${m[1]}` };
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchTweet(statusId) {
  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${statusId}`, {
      headers: { "user-agent": "Booth/0.1" },
    });
    if (res.ok) {
      const data = await res.json();
      const tweet = data.tweet || data;
      const text = tweet.text || tweet.full_text || "";
      const handle = tweet.author?.screen_name || tweet.user?.screen_name || data.user_screen_name || "";
      if (text && handle) return { text, handle: String(handle).replace(/^@/, "") };
    }
  } catch {
    /* try oEmbed */
  }
  const oembed = await fetch(
    `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(`https://x.com/i/status/${statusId}`)}`,
    { headers: { "user-agent": "Booth/0.1" } },
  );
  if (!oembed.ok) throw new Error("cannot read tweet");
  const data = await oembed.json();
  const handle = String(data.author_url || "")
    .split("/")
    .filter(Boolean)
    .pop();
  const text = stripHtml(data.html);
  if (!text || !handle) throw new Error("cannot parse tweet");
  return { text, handle };
}

function mutedUntilOf(clubMutes, address) {
  const until = Number(clubMutes?.[String(address).toLowerCase()] || 0);
  return until > Date.now() ? until : 0;
}

async function liveStaff(clubId) {
  const hit = staffCache.get(clubId);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const club = await client.readContract({
    address: CLUB,
    abi: clubsAbi,
    functionName: "clubs",
    args: [BigInt(clubId)],
  });
  const owner = club[0];
  const epoch = club[4];
  const minStake = await client.readContract({
    address: CLUB,
    abi: vaultAbi,
    functionName: "minVaultStake",
  });
  const list = await client.readContract({
    address: CLUB,
    abi: vaultAbi,
    functionName: "stakersOf",
    args: [BigInt(clubId)],
  });
  const ranked = [];
  await Promise.all(
    list.map(async (user) => {
      if (user.toLowerCase() === owner.toLowerCase()) return;
      const [vault, served, weight] = await Promise.all([
        client.readContract({
          address: CLUB,
          abi: vaultAbi,
          functionName: "vaults",
          args: [BigInt(clubId), user],
        }),
        client.readContract({
          address: CLUB,
          abi: vaultAbi,
          functionName: "servedEpoch",
          args: [BigInt(clubId), epoch, user],
        }),
        client.readContract({
          address: CLUB,
          abi: vaultAbi,
          functionName: "pendingWeight",
          args: [BigInt(clubId), user],
        }),
      ]);
      if (vault[0] < minStake || !served || weight === 0n) return;
      ranked.push({ user, weight });
    }),
  );
  ranked.sort((a, b) => (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1));
  const row = { at: Date.now(), owner, top5: ranked.slice(0, 5).map((x) => x.user) };
  staffCache.set(clubId, row);
  return row;
}

function isStaff(staff, address) {
  const a = address.toLowerCase();
  return staff.owner.toLowerCase() === a || staff.top5.some((x) => x.toLowerCase() === a);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function isMember(clubId, address) {
  const cached = getCachedMember(clubId, address);
  if (cached !== null) return cached;
  const [paid, , expiresAt] = await client.readContract({
    address: CLUB,
    abi: membershipAbi,
    functionName: "memberships",
    args: [BigInt(clubId), address],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ok = paid > 0n && BigInt(expiresAt) > now;
  setCachedMember(clubId, address, ok, Number(expiresAt));
  return ok;
}

async function loadHistory(clubId) {
  return loadHistoryStore(dataDir, history, clubId, MAX_HISTORY);
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function daySeed(day) {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyWeights(day) {
  const rnd = mulberry32(daySeed(day));
  const raw = {
    stake: 0.22 + rnd() * 0.22,
    join: 0.18 + rnd() * 0.22,
    leave: 0.1 + rnd() * 0.16,
    activity: 0.18 + rnd() * 0.26,
  };
  const sum = raw.stake + raw.join + raw.leave + raw.activity;
  return {
    stake: raw.stake / sum,
    join: raw.join / sum,
    leave: raw.leave / sum,
    activity: raw.activity / sum,
  };
}

function norm(values) {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => v / max);
}

async function chatActivity24h() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = {};
  let files = [];
  try {
    files = await readdir(dataDir);
  } catch {
    return out;
  }
  await Promise.all(
    files
      .filter((f) => /^\d+\.json$/.test(f))
      .map(async (f) => {
        const id = f.replace(/\.json$/, "");
        try {
          const msgs = JSON.parse(await readFile(join(dataDir, f), "utf8"));
          out[id] = Array.isArray(msgs) ? msgs.filter((m) => Number(m.at) >= since).length : 0;
        } catch {
          out[id] = 0;
        }
      }),
  );
  return out;
}

let rankCache = null;

async function buildRank() {
  const day = utcDay();
  if (rankCache?.day === day && Date.now() - rankCache.at < 10 * 60 * 1000) {
    return rankCache.payload;
  }

  const weights = dailyWeights(day);
  const n = await client.readContract({
    address: CLUB,
    abi: vaultAbi,
    functionName: "nextClubId",
  });
  const latest = await client.getBlockNumber();
  // ~2 day window on a ~2s chain; clamp for slow RPCs
  const fromBlock = latest > 80_000n ? latest - 80_000n : 0n;

  const [joinedLogs, settledLogs, activity, meta] = await Promise.all([
    client.getLogs({ address: CLUB, event: joinedEvent, fromBlock, toBlock: latest }).catch(() => []),
    client.getLogs({ address: CLUB, event: settledEvent, fromBlock, toBlock: latest }).catch(() => []),
    chatActivity24h(),
    loadMeta(),
  ]);

  const joinPaid = {};
  const leaveCount = {};
  for (const log of joinedLogs) {
    const id = String(log.args.clubId);
    joinPaid[id] = (joinPaid[id] || 0) + Number(log.args.paid || 0n);
  }
  for (const log of settledLogs) {
    const id = String(log.args.clubId);
    // early leave or expire both count as exits for heat
    if (Number(log.args.refund || 0n) > 0 || Number(log.args.used || 0n) > 0) {
      leaveCount[id] = (leaveCount[id] || 0) + 1;
    }
  }

  const rows = [];
  for (let i = 1n; i <= n; i++) {
    const id = i.toString();
    const club = await client.readContract({
      address: CLUB,
      abi: clubsAbi,
      functionName: "clubs",
      args: [i],
    });
    if (!club[9]) continue; // inactive
    const price = Number(club[1]);
    const members = Number(club[5]);
    const feePool = Number(club[7]);
    const list = await client.readContract({
      address: CLUB,
      abi: vaultAbi,
      functionName: "stakersOf",
      args: [i],
    });
    let stake = 0;
    for (const user of list) {
      const vault = await client.readContract({
        address: CLUB,
        abi: vaultAbi,
        functionName: "vaults",
        args: [i, user],
      });
      stake += Number(vault[0]);
    }
    const joinAmt = joinPaid[id] || members * price;
    rows.push({
      id: Number(id),
      name: meta[id]?.name || `Booth #${id}`,
      bio: meta[id]?.bio || "",
      stakeBooth: stake,
      joinUsdc: joinAmt,
      leaveCount: leaveCount[id] || 0,
      activity: activity[id] || 0,
      members,
      feePool,
      price,
    });
  }

  const nStake = norm(rows.map((r) => r.stakeBooth));
  const nJoin = norm(rows.map((r) => r.joinUsdc));
  const nLeave = norm(rows.map((r) => r.leaveCount));
  const nAct = norm(rows.map((r) => r.activity));

  const ranked = rows
    .map((r, i) => {
      const score =
        weights.stake * nStake[i] +
        weights.join * nJoin[i] +
        weights.leave * nLeave[i] +
        weights.activity * nAct[i];
      return {
        ...r,
        score: Math.round(score * 10000) / 10000,
        parts: {
          stake: Math.round(nStake[i] * 1000) / 1000,
          join: Math.round(nJoin[i] * 1000) / 1000,
          leave: Math.round(nLeave[i] * 1000) / 1000,
          activity: Math.round(nAct[i] * 1000) / 1000,
        },
      };
    })
    .sort((a, b) => b.score - a.score || b.activity - a.activity || a.id - b.id)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const payload = {
    day,
    updatedAt: Date.now(),
    weights: {
      stake: Math.round(weights.stake * 1000) / 1000,
      join: Math.round(weights.join * 1000) / 1000,
      leave: Math.round(weights.leave * 1000) / 1000,
      activity: Math.round(weights.activity * 1000) / 1000,
    },
    clubs: ranked,
  };
  rankCache = { day, at: Date.now(), payload };
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, `rank-${day}.json`), JSON.stringify(payload, null, 2));
  } catch {
    /* ignore */
  }
  return payload;
}

const httpServer = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        bus: bus.mode,
        rooms: rooms.size,
        memberCacheMs: Number(process.env.MEMBER_CACHE_MS || 60_000),
        maxHistory: MAX_HISTORY,
      });
    }
    if (req.method === "GET" && url.pathname === "/rank") {
      return json(res, 200, await buildRank());
    }
    if (req.method === "GET" && url.pathname === "/meta") {
      return json(res, 200, await loadMeta());
    }
    const one = url.pathname.match(/^\/meta\/(\d+)$/);
    if (req.method === "GET" && one) {
      const all = await loadMeta();
      return json(res, 200, all[one[1]] || {});
    }
    if (req.method === "PUT" && url.pathname === "/meta") {
      const body = await readBody(req);
      const clubId = String(body.clubId || "");
      const nonce = Number(body.nonce);
      const address = String(body.address || "");
      const signature = body.signature;
      const name = String(body.name || "").trim().slice(0, MAX_NAME);
      const bio = String(body.bio || "").trim().slice(0, MAX_BIO);
      if (!clubId || !address || !signature || !Number.isFinite(nonce) || !name) {
        return json(res, 400, { error: "missing fields" });
      }
      if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) {
        return json(res, 400, { error: "nonce expired" });
      }
      const recovered = await recoverMessageAddress({
        message: metaSignBody(clubId, nonce),
        signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        return json(res, 401, { error: "bad signature" });
      }
      const club = await client.readContract({
        address: CLUB,
        abi: clubsAbi,
        functionName: "clubs",
        args: [BigInt(clubId)],
      });
      const owner = club[0];
      if (owner.toLowerCase() !== recovered.toLowerCase()) {
        return json(res, 403, { error: "not club owner" });
      }
      const all = await loadMeta();
      all[clubId] = { name, bio, owner: recovered };
      metaCache = all;
      await saveMeta();
      return json(res, 200, all[clubId]);
    }
    const muteGet = url.pathname.match(/^\/mute\/(\d+)$/);
    if (req.method === "GET" && muteGet) {
      const staff = await liveStaff(muteGet[1]);
      const all = await loadMutes();
      const clubMutes = all[muteGet[1]] || {};
      const until = {};
      for (const [addr, ts] of Object.entries(clubMutes)) {
        if (Number(ts) > Date.now()) until[addr] = Number(ts);
      }
      return json(res, 200, { owner: staff.owner, top5: staff.top5, until });
    }
    if (req.method === "PUT" && url.pathname === "/mute") {
      const body = await readBody(req);
      const clubId = String(body.clubId || "");
      const target = String(body.target || "");
      const nonce = Number(body.nonce);
      const address = String(body.address || "");
      const signature = body.signature;
      if (!clubId || !target || !address || !signature || !Number.isFinite(nonce)) {
        return json(res, 400, { error: "missing fields" });
      }
      if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) {
        return json(res, 400, { error: "nonce expired" });
      }
      const recovered = await recoverMessageAddress({
        message: muteSignBody(clubId, target, nonce),
        signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        return json(res, 401, { error: "bad signature" });
      }
      const staff = await liveStaff(clubId);
      if (!isStaff(staff, recovered)) {
        return json(res, 403, { error: "not owner or top 5" });
      }
      if (target.toLowerCase() === staff.owner.toLowerCase()) {
        return json(res, 403, { error: "cannot mute owner" });
      }
      if (!(await isMember(clubId, target))) {
        return json(res, 400, { error: "target not a member" });
      }
      const until = Date.now() + MUTE_MS;
      const all = await loadMutes();
      if (!all[clubId]) all[clubId] = {};
      all[clubId][target.toLowerCase()] = until;
      muteCache = all;
      await saveMutes();
      await bus.publish(clubId, { type: "muted", user: target, until });
      return json(res, 200, { target, until });
    }
    if (req.method === "GET" && url.pathname === "/profile") {
      const all = await loadProfiles();
      const out = {};
      for (const [addr, row] of Object.entries(all)) out[addr] = publicProfile(addr, row);
      return json(res, 200, out);
    }
    const oneProfile = url.pathname.match(/^\/profile\/(0x[a-fA-F0-9]{40})$/);
    if (req.method === "GET" && oneProfile) {
      const addr = oneProfile[1].toLowerCase();
      const all = await loadProfiles();
      return json(res, 200, publicProfile(addr, all[addr]));
    }
    const av = url.pathname.match(/^\/avatar\/(0x[a-fA-F0-9]{40})$/i);
    if (req.method === "GET" && av) {
      const addr = av[1].toLowerCase();
      const all = await loadProfiles();
      const row = all[addr];
      if (!row?.mime) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const buf = await readFile(join(avatarDir, addr));
        res.writeHead(200, { "content-type": row.mime, "cache-control": "public, max-age=60" });
        res.end(buf);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (req.method === "PUT" && url.pathname === "/profile") {
      const body = await readBody(req);
      const nonce = Number(body.nonce);
      const address = String(body.address || "");
      const signature = body.signature;
      const name = String(body.name || "").trim().slice(0, MAX_NICK);
      const bio = String(body.bio || "").trim().slice(0, MAX_BIO);
      if (!address || !signature || !Number.isFinite(nonce) || !name) {
        return json(res, 400, { error: "missing fields" });
      }
      if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) {
        return json(res, 400, { error: "nonce expired" });
      }
      const recovered = await recoverMessageAddress({
        message: profileSignBody(nonce),
        signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        return json(res, 401, { error: "bad signature" });
      }
      const addr = recovered.toLowerCase();
      const all = await loadProfiles();
      const prev = all[addr] || {};
      const row = {
        name,
        bio,
        mime: prev.mime || "",
        twitter: prev.twitter || "",
        twitterUrl: prev.twitterUrl || "",
        twitterId: prev.twitterId || "",
      };
      if (body.avatar) {
        const parsed = parseAvatar(body.avatar);
        await mkdir(avatarDir, { recursive: true });
        await writeFile(join(avatarDir, addr), parsed.buf);
        row.mime = parsed.mime;
      }
      if (body.avatar === null && prev.mime) {
        row.mime = "";
        await unlink(join(avatarDir, addr)).catch(() => {});
      }
      all[addr] = row;
      profileCache = all;
      await saveProfiles();
      return json(res, 200, publicProfile(addr, row));
    }
    if (req.method === "PUT" && url.pathname === "/profile/twitter") {
      const body = await readBody(req);
      const nonce = Number(body.nonce);
      const address = String(body.address || "");
      const signature = body.signature;
      const tweetUrlRaw = String(body.tweetUrl || "");
      if (!address || !signature || !tweetUrlRaw || !Number.isFinite(nonce)) {
        return json(res, 400, { error: "missing fields" });
      }
      if (Math.abs(Date.now() - nonce) > 30 * 60 * 1000) {
        return json(res, 400, { error: "nonce expired" });
      }
      const { id, url: tweetUrl } = normalizeTweetUrl(tweetUrlRaw);
      const recovered = await recoverMessageAddress({
        message: twitterSignBody(address, nonce, tweetUrl),
        signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        return json(res, 401, { error: "bad signature" });
      }
      const addr = recovered.toLowerCase();
      const proof = twitterProof(addr);
      const tweet = await fetchTweet(id);
      if (!tweet.text.toLowerCase().includes(proof)) {
        return json(res, 400, { error: `tweet must contain ${proof}` });
      }
      const handle = tweet.handle.toLowerCase();
      const all = await loadProfiles();
      for (const [other, row] of Object.entries(all)) {
        if (other !== addr && row.twitter && row.twitter.toLowerCase() === handle) {
          return json(res, 409, { error: "twitter already bound to another wallet" });
        }
      }
      const prev = all[addr] || { name: "", bio: "", mime: "" };
      const row = {
        ...prev,
        twitter: handle,
        twitterUrl: tweetUrl,
        twitterId: id,
      };
      if (!row.name) row.name = `@${handle}`.slice(0, MAX_NICK);
      all[addr] = row;
      profileCache = all;
      await saveProfiles();
      return json(res, 200, publicProfile(addr, row));
    }
    if (req.method === "DELETE" && url.pathname === "/profile/twitter") {
      const body = await readBody(req);
      const nonce = Number(body.nonce);
      const address = String(body.address || "");
      const signature = body.signature;
      if (!address || !signature || !Number.isFinite(nonce)) {
        return json(res, 400, { error: "missing fields" });
      }
      if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) {
        return json(res, 400, { error: "nonce expired" });
      }
      const recovered = await recoverMessageAddress({
        message: `Booth twitter unbind\naddr: ${address.toLowerCase()}\nnonce: ${nonce}`,
        signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        return json(res, 401, { error: "bad signature" });
      }
      const addr = recovered.toLowerCase();
      const all = await loadProfiles();
      const prev = all[addr];
      if (!prev) return json(res, 404, { error: "no profile" });
      prev.twitter = "";
      prev.twitterUrl = "";
      prev.twitterId = "";
      all[addr] = prev;
      profileCache = all;
      await saveProfiles();
      return json(res, 200, publicProfile(addr, prev));
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("booth chat");
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : "server error" });
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.clubId = null;
  ws.address = null;

  ws.on("message", async (buf) => {
    let data;
    try {
      data = JSON.parse(String(buf));
    } catch {
      return send(ws, { type: "error", message: "bad json" });
    }
    try {
      if (data.type === "hello") {
        const clubId = String(data.clubId || "");
        const nonce = Number(data.nonce);
        const address = String(data.address || "");
        const signature = data.signature;
        if (!clubId || !address || !signature || !Number.isFinite(nonce)) {
          return send(ws, { type: "error", message: "missing hello fields" });
        }
        if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) {
          return send(ws, { type: "error", message: "nonce expired" });
        }
        const recovered = await recoverMessageAddress({
          message: signBody(clubId, nonce),
          signature,
        });
        if (recovered.toLowerCase() !== address.toLowerCase()) {
          return send(ws, { type: "error", message: "bad signature" });
        }
        if (!(await isMember(clubId, recovered))) {
          return send(ws, { type: "error", message: "not a member" });
        }
        if (ws.clubId && rooms.get(ws.clubId)) rooms.get(ws.clubId).delete(ws);
        ws.clubId = clubId;
        ws.address = recovered;
        if (!rooms.has(clubId)) rooms.set(clubId, new Set());
        rooms.get(clubId).add(ws);
        const msgs = await loadHistory(clubId);
        const all = await loadMutes();
        const mutedUntil = mutedUntilOf(all[clubId], recovered);
        const staff = await liveStaff(clubId);
        return send(ws, {
          type: "ready",
          messages: msgs,
          mutedUntil,
          canModerate: isStaff(staff, recovered),
        });
      }

      if (data.type === "msg") {
        if (!ws.clubId || !ws.address) {
          return send(ws, { type: "error", message: "say hello first" });
        }
        const text = String(data.text || "").trim().slice(0, MAX_TEXT);
        if (!text) return;
        if (!allowMessage(ws.address)) {
          return send(ws, { type: "error", message: "slow down" });
        }
        if (!(await isMember(ws.clubId, ws.address))) {
          return send(ws, { type: "error", message: "membership expired" });
        }
        const all = await loadMutes();
        const mutedUntil = mutedUntilOf(all[ws.clubId], ws.address);
        if (mutedUntil) {
          return send(ws, { type: "muted", user: ws.address, until: mutedUntil });
        }
        const msg = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          from: ws.address,
          text,
          at: Date.now(),
        };
        await appendHistory(dataDir, history, ws.clubId, msg, MAX_HISTORY);
        await bus.publish(ws.clubId, { type: "msg", ...msg });
      }
    } catch (err) {
      send(ws, { type: "error", message: err instanceof Error ? err.message : "server error" });
    }
  });

  ws.on("close", () => {
    if (ws.clubId && rooms.get(ws.clubId)) rooms.get(ws.clubId).delete(ws);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Booth chat ws on :${PORT} (bus=${bus.mode}, history=jsonl, memberCache=${process.env.MEMBER_CACHE_MS || 60000}ms)`);
});
