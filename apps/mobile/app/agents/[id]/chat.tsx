import type {
  ChatFrame,
  ProviderMessage,
  ResolvedAgent,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { clearCredentials, clientFor, type Credentials, loadCredentials } from '@/src/auth'
import {
  appendChatNotice,
  appendLocalUser,
  applyChatFrame,
  type ChatItem,
  type ChatState,
  chatStateFromHistory,
  parseCommunicationPending,
} from '@/src/chat-state'
import { mobileErrorMessage } from '@/src/errors'
import { NdjsonDecoder } from '@/src/ndjson'
import { useColors } from '@/src/theme-context'
import { type Colors, fonts, radii } from '@/src/theme'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; creds: Credentials; agent: ResolvedAgent }
  | { kind: 'error'; message: string }

const EMPTY_CHAT: ChatState = {
  items: [],
  assistantDraftId: null,
  terminal: 'idle',
}

function isChatFrame(value: unknown): value is ChatFrame {
  if (!value || typeof value !== 'object') return false
  const frame = value as Record<string, unknown>
  if (frame.kind === 'fatal') return typeof frame.error === 'string'
  if (frame.kind === 'done') return Array.isArray(frame.messages)
  return frame.kind === 'event' && !!frame.event && typeof frame.event === 'object'
}

function responseError(body: unknown, status: number, fallback: string): string {
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>
    if (typeof value.error === 'string') return value.error
    if (typeof value.reason === 'string') return value.reason
    if (typeof value.code === 'string') return value.code.replaceAll('_', ' ')
  }
  return fallback || `server returned ${status}`
}

