// Shared defaults. Loaded by background (importScripts), options and popup (<script>).

const XQF_TEXT = (key, fallback, substitutions) =>
  typeof XQF_t === "function" ? XQF_t(key, substitutions, fallback) : fallback;

// What the user sees: five labels. Jev answers with finer categories (below) which map onto these.
const XQF_CATEGORIES = {
  substance: { icon: "💡", label: XQF_TEXT("categorySubstanceLabel", "Substance"), hide: false, desc: XQF_TEXT("categorySubstanceDescription", "Insight, news, real discussion — something to learn or think about") },
  humor:     { icon: "😂", label: XQF_TEXT("categoryHumorLabel", "Humor"),     hide: false, desc: XQF_TEXT("categoryHumorDescription", "Jokes, memes, wit") },
  chitchat:  { icon: "🙂", label: XQF_TEXT("categoryChitchatLabel", "Chit-chat"), hide: false, desc: XQF_TEXT("categoryChitchatDescription", "Personal updates, photos, reactions, emoji replies") },
  promo:     { icon: "📢", label: XQF_TEXT("categoryPromoLabel", "Promo"),     hide: false, desc: XQF_TEXT("categoryPromoDescription", "Selling or pushing a product, course, newsletter, waitlist") },
  junk:      { icon: "🚫", label: XQF_TEXT("categoryJunkLabel", "Junk"),      hide: true,  desc: XQF_TEXT("categoryJunkDescription", "Engagement bait, empty filler, ads") }
};
const XQF_FINE_TO_UI = { insight: "substance", news: "substance", discussion: "substance", humor: "humor", personal: "chitchat", promo: "promo", bait: "junk", filler: "junk", ad: "junk" };
const XQF_FINE_LABEL = {
  insight: XQF_TEXT("fineInsight", "insight"), news: XQF_TEXT("fineNews", "news"), discussion: XQF_TEXT("fineDiscussion", "discussion"),
  humor: XQF_TEXT("fineHumor", "humor"), personal: XQF_TEXT("finePersonal", "personal"), promo: XQF_TEXT("finePromo", "promo"),
  bait: XQF_TEXT("fineBait", "engagement bait"), filler: XQF_TEXT("fineFiller", "filler"), ad: XQF_TEXT("fineAd", "ad")
};
// Short word shown on the post tag.
const XQF_TAG = {
  insight: XQF_TEXT("tagInsight", "Insight"), news: XQF_TEXT("tagNews", "News"), discussion: XQF_TEXT("tagDiscussion", "Discussion"),
  humor: XQF_TEXT("tagHumor", "Humor"), personal: XQF_TEXT("tagPersonal", "Chat"), promo: XQF_TEXT("tagPromo", "Promo"),
  bait: XQF_TEXT("tagBait", "Bait"), filler: XQF_TEXT("tagFiller", "Filler"), ad: XQF_TEXT("tagAd", "Ad")
};

// One-tap presets: what to hide.
const XQF_PRESETS = {
  signal:     { label: XQF_TEXT("presetSignalLabel", "Signal"),     desc: XQF_TEXT("presetSignalDescription", "Only substantive tech posts"), hide: { substance: false, humor: true,  chitchat: true,  promo: true,  junk: true }, hideAI: true, hideOffTopic: true },
  balanced:   { label: XQF_TEXT("presetBalancedLabel", "Balanced"),   desc: XQF_TEXT("presetBalancedDescription", "Tech, including humor and chat"), hide: { substance: false, humor: false, chitchat: false, promo: false, junk: true }, hideAI: true, hideOffTopic: true },
  everything: { label: XQF_TEXT("presetEverythingLabel", "Everything"), desc: XQF_TEXT("presetEverythingDescription", "Label only, hide nothing"), hide: { substance: false, humor: false, chitchat: false, promo: false, junk: false }, hideAI: false, hideOffTopic: false }
};

// Orthogonal flags: any label can also be AI-written, and any label can be off-topic.
const XQF_AI = { icon: "🤖", label: XQF_TEXT("aiLabel", "AI-written"), hide: true, desc: XQF_TEXT("aiDescription", "Reads like ChatGPT wrote it: “It's not X. It's Y.”, rule-of-three lists, emoji bullets, buzzwords, zero personal detail") };
const XQF_TOPIC = { icon: "🌐", label: XQF_TEXT("topicLabel", "Off-topic"), hide: true, desc: XQF_TEXT("topicDescription", "Not about tech: gossip, relationships, entertainment, sports, politics, lifestyle, memes with no technical angle") };

