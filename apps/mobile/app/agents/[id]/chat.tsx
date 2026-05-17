import type { ChatFrame, ProviderMessage, SessionEvent } from '@bazilion/api-types'
import { useHeaderHeight } from '@react-navigation/elements'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { clearCredentials, type Credentials, loadCredentials } from '@/src/auth'
import { useColors } from '@/src/theme-context'
import { type Colors, fonts, radii } from '@/src/theme'

// Display-side rendering item. Derived from the server's ProviderMessage[]
// (history) and SessionEvent stream (live turn). Tool-call/result pairs are
// collapsed into a single tool item so the UI doesn't show them as separate
// rows.
type Item =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'tool'; name: string; result?: string; error?: string }
  | { id: string; kind: 'error'; text: string }

let _itemIdSeq = 0
const nextItemId = (): string => `i${++_itemIdSeq}`

/** Turn the server's flattened ProviderMessage[] (history) into display Items. */
function historyToItems(messages: ProviderMessage[]): Item[] {
  const out: Item[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ id: nextItemId(), kind: 'user', text: m.content })
    } else if (m.role === 'assistant') {
      if (m.content) out.push({ id: nextItemId(), kind: 'assistant', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        out.push({ id: tc.id, kind: 'tool', name: tc.name })
      }
    } else if (m.role === 'tool') {
      // Backfill matching tool item with its result. The tool entry was
      // pushed when we saw the assistant's tool_call above; find by id.
      const idx = out.findIndex((it) => it.kind === 'tool' && it.id === m.toolCallId)
      if (idx >= 0) {
        const existing = out[idx]
        if (existing && existing.kind === 'tool') {
          out[idx] = { ...existing, result: m.content }
        }
      }
    }
  }
  return out
}

/**
 * Apply a SessionEvent emitted during a turn to the running items list.
 * Pure — caller commits the new array via setState.
 */
