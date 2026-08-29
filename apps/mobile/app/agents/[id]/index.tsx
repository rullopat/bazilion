import type { ResolvedAgent } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { clearCredentials, clientFor, type Credentials, loadCredentials } from '@/src/auth'
import { useColors } from '@/src/theme-context'
import { mobileErrorMessage } from '@/src/errors'
import { type Colors, fonts, radii } from '@/src/theme'

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; agent: ResolvedAgent }
  | { kind: 'error'; message: string }

export default function AgentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const fetchAgent = useCallback(async () => {
    setLoad({ kind: 'loading' })
    let creds: Credentials | null = null
    try {
      creds = await loadCredentials()
      if (!creds) {
        router.replace('/pair')
        return
      }
      const agent = await clientFor(creds).get<ResolvedAgent>(`/api/agents/${id}`)
      setLoad({ kind: 'ready', agent })
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await clearCredentials()
        router.replace('/pair')
        return
      }
      const message = mobileErrorMessage(err, creds?.server ?? 'the Bazilion gateway')
      setLoad({ kind: 'error', message })
    }
  }, [id])

  useEffect(() => {
    fetchAgent()
  }, [fetchAgent])

  if (load.kind === 'loading') {
    return (
      <View style={styles.centered} accessibilityLabel="Loading agent details">
        <ActivityIndicator />
      </View>
    )
  }

  if (load.kind === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn't load agent</Text>
        <Text style={styles.errorBody} accessibilityRole="alert">
          {load.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading agent details"
          style={styles.primaryBtn}
          onPress={fetchAgent}
        >
          <Text style={styles.primaryBtnText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const a = load.agent
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{a.agent.name}</Text>
      <Text style={styles.subtitle}>{a.agent.id}</Text>

      <Section label="status">
        <Text style={styles.mono}>{a.agent.status}</Text>
      </Section>

      <Section label="model">
        <Text style={styles.mono}>{a.model}</Text>
      </Section>

      <Section label="profile">
        <Text style={styles.mono}>{a.agent.profileId}</Text>
      </Section>

      <Section label="reasoning">
        <Text style={styles.mono}>{a.reasoningLevel}</Text>
      </Section>

      <Section label="team">
        <Text style={styles.mono}>{a.team.name}</Text>
        <Text style={styles.dim}>{a.team.path}</Text>
      </Section>

      <Section label={`skills (${a.skills.length})`}>
        {a.skills.length === 0 ? (
          <Text style={styles.dim}>(none attached)</Text>
        ) : (
          a.skills.map((name) => (
            <Text key={name} style={styles.mono}>
              {name}
            </Text>
          ))
        )}
      </Section>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open chat with ${a.agent.name}`}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
        onPress={() => router.push(`/agents/${a.agent.id}/chat`)}
      >
        <Text style={styles.primaryBtnText}>Open chat</Text>
      </Pressable>
    </ScrollView>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 8 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    name: { fontSize: 26, fontFamily: fonts.display, color: colors.foreground },
    subtitle: { fontFamily: fonts.mono, fontSize: 12, color: colors.mochaLight, marginBottom: 8 },
    section: { marginTop: 12 },
    sectionLabel: {
      fontSize: 11,
      color: colors.mocha,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
      fontFamily: fonts.bodyMedium,
    },
    sectionBody: { gap: 2 },
    mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.charcoal },
    dim: { color: colors.mochaLight, fontSize: 13, fontFamily: fonts.body },
    placeholder: {
      marginTop: 32,
      padding: 16,
      borderRadius: radii.md,
      backgroundColor: colors.ivory,
      gap: 6,
    },
    placeholderTitle: { fontSize: 14, fontFamily: fonts.bodyMedium, color: colors.mocha },
    placeholderBody: { fontSize: 12, color: colors.mochaLight, lineHeight: 18, fontFamily: fonts.body },
    errorTitle: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.foreground },
    errorBody: { color: colors.destructive, textAlign: 'center', fontFamily: fonts.body },
    primaryBtn: {
      marginTop: 24,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: radii.md,
      backgroundColor: colors.sapphire,
      alignItems: 'center',
    },
    primaryBtnPressed: { backgroundColor: colors.sapphireDeep },
    primaryBtnText: { color: colors.primaryForeground, fontSize: 15, fontFamily: fonts.bodyMedium },
  })
