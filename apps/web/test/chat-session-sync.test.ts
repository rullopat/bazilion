import type {
  AgentActivity,
  SessionHeadResponse,
  UserQueueItem,
  UserQueueListResponse,
} from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { draftEntry } from '../src/components/chat/entries.ts'
import {
  activityReaction,
  headMoved,
  isQueueWorking,
  openFollowUps,
} from '../src/components/chat/session-sync.ts'

const item = (status: UserQueueItem['status']) => ({ status }) as UserQueueItem
const queue = (items: UserQueueItem[], extra: Partial<UserQueueListResponse> = {}) => ({
  paused: false,
  turnActive: false,
  items,
  ...extra,
})

const idle: AgentActivity = {
  agentId: 'a1',
  teamId: 'launch',
  working: false,
  step: null,
  questions: 0,
  approvals: 0,
  queuePaused: false,
  followUps: 0,
  lastActivityAt: 1_000,
  results: 0,
  lastResultAt: null,
}

test('open follow-ups are the waiting and running ones', () => {
  expect(openFollowUps(null)).toBe(0)
  const items = [item('pending'), item('running'), item('completed'), item('failed')]
  expect(openFollowUps(queue(items))).toBe(2)
})

test('the queue works while a turn runs or a follow-up runs or may start', () => {
  expect(isQueueWorking(null)).toBeFalsy()
  expect(isQueueWorking(queue([]))).toBe(false)
  expect(isQueueWorking(queue([], { turnActive: true }))).toBe(true)
  expect(isQueueWorking(queue([item('running')], { paused: true }))).toBe(true)
  expect(isQueueWorking(queue([item('pending')]))).toBe(true)
  expect(isQueueWorking(queue([item('pending')], { paused: true }))).toBe(false)
})

test('the head moved when the file, its size or its readability changed', () => {
  const known: SessionHeadResponse = { file: 'a.jsonl', size: 10, conversationId: 'c1' }
  expect(headMoved({ ...known }, known)).toBe(false)
  expect(headMoved({ ...known, conversationId: 'c2' }, known)).toBe(false)
  expect(headMoved({ ...known, size: 11 }, known)).toBe(true)
  expect(headMoved({ ...known, file: 'b.jsonl' }, known)).toBe(true)
  expect(headMoved({ ...known, unavailable: true }, known)).toBe(true)
  expect(headMoved({ ...known, unavailable: false }, known)).toBe(false)
})

test('an activity reading asks for the head, the queue, both, or nothing', () => {
  expect(activityReaction(null, idle)).toBe('head')
  expect(activityReaction(idle, { ...idle })).toBe(null)
  expect(activityReaction(idle, { ...idle, working: true })).toBe('queue')
  expect(activityReaction({ ...idle, working: true }, idle)).toBe('queue-then-head')
  expect(activityReaction(idle, { ...idle, followUps: 1 })).toBe('queue')
  expect(activityReaction(idle, { ...idle, queuePaused: true })).toBe('queue')
  expect(activityReaction(idle, { ...idle, lastActivityAt: 2_000 })).toBe('head')
  const working = { ...idle, working: true }
  expect(activityReaction(working, { ...working, lastActivityAt: 2_000 })).toBe(null)
})

test('a message being sent shows its text, its images and the names of its other files', () => {
  expect(draftEntry('hi', [])).toEqual({ type: 'user', content: 'hi' })
  const image = { mimeType: 'image/png', data: 'AAAA', name: 'shot.png' }
  const entry = draftEntry('look', [image, { mimeType: 'text/plain', data: 'eA==' }])
  expect(entry).toEqual({
    type: 'user',
    content: 'look',
    images: [image],
    files: [{ name: 'file' }],
  })
})
