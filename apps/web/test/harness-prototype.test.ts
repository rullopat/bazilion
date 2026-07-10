import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PROFILE_COMMUNICATION,
  HARNESS_STORAGE_KEY,
  OUTSIDE_GROUP_ENDPOINT,
  USER_ENDPOINT,
  addHarnessEdge,
  addHarnessMember,
  addDirectSpawnToPrototype,
  applyProfileDefaults,
  bindLiveGroup,
  createBlockedAttempt,
  createHarnessFixtureState,
  createHarnessTemplate,
  createPresetPolicy,
  deriveHarnessChannel,
  diffLiveHarness,
  endpointForMember,
  endpointsEqual,
  effectiveProfileDefaults,
  evaluateHarnessPolicy,
  hasHarnessEdge,
  isValidHarnessConnection,
  loadHarnessPrototypeState,
  persistHarnessPrototypeState,
  removeHarnessEdge,
  removeHarnessMember,
  saveLiveAsTemplate,
  updateTemplateFromLive,
  type HarnessPrototypeState,
} from '../src/lib/harness-prototype'
import { harnessEndpointLabel } from '../src/lib/harness-presenter'

const profiles = [
  { id: 'planner-profile', name: 'Planner' },
  { id: 'worker-profile', name: 'Worker' },
  { id: 'reviewer-profile', name: 'Reviewer' },
  { id: 'reporter-profile', name: 'Reporter' },
]

describe('harness policy', () => {
  test('compares endpoints and rejects self and boundary-only edges', () => {
    const slot = { kind: 'member_slot' as const, slotId: 'one' }
    expect(endpointsEqual(slot, { kind: 'member_slot', slotId: 'one' })).toBe(true)
    expect(isValidHarnessConnection(slot, slot)).toBe(false)
    expect(isValidHarnessConnection(USER_ENDPOINT, OUTSIDE_GROUP_ENDPOINT)).toBe(false)
    expect(isValidHarnessConnection(USER_ENDPOINT, slot)).toBe(true)
  })

  test('adds unique directed edges and uses absence as deny', () => {
    const slot = { kind: 'member_slot' as const, slotId: 'one' }
    let policy = { version: 1 as const, edges: [] }
    policy = addHarnessEdge(policy, USER_ENDPOINT, slot)
    policy = addHarnessEdge(policy, USER_ENDPOINT, slot)
    expect(policy.edges).toHaveLength(1)
    expect(evaluateHarnessPolicy(policy, USER_ENDPOINT, slot)).toMatchObject({
      decision: 'allow',
    })
    expect(evaluateHarnessPolicy(policy, slot, USER_ENDPOINT)).toMatchObject({
      decision: 'deny',
    })
    expect(removeHarnessEdge(policy, USER_ENDPOINT, slot).edges).toHaveLength(0)
  })

  test('derives all boundary and peer channels', () => {
    const one = { kind: 'agent' as const, agentId: 'one' }
    const two = { kind: 'agent' as const, agentId: 'two' }
    expect(deriveHarnessChannel(USER_ENDPOINT, one)).toBe('user_input')
    expect(deriveHarnessChannel(one, USER_ENDPOINT)).toBe('user_output')
    expect(deriveHarnessChannel(OUTSIDE_GROUP_ENDPOINT, one)).toBe('outside_group_input')
    expect(deriveHarnessChannel(one, OUTSIDE_GROUP_ENDPOINT)).toBe('outside_group_output')
    expect(deriveHarnessChannel(one, two)).toBe('agent_message')
  })
})

