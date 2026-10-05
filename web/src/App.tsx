import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, parseEventLogs, parseUnits, type Abi, type Address, type Hex } from "viem";
import boothClubAbiJson from "./abi/BoothClub.json";
import { BOOTH, BOOTH_CLUB, USDC, arcTestnet, erc20Abi } from "./config";
import { LangToggle, useLang } from "./i18n";

const clubAbi = boothClubAbiJson as Abi;

type ClubRow = {
  id: bigint;
  owner: Address;
  monthlyPrice: bigint;
  memberCount: number;
  stakerCount: number;
  feePool: bigint;
  active: boolean;
  name: string;
  bio: string;
};

function clubTitle(c: { id: bigint; name?: string }) {
  return c.name?.trim() || `Booth #${c.id.toString()}`;
}

type Profile = { name: string; bio: string; avatar: string; twitter?: string };

function nickOf(addr: string, profiles: Record<string, Profile>) {
  return profiles[addr.toLowerCase()]?.name?.trim() || short(addr);
}

function Avatar({
  addr,
  profile,
  tiny,
  onOpen,
}: {
  addr: string;
  profile?: Profile;
  tiny?: boolean;
  onOpen?: (addr: string) => void;
}) {
  const src = profile?.avatar;
  const [fail, setFail] = useState(false);
  useEffect(() => {
    setFail(false);
  }, [src]);
  const cls = `av ${tiny ? "tiny" : ""} ${onOpen ? "clickable" : ""}`;
  const open = onOpen ? () => onOpen(addr) : undefined;
  if (src && !fail) {
    return <img className={cls} src={src} alt="" onClick={open} onError={() => setFail(true)} />;
  }
  const label = (profile?.name || short(addr)).replace(/^0x/i, "").slice(0, 2).toUpperCase();
  return (
    <div className={cls} onClick={open} role={onOpen ? "button" : undefined}>
      {label}
    </div>
  );
}

function short(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function errText(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "shortMessage" in e) {
    return String((e as { shortMessage: string }).shortMessage);
  }
  return e instanceof Error ? e.message : fallback;
}

