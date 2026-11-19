// The token radar's model (radar-2): one sealed snapshot of the protocol universe in, one ranked
// board of pre-token protocols out, every figure derived from the snapshot itself.
//
// The idea, in one paragraph. A token that already trades gives the market's own answer to "what is
// a protocol in this category worth per dollar of TVL": its market cap divided by its TVL. radar-2
// reads that answer from every token-bearing protocol in the snapshot, with two safeguards against
// a thin or extreme peer set: each peer's ratio is first capped at 3.0 (near the peer set's 90th
// percentile, so one 400x outlier cannot price a whole category), and each category's median is
// shrunk toward the all-market median in proportion to how few traded peers stand behind it.
// The category's multiple then applies to each pre-token protocol's TVL. Three adjustments follow,
// all from the protocol's own record: a growth factor from its 7-day TVL change, a maturity factor
// from how long DefiLlama has tracked it with no token, and a small breadth factor for each chain
// it runs on beyond the first. No protocol name is ever special-cased: one function scores every
// row, and the dashboard states the whole model.
//
// Who is ranked. Every protocol that records no token (no market cap, no CoinGecko id, no symbol)
// and is not itself a wrapped, staked or bridged product of a token that already trades: the
// snapshot watchlist's own product test (category, name and exchange-prefix rules) applied to the
// whole pre-token universe, not just above the watchlist's $50M floor. The board is that whole
// universe — 198 protocols on this snapshot — because a radar that only lists the biggest names
// finds nothing early. Protocols whose token already trades are never ranked; the dashboard shows
// the largest of them apart, as the calibration set the multiples came from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-derive every row. */
export interface ModelConstants {
  shrink_k: number;
  ratio_cap: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_factor_min: number;
  growth_factor_max: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  ratio_cap: 3,
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_factor_min: 0.6,
  growth_factor_max: 1.6,
  maturity_floor: 0.75,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_extra: 5,
};

