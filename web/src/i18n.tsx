import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";

const dict = {
  zh: {
    brand: "aclub",
    tagline: "Arc 上的会员房间 · 预付 3 个月 USDC",

    connect: "连接钱包",
    disconnect: "断开",
    profile: "主页",
    switchChain: "切换 Arc 主网",
    copied: "已复制",
    copyCa: "复制合约地址",
    openRoom: "开一间",
    roomName: "房间名",
    roomNamePh: "例如：深夜复盘",
    roomBio: "简介",
    roomBioPh: "这个房间聊什么？",
    seasonFee: "会费（USDC / 期）",
    periodLabel: "会籍时长",
    period1: "1 个月",
    period3: "3 个月",
    period6: "6 个月",
    needStake: "需锁定 {amount} USDC，锁仓 3 个月",
    createRule:
      "已绑定推特且粉丝 ≥ {min}：免费开一间（每钱包一次）。否则需锁定 {amount} USDC（90 天）。",
    createNeedTwitter: "未绑定推特，将按 10 USDC 开房…",
    createNeedFollowers: "当前粉丝 {n}（需 {min}），将按 10 USDC 开房…",
    creatingFree: "粉丝 {n}，免费开房…",
    roomCreatedFree: "免费房间已创建",
    create: "创建",
    rooms: "房间",
    rank: "群排名",
    rankHint: "每日 UTC 按权重重排：开房锁仓 · 入群金额 · 退群 · 活跃",
    rankEmpty: "暂无排名",
    rankLoading: "计算今日排名…",
    wStake: "锁仓",
    wJoin: "入群额",
    wLeave: "退群",
    wAct: "活跃",
    score: "热度",
    loadingRooms: "读取链上房间…",
    noRooms: "还没有房间",
    perSeason: "USDC / {m}月 · {n} 人",
    membersSeason: "{n} 位成员 · {fee} USDC/{m}月",
    owner: "群主",
    join: "入群",
    leave: "退群",
    feesVault: "会费",
    ownerSettings: "群主设置",
    ownerEditHint: "改价每次收 5 USDC 运营费，立即对新人生效；改时长需房间内无人在期（到期结算或退群后）。",
    periodNeedEmpty: "还有成员在期，请等全部到期结算或退群后再改时长。",
    periodEditOk: "当前无人在期，可以改 1 / 3 / 6 个月。",
    savePrice: "保存会费",
    savePeriod: "保存时长",
    needPrice: "请填写有效会费",
    priceUpdated: "会费已更新",
    periodUpdated: "会籍时长已更新",
    membership: "会籍",
    validUntil: "有效至 {t}",
    expired: "已到期",
    notMember: "未入群",
    feePool: "群费池",
    claimable: "可领",
    claim: "领取分成",
    pickBooth: "选一间房间，或开一间自己的",
    emptyLead: "付费入群 · 实时聊天 · 链上会籍",

    needRoomName: "请填写房间名",
    roomCreated: "房间已创建",
    metaFail: "资料保存失败",
    joined: "已入群",
    left: "已退出并结算",
    claimed: "已领取 USDC",
    waiting: "等待上链…",
    txFail: "交易失败",
    myProfile: "我的主页",
    backRoom: "返回房间",
    noBio: "还没有简介",
    twitterNone: "未绑定推特",
    nick: "昵称",
    nickPh: "怎么称呼你",
    about: "简介",
    aboutPh: "一句话介绍自己",
    avatar: "头像",
    avatarHint: "jpeg / png / webp / gif，不超过 200KB",
    saveProfile: "保存主页",
    bindTwitter: "绑定推特",
    bound: "已绑定",
    unbind: "解绑",
    twitterHow: "发一条公开推文，正文包含下面这串验证码，再把推文链接贴回来。",
    copyCode: "复制验证码",
    goTweet: "去发推",
    tweetUrl: "推文链接",
    tweetUrlPh: "https://x.com/你的账号/status/…",
    verifyBind: "验证并绑定",
    avatarTooBig: "头像请小于 200KB",
    codeCopied: "验证码已复制，发一条公开推文后把链接贴回来",
    copyManual: "请手动复制：{code}",
    needNick: "请填写昵称",
    saveFail: "保存失败",
    profileSaved: "主页已保存",
    needTweetUrl: "请粘贴推文链接",
    needTweetLink: "链接需指向具体推文",
    bindFail: "绑定失败",
    boundAs: "已绑定 @{handle}",
    unbound: "已解绑推特",
    unbindFail: "解绑失败",
    chatHintJoin: "入群后签一次名即可聊天，换房不用再弹钱包。",
    chatNeedPay: "付季费入群后才能进实时群聊。",
    chatSign: "首次进入签一次名（本会话有效，之后不再弹钱包）。",
    chatSignCancel: "签名取消，无法进入实时群。",
    chatSignFail: "登录失败。请停掉旧进程后重新 npm run dev。",
    chatMuted: "你已被禁言，约 {left} 后可发言。",
    chatConnected: "已连接实时群聊。",
    chatErr: "聊天服务出错",
    chatOffline: "连不上聊天服务。请用 npm run dev 同时启动页面和聊天服务。",
    muteFail: "禁言失败",
    mutedUser: "已禁言 {who} 3 天",
    peopleOwner: "{n} 人 · ",
    me: "我",
    mute3d: "禁言 3 天",
    typing: "发消息…",
    mutedTyping: "禁言中，约 {left} 后可发言",
    send: "发送",
    chatLockedBar: "付季费入群后才能在群里说话",
    day: "天",
    hour: "小时",
    people: "人",
    pageErr: "页面出错：{msg}",
    reload: "刷新",
  },
  en: {
    brand: "aclub",
    tagline: "Member rooms on Arc · prepaid 3-month USDC",

    connect: "Connect wallet",
    disconnect: "Disconnect",
    profile: "Profile",
    switchChain: "Switch to Arc",
    copied: "Copied",
    copyCa: "Copy contract address",
    openRoom: "Open",
    roomName: "Name",
    roomNamePh: "e.g. Late-night review",
    roomBio: "Bio",
    roomBioPh: "What is this room about?",
    seasonFee: "Dues (USDC / period)",
    periodLabel: "Membership length",
    period1: "1 month",
    period3: "3 months",
    period6: "6 months",
    needStake: "Lock {amount} USDC for 3 months",
    createRule:
      "Bound X with ≥ {min} followers: one free room per wallet. Otherwise lock {amount} USDC (90 days).",
    createNeedTwitter: "No X linked — creating with 10 USDC…",
    createNeedFollowers: "{n} followers (need {min}) — creating with 10 USDC…",
    creatingFree: "{n} followers — free create…",
    roomCreatedFree: "Free room created",
    create: "Create",
    rooms: "Rooms",
    rank: "Ranks",
    rankHint: "Reshuffles daily (UTC) by create lock · join volume · leaves · chat activity",
    rankEmpty: "No rankings yet",
    rankLoading: "Computing today's ranks…",
    wStake: "Lock",
    wJoin: "Joins",
    wLeave: "Leaves",
    wAct: "Chat",
    score: "Heat",
    loadingRooms: "Loading rooms…",
    noRooms: "No rooms yet",
    perSeason: "USDC / {m}mo · {n} members",
    membersSeason: "{n} members · {fee} USDC/{m}mo",
    owner: "Owner",
    join: "Join",
    leave: "Leave",
    feesVault: "Fees",
    ownerSettings: "Owner settings",
    ownerEditHint: "Each price change costs 5 USDC (ops fee) and applies to new joins immediately. Period can change only when no one is in-term.",
    periodNeedEmpty: "Members still in-term. Wait until all expire/settle or leave.",
    periodEditOk: "No active members — you can switch 1 / 3 / 6 months.",
    savePrice: "Save dues",
    savePeriod: "Save period",
    needPrice: "Enter a valid dues amount",
    priceUpdated: "Dues updated",
    periodUpdated: "Membership period updated",
    membership: "Membership",
    validUntil: "Until {t}",
    expired: "Expired",
    notMember: "Not a member",
    feePool: "Fee pool",
    claimable: "Claimable",
    claim: "Claim share",
    pickBooth: "Pick a room, or open your own",
    emptyLead: "Paid entry · live chat · on-chain membership",

    needRoomName: "Enter a room name",
    roomCreated: "Room created",
    metaFail: "Failed to save room info",
    joined: "Joined",
    left: "Left and settled",
    claimed: "USDC claimed",
    waiting: "Waiting for confirmation…",
    txFail: "Transaction failed",
    myProfile: "My profile",
    backRoom: "Back to room",
    noBio: "No bio yet",
    twitterNone: "Twitter not linked",
    nick: "Nickname",
    nickPh: "What should we call you",
    about: "Bio",
    aboutPh: "One line about you",
    avatar: "Avatar",
    avatarHint: "jpeg / png / webp / gif, max 200KB",
    saveProfile: "Save profile",
    bindTwitter: "Link Twitter",
    bound: "Linked",
    unbind: "Unlink",
    twitterHow: "Post a public tweet with the code below, then paste the tweet URL here.",
    copyCode: "Copy code",
    goTweet: "Tweet",
    tweetUrl: "Tweet URL",
    tweetUrlPh: "https://x.com/you/status/…",
    verifyBind: "Verify & link",
    avatarTooBig: "Avatar must be under 200KB",
    codeCopied: "Code copied — post a public tweet, then paste the link",
    copyManual: "Copy manually: {code}",
    needNick: "Enter a nickname",
    saveFail: "Save failed",
    profileSaved: "Profile saved",
    needTweetUrl: "Paste a tweet URL",
    needTweetLink: "URL must point to a tweet",
    bindFail: "Link failed",
    boundAs: "Linked @{handle}",
    unbound: "Twitter unlinked",
    unbindFail: "Unlink failed",
    chatHintJoin: "Join, sign once, then switch rooms without more wallet popups.",
    chatNeedPay: "Pay the season fee to enter live chat.",
    chatSign: "One signature for this session — no more wallet prompts for chat.",
    chatSignCancel: "Signature cancelled — cannot enter chat.",
    chatSignFail: "Session login failed. Restart npm run dev.",
    chatMuted: "You are muted for about {left}.",
    chatConnected: "Connected to live chat.",
    chatErr: "Chat error",
    chatOffline: "Chat offline. Run npm run dev to start web + chat.",
    muteFail: "Mute failed",
    mutedUser: "Muted {who} for 3 days",
    peopleOwner: "{n} members · ",
    me: "Me",
    mute3d: "Mute 3d",
    typing: "Message…",
    mutedTyping: "Muted — about {left} left",
    send: "Send",
    chatLockedBar: "Pay the season fee to speak here",
    day: "d",
    hour: "h",
    people: "",
    pageErr: "Something broke: {msg}",
    reload: "Reload",
  },
} as const;

export type MsgKey = keyof typeof dict.zh;

type Vars = Record<string, string | number>;

export function formatMsg(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MsgKey, vars?: Vars) => string;
};

const LangContext = createContext<LangCtx | null>(null);

function readLang(): Lang {
  try {
    const v = localStorage.getItem("booth-lang");
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const value = useMemo<LangCtx>(() => {
    const setLang = (l: Lang) => {
      setLangState(l);
      try {
        localStorage.setItem("booth-lang", l);
      } catch {
        /* ignore */
      }
    };
    const t = (key: MsgKey, vars?: Vars) => formatMsg(dict[lang][key], vars);
    return { lang, setLang, t };
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang outside LangProvider");
  return ctx;
}

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      className="lang-toggle"
      aria-label="Language"
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
    >
      <span className={lang === "zh" ? "on" : ""}>中</span>
      <span className="sep">/</span>
      <span className={lang === "en" ? "on" : ""}>EN</span>
    </button>
  );
}
