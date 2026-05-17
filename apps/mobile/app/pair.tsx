import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Button,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { saveCredentials, verifyCredentials } from '@/src/auth'
import { PairUrlError, parsePairingUrl } from '@/src/pair-url'
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
  // Expo fires the barcode callback repeatedly on every frame — dedupe.
  const handled = useRef(false)
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const handlePairingUrl = useCallback(async (raw: string) => {
    if (handled.current) return
    handled.current = true
    setBusy(true)
    setError(null)
    try {
      const creds = parsePairingUrl(raw)
      await verifyCredentials(creds)
      await saveCredentials(creds)
      router.replace('/agents')
    } catch (err) {
      handled.current = false
      const msg =
        err instanceof PairUrlError
          ? `QR content is not a pairing URL: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'unknown error'
      setError(msg)
      Alert.alert('Pairing failed', msg)
    } finally {
      setBusy(false)
    }
  }, [])

  if (mode === 'paste') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Paste pairing URL</Text>
        <Text style={styles.hint}>
          Run `bazilion token create &lt;label&gt; --qr` on your server to generate one.
        </Text>
        <TextInput
          value={pasteValue}
          onChangeText={setPasteValue}
          placeholder="bazilion://pair?server=…&token=…"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          multiline
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <Button
            title={busy ? 'Verifying…' : 'Pair'}
            onPress={() => handlePairingUrl(pasteValue.trim())}
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
        {webBlocked ? <Text style={styles.error}>{webBlocked}</Text> : null}
        {!permission.canAskAgain && !webBlocked ? (
          <Text style={styles.error}>
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
                Alert.alert(
                  'Camera not granted',
                  `status=${r.status} canAskAgain=${r.canAskAgain}`,
                )
              }
            } catch (err) {
              Alert.alert('requestPermission threw', String(err))
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
        onBarcodeScanned={busy || handled.current ? undefined : ({ data }) => handlePairingUrl(data)}
      >
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Scan pairing QR</Text>
          <Text style={styles.overlayHint}>
            Point the camera at the QR code emitted by `bazilion token create --qr`.
          </Text>
          {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          {error ? <Text style={[styles.error, styles.onCamera]}>{error}</Text> : null}
        </View>
      </CameraView>
      <Pressable style={styles.fallback} onPress={() => setMode('paste')}>
        <Text style={styles.fallbackText}>Paste URL instead</Text>
      </Pressable>
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
    title: {
      fontSize: 22,
      fontFamily: fonts.display,
      color: colors.foreground,
      marginBottom: 8,
    },
    hint: { color: colors.mocha, marginBottom: 16, textAlign: 'center', fontFamily: fonts.body },
    input: {
      margin: 16,
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
    },
    overlayTitle: {
      color: '#FFFFFF',
      fontSize: 20,
      fontFamily: fonts.display,
      marginBottom: 4,
    },
    overlayHint: { color: '#ddd', fontFamily: fonts.body },
    fallback: {
      position: 'absolute',
      bottom: 24,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    fallbackText: { color: '#FFFFFF', textDecorationLine: 'underline', fontFamily: fonts.body },
  })
