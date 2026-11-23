// What the Telegram cards share: the daemon route they call and the chip that says how each one
// stands.

import type { CardState } from '../../../lib/telegram-setup'
import { Chip } from '../../ui/parts'

export const TELEGRAM_PATH = '/api/config/telegram'

export function StateChip({ state }: { state: CardState | null }) {
  return state && <Chip tone={state.tone}>{state.label}</Chip>
}
