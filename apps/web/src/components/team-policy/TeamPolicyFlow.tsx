import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
  type Viewport,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Bot, CircleAlert, CircleUserRound, Globe2, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
  OUTSIDE_GROUP_ENDPOINT,
  USER_ENDPOINT,
  endpointForMember,
  endpointFromKey,
  endpointKey,
  type TeamPolicyDocument,
  type TeamPolicyEndpoint,
  type TeamPolicyMember,
  type TeamPolicyPosition,
} from '../../lib/team-policy'

interface AgentNodeData extends Record<string, unknown> {
  member: TeamPolicyMember
  isolated: boolean
  incomplete: boolean
  live: boolean
}

interface BoundaryNodeData extends Record<string, unknown> {
  label: string
  detail: string
  kind: 'user' | 'outside_team'
}

type TeamPolicyFlowNode = FlowNode<AgentNodeData, 'agent'> | FlowNode<BoundaryNodeData, 'boundary'>

function AgentNode({ data, selected }: NodeProps<FlowNode<AgentNodeData, 'agent'>>) {
  return (
    <div
      className={`relative w-[190px] rounded-md border bg-snow px-3 py-2.5 shadow-baziu-sm transition-shadow ${
        selected ? 'border-sapphire shadow-baziu-md' : 'border-frost'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-snow !bg-sapphire"
      />
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-sapphire-glow text-sapphire">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-chocolate">
            {data.member.name}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[0.68rem] text-mocha-light">
            {data.member.role ?? (data.live ? data.member.status ?? 'local member' : 'member slot')}
          </span>
        </span>
        {data.isolated && (
          <ShieldAlert
            className="h-4 w-4 flex-none text-[#a56568]"
            aria-label="Isolated member"
          />
        )}
        {data.incomplete && (
          <CircleAlert
            className="h-4 w-4 flex-none text-amber-700 dark:text-amber-300"
            aria-label="Incomplete member"
          />
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-snow !bg-sapphire"
      />
    </div>
  )
}

function BoundaryNode({ data, selected }: NodeProps<FlowNode<BoundaryNodeData, 'boundary'>>) {
  const Icon = data.kind === 'user' ? CircleUserRound : Globe2
  return (
    <div
      className={`w-[150px] rounded-md border bg-ivory px-3 py-2.5 shadow-baziu-sm ${
        selected ? 'border-sapphire' : 'border-fawn'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-ivory !bg-rose-baziu"
      />
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 flex-none text-rose-baziu" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-chocolate">{data.label}</span>
          <span className="block truncate text-[0.66rem] text-mocha-light">{data.detail}</span>
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-ivory !bg-rose-baziu"
      />
    </div>
  )
}

const NODE_TYPES: NodeTypes = {
  agent: AgentNode,
  boundary: BoundaryNode,
}

interface TeamPolicyFlowProps {
  teamPolicy: TeamPolicyDocument
  selectedId: string | null
  viewport: Viewport
  incompleteSlotIds: Set<string>
  simulatedPath: {
    source: TeamPolicyEndpoint
    target: TeamPolicyEndpoint
    decision: 'allow' | 'deny'
  } | null
  onSelect: (id: string | null) => void
  onConnect: (source: TeamPolicyEndpoint, target: TeamPolicyEndpoint) => void
  onRemoveEdge: (source: TeamPolicyEndpoint, target: TeamPolicyEndpoint) => void
  onMoveMember: (slotId: string, position: TeamPolicyPosition) => void
  onViewportChange: (viewport: Viewport) => void
  onOpenMember: (member: TeamPolicyMember) => void
}

export function TeamPolicyFlow({
  teamPolicy,
  selectedId,
  viewport,
  incompleteSlotIds,
  simulatedPath,
  onSelect,
  onConnect,
  onRemoveEdge,
  onMoveMember,
  onViewportChange,
  onOpenMember,
}: TeamPolicyFlowProps) {
  const computedNodes = useMemo<TeamPolicyFlowNode[]>(() => {
    const outsideX = Math.max(930, ...teamPolicy.members.map((member) => member.position.x + 280))
    const boundaryNodes: TeamPolicyFlowNode[] = [
      {
        id: endpointKey(USER_ENDPOINT),
        type: 'boundary',
        position: { x: 20, y: 110 },
        data: { label: 'User', detail: 'Web, CLI, Telegram', kind: 'user' },
        ariaLabel: 'User communication boundary',
        selected: selectedId === endpointKey(USER_ENDPOINT),
        draggable: false,
        deletable: false,
      },
      {
        id: endpointKey(OUTSIDE_GROUP_ENDPOINT),
        type: 'boundary',
        position: { x: outsideX, y: 110 },
        data: { label: 'Other teams', detail: 'Local Bazilion agents', kind: 'outside_team' },
        ariaLabel: 'Other local teams communication boundary',
        selected: selectedId === endpointKey(OUTSIDE_GROUP_ENDPOINT),
        draggable: false,
        deletable: false,
      },
    ]
    const memberNodes = teamPolicy.members.map<TeamPolicyFlowNode>((member) => {
      const endpoint = endpointForMember(teamPolicy, member)
      const isolated = !teamPolicy.policy.edges.some(
        (edge) =>
          endpointKey(edge.source) === endpointKey(endpoint) ||
          endpointKey(edge.target) === endpointKey(endpoint),
      )
      return {
        id: endpointKey(endpoint),
        type: 'agent',
        position: member.position,
        data: {
          member,
          isolated,
          incomplete: incompleteSlotIds.has(member.slotId),
          live: teamPolicy.kind === 'live',
        },
        ariaLabel: `${member.name}, ${isolated ? 'isolated' : 'configured'}${incompleteSlotIds.has(member.slotId) ? ', incomplete' : ''} ${teamPolicy.kind === 'live' ? 'agent' : 'member slot'}`,
        selected: selectedId === endpointKey(endpoint),
        deletable: false,
      }
    })
    return [...boundaryNodes, ...memberNodes]
  }, [teamPolicy, incompleteSlotIds, selectedId])
  const [nodes, setNodes, onNodesChange] = useNodesState<TeamPolicyFlowNode>(computedNodes)

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]))
      return computedNodes.map((node) => ({ ...currentById.get(node.id), ...node }))
    })
  }, [computedNodes, setNodes])

  const edges = useMemo<FlowEdge[]>(() => {
    const simulationKey = simulatedPath
      ? `${endpointKey(simulatedPath.source)}>${endpointKey(simulatedPath.target)}`
      : null
    const policyEdges = teamPolicy.policy.edges.map((edge) => {
      const simulated = simulationKey === `${endpointKey(edge.source)}>${endpointKey(edge.target)}`
      return {
        id: edge.id,
        source: endpointKey(edge.source),
        target: endpointKey(edge.target),
        selected: selectedId === edge.id,
        animated: simulated,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: {
          stroke: simulated ? 'var(--color-rose-baziu)' : 'var(--color-sapphire)',
          strokeWidth: simulated ? 3 : 1.7,
        },
      }
    })
    if (!simulatedPath || simulatedPath.decision === 'allow') return policyEdges
    return [
      ...policyEdges,
      {
        id: `simulation:${simulationKey}`,
        source: endpointKey(simulatedPath.source),
        target: endpointKey(simulatedPath.target),
        animated: true,
        deletable: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: 'var(--color-rose-baziu)',
        },
        style: {
          stroke: 'var(--color-rose-baziu)',
          strokeDasharray: '6 5',
          strokeWidth: 2.5,
        },
      },
    ]
  }, [teamPolicy.policy.edges, selectedId, simulatedPath])

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    const source = endpointFromKey(connection.source)
    const target = endpointFromKey(connection.target)
    if (source && target) onConnect(source, target)
  }

  return (
    <div className="h-full min-h-[420px] w-full bg-ivory">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onConnect={connect}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onNodeDoubleClick={(_event, node) => {
          const endpoint = endpointFromKey(node.id)
          if (!endpoint) return
          const member =
            endpoint.kind === 'agent'
              ? teamPolicy.members.find(
                  (candidate) =>
                    (candidate.agentId ?? `prototype:${candidate.slotId}`) === endpoint.agentId,
                )
              : endpoint.kind === 'member_slot'
                ? teamPolicy.members.find((candidate) => candidate.slotId === endpoint.slotId)
                : undefined
          if (member) onOpenMember(member)
        }}
        onEdgeClick={(_event, edge) => onSelect(edge.id)}
        onPaneClick={() => onSelect(null)}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted) {
            const source = endpointFromKey(edge.source)
            const target = endpointFromKey(edge.target)
            if (source && target) onRemoveEdge(source, target)
          }
        }}
        onNodeDragStop={(_event, node) => {
          const endpoint = endpointFromKey(node.id)
          if (!endpoint || !('data' in node)) return
          const member =
            endpoint.kind === 'agent'
              ? teamPolicy.members.find(
                  (candidate) =>
                    (candidate.agentId ?? `prototype:${candidate.slotId}`) === endpoint.agentId,
                )
              : endpoint.kind === 'member_slot'
                ? teamPolicy.members.find((candidate) => candidate.slotId === endpoint.slotId)
                : undefined
          if (member) onMoveMember(member.slotId, node.position)
        }}
        onMoveEnd={(_event, nextViewport) => onViewportChange(nextViewport)}
        defaultViewport={viewport}
        minZoom={0.35}
        maxZoom={1.8}
        edgesReconnectable={false}
        fitView={viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1}
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        className="teamPolicy-flow"
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
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="!hidden !rounded-md !border !border-frost !bg-snow sm:!block"
          nodeColor={(node) => (node.type === 'boundary' ? 'var(--color-rose-baziu)' : 'var(--color-sapphire)')}
          maskColor="color-mix(in srgb, var(--color-cream) 70%, transparent)"
        />
      </ReactFlow>
    </div>
  )
}
