import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { loadCredentials } from '@/src/auth'

type Gate = { kind: 'loading' } | { kind: 'unpaired' } | { kind: 'paired' }

export default function Index() {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })

  useEffect(() => {
    loadCredentials()
      .then((creds) => setGate({ kind: creds ? 'paired' : 'unpaired' }))
      .catch(() => setGate({ kind: 'unpaired' }))
  }, [])

  // Render nothing while SecureStore resolves. The native splash is still up
  // at this point on cold launch; rendering an ActivityIndicator briefly
  // produced a visible flash between splash dismissal and the redirect.
  if (gate.kind === 'loading') return null
  return <Redirect href={gate.kind === 'paired' ? '/agents' : '/pair'} />
}