const XQF_DEFAULTS = {
  enabled: true,
  pausedUntil: 0,
  apiKey: "",
  model: "jev-latest",
  // which categories to hide: {insight:false, ..., bait:true}
  hide: Object.fromEntries(Object.entries(XQF_CATEGORIES).map(([k, c]) => [k, c.hide])),
  hideAI: true,
  // hide posts that are not about technology / software / AI / science / the tech industry
  hideOffTopic: true,
  // P(tech) below which a post counts as off-topic
  techThreshold: 0.5,
  // also classify and hide replies under a post (the focal post itself is never hidden)
  filterReplies: true,
  // "hide" = collapse into a one-line bar with Show, "dim" = fade, "badge" = label only
  mode: "hide",
  showBadges: true,
  // hide X's right column (Premium upsell, Today's News, Trending, Who to follow) and let posts use the width
  hideSidebar: true,
  // stop phrases: one regex per line (case-insensitive). Matched locally, hides instantly, no API call.
  stopPhrases: [
    "\\bbookmark this\\b",
    "\\blet that sink in\\b",
    "\\bread that again\\b",
    "\\breply\\s+(with\\s+)?[\"“']?\\w+[\"”']?\\s+and\\s+i(?:'ll| will)\\s+(send|dm|share)",
    "\\bcomment\\s+[\"“']?\\w+[\"”']?\\s+and\\s+i(?:'ll| will)\\s+(send|dm|share)",
    "\\bfollow\\s+(me\\s+)?for\\s+more\\b",
    "\\bnobody\\s+is\\s+talking\\s+about\\s+this\\b",
    "\\bthis\\s+changes\\s+everything\\b",
    "\\byou(?:'re| are)\\s+not\\s+ready\\b",
    "\\bmost\\s+people\\s+(don't|dont|won't|will\\s+never)\\s+(know|understand|realize|get)\\b",
    "\\bhere(?:'s| is)\\s+(the|my)\\s+exact\\s+(system|framework|playbook|blueprint)\\b",
    "\\b(like|rt|retweet)\\s+(and|\\+|&)\\s+(follow|retweet|rt|like)\\b",
    "\\brt\\s+if\\s+you\\b",
    "\\bdrop\\s+a\\s+🔥",
    "\\b(i|we)\\s+made\\s+\\$\\d[\\d,]*k?\\s+in\\s+\\d+\\s+(days|hours|weeks)\\b",
    "^\\s*gm\\b\\s*[!.☀️🌞]*\\s*$",
    "^\\s*gn\\b\\s*[!.🌙]*\\s*$",
    "\\b(free|giveaway)\\b.*\\b(retweet|rt|follow|like)\\b",
    "\\bdm\\s+me\\s+[\"“']?\\w+[\"”']?\\s+(to|for)\\b"
  ].join("\n"),
  allowlist: "",
  blocklist: ""
};

// Three questions to Jev per post, one request.
const XQF_QUESTIONS = {
  category: {
    type: "choice",
    instructions: "Which single category best describes this post? The state may include the post text, a quoted post, a link card or article title, what media is attached, and — for replies — the post being replied to (in_reply_to). A photo or video with a short caption, an emoji reaction, or a quote-post with only an emoji is usually 'personal'. A screenshot of a chat conversation, a viral story about relationships / dating / family / celebrities, a rhetorical 'would you...?' prompt, or a meme is 'humor' or 'personal' — never 'insight' or 'news', no matter how many likes it has. For a reply, a short genuine reaction from a real person to the parent post is 'personal', not 'filler'.",
    criteria: {
      insight: "original analysis, first-hand experience, technical detail, specific data or numbers, a concrete lesson learned. Must actually teach or explain something.",
      news: "reports a concrete event, release, paper, announcement or fact with specifics",
      discussion: "a genuine question or opinion with enough context that a thoughtful person could reply substantively",
      humor: "a joke, meme caption, pun, funny screenshot, or witty observation whose point is to be funny",
      personal: "casual personal update, a photo or video of daily life, plain reaction or emoji, thanks, agreement, congratulations, a short specific comment from a real person on the parent post ('效率也太高了', 'tried it, works great', 'nice, what model?')",
      promo: "selling or pushing a course, product, newsletter, waitlist, affiliate link, or 'check out my ...'",
      bait: "written to farm engagement: 'bookmark this', 'reply X and I'll DM', 'most people don't know', ragebait, vague promises of a secret system, contentless 'agree?' / 'thoughts?', follower farming",
      filler: "a text-only reply or post with literally nothing to it: 'gm', '.', 'W', 'this', 'first', 'so true', a single generic word, a copy-pasted comment that could be under any post — but NOT a short reaction that clearly refers to the parent post, and NOT an emoji reaction to a quoted post or a photo, those are personal"
    }
  },
  tech: {
    type: "noul",
    instructions: "Is this post about technology? For a reply, judge by the conversation it is in (in_reply_to): a reaction under a tech post counts as tech.",
    criteria: {
      true: "software, programming, AI / ML / LLMs, developer tools, open source, databases, infrastructure, hardware, chips, science, engineering, math, startups and the tech industry, product launches of tech products, tech policy",
      false: "relationships, dating, family, gossip, celebrities, entertainment, sports, politics unrelated to tech, lifestyle, food, travel, fitness, finance tips, motivation, generic life advice, viral chat screenshots, memes with no technical angle"
    }
  },
  ai_written: {
    type: "noul",
    instructions: "Does this post read as written by an AI language model (ChatGPT-style) rather than typed by a person?",
    criteria: {
      true: "LLM prose tells: 'It's not X. It's Y.' contrasts, rule-of-three lists, heavy em dashes, perfectly parallel bullet points with emoji, words like delve/leverage/game-changer/unlock/harness/landscape, polished generic tone with zero personal specifics, hook then lesson then call to action, every sentence the same length",
      false: "typos, slang, uneven rhythm, terse phrasing, specific personal details or numbers, in-jokes, raw opinion, casual Chinese or English as people actually type on their phone"
    }
  }
};

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, { XQF_DEFAULTS, XQF_CATEGORIES, XQF_FINE_TO_UI, XQF_FINE_LABEL, XQF_TAG, XQF_PRESETS, XQF_AI, XQF_TOPIC, XQF_QUESTIONS });
}