export function App() {
  const { t, lang } = useLang();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState("1");
  const [clubName, setClubName] = useState("");
  const [clubBio, setClubBio] = useState("");
  const [stakeAmt, setStakeAmt] = useState("100");
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [selected, setSelected] = useState<bigint>(1n);
  const [usdcBal, setUsdcBal] = useState("0");
  const [boothBal, setBoothBal] = useState("0");
  const [stakeToCreate, setStakeToCreate] = useState(0n);
  const [minVault, setMinVault] = useState(0n);
  const [paid, setPaid] = useState(0n);
  const [expiresAt, setExpiresAt] = useState(0);
  const [vaultAmt, setVaultAmt] = useState(0n);
  const [lockUntil, setLockUntil] = useState(0);
  const [claimable, setClaimable] = useState(0n);
  const [tick, setTick] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [profileAddr, setProfileAddr] = useState<string | null>(null);
  const [rank, setRank] = useState<{
    day: string;
    weights: { stake: number; join: number; leave: number; activity: number };
    clubs: {
      rank: number;
      id: number;
      name: string;
      score: number;
      stakeBooth: number;
      joinUsdc: number;
      leaveCount: number;
      activity: number;
    }[];
  } | null>(null);
  const [rankLoading, setRankLoading] = useState(false);

  const wrongChain = isConnected && chainId !== arcTestnet.id;
  const member =
    !!address &&
    paid > 0n &&
    expiresAt * 1000 > Date.now();

  const selectedClub = useMemo(
    () => clubs.find((c) => c.id === selected),
    [clubs, selected],
  );

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingList(true);
        const [n, createStake, minS] = await Promise.all([
          publicClient.readContract({
            address: BOOTH_CLUB,
            abi: clubAbi,
            functionName: "nextClubId",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: BOOTH_CLUB,
            abi: clubAbi,
            functionName: "stakeToCreate",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: BOOTH_CLUB,
            abi: clubAbi,
            functionName: "minVaultStake",
          }) as Promise<bigint>,
        ]);
        if (cancelled) return;
        setStakeToCreate(createStake);
        setMinVault(minS);
        const rows: ClubRow[] = [];
        for (let i = 1n; i <= n; i++) {
          const c = (await publicClient.readContract({
            address: BOOTH_CLUB,
            abi: clubAbi,
            functionName: "clubs",
            args: [i],
          })) as readonly [
            Address,
            bigint,
            number,
            number,
            number,
            number,
            number,
            bigint,
            bigint,
            boolean,
          ];
          rows.push({
            id: i,
            owner: c[0],
            monthlyPrice: c[1],
            memberCount: Number(c[5]),
            stakerCount: Number(c[6]),
            feePool: c[7],
            active: c[9],
            name: "",
            bio: "",
          });
        }
        if (!cancelled) {
          try {
            const meta = (await fetch("/meta").then((r) => r.json())) as Record<
              string,
              { name?: string; bio?: string }
            >;
            for (const row of rows) {
              const m = meta[row.id.toString()];
              if (m?.name) row.name = m.name;
              if (m?.bio) row.bio = m.bio;
            }
          } catch {
            /* keep on-chain titles */
          }
          try {
            const all = (await fetch("/profile").then((r) => r.json())) as Record<string, Profile>;
            if (!cancelled) setProfiles(all);
          } catch {
            /* keep empty profiles */
          }
          setClubs(rows);
          setLoadingList(false);
          if (rows.length && !rows.some((r) => r.id === selected)) {
            setSelected(rows[0].id);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadingList(false);
          setStatus(errText(e, t("txFail")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, tick, selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRankLoading(true);
      try {
        const data = await fetch("/rank").then((r) => r.json());
        if (!cancelled) setRank(data);
      } catch {
        if (!cancelled) setRank(null);
      } finally {
        if (!cancelled) setRankLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (!publicClient || !address) return;
    let cancelled = false;
    (async () => {
      const [u, b, m, v, cl] = await Promise.all([
        publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: BOOTH,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "memberships",
          args: [selected, address],
        }) as Promise<readonly [bigint, number, number]>,
        publicClient.readContract({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "vaults",
          args: [selected, address],
        }) as Promise<readonly [bigint, number, number, number, number, bigint]>,
        publicClient.readContract({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "usdcClaimable",
          args: [address],
        }) as Promise<bigint>,
      ]);
      if (cancelled) return;
      setUsdcBal(formatUnits(u, 6));
      setBoothBal(formatUnits(b, 18));
      setPaid(m[0]);
      setExpiresAt(Number(m[2]));
      setVaultAmt(v[0]);
      setLockUntil(Number(v[1]));
      setClaimable(cl);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address, selected, tick]);

  async function send(hash: Hex, ok: string) {
    setStatus(t("waiting"));
    await publicClient!.waitForTransactionReceipt({ hash });
    setStatus(ok);
    setTick((x) => x + 1);
  }

  async function ensureChain() {
    if (chainId !== arcTestnet.id) {
      await switchChain({ chainId: arcTestnet.id });
    }
  }

  async function approveAnd(token: Address, amount: bigint, then: () => Promise<Hex>) {
    const allowance = await publicClient!.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address!, BOOTH_CLUB],
    });
    if (allowance < amount) {
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [BOOTH_CLUB, amount],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
    }
    return then();
  }

  async function onCreate() {
    if (!address) return;
    const name = clubName.trim();
    if (!name) {
      setStatus(t("needRoomName"));
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const monthly = parseUnits(price || "0", 6);
      const hash = await approveAnd(USDC, stakeToCreate, () =>
        writeContractAsync({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "createClub",
          args: [monthly],
        }),
      );
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      const created = parseEventLogs({
        abi: clubAbi,
        logs: receipt.logs,
      }) as { eventName?: string; args?: { clubId?: bigint } }[];
      const newId = created.find((e) => e.eventName === "ClubCreated")?.args?.clubId;
      if (newId !== undefined) {
        const nonce = Date.now();
        const signature = await signMessageAsync({
          message: `Booth meta\nclub: ${newId.toString()}\nnonce: ${nonce}`,
        });
        const res = await fetch("/meta", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clubId: newId.toString(),
            name,
            bio: clubBio.trim(),
            address,
            nonce,
            signature,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || t("metaFail"));
        }
        setSelected(newId);
        setClubName("");
        setClubBio("");
      }
      setStatus(t("roomCreated"));
      setTick((x) => x + 1);
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!address || !selectedClub) return;
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const hash = await approveAnd(USDC, selectedClub.monthlyPrice, () =>
        writeContractAsync({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "join",
          args: [selected],
        }),
      );
      await send(hash, t("joined"));
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  async function onStake() {
    if (!address) return;
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const amt = parseUnits(stakeAmt || "0", 18);
      const hash = await approveAnd(BOOTH, amt, () =>
        writeContractAsync({
          address: BOOTH_CLUB,
          abi: clubAbi,
          functionName: "stake",
          args: [selected, amt],
        }),
      );
      await send(hash, t("staked"));
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  async function onLeave() {
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: BOOTH_CLUB,
        abi: clubAbi,
        functionName: "leave",
        args: [selected],
      });
      await send(hash, t("left"));
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: BOOTH_CLUB,
        abi: clubAbi,
        functionName: "claimUsdc",
      });
      await send(hash, t("claimed"));
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  async function onUnstake() {
    setBusy(true);
    setStatus("");
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: BOOTH_CLUB,
        abi: clubAbi,
        functionName: "unstake",
        args: [selected],
      });
      await send(hash, t("unstaked"));
    } catch (e) {
      setStatus(errText(e, t("txFail")));
    } finally {
      setBusy(false);
    }
  }

  const locked = Date.now() < lockUntil * 1000;
  const working = busy || isPending;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>BOOTH</h1>
          <p className="tag">{t("tagline")}</p>
        </div>
        <div className="wallet">
          <LangToggle />
          {isConnected ? (
            <>
              <button type="button" className="me-chip" onClick={() => setProfileAddr(address!)}>
                <Avatar addr={address!} profile={profiles[address!.toLowerCase()]} tiny />
                <strong>{nickOf(address!, profiles)}</strong>
              </button>
              <div>USDC {usdcBal}</div>
              <div>BOOTH {Number(boothBal).toLocaleString()}</div>
              {wrongChain && (
                <button className="btn" onClick={() => switchChain({ chainId: arcTestnet.id })}>
                  {t("switchChain")}
                </button>
              )}
              <div className="row">
                <button className="btn" onClick={() => setProfileAddr(address!)}>
                  {t("profile")}
                </button>
                <button className="btn" onClick={() => disconnect()}>
                  {t("disconnect")}
                </button>
              </div>
            </>
          ) : (
            <button
              className="btn solid"
              disabled={connecting}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {t("connect")}
            </button>
          )}
        </div>
      </header>

      <div className="grid">
        <aside className="panel">
          <h2>{t("openRoom")}</h2>
          <label>{t("roomName")}</label>
          <input
            value={clubName}
            maxLength={40}
            placeholder={t("roomNamePh")}
            onChange={(e) => setClubName(e.target.value)}
          />
          <label>{t("roomBio")}</label>
          <textarea
            className="bio"
            value={clubBio}
            maxLength={200}
            rows={3}
            placeholder={t("roomBioPh")}
            onChange={(e) => setClubBio(e.target.value)}
          />
          <label>{t("seasonFee")}</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} />
          <p className="tag">{t("needStake", { amount: formatUnits(stakeToCreate, 6) })}</p>
          <div className="row">
            <button className="btn solid" disabled={!isConnected || working} onClick={onCreate}>
              {t("create")}
            </button>
          </div>

          <h2 style={{ marginTop: 22 }}>{t("rank")}</h2>
          <p className="tag">{t("rankHint")}</p>
          {rank && (
            <p className="tag rank-weights">
              {t("wStake")} {(rank.weights.stake * 100).toFixed(0)}% · {t("wJoin")}{" "}
              {(rank.weights.join * 100).toFixed(0)}% · {t("wLeave")} {(rank.weights.leave * 100).toFixed(0)}% ·{" "}
              {t("wAct")} {(rank.weights.activity * 100).toFixed(0)}%
              <span> · {rank.day}</span>
            </p>
          )}
          {rankLoading && <p className="tag">{t("rankLoading")}</p>}
          {!rankLoading && rank && !rank.clubs.length && <p className="tag">{t("rankEmpty")}</p>}
          {!rankLoading &&
            rank?.clubs.map((r) => (
              <button
                key={`rank-${r.id}`}
                className={`club rank-row ${BigInt(r.id) === selected ? "active" : ""}`}
                onClick={() => setSelected(BigInt(r.id))}
              >
                <span className="rank-n">#{r.rank}</span>
                {r.name}
                <small>
                  {t("score")} {r.score.toFixed(2)} · {t("wStake")}{" "}
                  {(r.stakeBooth / 1e18).toFixed(0)} · {t("wJoin")} {(r.joinUsdc / 1e6).toFixed(0)} · {t("wLeave")}{" "}
                  {r.leaveCount} · {t("wAct")} {r.activity}
                </small>
              </button>
            ))}

          <h2 style={{ marginTop: 22 }}>{t("rooms")}</h2>
          {loadingList && <p className="tag">{t("loadingRooms")}</p>}
          {!loadingList &&
            clubs.map((c) => (
            <button
              key={c.id.toString()}
              className={`club ${c.id === selected ? "active" : ""}`}
              onClick={() => setSelected(c.id)}
            >
              {clubTitle(c)}
              <small>
                {c.bio ? `${c.bio} · ` : ""}
                {formatUnits(c.monthlyPrice, 6)} {t("perSeason", { n: c.memberCount })}
              </small>
            </button>
          ))}
          {!loadingList && !clubs.length && <p className="tag">{t("noRooms")}</p>}
        </aside>

        <main className="panel">
          {profileAddr ? (
            <ProfilePage
              addr={profileAddr}
              mine={!!address && profileAddr.toLowerCase() === address.toLowerCase()}
              profile={profiles[profileAddr.toLowerCase()]}
              onBack={() => setProfileAddr(null)}
              onSaved={async () => {
                const all = (await fetch("/profile").then((r) => r.json())) as Record<string, Profile>;
                setProfiles(all);
              }}
            />
          ) : selectedClub ? (
            <>
              <div className="club-head">
                <div>
                  <strong>{clubTitle(selectedClub)}</strong>
                  <small>
                    {selectedClub.bio ? `${selectedClub.bio} · ` : ""}
                    {t("membersSeason", {
                      n: selectedClub.memberCount,
                      fee: formatUnits(selectedClub.monthlyPrice, 6),
                    })}
                    {" · "}
                    <button type="button" className="mute" onClick={() => setProfileAddr(selectedClub.owner)}>
                      {t("owner")} {nickOf(selectedClub.owner, profiles)}
                    </button>
                  </small>
                </div>
                <div className="club-head-actions">
                  <button className="btn solid" disabled={!isConnected || working || member} onClick={onJoin}>
                    {t("join")}
                  </button>
                  <button className="btn" disabled={!isConnected || working || paid === 0n} onClick={onLeave}>
                    {t("leave")}
                  </button>
                </div>
              </div>

              <Room
                clubId={selected}
                title={clubTitle(selectedClub)}
                bio={selectedClub.bio}
                open={member}
                me={address}
                memberCount={selectedClub.memberCount}
                owner={selectedClub.owner}
                profiles={profiles}
                onOpenProfile={setProfileAddr}
              />

              <details className="more">
                <summary>{t("feesVault")}</summary>
                <div className="kv">
                  <span>{t("owner")}</span>
                  <div>
                    <button type="button" className="mute" onClick={() => setProfileAddr(selectedClub.owner)}>
                      {nickOf(selectedClub.owner, profiles)}
                    </button>
                  </div>
                  <span>{t("membership")}</span>
                  <div>
                    {member
                      ? t("validUntil", {
                          t: new Date(expiresAt * 1000).toLocaleString(lang === "zh" ? "zh-CN" : "en-US"),
                        })
                      : paid > 0n
                        ? t("expired")
                        : t("notMember")}
                  </div>
                  <span>{t("feePool")}</span>
                  <div>{formatUnits(selectedClub.feePool, 6)} USDC</div>
                  <span>{t("vault")}</span>
                  <div>
                    {vaultAmt === 0n
                      ? t("notStaked")
                      : `${formatUnits(vaultAmt, 18)} BOOTH${locked ? t("locked") : ""}`}
                  </div>
                  <span>{t("claimable")}</span>
                  <div>{formatUnits(claimable, 6)} USDC</div>
                </div>
                <label>{t("stakeBooth", { min: formatUnits(minVault, 18) })}</label>
                <input value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value)} />
                <div className="row">
                  <button className="btn" disabled={!isConnected || working || !member} onClick={onStake}>
                    {t("stakeIn")}
                  </button>
                  <button
                    className="btn"
                    disabled={!isConnected || working || vaultAmt === 0n || locked}
                    onClick={onUnstake}
                  >
                    {t("unstake")}
                  </button>
                  <button className="btn" disabled={!isConnected || working || claimable === 0n} onClick={onClaim}>
                    {t("claim")}
                  </button>
                </div>
              </details>
            </>
          ) : (
            <p className="tag">{t("pickBooth")}</p>
          )}
          <p className={`status ${status.includes("失败") || status.toLowerCase().includes("fail") || status.includes("User") ? "err" : ""}`}>
            {status}
          </p>
        </main>
      </div>
    </div>
  );
}

