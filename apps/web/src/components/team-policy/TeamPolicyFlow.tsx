import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  MiniMap,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Bot, CircleAlert, Globe2, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
  edgeKey,
  OUTSIDE,
  type PolicyDocument,
  type PolicyMember,
  type PolicyPosition,
} from '../../lib/team-policy'

interface AgentNodeData extends Record<string, unknown> {
  member: PolicyMember
  isolated: boolean
  incomplete: boolean
  live: boolean
}

interface OutsideNodeData extends Record<string, unknown> {
  label: string
}

type PolicyFlowNode = FlowNode<AgentNodeData, 'agent'> | FlowNode<OutsideNodeData, 'outside'>

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
            {data.live ? (data.member.status ?? 'member') : 'slot'}
          </span>
        </span>
        {data.isolated && (
          <ShieldAlert className="h-4 w-4 flex-none text-[#a56568]" aria-label="No allow edges" />
        )}
        {data.incomplete && (
          <CircleAlert className="h-4 w-4 flex-none text-warning" aria-label="Incomplete slot" />
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

function OutsideNode({ data, selected }: NodeProps<FlowNode<OutsideNodeData, 'outside'>>) {
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
        <Globe2 className="h-4 w-4 flex-none text-rose-baziu" aria-hidden="true" />
        <span className="block text-sm font-semibold text-chocolate">{data.label}</span>
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
  outside: OutsideNode,
}

interface TeamPolicyFlowProps {
  document: PolicyDocument
  selectedId: string | null
  incompleteKeys: Set<string>
  onSelect: (id: string | null) => void
  onConnect: (from: string, to: string) => void
  onRemoveEdge: (from: string, to: string) => void
  onMoveMember: (key: string, position: PolicyPosition) => void
  onOpenMember: (member: PolicyMember) => void
}

export function TeamPolicyFlow({
  document,
  selectedId,
  incompleteKeys,
  onSelect,
  onConnect,
  onRemoveEdge,
  onMoveMember,
  onOpenMember,
}: TeamPolicyFlowProps) {
  const computedNodes = useMemo<PolicyFlowNode[]>(() => {
    const outsideX = Math.max(800, ...document.members.map((member) => member.position.x + 280))
    const outside: PolicyFlowNode = {
      id: OUTSIDE,
      type: 'outside',
      position: { x: outsideX, y: 110 },
      data: { label: 'Other teams' },
      ariaLabel: 'Agents in other teams',
      selected: selectedId === OUTSIDE,
      draggable: false,
      deletable: false,
    }
    const members = document.members.map<PolicyFlowNode>((member) => {
      // Only a restricted Team cuts off a member without edges; in an open Team
      // teammates message each other freely.
      const isolated =
        document.mode === 'restricted' &&
        !document.edges.some((edge) => edge.from === member.key || edge.to === member.key)
      const incomplete = incompleteKeys.has(member.key)
      return {
        id: member.key,
        type: 'agent',
        position: member.position,
        data: { member, isolated, incomplete, live: document.kind === 'live' },
        ariaLabel: `${member.name}${isolated ? ', no allow edges' : ''}${incomplete ? ', incomplete' : ''}`,
        selected: selectedId === member.key,
        deletable: false,
      }
    })
    return [outside, ...members]
  }, [document, incompleteKeys, selectedId])
  const [nodes, setNodes, onNodesChange] = useNodesState<PolicyFlowNode>(computedNodes)

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]))
      return computedNodes.map((node) => ({ ...currentById.get(node.id), ...node }))
    })
  }, [computedNodes, setNodes])

  const edges = useMemo<FlowEdge[]>(
    () =>
      document.edges.map((edge) => {
        const id = edgeKey(edge.from, edge.to)
        return {
          id,
          source: edge.from,
          target: edge.to,
          selected: selectedId === id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { stroke: 'var(--color-sapphire)', strokeWidth: 1.7 },
        }
      }),
    [document.edges, selectedId],
  )

  const connect = (connection: Connection) => {
    if (connection.source && connection.target) onConnect(connection.source, connection.target)
  }
  const memberFor = (id: string) => document.members.find((member) => member.key === id)

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
          const member = memberFor(node.id)
          if (member) onOpenMember(member)
        }}
        onEdgeClick={(_event, edge) => onSelect(edge.id)}
        onPaneClick={() => onSelect(null)}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted) onRemoveEdge(edge.source, edge.target)
        }}
        onNodeDragStop={(_event, node) => {
          if (memberFor(node.id)) onMoveMember(node.id, node.position)
        }}
        minZoom={0.35}
        maxZoom={1.8}
        edgesReconnectable={false}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
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
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="!hidden !rounded-md !border !border-frost !bg-snow sm:!block"
          nodeColor={(node) =>
            node.type === 'outside' ? 'var(--color-rose-baziu)' : 'var(--color-sapphire)'
          }
          maskColor="color-mix(in srgb, var(--color-cream) 70%, transparent)"
        />
      </ReactFlow>
    </div>
  )
}