describe('presets and defaults', () => {
  test('builds the four documented preset topologies', () => {
    const open = createHarnessTemplate({
      id: 'open',
      name: 'Open',
      preset: 'open_team',
      profiles: profiles.slice(0, 3),
      now: 1,
    })
    const coordinator = createHarnessTemplate({
      id: 'coord',
      name: 'Coordinator',
      preset: 'coordinator',
      profiles: profiles.slice(0, 3),
      now: 1,
    })
    const review = createHarnessTemplate({
      id: 'review',
      name: 'Review',
      preset: 'review_pipeline',
      profiles,
      now: 1,
    })
    const blank = createHarnessTemplate({
      id: 'blank',
      name: 'Blank',
      preset: 'blank',
      profiles: profiles.slice(0, 2),
      now: 1,
    })
    expect(open.policy.edges).toHaveLength(18)
    expect(coordinator.policy.edges).toHaveLength(6)
    expect(review.policy.edges).toHaveLength(5)
    expect(blank.policy.edges).toHaveLength(0)

    for (const member of open.members) {
      const endpoint = endpointForMember(open, member)
      expect(hasHarnessEdge(open.policy, USER_ENDPOINT, endpoint)).toBe(true)
      expect(hasHarnessEdge(open.policy, endpoint, USER_ENDPOINT)).toBe(true)
      expect(hasHarnessEdge(open.policy, OUTSIDE_GROUP_ENDPOINT, endpoint)).toBe(true)
      expect(hasHarnessEdge(open.policy, endpoint, OUTSIDE_GROUP_ENDPOINT)).toBe(true)
    }
    for (const source of open.members) {
      for (const target of open.members) {
        if (source.slotId === target.slotId) continue
        expect(
          hasHarnessEdge(
            open.policy,
            endpointForMember(open, source),
            endpointForMember(open, target),
          ),
        ).toBe(true)
      }
    }

    const coordinatorEndpoint = endpointForMember(coordinator, coordinator.members[0]!)
    const coordinatorWorkers = coordinator.members.slice(1).map((member) =>
      endpointForMember(coordinator, member),
    )
    expect(hasHarnessEdge(coordinator.policy, USER_ENDPOINT, coordinatorEndpoint)).toBe(true)
    expect(hasHarnessEdge(coordinator.policy, coordinatorEndpoint, USER_ENDPOINT)).toBe(true)
    for (const worker of coordinatorWorkers) {
      expect(hasHarnessEdge(coordinator.policy, coordinatorEndpoint, worker)).toBe(true)
      expect(hasHarnessEdge(coordinator.policy, worker, coordinatorEndpoint)).toBe(true)
      expect(hasHarnessEdge(coordinator.policy, USER_ENDPOINT, worker)).toBe(false)
    }
    expect(hasHarnessEdge(coordinator.policy, coordinatorWorkers[0]!, coordinatorWorkers[1]!)).toBe(
      false,
    )

    const reviewEndpoints = review.members.map((member) => endpointForMember(review, member))
    const reviewPath = [USER_ENDPOINT, ...reviewEndpoints, USER_ENDPOINT]
    for (let index = 0; index < reviewPath.length - 1; index++) {
      expect(hasHarnessEdge(review.policy, reviewPath[index]!, reviewPath[index + 1]!)).toBe(true)
    }
    expect(hasHarnessEdge(review.policy, reviewEndpoints[1]!, reviewEndpoints[0]!)).toBe(false)
  })

  test('profile defaults overlay boundary and peer policy deterministically', () => {
    const defaults = {
      userInput: false,
      userOutput: true,
      outsideGroupInput: false,
      outsideGroupOutput: false,
      peerDefault: 'deny_all' as const,
    }
    const preset = createHarnessTemplate({
      id: 'profile-defaults',
      name: 'Defaults',
      preset: 'open_team',
      profiles: profiles.slice(0, 2),
      profileDefaults: { 'planner-profile': defaults },
      now: 1,
    })
    const member = preset.members[0]
    expect(member).toBeDefined()
    if (!member) return
    const endpoint = endpointForMember(preset, member)
    expect(hasHarnessEdge(preset.policy, USER_ENDPOINT, endpoint)).toBe(false)
    expect(hasHarnessEdge(preset.policy, endpoint, USER_ENDPOINT)).toBe(true)
    expect(
      preset.policy.edges.filter((edge) => endpointsEqual(edge.source, endpoint)),
    ).toHaveLength(1)

    defaults.userInput = true
    expect(hasHarnessEdge(preset.policy, USER_ENDPOINT, endpoint)).toBe(false)

    const reapplied = applyProfileDefaults(preset.policy, preset, member, defaults)
    expect(hasHarnessEdge(reapplied, USER_ENDPOINT, endpoint)).toBe(true)
  })

  test('missing profile defaults stay neutral until explicitly saved', () => {
    expect(effectiveProfileDefaults({}, 'planner-profile')).toBeUndefined()
    expect(
      effectiveProfileDefaults({}, 'planner-profile', DEFAULT_PROFILE_COMMUNICATION),
    ).toBe(DEFAULT_PROFILE_COMMUNICATION)

    const blank = createHarnessTemplate({
      id: 'blank-with-unsaved-defaults',
      name: 'Blank with unsaved defaults',
      preset: 'blank',
      profiles: profiles.slice(0, 1),
      profileDefaults: {},
      now: 1,
    })
    expect(blank.policy.edges).toEqual([])

    const explicit = { ...DEFAULT_PROFILE_COMMUNICATION, userInput: false }
    expect(effectiveProfileDefaults({ 'planner-profile': explicit }, 'planner-profile')).toBe(
      explicit,
    )
  })

  test('new blank policy has no implicit permission', () => {
    const template = createHarnessTemplate({
      id: 'blank-test',
      name: 'Blank',
      preset: 'blank',
      profiles: profiles.slice(0, 2),
      now: 1,
    })
    expect(createPresetPolicy('template', template.members, 'blank').edges).toEqual([])
  })

  test('new members stay isolated unless defaults are explicitly applied', () => {
    const template = createHarnessTemplate({
      id: 'member-add',
      name: 'Member add',
      preset: 'blank',
      profiles: profiles.slice(0, 1),
      now: 1,
    })
    const member = {
      slotId: 'new-slot',
      profileId: 'worker-profile',
      name: 'Worker',
      position: { x: 1, y: 1 },
    }
    const isolated = addHarnessMember(template, member)
    expect(isolated.policy.edges).toHaveLength(0)
    const configured = addHarnessMember(template, member, {
      userInput: true,
      userOutput: false,
      outsideGroupInput: false,
      outsideGroupOutput: false,
      peerDefault: 'deny_all',
    })
    expect(configured.policy.edges).toHaveLength(1)
  })

  test('member removal deletes all incident edges', () => {
    const template = createHarnessTemplate({
      id: 'member-remove',
      name: 'Member remove',
      preset: 'open_team',
      profiles: profiles.slice(0, 2),
      now: 1,
    })
    const removed = template.members[0]
    expect(removed).toBeDefined()
    if (!removed) return
    const endpoint = endpointForMember(template, removed)
    const next = removeHarnessMember(template, removed.slotId)
    expect(next.members).toHaveLength(1)
    expect(
      next.policy.edges.some(
        (edge) => endpointsEqual(edge.source, endpoint) || endpointsEqual(edge.target, endpoint),
      ),
    ).toBe(false)
  })
})

