/** Incremental newline-delimited JSON decoder, independent of React Native. */
export class NdjsonDecoder<T> {
  #buffer = ''

  push(chunk: string): T[] {
    this.#buffer += chunk
    const lines = this.#buffer.split('\n')
    this.#buffer = lines.pop() ?? ''
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line) as T)
  }

  finish(chunk = ''): T[] {
    this.#buffer += chunk
    const tail = this.#buffer.trim()
    this.#buffer = ''
    return tail ? [JSON.parse(tail) as T] : []
  }
}