/** The model's version label: the dashboard names it and board rows carry it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's calibration view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One protocol's scoring breakdown: every factor that produced its implied value. */
export interface ScoreBreakdown {
  category_multiple: number;
  category_peers: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  base_value_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  signal: string;
  implied_value_usd: number;
  model: ScoreBreakdown & { version: string };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row itself, nothing held back. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's calibration: the multiple the model uses and how many traded peers stand behind it. */
export interface CategoryStat {
  category: string;
  peers: number;
  median_multiple: number;
  used_multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  universe_size: number;
  pre_token_size: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers, on a sorted copy so the input order never matters. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of another asset. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are products of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token protocol is a launch candidate of its own, under the watchlist's product
 * test: not a product category, no version marker, no wrapped/staked word, no exchange prefix.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  return !EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** The peer calibration: every category's multiple, from the snapshot's token-bearing protocols. */
export interface Calibration {
  global_multiple: number;
  categories: CategoryStat[];
  byCategory: Map<string, CategoryStat>;
}

/** Build the calibration table: per-category median mcap/TVL, shrunk toward the global median. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    // Winsorized: a peer's ratio counts at most ratio_cap, so a single extreme market (a prediction
    // market priced at 400x its TVL) informs its category without pricing it.
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, model.ratio_cap);
    all.push(ratio);
    const key = p.category ?? '(none)';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const categories: CategoryStat[] = [];
  const byCategory = new Map<string, CategoryStat>();
  for (const key of [...ratiosByCategory.keys()].sort()) {
    const list = ratiosByCategory.get(key)!;
    const med = median(list);
    const used = (list.length * med + model.shrink_k * global) / (list.length + model.shrink_k);
    const stat: CategoryStat = { category: key, peers: list.length, median_multiple: round4(med), used_multiple: round4(used) };
    categories.push(stat);
    byCategory.set(key, stat);
  }
  return { global_multiple: global, categories, byCategory };
}

/** The multiple one protocol is scored with: its category's, or the global median when it has none. */
function multipleFor(p: SnapshotProtocol, cal: Calibration, model: ModelConstants): { multiple: number; peers: number } {
  const stat = p.category === null ? undefined : cal.byCategory.get(p.category);
  if (stat !== undefined) return { multiple: stat.used_multiple, peers: stat.peers };
  return { multiple: round4(cal.global_multiple), peers: 0 };
}

/** The three adjustments and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  cal: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: ScoreBreakdown; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, peers } = multipleFor(p, cal, model);
  const base = p.tvl_usd * multiple;
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(p.change_7d, 0)));
  const growthFactor = Math.min(model.growth_factor_max, Math.max(model.growth_factor_min, 1 + (growthPct / 100) * model.growth_weight));
  const ageForModel = age ?? model.unknown_age_days;
  const maturityFactor = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainFactor = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_extra);
  const implied = Math.max(1, Math.round(base * growthFactor * maturityFactor * chainFactor));
  return {
    implied,
    age,
    breakdown: {
      category_multiple: multiple,
      category_peers: peers,
      growth_pct: growthPct,
      growth_factor: round4(growthFactor),
      maturity_factor: round4(maturityFactor),
      chain_factor: round4(chainFactor),
      base_value_usd: Math.round(base),
    },
  };
}

/** A one-word read of a row's figures, for the board's signal column. Deterministic in the figures. */
export function signalFor(p: SnapshotProtocol, age: number | null, watchlist: boolean, floorUsd: number): string {
  let points = 0;
  if (p.tvl_usd >= floorUsd) points += 2;
  else if (p.tvl_usd >= 20_000_000) points += 1;
  if ((p.change_7d ?? 0) >= 5) points += 1;
  else if ((p.change_7d ?? 0) <= -10) points -= 1;
  if (age !== null && age >= 730) points += 1;
  if (watchlist) points += 1;
  if (points >= 4) return 'Strong';
  if (points >= 2) return 'Watch';
  return 'Early';
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const cal = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // Coverage first: every watchlist slug, whatever the product test says — the list is the floor.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Then the whole launch-candidate universe the snapshot carries, at every size: the radar's job
  // is to find launches early, and the snapshot's own floor is $5M of TVL, so nothing is cut here.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown, age } = impliedValue(p, snapshot.as_of, cal, model);
    return { p, implied, breakdown, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    signal: signalFor(s.p, s.age, watch.has(s.p.slug), snapshot.floor_usd),
    implied_value_usd: s.implied,
    model: { version: MODEL_VERSION, ...s.breakdown },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A small stable hash of a slug, so wording variants are chosen deterministically, never at random. */
export function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. Two phrasings, picked by slug hash. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const alt = slugHash(p.slug) % 2 === 1;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return alt
      ? `Lend $${capital} of USDC on ${name} (${chain}) and borrow no more than 30% against it, so the supply counts without liquidation risk.`
      : `Supply $${capital} of USDC to ${name} on ${chain} and keep the deposit open; add a small borrow of 20-30% only if the app tracks borrowers.`;
  }
  if (c.includes('dex') || c.includes('swap')) {
    return alt
      ? `Trade on ${name}: swap about $${capital} of volume a week on ${chain}, split into 3-4 swaps, and hold a small LP position if it offers one.`
      : `Provide $${capital} of liquidity to ${name}'s most-used pool on ${chain} and make 2-3 swaps a week through the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return `Deposit $${capital} of USDC as margin on ${name} and run one small hedged position (long spot, short perp) so volume counts without directional risk.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) {
    return alt
      ? `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet; do not route them through another aggregator.`
      : `Allocate $${capital} to ${name} on ${chain} and hold the position's receipt token where the app issued it.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt in the same wallet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds in one app on the far side so the trip is real usage.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it; make one redemption later so both directions count.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it past one full distribution cycle.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take positions in 3-4 different markets on ${name}, sized small, so the account shows real breadth.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy to expiry.`;
  }
  if (c.includes('launchpad') || c.includes('ido')) {
    return `Complete ${name}'s participation steps on ${chain} with $${capital} ready: register the wallet, hold any required balance and join one sale or waitlist.`;
  }
  if (c.includes('nft') || c.includes('gaming') || c.includes('game')) {
    return `Play or trade on ${name} with a $${capital} budget on ${chain}: finish its onboarding quests and make a few in-app transactions each week.`;
  }
  return alt
    ? `Use ${name}'s core product on ${chain} with $${capital}: deposit or commit the funds in the app's main flow and keep the position open.`
    : `Deposit $${capital} of USDC into ${name} on ${chain} through its main app and keep the position open past the next snapshot.`;
}

/** The second, breadth step: a second chain when there is one, else a second kind of activity. */
function breadthStep(p: SnapshotProtocol, capital: number): FarmStep {
  if (p.chains.length > 1) {
    return {
      text: `Repeat a smaller position (about half size) on ${p.chains[1]}, the protocol's second chain: multi-chain activity is the cheapest breadth a points program can see.`,
      cost: `about $${Math.round(capital / 2)} of capital plus $5 of bridge and gas fees`,
      time: '20 minutes',
    };
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) {
    return {
      text: `Add a second kind of activity in the same app: one borrow-and-repay cycle a month, so the wallet reads as a user of both sides of the market.`,
      cost: 'about $3 of gas a month, no extra capital',
      time: '10 minutes a month',
    };
  }
  return {
    text: `Add a second kind of activity in the same app — a vote, a claim, a referral-free second deposit — so the wallet reads as a returning user, not a one-off.`,
    cost: 'about $2 of gas a month, no extra capital',
    time: '10 minutes a month',
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Start with a fresh wallet used only for ${p.name}: fund it from an exchange withdrawal, keep the seed phrase offline, and never reuse an address you farm other launches with.`,
      cost: 'under $3 of gas for the first transactions',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    breadthStep(p, capital),
    {
      text: `Make one qualifying action every week — a deposit, a swap, a borrow or a vote inside ${p.name} — on a weekday, so the wallet's history spans months instead of one burst.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and check the protocol's own points or rewards page once a month; claim only from a link that page publishes, and never pay a fee to claim.`,
      cost: `the $${capital} stays in the position; checking is free`,
      time: `${hold} days, 5 minutes a month`,
    },
    {
      text: `Keep a farm log (wallet, dates, amounts, transaction hashes) and set an exit rule now: when a token or claim is announced, follow the announcement's own steps within its first week.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's calibration view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const cal = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(cal.global_multiple),
    universe_size: snapshot.protocols.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    categories: cal.categories,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const inRankOrder = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < inRankOrder.length; i++) {
    if (inRankOrder[i]!.implied_value_usd > inRankOrder[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && inRankOrder[0]!.implied_value_usd === inRankOrder[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
