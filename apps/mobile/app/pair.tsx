import { CameraView, useCameraPermissions } from 'expo-camera'
import { useLinkingURL } from 'expo-linking'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { saveCredentials, verifyCredentials } from '@/src/auth'
import {
  canStartPairingAttempt,
  type PairingAttemptSnapshot,
} from '@/src/pairing-attempt'
import { isPairingDeepLink, PairUrlError, parsePairingUrl } from '@/src/pair-url'
import { useColors } from '@/src/theme-context'
import { type Colors, fonts, radii } from '@/src/theme'

/**
 * Browsers require a secure context (HTTPS or localhost) for
 * `navigator.mediaDevices.getUserMedia`. Over LAN / Tailscale on http://,
 * `requestPermission()` silently rejects without ever prompting. Detect
 * that up front so the user doesn't tap a button that does nothing.
 */
function webCameraBlockedReason(): string | null {
  if (Platform.OS !== 'web') return null
  if (typeof window === 'undefined') return null
  const { protocol, hostname } = window.location
  if (protocol === 'https:') return null
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return null
  return `Camera access on the web requires HTTPS. You are on ${protocol}//${hostname} — use the manual-paste flow below, or open this page from a phone via Expo Go.`
}

type Mode = 'scan' | 'paste'

export default function PairScreen() {
  const [mode, setMode] = useState<Mode>('scan')
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [scanPaused, setScanPaused] = useState(false)
  // Expo fires the barcode callback repeatedly on every frame. Keep the gate
  // in a ref so callbacks cannot race React's asynchronous state updates.
  const attempt = useRef<PairingAttemptSnapshot>({
    busy: false,
    lastRaw: null,
    scanPaused: false,
  })
  const linkingUrl = useLinkingURL()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const handlePairingUrl = useCallback(async (
    raw: string,
    source: 'camera' | 'paste' | 'link',
    explicitRetry = false,
  ) => {
    const normalized = raw.trim()
    if (!canStartPairingAttempt(normalized, attempt.current, explicitRetry)) return
    attempt.current = { ...attempt.current, busy: true, lastRaw: normalized }
    setBusy(true)
    setError(null)
    try {
      const creds = parsePairingUrl(normalized)
      await verifyCredentials(creds)
      await saveCredentials(creds)
      router.replace('/agents')
    } catch (err) {
      const msg =
        err instanceof PairUrlError
          ? `${source === 'camera' ? 'QR content' : 'Pairing URL'} is not valid: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'unknown error'
      setError(msg)
      // A failed QR remains under the camera and would otherwise fire again
      // every frame. Require a deliberate "Scan again" action.
      const paused = source !== 'paste'
      attempt.current = { ...attempt.current, scanPaused: paused }
      setScanPaused(paused)
    } finally {
      attempt.current = { ...attempt.current, busy: false }
      setBusy(false)
    }
  }, [])

  // Consume the actual custom-scheme URL on cold launch and while the app is
  // already running. Expo Router opens /pair, but query handling belongs here
  // so the credential is verified before it reaches SecureStore.
  useEffect(() => {
    if (!isPairingDeepLink(linkingUrl)) return
    void handlePairingUrl(linkingUrl, 'link')
  }, [handlePairingUrl, linkingUrl])

  if (mode === 'paste') {
    return (
      <View style={[styles.container, styles.form]}>
        <Text style={styles.title}>Paste pairing URL</Text>
        <Text style={styles.hint}>
          Publish only the loopback web app with Tailscale Serve, then run `bazilion token create
          &lt;label&gt; --expires-days 90 --qr --server $BAZILION_PUBLIC_ORIGIN`.
        </Text>
        <TextInput
          value={pasteValue}
          onChangeText={setPasteValue}
          placeholder="bazilion://pair?server=…&token=…"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          multiline
          placeholderTextColor={colors.mocha}
          accessibilityLabel="Bazilion pairing URL"
          accessibilityHint="Paste the complete pairing URL from the Bazilion CLI"
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Button
            title={busy ? 'Verifying…' : 'Pair'}
            onPress={() => handlePairingUrl(pasteValue, 'paste', true)}
            disabled={busy || !pasteValue.trim()}
          />
          <Button title="Scan instead" onPress={() => setMode('scan')} disabled={busy} />
        </View>
      </View>
    )
  }

  if (!permission) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator />
      </View>
    )
  }

  if (!permission.granted) {
    const webBlocked = webCameraBlockedReason()
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.hint}>
          Bazilion uses the camera only to scan pairing QR codes. Nothing is recorded.
        </Text>
        <Text style={styles.diag}>
          status: {permission.status} · canAskAgain: {String(permission.canAskAgain)}
        </Text>
        {webBlocked ? (
          <Text style={styles.error} accessibilityRole="alert">
            {webBlocked}
          </Text>
        ) : null}
        {!permission.canAskAgain && !webBlocked ? (
          <Text style={styles.error} accessibilityRole="alert">
            The OS won't prompt again — camera was denied earlier. Grant it in Settings → Expo Go
            → Camera, then restart Expo Go.
          </Text>
        ) : null}
        <Button
          title="Grant camera access"
          onPress={async () => {
            try {
              const r = await requestPermission()
              if (!r.granted) {
                setError(`Camera not granted: ${r.status}. You can use manual paste instead.`)
              }
            } catch (err) {
              setError(`Couldn’t request camera access: ${String(err)}`)
            }
          }}
          disabled={!!webBlocked}
        />
        <View style={{ height: 16 }} />
        <Button title="Paste URL instead" onPress={() => setMode('paste')} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          busy || scanPaused ? undefined : ({ data }) => handlePairingUrl(data, 'camera')
        }
        accessible
        accessibilityLabel="Pairing QR scanner"
      >
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Scan pairing QR</Text>
          <Text style={styles.overlayHint}>
            Scan the private HTTPS gateway QR emitted by `bazilion token create --qr`.
          </Text>
          {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          {error ? (
            <Text style={[styles.error, styles.onCamera]} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {scanPaused ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan another pairing QR code"
              style={styles.scanAgain}
              onPress={() => {
                attempt.current = { busy: false, lastRaw: null, scanPaused: false }
                setError(null)
                setScanPaused(false)
              }}
            >
              <Text style={styles.scanAgainText}>Scan again</Text>
            </Pressable>
          ) : null}
        </View>
      </CameraView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Paste a pairing URL instead"
        style={styles.fallback}
        onPress={() => setMode('paste')}
      >
        <Text style={styles.fallbackText}>Paste URL instead</Text>
      </Pressable>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    form: { padding: 20 },
    centered: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    title: {
      fontSize: 22,
      fontFamily: fonts.display,
      color: colors.foreground,
      marginBottom: 8,
    },
    hint: { color: colors.mocha, marginBottom: 16, textAlign: 'center', fontFamily: fonts.body },
    input: {
      marginVertical: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      minHeight: 80,
      fontFamily: fonts.mono,
      color: colors.foreground,
      backgroundColor: colors.ivory,
    },
    row: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginTop: 8 },
    error: { color: colors.destructive, margin: 16, textAlign: 'center', fontFamily: fonts.body },
    diag: { color: colors.mochaLight, fontFamily: fonts.mono, fontSize: 12, marginBottom: 12 },
    // Camera-overlay backdrop is intentionally theme-independent: sits on top
    // of live camera video, needs to read as a translucent dark scrim regardless
    // of light/dark theme.
    onCamera: { backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 4 },
    camera: { flex: 1 },
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      padding: 24,
      paddingBottom: 80,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    overlayTitle: {
      color: '#FFFFFF',
      fontSize: 20,
      fontFamily: fonts.display,
      marginBottom: 4,
    },
    overlayHint: { color: '#ddd', fontFamily: fonts.body },
    scanAgain: {
      alignSelf: 'flex-start',
      marginTop: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radii.md,
      backgroundColor: '#FFFFFF',
    },
    scanAgainText: { color: '#3D2B1F', fontFamily: fonts.bodyMedium },
    fallback: {
      position: 'absolute',
      bottom: 24,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    fallbackText: {
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0.72)',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.md,
      textDecorationLine: 'underline',
      fontFamily: fonts.bodyMedium,
    },
  })