async function consumeChatFrames(
  response: Response,
  onFrame: (frame: ChatFrame) => void,
): Promise<void> {
  const decoder = new NdjsonDecoder<unknown>()
  const emit = (value: unknown) => {
    if (!isChatFrame(value)) throw new SyntaxError('invalid chat frame')
    onFrame(value)
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const text = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of decoder.push(text.decode(value, { stream: true }))) emit(frame)
    }
    for (const frame of decoder.finish(text.decode())) emit(frame)
    return
  }

  // Some React Native fetch implementations expose no readable body. Keep a
  // correct buffered fallback for ordinary turns instead of dropping frames.
  for (const frame of decoder.finish(await response.text())) emit(frame)
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [chat, setChat] = useState<ChatState>(EMPTY_CHAT)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [failedMessage, setFailedMessage] = useState<string | null>(null)
  const streamAbort = useRef<AbortController | null>(null)
  const cancelRequested = useRef(false)
  const disposed = useRef(false)
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const insets = useSafeAreaInsets()
  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 44 : 0
  const reversedItems = useMemo(() => [...chat.items].reverse(), [chat.items])

  useEffect(() => {
    let cancelled = false
    setLoad({ kind: 'loading' })
    ;(async () => {
      let creds: Credentials | null = null
      try {
        creds = await loadCredentials()
        if (!creds) {
          router.replace('/pair')
          return
        }
        const client = clientFor(creds)
        const [agent, history] = await Promise.all([
          client.get<ResolvedAgent>(`/api/agents/${id}`),
          client.get<{ messages: ProviderMessage[] }>(`/api/agents/${id}/sessions/messages`),
        ])
        if (cancelled) return
        setChat(chatStateFromHistory(history.messages))
        setLoad({ kind: 'ready', creds, agent })
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiClientError && error.status === 401) {
          await clearCredentials()
          router.replace('/pair')
          return
        }
        setLoad({
          kind: 'error',
          message: mobileErrorMessage(error, creds?.server ?? 'the Bazilion gateway'),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      streamAbort.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (load.kind !== 'ready' || sending || streamAbort.current) return
      const message = text.trim()
      if (!message) return

      const controller = new AbortController()
      streamAbort.current = controller
      cancelRequested.current = false
      setDraft('')
      setFailedMessage(null)
      setSending(true)
      setChat((current) => appendLocalUser(current, message))

      let terminalFrame = false
      try {
        const response = await fetch(`${load.creds.server}/api/agents/${id}/chat`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${load.creds.token}`,
            origin: load.creds.server,
            'content-type': 'application/json',
          },
          // Native keeps dangerous shell commands fail-closed. Interactive
          // command approval requires a guaranteed streaming transport; the
          // web chat remains the supported approval surface.
          body: JSON.stringify({ message, bashApprovalMode: 'auto_deny' }),
          signal: controller.signal,
        })

        if (response.status === 401) {
          await clearCredentials()
          router.replace('/pair')
          return
        }
        if (response.status === 202) {
          const pending = parseCommunicationPending(await response.json())
          const expiry = new Date(pending.expiresAt).toLocaleString()
          setChat((current) => ({
            ...appendChatNotice(
              current,
              'info',
              `Message held for Team Policy approval until ${expiry}. Review it in the web Approval queue.`,
            ),
            terminal: 'done',
          }))
          terminalFrame = true
          return
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(responseError(body, response.status, response.statusText))
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('application/x-ndjson')) {
          throw new SyntaxError(`expected NDJSON, received ${contentType || 'no content type'}`)
        }

        await consumeChatFrames(response, (frame) => {
          if (frame.kind === 'done' || frame.kind === 'fatal') {
            terminalFrame = true
            if (frame.kind === 'fatal') setFailedMessage(message)
          }
          setChat((current) => applyChatFrame(current, frame))
        })
        if (!terminalFrame) throw new Error('Chat stream ended before a done or fatal frame.')
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError' && disposed.current) {
          return
        }
        if (error instanceof Error && error.name === 'AbortError' && cancelRequested.current) {
          setChat((current) => ({
            ...appendChatNotice(current, 'info', 'Turn cancelled.'),
            terminal: 'done',
          }))
        } else {
          const detail = mobileErrorMessage(error, load.creds.server)
          setChat((current) => ({
            ...appendChatNotice(current, 'error', detail),
            terminal: 'fatal',
          }))
          setFailedMessage(message)
          setDraft((current) => current || message)
        }
      } finally {
        if (streamAbort.current === controller) {
          streamAbort.current = null
          cancelRequested.current = false
          if (!disposed.current) {
            setSending(false)
            setCanceling(false)
          }
        }
      }
    },
    [id, load, sending],
  )

  const onSend = useCallback(() => {
    void sendMessage(draft)
  }, [draft, sendMessage])

  const onCancel = useCallback(async () => {
    if (load.kind !== 'ready' || !streamAbort.current || canceling) return
    setCanceling(true)
    try {
      await clientFor(load.creds).post(`/api/agents/${id}/cancel`)
      cancelRequested.current = true
      streamAbort.current?.abort()
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        setChat((current) =>
          appendChatNotice(
            current,
            'info',
            'The turn already finished; waiting for its final response.',
          ),
        )
        setCanceling(false)
        return
      }
      setChat((current) =>
        appendChatNotice(
          current,
          'error',
          `Couldn’t confirm cancellation. ${mobileErrorMessage(error, load.creds.server)}`,
        ),
      )
      setCanceling(false)
    }
  }, [canceling, id, load])

  if (load.kind === 'loading') {
    return (
      <View style={styles.centered} accessibilityLabel="Loading chat">
        <ActivityIndicator />
      </View>
    )
  }

  if (load.kind === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn’t load chat</Text>
        <Text style={styles.errorBody} accessibilityRole="alert">
          {load.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading chat"
          style={styles.primaryBtn}
          onPress={() => setReloadKey((value) => value + 1)}
        >
          <Text style={styles.primaryBtnText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const identity = load.agent.agent.identity
  const recipient = `${identity?.emoji ? `${identity.emoji} ` : ''}${load.agent.agent.name}`

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardOffset}
    >
      <Stack.Screen options={{ title: load.agent.agent.name }} />
      <View style={styles.recipient} accessible accessibilityLabel={`Chatting with ${recipient}`}>
        <Text style={styles.recipientName}>Chatting with {recipient}</Text>
        <Text style={styles.recipientMeta} numberOfLines={1}>
          {load.agent.team.name} · {load.agent.model}
        </Text>
      </View>
      <FlatList
        data={reversedItems}
        inverted
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Bubble item={item} />}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel={`Conversation with ${load.agent.agent.name}`}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Start the conversation.</Text>
          </View>
        }
      />
      {sending ? (
        <View style={styles.thinking} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.mocha} />
          <Text style={styles.thinkingText}>{canceling ? 'cancelling…' : 'working…'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Cancel ${load.agent.agent.name}’s active turn`}
            disabled={canceling}
            onPress={() => void onCancel()}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {failedMessage && !sending ? (
        <View style={styles.retryRow} accessibilityLiveRegion="polite">
          <Text style={styles.retryText} numberOfLines={2}>
            Send failed. Check the conversation before retrying if the connection dropped mid-turn.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send failed message again"
            onPress={() => void sendMessage(failedMessage)}
            style={styles.retryBtn}
          >
            <Text style={styles.retryBtnText}>Send again</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.inputRow, { paddingBottom: 4 + insets.bottom }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${load.agent.agent.name}`}
          placeholderTextColor={colors.mocha}
          style={styles.input}
          multiline
          editable={!sending}
          accessibilityLabel={`Message ${load.agent.agent.name}`}
          accessibilityHint="Enter a message for this agent"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send message to ${load.agent.agent.name}`}
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

function Bubble({ item }: { item: ChatItem }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors])
  if (item.kind === 'user') {
    return (
      <View
        style={[styles.bubbleRow, styles.bubbleRowRight]}
        accessible
        accessibilityLabel={`You: ${item.text}`}
      >
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{item.text}</Text>
        </View>
      </View>
    )
  }
  if (item.kind === 'assistant') {
    return (
      <View
        style={[styles.bubbleRow, styles.bubbleRowLeft]}
        accessible
        accessibilityLabel={`Agent: ${item.text}`}
      >
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        </View>
      </View>
    )
  }
  if (item.kind === 'tool') {
    const status = item.error ? 'error' : item.result !== undefined ? 'done' : 'running'
    return (
      <View style={styles.toolRow} accessible accessibilityLabel={`${item.name} tool ${status}`}>
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
        {item.images?.map((image, index) => (
          <Image
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only image result list
            key={index}
            source={{ uri: `data:${image.mimeType};base64,${image.data}` }}
            style={styles.toolImage}
            resizeMode="contain"
            accessibilityLabel={`${item.name} result image ${index + 1}`}
          />
        ))}
      </View>
    )
  }
  if (item.kind === 'file') {
    return (
      <View style={styles.fileRow} accessible accessibilityLabel={`Delivered file ${item.name}`}>
        {item.mimeType.startsWith('image/') ? (
          <Image
            source={{ uri: `data:${item.mimeType};base64,${item.data}` }}
            style={styles.fileImage}
            resizeMode="contain"
            accessibilityLabel={item.name}
          />
        ) : null}
        <Text style={styles.fileName}>📄 {item.name}</Text>
        <Text style={styles.fileType}>{item.mimeType}</Text>
      </View>
    )
  }
  if (item.kind === 'approval') {
    return (
      <View
        style={styles.approvalRow}
        accessible
        accessibilityLabel={`Shell command ${item.approval.status}`}
      >
        <Text style={styles.approvalTitle}>Shell command · {item.approval.status}</Text>
        <Text style={styles.approvalCommand}>{item.approval.command}</Text>
        <Text style={styles.approvalHint}>Use web chat to review interactive shell commands.</Text>
      </View>
    )
  }
  return (
    <View
      style={item.tone === 'error' ? styles.errorRow : styles.infoRow}
      accessibilityRole={item.tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      <Text style={item.tone === 'error' ? styles.errorBubbleText : styles.infoBubbleText}>
        {item.text}
      </Text>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    recipient: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.ivory,
    },
    recipientName: { color: colors.foreground, fontFamily: fonts.bodyMedium, fontSize: 14 },
    recipientMeta: { color: colors.mocha, fontFamily: fonts.mono, fontSize: 11, marginTop: 1 },
    listContent: { padding: 12, paddingBottom: 24, gap: 8 },
    empty: { padding: 32, alignItems: 'center' },
    emptyText: { color: colors.mocha, fontSize: 13, fontFamily: fonts.body },
    bubbleRow: { flexDirection: 'row' },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '85%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.lg },
    bubbleUser: { backgroundColor: colors.sapphire },
    bubbleUserText: { color: colors.primaryForeground, fontSize: 15, fontFamily: fonts.body },
    bubbleAssistant: { backgroundColor: colors.card },
    toolRow: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.ivory,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 4,
    },
    toolLabel: { fontFamily: fonts.mono, fontSize: 12, color: colors.mocha },
    toolResult: { fontFamily: fonts.mono, fontSize: 11, color: colors.mocha },
    toolError: { fontFamily: fonts.mono, fontSize: 11, color: colors.destructive },
    toolImage: { width: '100%', height: 220, borderRadius: radii.sm, marginTop: 6 },
    fileRow: {
      padding: 12,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapphire,
      backgroundColor: colors.sapphireGlow,
      gap: 4,
    },
    fileImage: { width: '100%', height: 240, borderRadius: radii.sm, marginBottom: 4 },
    fileName: { color: colors.foreground, fontFamily: fonts.bodyMedium, fontSize: 14 },
    fileType: { color: colors.mocha, fontFamily: fonts.mono, fontSize: 11 },
    approvalRow: {
      padding: 12,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.destructive,
      backgroundColor: `${colors.destructive}12`,
      gap: 6,
    },
    approvalTitle: { color: colors.destructive, fontFamily: fonts.bodyBold, fontSize: 13 },
    approvalCommand: { color: colors.foreground, fontFamily: fonts.mono, fontSize: 12 },
    approvalHint: { color: colors.mocha, fontFamily: fonts.body, fontSize: 12 },
    errorRow: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: `${colors.destructive}1A`,
      borderRadius: radii.md,
    },
    infoRow: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.sapphireGlow,
      borderRadius: radii.md,
      borderLeftWidth: 3,
      borderLeftColor: colors.sapphire,
    },
    errorBubbleText: { color: colors.destructive, fontSize: 13, fontFamily: fonts.body },
    infoBubbleText: { color: colors.accentForeground, fontSize: 13, fontFamily: fonts.body },
    thinking: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    thinkingText: { flex: 1, color: colors.mocha, fontSize: 12, fontFamily: fonts.body },
    cancelBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    cancelBtnText: { color: colors.destructive, fontSize: 13, fontFamily: fonts.bodyMedium },
    retryRow: {
      marginHorizontal: 12,
      marginBottom: 4,
      padding: 10,
      borderRadius: radii.md,
      backgroundColor: `${colors.destructive}12`,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    retryText: { flex: 1, color: colors.destructive, fontSize: 11, fontFamily: fonts.body },
    retryBtn: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radii.sm,
      backgroundColor: colors.card,
    },
    retryBtnText: { color: colors.destructive, fontSize: 12, fontFamily: fonts.bodyMedium },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radii.xl,
      backgroundColor: colors.ivory,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: fonts.body,
    },
    sendBtn: {
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: radii.xl,
      backgroundColor: colors.sapphire,
      alignSelf: 'flex-end',
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: colors.mocha },
    sendBtnPressed: { backgroundColor: colors.sapphireDeep },
    sendBtnText: { color: colors.primaryForeground, fontSize: 14, fontFamily: fonts.bodyMedium },
    errorTitle: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.foreground },
    errorBody: { color: colors.destructive, textAlign: 'center', fontFamily: fonts.body },
    primaryBtn: {
      marginTop: 8,
      minHeight: 44,
      paddingHorizontal: 20,
      paddingVertical: 11,
      borderRadius: radii.md,
      backgroundColor: colors.sapphire,
      justifyContent: 'center',
    },
    primaryBtnText: { color: colors.primaryForeground, fontSize: 14, fontFamily: fonts.bodyMedium },
  })

const makeMarkdownStyles = (colors: Colors) => ({
  body: { color: colors.foreground, fontSize: 15, fontFamily: fonts.body, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 7 },
  heading1: {
    color: colors.foreground,
    fontFamily: fonts.display,
    fontSize: 22,
    marginVertical: 6,
  },
  heading2: {
    color: colors.foreground,
    fontFamily: fonts.display,
    fontSize: 19,
    marginVertical: 5,
  },
  heading3: {
    color: colors.foreground,
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    marginVertical: 4,
  },
  strong: { fontFamily: fonts.bodyBold },
  em: { fontStyle: 'italic' as const },
  code_inline: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.charcoal,
    backgroundColor: colors.frost,
  },
  code_block: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.charcoal,
    backgroundColor: colors.ivory,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: 10,
  },
  fence: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.charcoal,
    backgroundColor: colors.ivory,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: 10,
  },
  link: { color: colors.sapphireDeep, textDecorationLine: 'underline' as const },
  blockquote: {
    backgroundColor: colors.ivory,
    borderLeftColor: colors.sapphire,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
})
