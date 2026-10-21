// Offline candidate only: NOT installed by managed guards or used by the pool.
// A dialog island is not a consent authorizer. This prototype explores whether
// unrelated text mutations can be distinguished from changed action evidence.
// Structural/attribute mutations, external accessible-name dependencies,
// frames/shadow roots, geometry changes and unknown coverage all fail closed.
import { randomUUID } from 'node:crypto'
import type { ElementHandle, Page } from 'playwright'
import { DOM_SCAN_NODE_BOUND, type DomStats, readDomStats } from './observation.ts'

const REGION_BOUND_CHARS = 8_192
const MUTATION_BOUND = 128

/** Trusted fixture instrumentation. Never shipped through a worker/tool argument. */
export const DIALOG_TARGET_PROTOTYPE_SCRIPT = `(() => {
  const tokens = new Map();
  let serial = 0;
  let unknown = false;
  const history = [];
  const record = (records) => {
    for (const r of records) {
      serial++;
      history.push({ serial, type: r.type, target: r.target });
      if (history.length > ${MUTATION_BOUND}) history.shift();
    }
  };
  const observer = new MutationObserver(record);
  observer.observe(document, {subtree:true, childList:true, characterData:true, attributes:true});
  const coverage = () => {
    record(observer.takeRecords());
    let count = 0;
    const walk = (node) => {
      if (++count > ${DOM_SCAN_NODE_BOUND}) { unknown = true; return; }
      if (node.shadowRoot || node.nodeName === 'IFRAME' || node.nodeName === 'FRAME') unknown = true;
      for (const child of node.childNodes || []) {
        if (unknown) break;
        walk(child);
      }
    };
    walk(document);
    // The prototype intentionally refuses externally supplied accessible names.
    // A changed text node outside the dialog could otherwise change its meaning.
    if (document.querySelector('[aria-labelledby],[aria-describedby],[aria-details],[aria-owns],label[for]')) unknown = true;
    return !unknown;
  };
  const view = (target, region) => {
    if (!target.isConnected || !region.isConnected || !region.contains(target)) return null;
    const bounds = target.getBoundingClientRect();
    const box = region.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== target && !target.contains(hit))) return null;
    const style = getComputedStyle(target);
    if (style.visibility !== 'visible' || style.display === 'none' || target.disabled) return null;
    // Text mutations outside the region can still affect CSS (:empty/:has).
    // Include computed rendering of every bounded island element, not merely
    // the button's label/rect; hidden consent explanations are changed evidence.
    const elements = [region, ...region.querySelectorAll('*')];
    if (elements.length > 32) return null;
    const rendered = [];
    let styleChars = 0;
    for (const el of elements) {
      const css = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (css.length > 1024) return null;
      const values = [];
      for (const key of Array.from(css)) {
        const value = css.getPropertyValue(key);
        styleChars += key.length + value.length;
        if (value.length > 4096 || styleChars > 64 * 1024) return null;
        values.push([key, value]);
      }
      const pseudo = [];
      for (const which of [':before', ':after']) {
        const p = getComputedStyle(el, which);
        if (p.content.length > 4096) return null;
        pseudo.push([p.content, p.visibility, p.display, p.opacity]);
      }
      rendered.push({rect:[rect.x,rect.y,rect.width,rect.height], values, pseudo});
    }
    const result = JSON.stringify({bounds:[bounds.x,bounds.y,bounds.width,bounds.height],
      region:[box.x,box.y,box.width,box.height],
      viewport:[innerWidth,innerHeight,scrollX,scrollY], rendered,
      html:region.outerHTML});
    return result.length <= 128 * 1024 ? result : null;
  };
  Object.defineProperty(window, '__bazilion_dialog_prototype', {value:Object.freeze({
    seal(target, token) {
      // One capture is authoritative; bound retained DOM references as well.
      tokens.clear();
      if (!coverage() || target.getRootNode() !== document) return false;
      const region = target.closest('dialog,[role="dialog"],[role="alertdialog"]');
      if (!region || region.outerHTML.length > ${REGION_BOUND_CHARS}) return false;
      const baseline = view(target, region);
      if (!baseline) return false;
      tokens.set(token, {target, region, root:document.documentElement, serial, baseline});
      return true;
    },
    check(target, token) {
      if (!coverage()) return false;
      const seal = tokens.get(token);
      if (!seal || target !== seal.target || document.documentElement !== seal.root) return false;
      if (history.length && history[0].serial > seal.serial + 1) return false;
      for (const r of history) {
        if (r.serial <= seal.serial) continue;
        if (r.type !== 'characterData' || seal.region.contains(r.target)) return false;
        // Reject non-rendered text with code or styling effects even outside
        // the region; stylesheet/script text is not an unrelated ticker.
        if (!r.target.isConnected || r.target.parentElement?.closest('style,script,template,noscript')) return false;
      }
      return view(target, seal.region) === seal.baseline;
    },
    clear(token) { tokens.delete(token); },
  }), configurable:false, writable:false});
})()`

