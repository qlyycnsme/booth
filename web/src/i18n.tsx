import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";

const dict = {
  zh: {
    tagline: "Arc 测试网包厢 · 预付 3 个月 USDC · 质押 BOOTH 分群费",
    connect: "连接钱包",
    disconnect: "断开",
    profile: "主页",
    switchChain: "切换 Arc Testnet",
    openRoom: "开一间",
    roomName: "房间名",
    roomNamePh: "例如：深夜复盘",
    roomBio: "简介",
    roomBioPh: "这个包厢聊什么？",
    seasonFee: "季费（USDC / 3 个月）",
    needStake: "需质押 {amount} USDC，锁仓 3 个月",
    create: "创建",
    rooms: "房间",
    rank: "群排名",
    rankHint: "每日 UTC 按权重重排：质押 · 入群金额 · 退群 · 活跃",
    rankEmpty: "暂无排名",
    rankLoading: "计算今日排名…",
    wStake: "质押",
    wJoin: "入群额",
    wLeave: "退群",
    wAct: "活跃",
    score: "热度",
    loadingRooms: "读取链上房间…",
    noRooms: "还没有房间",
    perSeason: "USDC / 季 · {n} 人",
    membersSeason: "{n} 位成员 · {fee} USDC/季",
    owner: "群主",
    join: "入群",
    leave: "退群",
    feesVault: "会费与金库",
    membership: "会籍",
    validUntil: "有效至 {t}",
    expired: "已到期",
    notMember: "未入群",
    feePool: "群费池",
    vault: "金库",
    notStaked: "未质押",
    locked: " 锁仓中",
    claimable: "可领",
    stakeBooth: "质押 BOOTH（最低 {min}）",
    stakeIn: "押进金库",
    unstake: "解锁取出",
    claim: "领取分成",
    pickBooth: "选择或创建一个 Booth",
    needRoomName: "请填写房间名",
    roomCreated: "房间已创建",
    metaFail: "资料保存失败",
    joined: "已入群",
    staked: "已质押进金库",
    left: "已退出并结算",
    claimed: "已领取 USDC",
    unstaked: "已取回质押",
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
    chatHintJoin: "进群并签名后，任意设备都能收到消息。",
    chatNeedPay: "付季费入群后才能进实时群聊。",
    chatSign: "请在钱包里签名，证明你是这个地址。",
    chatSignCancel: "签名取消，无法进入实时群。",
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
    tagline: "Arc testnet booths · 3-month USDC prepaid · stake BOOTH for fee share",
    connect: "Connect wallet",
    disconnect: "Disconnect",
    profile: "Profile",
    switchChain: "Switch to Arc Testnet",
    openRoom: "Open a booth",
    roomName: "Name",
    roomNamePh: "e.g. Late-night review",
    roomBio: "Bio",
    roomBioPh: "What is this booth about?",
    seasonFee: "Season fee (USDC / 3 months)",
    needStake: "Stake {amount} USDC, locked 3 months",
    create: "Create",
    rooms: "Booths",
    rank: "Leaderboard",
    rankHint: "Reshuffles daily (UTC) by stake · join volume · leaves · chat activity",
    rankEmpty: "No rankings yet",
    rankLoading: "Computing today's ranks…",
    wStake: "Stake",
    wJoin: "Joins",
    wLeave: "Leaves",
    wAct: "Chat",
    score: "Heat",
    loadingRooms: "Loading booths…",
    noRooms: "No booths yet",
    perSeason: "USDC / season · {n} members",
    membersSeason: "{n} members · {fee} USDC/season",
    owner: "Owner",
    join: "Join",
    leave: "Leave",
    feesVault: "Fees & vault",
    membership: "Membership",
    validUntil: "Until {t}",
    expired: "Expired",
    notMember: "Not a member",
    feePool: "Fee pool",
    vault: "Vault",
    notStaked: "Not staked",
    locked: " locked",
    claimable: "Claimable",
    stakeBooth: "Stake BOOTH (min {min})",
    stakeIn: "Stake",
    unstake: "Unstake",
    claim: "Claim share",
    pickBooth: "Pick or create a Booth",
    needRoomName: "Enter a booth name",
    roomCreated: "Booth created",
    metaFail: "Failed to save booth info",
    joined: "Joined",
    staked: "Staked in vault",
    left: "Left and settled",
    claimed: "USDC claimed",
    unstaked: "Stake withdrawn",
    waiting: "Waiting for confirmation…",
    txFail: "Transaction failed",
    myProfile: "My profile",
    backRoom: "Back to booth",
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
    chatHintJoin: "Join and sign to chat across devices.",
    chatNeedPay: "Pay the season fee to enter live chat.",
    chatSign: "Sign in your wallet to prove this address.",
    chatSignCancel: "Signature cancelled — cannot enter chat.",
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
