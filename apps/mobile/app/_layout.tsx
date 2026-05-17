import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display'
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { colors, fonts } from '@/src/theme'

export default function RootLayout() {
  // Aliases (BaziuDisplay / BaziuBody / …) are what each StyleSheet
  // references via theme.fonts.* — keys here are the registered family
  // names, values are the asset module IDs imported above.
  const [loaded] = useFonts({
    BaziuDisplay: DMSerifDisplay_400Regular,
    BaziuBody: DMSans_400Regular,
    BaziuBodyMedium: DMSans_500Medium,
    BaziuBodyBold: DMSans_700Bold,
    BaziuMono: JetBrainsMono_400Regular,
  })

  // Block render until fonts settle so screens never flash with the
  // system fallback font.
  if (!loaded) return null

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: fonts.display, fontSize: 18 },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: 'Pair' }} />
        <Stack.Screen name="agents/index" options={{ title: 'Agents' }} />
        <Stack.Screen name="agents/[id]/index" options={{ title: 'Agent' }} />
        <Stack.Screen name="agents/[id]/chat" options={{ title: 'Chat' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </>
  )
}
