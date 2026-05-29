// Telegram safety guards — per-agent sliding-window budgets.
//
// Context for whoever reads this expecting classic "bot-loop
// protection": bazilion runs ONE bot, and Telegram never redelivers a bot's
// own messages to itself, so the classic two-bots-echoing loop (and even a
// single-agent self-echo) cannot happen via Telegram. The real Telegram-side
// vectors these guards cover are:
//   - another bot posting in a bound topic — handled by dropping is_bot
//     inbound in routing.ts, NOT here;
//   - a human or script spamming a bound topic — the inbound budget below;
//   - a heartbeat-heavy agent flooding its topic with verbose tool-line
//     noise — the outbound-noise budget below.
//
// OUT OF SCOPE: the genuinely cost-dangerous runaway — two agents replying to
// each other forever via the internal send_message / heartbeat machinery — is
// not a Telegram concern. Those turns merely *mirror* to Telegram; the loop
// engine lives in the messaging/scheduler layer and needs its own guard.
//
// Budgets are read once from env at module load:
//   BAZILION_TELEGRAM_LOOP_BUDGET     inbound,  default 20/60/60  (max/windowSec/cooldownSec)
//   BAZILION_TELEGRAM_AGENT_THROTTLE  outbound, default 30/60     (max/windowSec[/cooldownSec])

interface Budget {
  max: number
  windowMs: number
  cooldownMs: number
}

function parseBudget(raw: string | undefined, def: Budget): Budget {
  if (!raw) return def
  const parts = raw.split('/').map((s) => Number(s.trim()))
  const max = parts[0]
  const windowSec = parts[1]
  const cooldownSec = parts[2]
  return {
    max: Number.isFinite(max) && (max as number) > 0 ? (max as number) : def.max,
    windowMs:
      Number.isFinite(windowSec) && (windowSec as number) > 0
        ? (windowSec as number) * 1000
        : def.windowMs,
    cooldownMs:
      parts.length >= 3 && Number.isFinite(cooldownSec) && (cooldownSec as number) >= 0
        ? (cooldownSec as number) * 1000
        : def.cooldownMs,
  }
}

const INBOUND_BUDGET = parseBudget(process.env.BAZILION_TELEGRAM_LOOP_BUDGET, {
  max: 20,
  windowMs: 60_000,
  cooldownMs: 60_000,
})

const OUTBOUND_BUDGET = parseBudget(process.env.BAZILION_TELEGRAM_AGENT_THROTTLE, {
  max: 30,
  windowMs: 60_000,
  cooldownMs: 0,
})

interface Window {
  hits: number[]
  cooldownUntil: number
  lastNoticeAt: number
}

const _inbound = new Map<string, Window>()
const _outbound = new Map<string, Window>()

function windowFor(map: Map<string, Window>, key: string): Window {
  let w = map.get(key)
  if (!w) {
    w = { hits: [], cooldownUntil: 0, lastNoticeAt: 0 }
    map.set(key, w)
  }
  return w
}

/**
 * Record one event against a budget. Returns true when the event is within
 * budget (caller proceeds), false when over (caller drops it). A non-zero
 * `cooldownMs` latches: once tripped, everything is rejected until the
 * cooldown elapses, not just until the window drains.
 */
function tryConsume(map: Map<string, Window>, key: string, budget: Budget): boolean {
  const now = Date.now()
  const w = windowFor(map, key)
  if (now < w.cooldownUntil) return false
  w.hits = w.hits.filter((t) => now - t < budget.windowMs)
  if (w.hits.length >= budget.max) {
    if (budget.cooldownMs > 0) w.cooldownUntil = now + budget.cooldownMs
    return false
  }
  w.hits.push(now)
  return true
}

/** True when an inbound Telegram message for this agent is within budget. */
export function allowTelegramInbound(agentId: string): boolean {
  return tryConsume(_inbound, agentId, INBOUND_BUDGET)
}

/**
 * True when a non-essential (verbose tool-line) outbound mirror frame for this
 * agent is within budget. Essential frames (assistant_message / error / fatal)
 * bypass this entirely — we never drop the agent's actual reply.
 */
export function allowTelegramOutboundNoise(agentId: string): boolean {
  return tryConsume(_outbound, agentId, OUTBOUND_BUDGET)
}

/**
 * Returns true at most once per inbound cooldown window, so the router posts a
 * single "slow down" notice instead of one per dropped message. Call only
 * after `allowTelegramInbound` returned false.
 */
export function shouldNotifyInboundThrottle(agentId: string): boolean {
  const w = _inbound.get(agentId)
  if (!w) return false
  const now = Date.now()
  if (now - w.lastNoticeAt < INBOUND_BUDGET.cooldownMs) return false
  w.lastNoticeAt = now
  return true
}

/** Test-only — wipe both budget maps. */
export function _resetLoopGuardForTest(): void {
  _inbound.clear()
  _outbound.clear()
}
