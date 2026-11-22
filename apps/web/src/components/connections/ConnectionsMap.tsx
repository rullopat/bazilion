// The Team as a map: an Agent per node with what it is doing, a line per pair of Agents that are
// connected or that talked, arrowheads for who may message whom. Drag from one node to another
// to connect them.

import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentIdentityFile } from '@bazilion/api-types'
import { Globe2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { AgentState } from '../../lib/activity'
import { pairKey } from '../../lib/messages'
import { hasEdge, OUTSIDE, type PolicyDocument, type PolicyPosition } from '../../lib/team-policy'
import { AgentAvatar } from '../AgentAvatar'
import { STATE_DOT } from '../workspace/Rail'

export interface MapMember {
  id: string
  name: string
  identity: AgentIdentityFile | null | undefined
  state: AgentState
  /** In a restricted Team, a member with no connection at all. */
  isolated: boolean
  position: PolicyPosition
}

interface MemberData extends Record<string, unknown> {
  member: MapMember
}
type MemberNode = FlowNode<MemberData, 'member'>
type OutsideNode = FlowNode<Record<string, unknown>, 'outside'>
type MapNode = MemberNode | OutsideNode

const HANDLE = '!size-2.5 !border-2 !border-snow !bg-sapphire'
const SIDES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
] as const

function Handles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={side.id}
          id={side.id}
          type="source"
          position={side.position}
          className={HANDLE}
        />
      ))}
    </>
  )
}

