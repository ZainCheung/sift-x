// Shared defaults. Loaded by background (importScripts), options and popup (<script>).

// What the user sees: five labels. Jev answers with finer categories (below) which map onto these.
const XQF_CATEGORIES = {
  substance: { icon: "💡", label: "Substance", hide: false, desc: "Insight, news, real discussion — something to learn or think about" },
  humor:     { icon: "😂", label: "Humor",     hide: false, desc: "Jokes, memes, wit" },
  chitchat:  { icon: "🙂", label: "Chit-chat", hide: false, desc: "Personal updates, photos, reactions, emoji replies" },
  promo:     { icon: "📢", label: "Promo",     hide: false, desc: "Selling or pushing a product, course, newsletter, waitlist" },
  junk:      { icon: "🚫", label: "Junk",      hide: true,  desc: "Engagement bait, empty filler, ads" }
};
const XQF_FINE_TO_UI = { insight: "substance", news: "substance", discussion: "substance", humor: "humor", personal: "chitchat", promo: "promo", bait: "junk", filler: "junk", ad: "junk" };
const XQF_FINE_LABEL = { insight: "insight", news: "news", discussion: "discussion", humor: "humor", personal: "personal", promo: "promo", bait: "engagement bait", filler: "filler", ad: "ad" };

// Orthogonal flag: any label can also be AI-written.
const XQF_AI = { icon: "🤖", label: "AI-written", hide: true, desc: "Reads like ChatGPT wrote it: “It's not X. It's Y.”, rule-of-three lists, emoji bullets, buzzwords, zero personal detail" };

const XQF_DEFAULTS = {
  enabled: true,
  pausedUntil: 0,
  apiKey: "",
  model: "jev-latest",
  // which categories to hide: {insight:false, ..., bait:true}
  hide: Object.fromEntries(Object.entries(XQF_CATEGORIES).map(([k, c]) => [k, c.hide])),
  hideAI: true,
  // also classify and hide replies under a post (the focal post itself is never hidden)
  filterReplies: true,
  // "hide" = collapse into a one-line bar with Show, "dim" = fade, "badge" = label only
  mode: "hide",
  showBadges: true,
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

// Two questions to Jev per post, one request.
const XQF_QUESTIONS = {
  category: {
    type: "choice",
    instructions: "Which single category best describes this post? The state may include the post text, a quoted post, a link card or article title, and what media is attached. A photo or video with a short caption, an emoji reaction, or a quote-post with only an emoji is usually 'personal'. If it is a reply, judge whether the reply adds anything.",
    criteria: {
      insight: "original analysis, first-hand experience, technical detail, specific data or numbers, a concrete lesson learned",
      news: "reports a concrete event, release, paper, announcement or fact with specifics",
      discussion: "a genuine question or opinion with enough context that a thoughtful person could reply substantively",
      humor: "a joke, meme caption, pun or witty observation whose point is to be funny",
      personal: "casual personal update, a photo or video of daily life, plain reaction or emoji, thanks, agreement, congratulations, a short comment from a real person",
      promo: "selling or pushing a course, product, newsletter, waitlist, affiliate link, or 'check out my ...'",
      bait: "written to farm engagement: 'bookmark this', 'reply X and I'll DM', 'most people don't know', ragebait, vague promises of a secret system, contentless 'agree?' / 'thoughts?', follower farming",
      filler: "a text-only reply or post that carries nothing: 'gm', 'this.', 'W', 'so true', generic praise, one word — but NOT an emoji reaction to a quoted post or a photo, those are personal"
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
  Object.assign(globalThis, { XQF_DEFAULTS, XQF_CATEGORIES, XQF_FINE_TO_UI, XQF_FINE_LABEL, XQF_AI, XQF_QUESTIONS });
}
