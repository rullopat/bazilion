import type { CreateTokenResponse, ListTokensResponse, WebToken } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { clearCredentials, clientFor, type Credentials, loadCredentials } from '@/src/auth'
import { colors, fonts, radii } from '@/src/theme'

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; creds: Credentials; tokens: WebToken[]; bootstrapId: string | null }
  | { kind: 'error'; message: string }

export default function Settings() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [newLabel, setNewLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [mintedSecret, setMintedSecret] = useState<{ token: string; meta: WebToken } | null>(null)

  const fetchTokens = useCallback(async () => {
    setLoad({ kind: 'loading' })
    const creds = await loadCredentials()
    if (!creds) {
      router.replace('/pair')
      return
    }
    try {
      const res = await clientFor(creds).get<ListTokensResponse>('/api/tokens')
      // Identify the bootstrap row so the UI can hide its revoke button
      // (matches the daemon's 409-on-revoke guard).
      const bootstrap = res.tokens.find((t) => t.label === 'bootstrap')
      setLoad({
        kind: 'ready',
        creds,
        tokens: res.tokens,
        bootstrapId: bootstrap?.id ?? null,
      })
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await clearCredentials()
        router.replace('/pair')
        return
      }
      const message = err instanceof Error ? err.message : 'unknown error'
      setLoad({ kind: 'error', message })
    }
  }, [])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const onMint = useCallback(async () => {
    if (load.kind !== 'ready' || minting) return
    const label = newLabel.trim()
    if (!label) return
    setMinting(true)
    try {
      const res = await clientFor(load.creds).post<CreateTokenResponse>('/api/tokens', { label })
      setMintedSecret({ token: res.token, meta: res.meta })
      setNewLabel('')
      await fetchTokens()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      Alert.alert('Could not mint token', message)
    } finally {
      setMinting(false)
    }
  }, [load, minting, newLabel, fetchTokens])

  const onRevoke = useCallback(
    async (id: string) => {
      if (load.kind !== 'ready') return
      Alert.alert(
        'Revoke token?',
        'Devices using this token will lose access immediately.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: async () => {
              try {
                await clientFor(load.creds).del(`/api/tokens/${id}`)
                await fetchTokens()
              } catch (err) {
                const message = err instanceof Error ? err.message : 'unknown error'
                Alert.alert('Could not revoke', message)
              }
            },
          },
        ],
        { cancelable: true },
      )
    },
    [load, fetchTokens],
  )

  const onUnpair = useCallback(() => {
    Alert.alert(
      'Unpair this device?',
      'You will need to scan a new pairing QR to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await clearCredentials()
            router.replace('/pair')
          },
        },
      ],
      { cancelable: true },
    )
  }, [])

  if (load.kind === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    )
  }

  if (load.kind === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn't load settings</Text>
        <Text style={styles.errorBody}>{load.message}</Text>
        <Pressable style={styles.primaryBtn} onPress={fetchTokens}>
          <Text style={styles.primaryBtnText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={onUnpair}>
          <Text style={styles.linkBtnText}>Unpair</Text>
        </Pressable>
      </View>
    )
  }

  const tokenPreview = `${load.creds.token.slice(0, 6)}…${load.creds.token.slice(-4)}`

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section label="server">
        <Text style={styles.mono}>{load.creds.server}</Text>
      </Section>

      <Section label="this device's token">
        <Text style={styles.mono}>{tokenPreview}</Text>
      </Section>

      <View style={styles.divider} />

      <Section label="mint a new token">
        <View style={styles.mintRow}>
          <TextInput
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="e.g. tablet, laptop"
            placeholderTextColor="#aaa"
            style={styles.mintInput}
            editable={!minting}
            autoCapitalize="none"
          />
          <Pressable
            onPress={onMint}
            disabled={minting || !newLabel.trim()}
            style={({ pressed }) => [
              styles.mintBtn,
              (minting || !newLabel.trim()) && styles.mintBtnDisabled,
              pressed && styles.mintBtnPressed,
            ]}
          >
            <Text style={styles.mintBtnText}>{minting ? '…' : 'Mint'}</Text>
          </Pressable>
        </View>
        {mintedSecret ? (
          <View style={styles.mintedBox}>
            <Text style={styles.mintedLabel}>new token (shown once):</Text>
            <Text style={styles.mintedToken} selectable>
              {mintedSecret.token}
            </Text>
            <Text style={styles.mintedHint}>
              copy this now — it cannot be retrieved later. label: {mintedSecret.meta.label}
            </Text>
          </View>
        ) : null}
      </Section>

      <Section label={`tokens (${load.tokens.length})`}>
        <FlatList
          data={load.tokens}
          scrollEnabled={false}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <TokenRow
              token={item}
              isBootstrap={item.id === load.bootstrapId}
              onRevoke={() => onRevoke(item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.tokenSep} />}
        />
      </Section>

      <View style={styles.divider} />

      <Pressable
        onPress={onUnpair}
        style={({ pressed }) => [styles.dangerBtn, pressed && styles.dangerBtnPressed]}
      >
        <Text style={styles.dangerBtnText}>Unpair this device</Text>
      </Pressable>
    </ScrollView>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function TokenRow({
  token,
  isBootstrap,
  onRevoke,
}: {
  token: WebToken
  isBootstrap: boolean
  onRevoke: () => void
}) {
  const status = token.revokedAt ? 'revoked' : 'active'
  const last = token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : '(never used)'
  return (
    <View style={styles.tokenRow}>
      <View style={styles.tokenInfo}>
        <Text style={styles.tokenLabel}>
          {token.label} {isBootstrap ? <Text style={styles.tokenBootstrap}>· bootstrap</Text> : null}
        </Text>
        <Text style={styles.tokenMeta}>
          {status} · {last}
        </Text>
      </View>
      {!isBootstrap && !token.revokedAt ? (
        <Pressable onPress={onRevoke} hitSlop={10}>
          <Text style={styles.tokenRevoke}>Revoke</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  section: { marginTop: 16 },
  sectionLabel: {
    fontSize: 11,
    color: colors.mocha,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    fontFamily: fonts.bodyMedium,
  },
  sectionBody: { gap: 4 },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.charcoal },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 },
  mintRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  mintInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.ivory,
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.body,
  },
  mintBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.sapphire,
  },
  mintBtnDisabled: { backgroundColor: colors.mochaLight },
  mintBtnPressed: { backgroundColor: colors.sapphireDeep },
  mintBtnText: { color: colors.snow, fontSize: 14, fontFamily: fonts.bodyMedium },
  mintedBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.sapphireGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sapphire,
    gap: 6,
  },
  mintedLabel: {
    fontSize: 11,
    color: colors.sapphireDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: fonts.bodyMedium,
  },
  mintedToken: { fontFamily: fonts.mono, fontSize: 12, color: colors.charcoal },
  mintedHint: { fontSize: 11, color: colors.sapphireDeep, fontFamily: fonts.body },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  tokenSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.frost },
  tokenInfo: { flex: 1 },
  tokenLabel: { fontSize: 14, color: colors.foreground, fontFamily: fonts.body },
  tokenBootstrap: { color: colors.mochaLight, fontSize: 11, fontFamily: fonts.body },
  tokenMeta: { fontSize: 11, color: colors.mochaLight, marginTop: 2, fontFamily: fonts.body },
  tokenRevoke: { color: colors.destructive, fontSize: 13, fontFamily: fonts.bodyMedium },
  primaryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.sapphire,
  },
  primaryBtnText: { color: colors.snow, fontSize: 14, fontFamily: fonts.bodyMedium },
  linkBtn: { marginTop: 4, padding: 8 },
  linkBtnText: { color: colors.mocha, fontSize: 13, fontFamily: fonts.body },
  dangerBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.destructive,
    alignItems: 'center',
  },
  dangerBtnPressed: { backgroundColor: 'rgba(155, 61, 61, 0.1)' },
  dangerBtnText: { color: colors.destructive, fontSize: 14, fontFamily: fonts.bodyMedium },
  errorTitle: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.foreground },
  errorBody: { color: colors.destructive, textAlign: 'center', fontFamily: fonts.body },
})
