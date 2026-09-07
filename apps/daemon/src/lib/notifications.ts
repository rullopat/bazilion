import type { BazilionDb } from '../core/db/client.ts'
import { NotificationControl } from './notification-control.ts'
import { NotificationDispatcher } from './notification-dispatch.ts'
import { telegramNotificationTransport } from './telegram/notification-transport.ts'

const services = new WeakMap<
  BazilionDb,
  { control: NotificationControl; dispatcher: NotificationDispatcher }
>()
export function notificationsFor(db: BazilionDb, authToken: string) {
  let service = services.get(db)
  if (!service) {
    const transport = telegramNotificationTransport(db, authToken)
    service = {
      control: new NotificationControl(db, transport),
      dispatcher: new NotificationDispatcher(db, transport),
    }
    services.set(db, service)
  }
  return service
}
const pumpKey = Symbol.for('bazilion.notifications')
interface Pump {
  db: BazilionDb
  stop(): void
}
const registry = globalThis as typeof globalThis & { [pumpKey]?: Pump }
export function startNotifications(db: BazilionDb, authToken: string): Pump {
  const existing = registry[pumpKey]
  if (existing?.db === db) return existing
  existing?.stop()
  const { dispatcher } = notificationsFor(db, authToken)
  const timer = setInterval(() => {
    void dispatcher.tick()
  }, 5000)
  timer.unref()
  const pump: Pump = {
    db,
    stop() {
      clearInterval(timer)
      dispatcher.stop()
      if (registry[pumpKey] === pump) delete registry[pumpKey]
    },
  }
  registry[pumpKey] = pump
  void dispatcher.tick()
  return pump
}
