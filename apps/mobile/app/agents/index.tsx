import type { Agent } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  clearCredentials,
  clientFor,
  type Credentials,
  loadCredentials,
} from '@/src/auth'
import { useColors } from '@/src/theme-context'
import { mobileErrorMessage } from '@/src/errors'
import { type Colors, fonts, radii } from '@/src/theme'

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; agents: Agent[]; creds: Credentials }
  | { kind: 'error'; message: string }

export default function AgentsList() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  // Skip the loading-spinner on re-focus (navigating back from chat /
  // settings) — show the stale list while the background refetch runs so
  // the screen doesn't flash empty every time.
  const hasLoaded = useRef(false)
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const fetchAgents = useCallback(async (initial: boolean) => {
    if (initial) setLoad({ kind: 'loading' })
    let creds: Credentials | null = null
    try {
      creds = await loadCredentials()
      if (!creds) {
        router.replace('/pair')
        return
      }
      const agents = await clientFor(creds).get<Agent[]>('/api/agents')
      setLoad({ kind: 'ready', agents, creds })
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        // Token was revoked or the daemon's auth was rotated. Force re-pair.
        await clearCredentials()
        router.replace('/pair')
        return
      }
      const message = mobileErrorMessage(err, creds?.server ?? 'the Bazilion gateway')
      setLoad({ kind: 'error', message })
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      fetchAgents(!hasLoaded.current)
      hasLoaded.current = true
    }, [fetchAgents]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchAgents(false)
    } finally {
      setRefreshing(false)
    }
  }, [fetchAgents])

  const onUnpair = useCallback(async () => {
    await clearCredentials()
    router.replace('/pair')
  }, [])

  if (load.kind === 'loading') {
    return (
      <View style={styles.centered} accessibilityLabel="Loading agents">
        <ActivityIndicator />
      </View>
    )
  }

  if (load.kind === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn't load agents</Text>
        <Text style={styles.errorBody} accessibilityRole="alert">
          {load.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading agents"
          style={styles.primaryBtn}
          onPress={() => fetchAgents(true)}
        >
          <Text style={styles.primaryBtnText}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unpair this device"
          style={styles.linkBtn}
          onPress={onUnpair}
        >
          <Text style={styles.linkBtnText}>Unpair</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerServer}>{load.creds.server}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Bazilion settings"
          onPress={() => router.push('/settings')}
          hitSlop={10}
        >
          <Text style={styles.headerSettings}>Settings</Text>
        </Pressable>
      </View>
      <FlatList
        data={load.agents}
        accessibilityLabel="Bazilion agents"
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No agents yet</Text>
            <Text style={styles.emptyBody}>
              Spawn one from the web UI or `bazilion agent spawn` on the server.
            </Text>
          </View>
        }
        renderItem={({ item }) => <AgentRow agent={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  )
}

function AgentRow({ agent }: { agent: Agent }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}, ${agent.status}`}
      accessibilityHint="Opens chat. Long press opens agent details."
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/agents/${agent.id}/chat`)}
      onLongPress={() => router.push(`/agents/${agent.id}`)}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {agent.name}
        </Text>
        <Text style={styles.rowModel} numberOfLines={1}>
          {agent.modelOverride ?? '(profile default)'}
        </Text>
      </View>
      <View style={[styles.pill, agent.status === 'archived' ? styles.pillArchived : styles.pillActive]}>
        <Text style={styles.pillText}>{agent.status}</Text>
      </View>
    </Pressable>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.ivory,
    },
    headerServer: {
      fontFamily: fonts.mono,
      fontSize: 12,
      color: colors.mocha,
      flex: 1,
    },
    headerSettings: { color: colors.sapphireDeep, fontSize: 14, fontFamily: fonts.bodyMedium },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    errorTitle: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.foreground },
    errorBody: { color: colors.destructive, textAlign: 'center', fontFamily: fonts.body },
    primaryBtn: {
      marginTop: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: radii.md,
      backgroundColor: colors.sapphire,
    },
    primaryBtnText: { color: colors.primaryForeground, fontSize: 14, fontFamily: fonts.bodyMedium },
    linkBtn: { marginTop: 4, padding: 8 },
    linkBtnText: { color: colors.mocha, fontSize: 13, fontFamily: fonts.body },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: colors.card,
    },
    rowPressed: { backgroundColor: colors.frost },
    rowMain: { flex: 1, marginRight: 12 },
    rowName: { fontSize: 16, fontFamily: fonts.bodyMedium, color: colors.foreground },
    rowModel: { fontSize: 12, color: colors.mochaLight, marginTop: 2, fontFamily: fonts.mono },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.frost, marginLeft: 16 },
    pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.md },
    pillActive: { backgroundColor: colors.sapphireGlow },
    pillArchived: { backgroundColor: colors.frost },
    pillText: {
      fontSize: 11,
      fontFamily: fonts.bodyMedium,
      textTransform: 'lowercase',
      color: colors.mocha,
    },
    empty: { padding: 32, alignItems: 'center', gap: 8 },
    emptyTitle: { fontSize: 16, fontFamily: fonts.bodyMedium, color: colors.foreground },
    emptyBody: { color: colors.mocha, textAlign: 'center', fontSize: 13, fontFamily: fonts.body },
  })