function applyEvent(items: Item[], ev: SessionEvent): Item[] {
  switch (ev.type) {
    case 'user_message':
      // Already appended locally on send; ignore the echo.
      return items
    case 'assistant_message':
      return [...items, { id: nextItemId(), kind: 'assistant', text: ev.text }]
    case 'assistant_delta': {
      const last = items[items.length - 1]
      if (last && last.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + ev.delta }]
      }
      return [...items, { id: nextItemId(), kind: 'assistant', text: ev.delta }]
    }
    case 'tool_call':
      return [...items, { id: ev.id, kind: 'tool', name: ev.name }]
    case 'tool_result':
    case 'tool_error': {
      const idx = items.findIndex((it) => it.kind === 'tool' && it.id === ev.id)
      if (idx < 0) return items
      const existing = items[idx]
      if (!existing || existing.kind !== 'tool') return items
      const updated: Item =
        ev.type === 'tool_result'
          ? { ...existing, result: ev.result }
          : { ...existing, error: ev.error }
      return [...items.slice(0, idx), updated, ...items.slice(idx + 1)]
    }
    case 'error':
      return [...items, { id: nextItemId(), kind: 'error', text: ev.error }]
    default:
      return items
  }
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [items, setItems] = useState<Item[]>([])
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [draft, setDraft] = useState('')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // Real header height (varies with notch / dynamic island / safe-area
  // insets) so KeyboardAvoidingView lifts the input box above the keyboard
  // by exactly the right amount.
  const headerHeight = useHeaderHeight()
  // Bottom inset clears the home indicator on iPhones with curved
  // corners — without this, the input row gets clipped at rest.
  const insets = useSafeAreaInsets()

  // FlatList is `inverted` so the visual bottom is index 0 of the rendered
  // data — chronological items get reversed at render time. This makes the
  // list anchor itself to the bottom by default; no scrollToEnd dance.
  const reversedItems = useMemo(() => [...items].reverse(), [items])

  // History fetch on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const c = await loadCredentials()
      if (!c) {
        router.replace('/pair')
        return
      }
      if (cancelled) return
      setCreds(c)
      try {
        const res = await fetch(`${c.server}/api/agents/${id}/sessions/messages`, {
          headers: { authorization: `Bearer ${c.token}`, origin: c.server },
        })
        if (res.status === 401) {
          await clearCredentials()
          router.replace('/pair')
          return
        }
        if (!res.ok) {
          throw new Error(`server returned ${res.status} loading history`)
        }
        const body = (await res.json()) as { messages: ProviderMessage[] }
        if (cancelled) return
        setItems(historyToItems(body.messages))
        setLoadState('ready')
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'unknown error')
        setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const onSend = useCallback(async () => {
    if (!creds || sending) return
    const text = draft.trim()
    if (!text) return

    setDraft('')
    setSending(true)
    setItems((prev) => [...prev, { id: nextItemId(), kind: 'user', text }])

    try {
      const res = await fetch(`${creds.server}/api/agents/${id}/chat`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${creds.token}`,
          origin: creds.server,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      })
      if (res.status === 401) {
        await clearCredentials()
        router.replace('/pair')
        return
      }
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({ error: res.statusText }))) as {
          error?: string
        }
        throw new Error(errBody.error ?? `server returned ${res.status}`)
      }
      // Buffered NDJSON: read the whole body, split per line, parse each
      // ChatFrame, then apply contained SessionEvents in order. RN's
      // ReadableStream support is platform-flaky; buffering trades the
      // typing-effect for reliability.
      const raw = await res.text()
      const frames: ChatFrame[] = raw
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as ChatFrame)

      let next = items
      for (const frame of frames) {
        if (frame.kind === 'event') {
          next = applyEvent(next, frame.event)
          // Apply via setState too so each frame committed visibly when
          // the chunk lands. (We defer to the final setState below for
          // efficiency; this comment notes intent.)
        } else if (frame.kind === 'fatal') {
          next = [...next, { id: nextItemId(), kind: 'error', text: frame.error }]
        }
      }
      setItems(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      setItems((prev) => [...prev, { id: nextItemId(), kind: 'error', text: message }])
    } finally {
      setSending(false)
    }
  }, [creds, draft, id, items, sending])

  if (loadState === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    )
  }

  if (loadState === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn't load chat</Text>
        <Text style={styles.errorBody}>{loadError}</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        data={reversedItems}
        inverted
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <Bubble item={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Start the conversation.</Text>
          </View>
        }
      />
      {sending ? (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color={colors.mochaLight} />
          <Text style={styles.thinkingText}>thinking…</Text>
        </View>
      ) : null}
      <View style={[styles.inputRow, { paddingBottom: 4 + insets.bottom }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.fawn}
          style={styles.input}
          multiline
          editable={!sending}
        />
        <Pressable
          onPress={onSend}
          disabled={sending || !draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            (sending || !draft.trim()) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function Bubble({ item }: { item: Item }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors])
  if (item.kind === 'user') {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowRight]}>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{item.text}</Text>
        </View>
      </View>
    )
  }
  if (item.kind === 'assistant') {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        </View>
      </View>
    )
  }
  if (item.kind === 'tool') {
    const status = item.error ? 'error' : item.result !== undefined ? 'done' : 'running'
    return (
      <View style={styles.toolRow}>
        <Text style={styles.toolLabel}>
          ⚙ {item.name} · {status}
        </Text>
        {item.error ? (
          <Text style={styles.toolError} numberOfLines={3}>
            {item.error}
          </Text>
        ) : item.result ? (
          <Text style={styles.toolResult} numberOfLines={4}>
            {item.result}
          </Text>
        ) : null}
      </View>
    )
  }
  return (
    <View style={styles.errorRow}>
      <Text style={styles.errorBubbleText}>error: {item.text}</Text>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    listContent: { padding: 12, paddingBottom: 24, gap: 8 },
    empty: { padding: 32, alignItems: 'center' },
    emptyText: { color: colors.mochaLight, fontSize: 13, fontFamily: fonts.body },
    bubbleRow: { flexDirection: 'row' },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '85%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.lg },
    bubbleUser: { backgroundColor: colors.sapphire },
    bubbleUserText: { color: colors.primaryForeground, fontSize: 15, fontFamily: fonts.body },
    bubbleAssistant: { backgroundColor: colors.card },
    bubbleAssistantText: { color: colors.foreground, fontSize: 15, fontFamily: fonts.body },
    toolRow: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.ivory,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 4,
    },
    toolLabel: { fontFamily: fonts.mono, fontSize: 12, color: colors.mocha },
    toolResult: { fontFamily: fonts.mono, fontSize: 11, color: colors.mochaLight },
    toolError: { fontFamily: fonts.mono, fontSize: 11, color: colors.destructive },
    errorRow: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      // 6-char hex + 1A alpha suffix = ~10% opacity; tracks colors.destructive
      // across both themes without needing a separate `destructiveBg` token.
      backgroundColor: `${colors.destructive}1A`,
      borderRadius: radii.md,
    },
    errorBubbleText: { color: colors.destructive, fontSize: 13, fontFamily: fonts.body },
    thinking: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    thinkingText: {
      color: colors.mochaLight,
      fontSize: 12,
      fontStyle: 'italic',
      fontFamily: fonts.body,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.xl,
      backgroundColor: colors.ivory,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: fonts.body,
    },
    sendBtn: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radii.xl,
      backgroundColor: colors.sapphire,
      alignSelf: 'flex-end',
    },
    sendBtnDisabled: { backgroundColor: colors.mochaLight },
    sendBtnPressed: { backgroundColor: colors.sapphireDeep },
    sendBtnText: { color: colors.primaryForeground, fontSize: 14, fontFamily: fonts.bodyMedium },
    errorTitle: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.foreground },
    errorBody: { color: colors.destructive, textAlign: 'center', fontFamily: fonts.body },
  })

// Style overrides for assistant-bubble markdown. Matches the surrounding
// bubble look (Baziu body font, foreground color) and trims default
// vertical paragraph margins so short replies don't get extra space.
const makeMarkdownStyles = (colors: Colors) =>
  StyleSheet.create({
    body: { color: colors.foreground, fontSize: 15, fontFamily: fonts.body },
    paragraph: { marginTop: 0, marginBottom: 0 },
    heading1: {
      fontSize: 22,
      fontFamily: fonts.display,
      color: colors.foreground,
      marginTop: 4,
      marginBottom: 4,
    },
    heading2: {
      fontSize: 19,
      fontFamily: fonts.display,
      color: colors.foreground,
      marginTop: 4,
      marginBottom: 4,
    },
    heading3: {
      fontSize: 17,
      fontFamily: fonts.bodyBold,
      color: colors.foreground,
      marginTop: 4,
      marginBottom: 4,
    },
    strong: { fontFamily: fonts.bodyBold },
    code_inline: {
      fontFamily: fonts.mono,
      fontSize: 13,
      backgroundColor: colors.frost,
      color: colors.charcoal,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    code_block: {
      fontFamily: fonts.mono,
      fontSize: 12,
      backgroundColor: colors.frost,
      color: colors.charcoal,
      padding: 8,
      borderRadius: radii.sm,
    },
    fence: {
      fontFamily: fonts.mono,
      fontSize: 12,
      backgroundColor: colors.frost,
      color: colors.charcoal,
      padding: 8,
      borderRadius: radii.sm,
    },
    link: { color: colors.sapphireDeep },
    blockquote: {
      backgroundColor: colors.ivory,
      borderLeftColor: colors.sapphire,
      borderLeftWidth: 3,
      paddingLeft: 8,
      paddingVertical: 4,
      marginVertical: 4,
    },
    bullet_list: { marginVertical: 2 },
    ordered_list: { marginVertical: 2 },
  })