type ChatMsg = { id: string; from: string; text: string; at: number };

function ProfilePage({
  addr,
  mine,
  profile,
  onBack,
  onSaved,
}: {
  addr: string;
  mine: boolean;
  profile?: Profile;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLang();
  const { signMessageAsync } = useSignMessage();
  const [name, setName] = useState(profile?.name || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [preview, setPreview] = useState(profile?.avatar || "");
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [tweetUrl, setTweetUrl] = useState("");
  const [twitter, setTwitter] = useState(profile?.twitter || "");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const proof = `booth:${addr.toLowerCase()}`;

  useEffect(() => {
    setName(profile?.name || "");
    setBio(profile?.bio || "");
    setPreview(profile?.avatar || "");
    setTwitter(profile?.twitter || "");
    setAvatarData(null);
  }, [addr, profile?.name, profile?.bio, profile?.avatar, profile?.twitter]);

  function onFile(file?: File) {
    if (!file) return;
    if (file.size > 200 * 1024) {
      setHint(t("avatarTooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setAvatarData(url);
      setPreview(url);
    };
    reader.readAsDataURL(file);
  }

  async function copyProof() {
    try {
      await navigator.clipboard.writeText(proof);
      setHint(t("codeCopied"));
    } catch {
      setHint(t("copyManual", { code: proof }));
    }
  }

  async function save() {
    const nick = name.trim();
    if (!nick) {
      setHint(t("needNick"));
      return;
    }
    setBusy(true);
    setHint("");
    try {
      const nonce = Date.now();
      const signature = await signMessageAsync({ message: `Booth profile\nnonce: ${nonce}` });
      const res = await fetch("/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addr,
          nonce,
          signature,
          name: nick,
          bio: bio.trim(),
          avatar: avatarData || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || t("saveFail"));
      await onSaved();
      setHint(t("profileSaved"));
    } catch (e) {
      setHint(e instanceof Error ? e.message : t("saveFail"));
    } finally {
      setBusy(false);
    }
  }

  async function bindTwitter() {
    const raw = tweetUrl.trim();
    if (!raw) {
      setHint(t("needTweetUrl"));
      return;
    }
    setBusy(true);
    setHint("");
    try {
      const idMatch = raw.match(/\/status(?:es)?\/(\d+)/);
      if (!idMatch) throw new Error(t("needTweetLink"));
      const normalized = `https://x.com/i/status/${idMatch[1]}`;
      const nonce = Date.now();
      const signature = await signMessageAsync({
        message: `Booth twitter\naddr: ${addr.toLowerCase()}\nnonce: ${nonce}\nurl: ${normalized}`,
      });
      const res = await fetch("/profile/twitter", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: addr,
          nonce,
          signature,
          tweetUrl: raw,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Profile & { error?: string };
      if (!res.ok) throw new Error(body.error || t("bindFail"));
      setTwitter(body.twitter || "");
      if (body.name) setName(body.name);
      setTweetUrl("");
      await onSaved();
      setHint(t("boundAs", { handle: body.twitter || "" }));
    } catch (e) {
      setHint(e instanceof Error ? e.message : t("bindFail"));
    } finally {
      setBusy(false);
    }
  }

  async function unbindTwitter() {
    setBusy(true);
    setHint("");
    try {
      const nonce = Date.now();
      const signature = await signMessageAsync({
        message: `Booth twitter unbind\naddr: ${addr.toLowerCase()}\nnonce: ${nonce}`,
      });
      const res = await fetch("/profile/twitter", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr, nonce, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || t("unbindFail"));
      setTwitter("");
      await onSaved();
      setHint(t("unbound"));
    } catch (e) {
      setHint(e instanceof Error ? e.message : t("unbindFail"));
    } finally {
      setBusy(false);
    }
  }

  const emptyProfile: Profile = { name: "", bio: "", avatar: "", twitter: "" };

  return (
    <div className="profile">
      <div className="club-head">
        <div>
          <strong>
            {mine
              ? t("myProfile")
              : nickOf(addr, { [addr.toLowerCase()]: profile || emptyProfile })}
          </strong>
          <small>{short(addr)}</small>
        </div>
        <button className="btn" onClick={onBack}>
          {t("backRoom")}
        </button>
      </div>
      <div className="profile-hero">
        <Avatar addr={addr} profile={{ name, bio, avatar: preview, twitter }} />
        <div>
          <p className="profile-name">{name.trim() || short(addr)}</p>
          <p className="tag">{bio.trim() || t("noBio")}</p>
          {twitter ? (
            <a className="twitter-link" href={`https://x.com/${twitter}`} target="_blank" rel="noreferrer">
              @{twitter}
            </a>
          ) : (
            <p className="tag">{t("twitterNone")}</p>
          )}
        </div>
      </div>
      {mine ? (
        <>
          <label>{t("nick")}</label>
          <input value={name} maxLength={24} placeholder={t("nickPh")} onChange={(e) => setName(e.target.value)} />
          <label>{t("about")}</label>
          <textarea
            className="bio"
            rows={3}
            maxLength={200}
            value={bio}
            placeholder={t("aboutPh")}
            onChange={(e) => setBio(e.target.value)}
          />
          <label>{t("avatar")}</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <p className="tag">{t("avatarHint")}</p>
          <div className="row">
            <button className="btn solid" disabled={busy} onClick={save}>
              {t("saveProfile")}
            </button>
          </div>

          <h2 style={{ marginTop: 22 }}>{t("bindTwitter")}</h2>
          {twitter ? (
            <>
              <p className="tag">
                {t("bound")}{" "}
                <a href={`https://x.com/${twitter}`} target="_blank" rel="noreferrer">
                  @{twitter}
                </a>
              </p>
              <div className="row">
                <button className="btn" disabled={busy} onClick={unbindTwitter}>
                  {t("unbind")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="tag">{t("twitterHow")}</p>
              <code className="proof">{proof}</code>
              <div className="row">
                <button className="btn" disabled={busy} onClick={copyProof}>
                  {t("copyCode")}
                </button>
                <a
                  className="btn"
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(proof)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("goTweet")}
                </a>
              </div>
              <label>{t("tweetUrl")}</label>
              <input
                value={tweetUrl}
                placeholder={t("tweetUrlPh")}
                onChange={(e) => setTweetUrl(e.target.value)}
              />
              <div className="row">
                <button className="btn solid" disabled={busy} onClick={bindTwitter}>
                  {t("verifyBind")}
                </button>
              </div>
            </>
          )}
        </>
      ) : null}
      {hint ? <p className="status">{hint}</p> : null}
    </div>
  );
}

function chatWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/chat`;
}

function signBody(clubId: string, nonce: number) {
  return `Booth chat\nclub: ${clubId}\nnonce: ${nonce}`;
}

function muteSignBody(clubId: string, target: string, nonce: number) {
  return `Booth mute\nclub: ${clubId}\nuser: ${target}\nnonce: ${nonce}`;
}

function muteLeft(until: number, dayLabel: string, hourLabel: string) {
  if (until <= Date.now()) return "";
  const ms = until - Date.now();
  const h = Math.ceil(ms / 3_600_000);
  if (h >= 24) return `${Math.ceil(h / 24)} ${dayLabel}`;
  return `${h} ${hourLabel}`;
}

function Room({
  clubId,
  title,
  bio,
  open,
  me,
  memberCount,
  owner,
  profiles,
  onOpenProfile,
}: {
  clubId: bigint;
  title: string;
  bio: string;
  open: boolean;
  me?: Address;
  memberCount: number;
  owner: Address;
  profiles: Record<string, Profile>;
  onOpenProfile: (addr: string) => void;
}) {
  const { t, lang } = useLang();
  const { signMessageAsync } = useSignMessage();
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [live, setLive] = useState<"off" | "signing" | "on" | "err">("off");
  const [hint, setHint] = useState(() => t("chatHintJoin"));
  const [canModerate, setCanModerate] = useState(false);
  const [mutedUntil, setMutedUntil] = useState(0);
  const [muting, setMuting] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const leftLabel = (until: number) => muteLeft(until, t("day"), t("hour"));

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs, open]);

  useEffect(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setMsgs([]);
    setCanModerate(false);
    setMutedUntil(0);
    if (!open || !me) {
      setLive("off");
      setHint(t("chatNeedPay"));
      return;
    }

    let stopped = false;
    (async () => {
      setLive("signing");
      setHint(t("chatSign"));
      const nonce = Date.now();
      const club = clubId.toString();
      let signature: Hex;
      try {
        signature = await signMessageAsync({ message: signBody(club, nonce) });
      } catch {
        if (!stopped) {
          setLive("err");
          setHint(t("chatSignCancel"));
        }
        return;
      }
      if (stopped) return;
      const ws = new WebSocket(chatWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "hello",
            clubId: club,
            address: me,
            nonce,
            signature,
          }),
        );
      };
      ws.onmessage = (ev) => {
        const data = JSON.parse(String(ev.data)) as {
          type: string;
          messages?: ChatMsg[];
          message?: string;
          id?: string;
          from?: string;
          text?: string;
          at?: number;
          mutedUntil?: number;
          canModerate?: boolean;
          user?: string;
          until?: number;
        };
        if (data.type === "ready") {
          setLive("on");
          setMsgs(data.messages || []);
          setCanModerate(!!data.canModerate);
          setMutedUntil(data.mutedUntil || 0);
          setHint(
            data.mutedUntil && data.mutedUntil > Date.now()
              ? t("chatMuted", { left: leftLabel(data.mutedUntil) })
              : t("chatConnected"),
          );
        } else if (data.type === "msg" && data.id && data.from && data.text && data.at) {
          setMsgs((cur) => (cur.some((m) => m.id === data.id) ? cur : [...cur, data as ChatMsg]));
        } else if (data.type === "muted" && data.until) {
          if (me && data.user && data.user.toLowerCase() === me.toLowerCase()) {
            setMutedUntil(data.until);
            setHint(t("chatMuted", { left: leftLabel(data.until) }));
          }
        } else if (data.type === "error") {
          setLive("err");
          setHint(data.message || t("chatErr"));
        }
      };
      ws.onerror = () => {
        if (!stopped) {
          setLive("err");
          setHint(t("chatOffline"));
        }
      };
      ws.onclose = () => {
        if (!stopped && live !== "err") setLive("off");
      };
    })();

    return () => {
      stopped = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [open, me, clubId, signMessageAsync, t, lang]);

  function send() {
    if (!open || !me || !text.trim() || live !== "on" || !wsRef.current) return;
    if (mutedUntil > Date.now()) return;
    wsRef.current.send(JSON.stringify({ type: "msg", text: text.trim() }));
    setText("");
  }

  async function muteUser(target: string) {
    if (!me || muting) return;
    setMuting(target);
    try {
      const nonce = Date.now();
      const signature = await signMessageAsync({
        message: muteSignBody(clubId.toString(), target, nonce),
      });
      const res = await fetch("/mute", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubId: clubId.toString(),
          target,
          address: me,
          nonce,
          signature,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || t("muteFail"));
      setHint(t("mutedUser", { who: short(target) }));
    } catch (e) {
      setHint(e instanceof Error ? e.message : t("muteFail"));
    } finally {
      setMuting(null);
    }
  }

  const silenced = mutedUntil > Date.now();

  return (
    <div className={`chat ${open ? "" : "is-locked"}`}>
      <div className="chat-top">
        <div className="av">{clubId.toString()}</div>
        <div>
          <b>{title}</b>
          <span>
            {bio ? `${bio} · ` : ""}
            {t("peopleOwner", { n: memberCount })}
            <button type="button" className="mute" onClick={() => onOpenProfile(owner)}>
              {t("owner")} {nickOf(owner, profiles)}
            </button>
          </span>
        </div>
      </div>
      <div className="chat-body" ref={scroller}>
        <p className="sys">{hint}</p>
        {msgs.map((m) => {
          const mine = me && m.from.toLowerCase() === me.toLowerCase();
          const fromP = profiles[m.from.toLowerCase()];
          return (
            <div key={m.id} className={`bubble-row ${mine ? "mine" : ""}`}>
              <Avatar addr={m.from} profile={fromP} tiny onOpen={onOpenProfile} />
              <div>
                <div className="who">
                  <button type="button" className="mute" onClick={() => onOpenProfile(m.from)}>
                    {mine ? t("me") : nickOf(m.from, profiles)}
                  </button>
                  <time>
                    {new Date(m.at).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {canModerate && !mine && m.from.toLowerCase() !== owner.toLowerCase() && (
                    <button
                      type="button"
                      className="mute"
                      disabled={!!muting}
                      onClick={() => muteUser(m.from)}
                    >
                      {t("mute3d")}
                    </button>
                  )}
                </div>
                <div className="bubble">{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      {open ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={1}
            value={text}
            placeholder={silenced ? t("mutedTyping", { left: leftLabel(mutedUntil) }) : t("typing")}
            disabled={silenced}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn solid" type="submit" disabled={silenced || !text.trim() || live !== "on"}>
            {t("send")}
          </button>
        </form>
      ) : (
        <div className="composer locked-bar">{t("chatLockedBar")}</div>
      )}
    </div>
  );
}
