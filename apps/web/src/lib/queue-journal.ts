import type { EditQueuedInput, EnqueueUserInput } from '@bazilion/api-types'

export interface PendingQueueRequest {
  agentId: string
  replacementId?: string
  input: EnqueueUserInput | EditQueuedInput
}

/** Store bytes before submission so a reload can retry the exact same attempt. */
export async function queueJournal(agentId: string, value?: PendingQueueRequest | null, clearRequestId?: string): Promise<PendingQueueRequest | null> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('bazilion-queue-attempts', 1)
    opening.onupgradeneeded = () => { opening.result.createObjectStore('requests', { keyPath: 'input.requestId' }).createIndex('agentId', 'agentId') }
    opening.onerror = () => reject(new Error('Local queue recovery storage is unavailable'))
    opening.onblocked = () => reject(new Error('Close other Bazilion tabs to open queue recovery storage'))
    opening.onsuccess = () => {
      const db = opening.result
      const tx = db.transaction('requests', value === undefined ? 'readonly' : 'readwrite')
      const store = tx.objectStore('requests')
      if (value === null && !clearRequestId) { db.close(); reject(new Error('Queue request identity is required to clear recovery state')); return }
      const request = value === undefined ? store.index('agentId').get(agentId) : value === null ? store.delete(clearRequestId!) : store.put(value)
      tx.oncomplete = () => { db.close(); resolve(value === undefined ? request.result ?? null : value) }
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Unable to retain queue request locally; it was not acknowledged')) }
    }
  })
}
