import type { Hex } from "viem";

const KEY = "booth.session.v1";
const SESSION_MSG = (nonce: number) => `Booth session\nnonce: ${nonce}`;

type Stored = { token: string; address: string; exp: number };

let minting: Promise<string> | null = null;

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as Stored;
    if (!row?.token || !row?.address || !row?.exp) return null;
    return row;
  } catch {
    return null;
  }
}

function write(row: Stored) {
  sessionStorage.setItem(KEY, JSON.stringify(row));
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
}

export function peekSession(address: string): string | null {
  const row = read();
  if (!row) return null;
  if (row.address.toLowerCase() !== address.toLowerCase()) return null;
  if (row.exp <= Date.now() + 60_000) return null;
  return row.token;
}

export function isUserReject(e: unknown): boolean {
  const msg =
    e && typeof e === "object" && "shortMessage" in e
      ? String((e as { shortMessage: string }).shortMessage)
      : e instanceof Error
        ? e.message
        : String(e);
  return /user rejected|user denied|rejected the request|denied transaction|cancel/i.test(msg);
}

async function mintSession(
  address: string,
  signMessageAsync: (args: { message: string }) => Promise<Hex>,
): Promise<string> {
  const nonce = Date.now();
  const signature = await signMessageAsync({ message: SESSION_MSG(nonce) });
  const res = await fetch("/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, nonce, signature }),
  });
  const text = await res.text();
  let body: { token?: string; exp?: number; address?: string; error?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Old chat.mjs answered unknown routes with plain "booth chat" + HTTP 200.
    throw new Error("聊天服务未更新：请停掉后重新 npm run dev");
  }
  if (!res.ok || !body?.token || !body?.exp) {
    throw new Error(body?.error || `登录失败（HTTP ${res.status}）`);
  }
  write({
    token: body.token,
    address: (body.address || address).toLowerCase(),
    exp: body.exp,
  });
  return body.token;
}

export async function ensureSession(
  address: string,
  signMessageAsync: (args: { message: string }) => Promise<Hex>,
  force = false,
): Promise<string> {
  if (!force) {
    const cached = peekSession(address);
    if (cached) return cached;
  } else {
    clearSession();
  }
  if (minting) return minting;
  minting = mintSession(address, signMessageAsync).finally(() => {
    minting = null;
  });
  return minting;
}