interface DialogPrototypeInstrumentation {
  seal(target: unknown, token: string): boolean
  check(target: unknown, token: string): boolean
  clear(token: string): void
}

/** Exact handle identity: never resolve a new element by its repeated label. */
export class DialogTargetPrototype {
  private disposed = false
  private constructor(
    private readonly page: Page,
    private readonly handle: ElementHandle,
    private readonly token: string,
    private readonly capturedUrl: string,
  ) {}

  static async capture(
    page: Page,
    ref: string,
    observed: DomStats,
  ): Promise<DialogTargetPrototype | null> {
    if (!/^e\d{1,9}$/.test(ref) || observed.nodes > DOM_SCAN_NODE_BOUND) return null
    const matches = (stats: DomStats | null) =>
      stats !== null &&
      stats.nodes <= DOM_SCAN_NODE_BOUND &&
      stats.docId === observed.docId &&
      stats.generation === observed.generation
    if (!matches(await readDomStats(page))) return null
    let handle: ElementHandle | null = null
    const token = randomUUID()
    const capturedUrl = page.url()
    try {
      handle = await page.locator(`aria-ref=${ref}`).elementHandle({ timeout: 1_000 })
      if (!handle) return null
      const ok = await handle.evaluate((target, token) => {
        const api = (
          globalThis as unknown as {
            __bazilion_dialog_prototype?: DialogPrototypeInstrumentation
          }
        ).__bazilion_dialog_prototype
        return api?.seal(target, token) === true
      }, token)
      if (ok && matches(await readDomStats(page)) && page.url() === capturedUrl) {
        return new DialogTargetPrototype(page, handle, token, capturedUrl)
      }
    } catch {
      // Navigating/closed/unknown instrumentation never supplies a proof.
    }
    try {
      await handle?.evaluate((_, token) => {
        const api = (
          globalThis as unknown as {
            __bazilion_dialog_prototype?: DialogPrototypeInstrumentation
          }
        ).__bazilion_dialog_prototype
        api?.clear(token)
      }, token)
    } catch {
      // A destroyed document retains no usable seal.
    }
    await handle?.dispose()
    return null
  }

  /** Read-only evidence; a true result is NOT authorization to dispatch a click. */
  async unchanged(): Promise<boolean> {
    if (this.disposed || this.page.isClosed() || this.page.url() !== this.capturedUrl) return false
    try {
      return await this.handle.evaluate((target, token) => {
        const api = (
          globalThis as unknown as {
            __bazilion_dialog_prototype?: DialogPrototypeInstrumentation
          }
        ).__bazilion_dialog_prototype
        return api?.check(target, token) === true
      }, this.token)
    } catch {
      return false
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      await this.page.evaluate((token) => {
        const api = (
          globalThis as unknown as {
            __bazilion_dialog_prototype?: DialogPrototypeInstrumentation
          }
        ).__bazilion_dialog_prototype
        api?.clear(token)
      }, this.token)
    } catch {
      // The old document may have been destroyed; no authority survives it.
    }
    await this.handle.dispose()
  }
}