function MemberNodeView({ data, selected }: NodeProps<MemberNode>) {
  const { member } = data
  return (
    <div
      className={`w-[210px] rounded-2xl border bg-snow px-3 py-2.5 shadow-baziu-sm transition-shadow ${
        selected ? 'border-sapphire shadow-baziu-md' : 'border-frost'
      }`}
    >
      <Handles />
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar identity={member.identity} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-chocolate">{member.name}</span>
          <span
            className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${
              member.isolated ? 'font-semibold text-warning' : 'text-mocha'
            }`}
          >
            <span
              className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[member.state.kind]}`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">
              {member.isolated ? 'No connections' : member.state.text}
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}

function OutsideNodeView({ selected }: NodeProps<OutsideNode>) {
  return (
    <div
      className={`w-[160px] rounded-2xl border border-dashed bg-ivory px-3 py-2.5 ${
        selected ? 'border-sapphire' : 'border-fawn'
      }`}
    >
      <Handles />
      <div className="flex items-center gap-2">
        <Globe2 className="size-4 shrink-0 text-rose-baziu" aria-hidden="true" />
        <span className="block text-sm font-semibold text-chocolate">Other teams</span>
      </div>
    </div>
  )
}

const NODE_TYPES: NodeTypes = { member: MemberNodeView, outside: OutsideNodeView }

/** The id of the line between two actors, whichever way it is asked. */
export const pairId = (a: string, b: string) => `pair:${pairKey(a, b)}`

export function pairOf(id: string | null): [string, string] | null {
  if (!id?.startsWith('pair:')) return null
  const [a, b] = id.slice(5).split('|')
  return a && b ? [a, b] : null
}

const NODE_SIZE = { member: { w: 210, h: 62 }, outside: { w: 160, h: 46 } }

/** The sides of two nodes that face each other. */
function facing(a: MapNode, b: MapNode): { from: string; to: string } {
  const size = (node: MapNode) => NODE_SIZE[node.type === 'outside' ? 'outside' : 'member']
  const dx = b.position.x + size(b).w / 2 - (a.position.x + size(a).w / 2)
  const dy = b.position.y + size(b).h / 2 - (a.position.y + size(a).h / 2)
  // Nodes are wide: a pair counts as side by side unless one is clearly above the other.
  if (Math.abs(dx) >= Math.abs(dy) * 1.4)
    return dx > 0 ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' }
  return dy > 0 ? { from: 'b', to: 't' } : { from: 't', to: 'b' }
}

export function ConnectionsMap({
  document,
  members,
  traffic,
  selectedId,
  onSelect,
  onConnect,
  onMove,
  onOpenMember,
}: {
  document: PolicyDocument
  members: MapMember[]
  /** Messages exchanged per pair id, both ways together. */
  traffic: ReadonlyMap<string, number>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onConnect: (from: string, to: string) => void
  onMove: (id: string, position: PolicyPosition) => void
  onOpenMember: (id: string) => void
}) {
  const computed = useMemo<MapNode[]>(() => {
    const right = Math.max(520, ...members.map((member) => member.position.x + 270))
    const middle =
      members.length === 0
        ? 120
        : members.reduce((sum, member) => sum + member.position.y, 0) / members.length
    return [
      ...members.map<MapNode>((member) => ({
        id: member.id,
        type: 'member',
        position: member.position,
        data: { member },
        ariaLabel: `${member.name}: ${member.isolated ? 'no connections' : member.state.text}`,
        selected: selectedId === member.id,
        deletable: false,
      })),
      {
        id: OUTSIDE,
        type: 'outside',
        position: { x: right, y: middle },
        data: {},
        ariaLabel: 'Agents in other teams',
        selected: selectedId === OUTSIDE,
        draggable: false,
        deletable: false,
      },
    ]
  }, [members, selectedId])
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>(computed)

  // New data keeps the positions of nodes being dragged.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]))
      return computed.map((node) => {
        const known = byId.get(node.id)
        return known?.dragging ? ({ ...node, position: known.position } as MapNode) : node
      })
    })
  }, [computed, setNodes])

  const edges = useMemo<FlowEdge[]>(() => {
    const out: FlowEdge[] = []
    const shown = new Map(nodes.map((node) => [node.id, node]))
    const ids = [...shown.keys()]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i] as string, ids[j] as string].sort() as [string, string]
        const forward = hasEdge(document, a, b)
        const back = hasEdge(document, b, a)
        const id = pairId(a, b)
        const messages = traffic.get(id) ?? 0
        if (!forward && !back && messages === 0) continue
        const from = shown.get(a) as MapNode
        const to = shown.get(b) as MapNode
        const sides = facing(from, to)
        const connected = forward || back
        const selected = selectedId === id
        const stroke = selected
          ? 'var(--color-sapphire-deep)'
          : connected
            ? 'var(--color-sapphire)'
            : 'var(--color-fawn)'
        const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke }
        out.push({
          id,
          source: a,
          target: b,
          sourceHandle: sides.from,
          targetHandle: sides.to,
          selected,
          ...(forward ? { markerEnd: marker } : {}),
          ...(back ? { markerStart: marker } : {}),
          style: {
            stroke,
            strokeWidth: selected ? 2.6 : 1.8,
            // A pair that talked without a connection (an open Team) is a dashed line.
            ...(connected ? {} : { strokeDasharray: '5 5' }),
          },
          ...(messages > 0
            ? {
                label: `${messages} message${messages === 1 ? '' : 's'}`,
                labelStyle: { fontSize: 11, fontWeight: 600, fill: 'var(--color-mocha)' },
                labelBgStyle: { fill: 'var(--color-snow)', stroke: 'var(--color-frost)' },
                labelBgPadding: [6, 3] as [number, number],
                labelBgBorderRadius: 8,
              }
            : {}),
          interactionWidth: 24,
        })
      }
    }
    return out
  }, [nodes, document, traffic, selectedId])

  const connect = (connection: Connection) => {
    if (connection.source && connection.target && connection.source !== connection.target) {
      onConnect(connection.source, connection.target)
    }
  }

  return (
    <div className="h-full min-h-[420px] w-full bg-ivory">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onConnect={connect}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === 'member') onOpenMember(node.id)
        }}
        onEdgeClick={(_event, edge) => onSelect(edge.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_event, node) => {
          if (node.type === 'member') onMove(node.id, node.position)
        }}
        deleteKeyCode={null}
        minZoom={0.35}
        maxZoom={1.6}
        edgesReconnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        className="policy-flow"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color="var(--color-fawn)"
        />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!overflow-hidden !rounded-md !border !border-frost !bg-snow !shadow-baziu-sm [&_button]:!border-frost [&_button]:!bg-snow [&_button]:!fill-chocolate"
        />
      </ReactFlow>
    </div>
  )
}
