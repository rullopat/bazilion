// Shared plumbing for the routers: handlers throw DomainErrors instead of building error
// responses, and resolve their path params and JSON bodies through these helpers.

import type { Agent, Team } from '@bazilion/api-types'
import { type Context, type Env, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { DomainError } from '../core/errors.ts'
import * as agentRepo from '../core/repos/agents.ts'
import * as teamRepo from '../core/repos/teams.ts'
import { getCtx } from '../lib/ctx.ts'

/** A router whose thrown errors become responses (see onRouteError). */
export function newRouter<E extends Env = Env>(): Hono<E> {
  return new Hono<E>().onError(onRouteError)
}

/**
 * A DomainError answers with its status and `{ error, code? }`, an HTTPException (a body limit)
 * with its own response; anything else is a 500.
 */
export function onRouteError(error: Error, c: Context): Response {
  if (error instanceof HTTPException) return error.getResponse()
  if (error instanceof DomainError) {
    return c.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      error.status,
    )
  }
  console.error(error)
  return c.json({ error: error.message || 'Internal error' }, 500)
}

/** The Agent a path param names by id, unique name or id prefix; 404 otherwise. */
export function routeAgent(c: Context, param = 'id'): Agent {
  const ref = c.req.param(param) ?? ''
  const { db } = getCtx()
  const agent = agentRepo.get(db, ref)
  if (agent) return agent
  const named = db.raw
    .query<{ id: string }, [string]>('SELECT id FROM agents WHERE name = ? ORDER BY created_at')
    .all(ref)
  if (named.length > 1) {
    const ids = named.map((row) => row.id.slice(0, 8)).join(', ')
    throw new DomainError(404, `agent name "${ref}" is ambiguous (${ids}); use an id`)
  }
  throw new DomainError(404, `agent not found: ${ref}`)
}

/** The Team a path param names; 404 otherwise. */
export function routeTeam(c: Context, param = 'id'): Team {
  const { db, paths } = getCtx()
  const ref = c.req.param(param) ?? ''
  const team = teamRepo.get(db, ref, paths)
  if (!team) throw new DomainError(404, `team not found: ${ref}`)
  return team
}

/** The request's JSON object body, or null when it is missing, malformed or not an object. */
export async function jsonBody<T extends object>(c: Context): Promise<Partial<T> | null> {
  const body: unknown = await c.req.json().catch(() => null)
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Partial<T>)
    : null
}