describe('live snapshots', () => {
  test('binds template slots to live agents and detects divergence', () => {
    const source = createHarnessTemplate({
      id: 'source',
      name: 'Source',
      preset: 'coordinator',
      profiles: profiles.slice(0, 2),
      now: 1,
    })
    const live = bindLiveGroup({
      group: { id: 'team', name: 'Team' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Planner', status: 'idle' },
        { id: 'a2', profileId: 'worker-profile', name: 'Worker', status: 'running' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    expect(live.policy.edges.every((edge) => edge.source.kind !== 'member_slot')).toBe(true)
    expect(diffLiveHarness(source, live).modified).toBe(false)

    const first = live.members[0]
    const second = live.members[1]
    expect(first?.agentId).toBe('a1')
    expect(second?.agentId).toBe('a2')
    if (!first || !second) return
    const changed = {
      ...live,
      policy: removeHarnessEdge(
        live.policy,
        endpointForMember(live, first),
        endpointForMember(live, second),
      ),
    }
    expect(diffLiveHarness(source, changed).modified).toBe(true)
    expect(diffLiveHarness(source, changed).removedEdges).toHaveLength(1)
  })

  test('detects changed member metadata as roster divergence', () => {
    const source = createHarnessTemplate({
      id: 'source-metadata',
      name: 'Source',
      preset: 'blank',
      profiles: profiles.slice(0, 1),
      now: 1,
    })
    const live = bindLiveGroup({
      group: { id: 'metadata-team', name: 'Metadata team' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Renamed planner', status: 'idle' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    const diff = diffLiveHarness(source, live)
    expect(diff.modified).toBe(true)
    expect(diff.changedMembers).toHaveLength(1)
  })

  test('binds the edited Open Team source snapshot instead of regenerating the preset', () => {
    const initialSource = createHarnessTemplate({
      id: 'open-source',
      name: 'Open source',
      preset: 'open_team',
      profiles: profiles.slice(0, 1),
      now: 1,
    })
    const sourceMember = initialSource.members[0]
    expect(sourceMember).toBeDefined()
    if (!sourceMember) return
    const source = {
      ...initialSource,
      policy: removeHarnessEdge(
        initialSource.policy,
        USER_ENDPOINT,
        endpointForMember(initialSource, sourceMember),
      ),
    }
    const live = bindLiveGroup({
      group: { id: 'legacy-open', name: 'Legacy open' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Planner', status: 'idle' },
        { id: 'a2', profileId: 'worker-profile', name: 'Worker', status: 'idle' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    expect(live.policy.edges).toHaveLength(3)
    const mapped = live.members[0]
    const extra = live.members[1]
    expect(mapped).toBeDefined()
    expect(extra).toBeDefined()
    if (!mapped || !extra) return
    const mappedEndpoint = endpointForMember(live, mapped)
    const extraEndpoint = endpointForMember(live, extra)
    expect(hasHarnessEdge(live.policy, USER_ENDPOINT, mappedEndpoint)).toBe(false)
    expect(hasHarnessEdge(live.policy, mappedEndpoint, USER_ENDPOINT)).toBe(true)
    expect(
      live.policy.edges.some(
        (edge) =>
          endpointsEqual(edge.source, extraEndpoint) || endpointsEqual(edge.target, extraEndpoint),
      ),
    ).toBe(false)
  })

  test('keeps every member of an existing group open for a canonical Open Team source', () => {
    const source = createHarnessTemplate({
      id: 'canonical-open-source',
      name: 'Canonical open source',
      preset: 'open_team',
      profiles: profiles.slice(0, 1),
      now: 1,
    })
    const live = bindLiveGroup({
      group: { id: 'canonical-legacy-open', name: 'Canonical legacy open' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Planner', status: 'idle' },
        { id: 'a2', profileId: 'worker-profile', name: 'Worker', status: 'idle' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    expect(live.policy.edges).toHaveLength(10)
    const extra = live.members[1]
    expect(extra).toBeDefined()
    if (!extra) return
    const endpoint = endpointForMember(live, extra)
    expect(hasHarnessEdge(live.policy, USER_ENDPOINT, endpoint)).toBe(true)
    expect(hasHarnessEdge(live.policy, endpoint, OUTSIDE_GROUP_ENDPOINT)).toBe(true)
  })

  test('labels synthetic live members by their local member name', () => {
    const harness = {
      ...bindLiveGroup({
        group: { id: 'labels', name: 'Labels' },
        agents: [],
        sourceTemplate: createHarnessTemplate({
          id: 'label-source',
          name: 'Label source',
          preset: 'blank',
          profiles: [],
          now: 1,
        }),
        now: 2,
      }),
      members: [
        {
          slotId: 'local-slot',
          profileId: 'worker-profile',
          name: 'Local reviewer',
          position: { x: 0, y: 0 },
        },
      ],
    }
    const member = harness.members[0]
    expect(member).toBeDefined()
    if (!member) return
    expect(harnessEndpointLabel(harness, endpointForMember(harness, member))).toBe(
      'Local reviewer',
    )
  })

  test('updates a source only with explicitly included live-only members', () => {
    const source = createHarnessTemplate({
      id: 'source-update',
      name: 'Source',
      preset: 'blank',
      profiles: profiles.slice(0, 1),
      now: 1,
    })
    const live = bindLiveGroup({
      group: { id: 'team', name: 'Team' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Planner', status: 'idle' },
        { id: 'a2', profileId: 'worker-profile', name: 'Worker', status: 'idle' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    const withoutExtra = updateTemplateFromLive({
      sourceTemplate: source,
      liveHarness: live,
      includeLiveOnlySlots: new Set(),
      now: 3,
    })
    expect(withoutExtra.members).toHaveLength(1)
    const extra = live.members[1]
    expect(extra).toBeDefined()
    if (!extra) return
    const withExtra = updateTemplateFromLive({
      sourceTemplate: source,
      liveHarness: live,
      includeLiveOnlySlots: new Set([extra.slotId]),
      now: 3,
    })
    expect(withExtra.members).toHaveLength(2)
  })

  test('saves live policy as an independent slot-based template', () => {
    const source = createHarnessTemplate({
      id: 'source-save',
      name: 'Source',
      preset: 'open_team',
      profiles: profiles.slice(0, 2),
      now: 1,
    })
    const live = bindLiveGroup({
      group: { id: 'team', name: 'Team' },
      agents: [
        { id: 'a1', profileId: 'planner-profile', name: 'Planner', status: 'idle' },
        { id: 'a2', profileId: 'worker-profile', name: 'Worker', status: 'idle' },
      ],
      sourceTemplate: source,
      now: 2,
    })
    const saved = saveLiveAsTemplate({ liveHarness: live, name: 'Saved', id: 'saved', now: 3 })
    expect(saved.kind).toBe('template')
    expect(saved.members.every((member) => !member.agentId)).toBe(true)
    expect(saved.policy.edges.some((edge) => edge.source.kind === 'agent')).toBe(false)
  })
})

describe('audit and persistence', () => {
  test('direct profile spawn copies defaults into a local live overlay', () => {
    const state = createHarnessFixtureState()
    state.profileDefaults['planner-profile'] = {
      userInput: true,
      userOutput: false,
      outsideGroupInput: false,
      outsideGroupOutput: false,
      peerDefault: 'inherit_harness',
    }
    const next = addDirectSpawnToPrototype({
      state,
      agent: {
        id: 'agent-1',
        profileId: 'planner-profile',
        name: 'Planner',
        status: 'idle',
        groupId: 'direct-group',
      },
      groupName: 'Direct group',
      now: 12,
    })
    const live = next.liveHarnesses.find((harness) => harness.boundGroupId === 'direct-group')
    expect(live?.members[0]?.agentId).toBe('agent-1')
    expect(live?.policy.edges).toHaveLength(1)
  })

  test('direct profile spawn deliberately uses the open fallback when defaults are unsaved', () => {
    const next = addDirectSpawnToPrototype({
      state: createHarnessFixtureState(),
      agent: {
        id: 'agent-with-unsaved-defaults',
        profileId: 'planner-profile',
        name: 'Planner',
        status: 'idle',
        groupId: 'fallback-group',
      },
      now: 13,
    })
    const live = next.liveHarnesses.find((harness) => harness.boundGroupId === 'fallback-group')
    expect(live?.policy.edges).toHaveLength(4)
  })

  test('creates a complete blocked-attempt record', () => {
    const target = { kind: 'agent' as const, agentId: 'a1' }
    expect(
      createBlockedAttempt({
        id: 'block-1',
        harnessId: 'live-team',
        source: USER_ENDPOINT,
        target,
        origin: 'telegram',
        reason: 'No edge',
        now: 123,
      }),
    ).toEqual({
      id: 'block-1',
      harnessId: 'live-team',
      source: USER_ENDPOINT,
      target,
      channel: 'user_input',
      origin: 'telegram',
      reason: 'No edge',
      createdAt: 123,
    })
  })

  test('round-trips valid state and falls back on missing or mismatched versions', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const state = createHarnessFixtureState()
    persistHarnessPrototypeState(state, storage)
    expect(loadHarnessPrototypeState(storage)).toEqual(state)

    values.set(HARNESS_STORAGE_KEY, JSON.stringify({ ...state, version: 99 }))
    expect(loadHarnessPrototypeState(storage).version).toBe(1)
    expect(loadHarnessPrototypeState(storage).templates).toHaveLength(4)

    values.set(HARNESS_STORAGE_KEY, '{invalid')
    expect(loadHarnessPrototypeState(storage).templates).toHaveLength(4)
  })

  test('fixture factory returns independent state objects', () => {
    const left: HarnessPrototypeState = createHarnessFixtureState()
    const right = createHarnessFixtureState()
    left.templates.pop()
    expect(right.templates).toHaveLength(4)
  })
})
