// The parts every Setup page is built from: what they say and how they are wired for
// assistive technology. How they look is checked in a browser.
import { type ReactElement, createElement as typedCreateElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import {
  SaveBar,
  SecretField,
  SelectField,
  SwitchRow,
  saveStatus,
  TextField,
} from '../src/components/setup/form.tsx'
import {
  Banner,
  CardList,
  CheckItem,
  CheckList,
  Chip,
  Fact,
  Facts,
  ListRow,
  Notice,
  SetupCard,
} from '../src/components/setup/parts.tsx'

// Children are given as arguments, as JSX gives them; the types of createElement ask for them
// among the props instead.
const createElement = typedCreateElement as (
  type: unknown,
  props?: object | null,
  ...children: unknown[]
) => ReactElement
const html = (element: ReactElement): string => renderToStaticMarkup(element)
const nothing = () => {}
const attribute = (markup: string, tag: string, name: string): string | undefined =>
  new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`).exec(markup)?.[1]

test('a form says where it stands in the same words everywhere', () => {
  const quiet = { dirty: false, saved: false }
  expect(saveStatus({ ...quiet, footnote: 'Applies to every Agent.' })).toEqual({
    text: 'Applies to every Agent.',
    tone: 'neutral',
  })
  expect(saveStatus(quiet)).toEqual({ text: '', tone: 'neutral' })
  expect(saveStatus({ dirty: true, saved: false })).toEqual({
    text: 'Not saved yet.',
    tone: 'warning',
  })
  expect(saveStatus({ dirty: false, saved: true })).toEqual({ text: 'Saved.', tone: 'success' })
  expect(saveStatus({ dirty: false, saved: true, savedText: 'Saved. It applies now.' }).text).toBe(
    'Saved. It applies now.',
  )
  // What went wrong outranks what is merely unsaved, and a refused field outranks both.
  expect(saveStatus({ dirty: true, saved: false, error: 'the daemon is not running' })).toEqual({
    text: 'Nothing was saved: the daemon is not running',
    tone: 'warning',
  })
  expect(
    saveStatus({ dirty: true, saved: false, error: 'the daemon is not running', refused: true }),
  ).toEqual({ text: 'Nothing was saved: see above.', tone: 'warning' })
  // A change after a save is not "saved".
  expect(saveStatus({ dirty: true, saved: true }).text).toBe('Not saved yet.')
})

test('Save is off while there is nothing to save, and says when it is saving', () => {
  const status = { text: 'Not saved yet.', tone: 'warning' as const }
  const idle = html(createElement(SaveBar, { busy: false, disabled: false, status }))
  expect(idle).toContain('type="submit"')
  expect(idle).not.toContain('disabled')
  expect(idle).toContain('>Save<')
  expect(idle).toMatch(/<p role="status"[^>]*text-warning[^>]*>Not saved yet\.<\/p>/)
  expect(html(createElement(SaveBar, { busy: false, disabled: true, status }))).toContain(
    'disabled=""',
  )
  const busy = html(createElement(SaveBar, { busy: true, disabled: false, status }))
  expect(busy).toContain('disabled=""')
  expect(busy).toContain('>Saving…<')
})

test('a saved key is never put into a field: the row says so and offers what can be done', () => {
  const field = { label: 'Brave API key', value: '', onChange: nothing }
  const saved = html(
    createElement(SecretField, { ...field, saved: true, preview: 'BSA-no…', onRemove: nothing }),
  )
  expect(saved).not.toContain('<input')
  expect(saved).toContain('Saved: <span class="font-mono">BSA-no…</span>, stored encrypted')
  expect(saved).toContain('>Replace<')
  expect(saved).toContain('>Remove<')
  // The row is named by the label; the label does not point at a button.
  expect(attribute(saved, 'label', 'id')).toBeTruthy()
  expect(attribute(saved, 'div', 'aria-labelledby')).toBe(attribute(saved, 'label', 'id'))
  expect(saved).toContain('role="group"')
  expect(attribute(saved, 'label', 'for')).toBeUndefined()

  // A token that can only be replaced, such as the Telegram bot's.
  expect(
    html(createElement(SecretField, { ...field, saved: true, preview: '1234…' })),
  ).not.toContain('>Remove<')
  // No preview is no reason to show nothing.
  expect(html(createElement(SecretField, { ...field, saved: true }))).toContain('•••')

  const removing = html(
    createElement(SecretField, { ...field, saved: true, removed: true, onRemove: nothing }),
  )
  expect(removing).toContain('Will be removed when you save.')
  expect(removing).toContain('>Keep it<')
  expect(removing).not.toContain('>Replace<')
})

test('a key that is not saved, or is needed again, is typed into a password field', () => {
  const field = { label: 'Bot token', value: '', onChange: nothing }
  const empty = html(
    createElement(SecretField, { ...field, saved: false, placeholder: '1234567890:ABC…' }),
  )
  expect(attribute(empty, 'input', 'type')).toBe('password')
  expect(attribute(empty, 'input', 'autoComplete')).toBe('off')
  expect(attribute(empty, 'input', 'id')).toBeTruthy()
  expect(attribute(empty, 'input', 'id')).toBe(attribute(empty, 'label', 'for'))
  expect(empty).not.toContain('Keep the saved one')

  // Something else in the form needs the stored value typed again: there is no keeping it.
  const again = html(
    createElement(SecretField, { ...field, saved: true, preview: '1234…', open: true }),
  )
  expect(attribute(again, 'input', 'type')).toBe('password')
  expect(again).not.toContain('Saved:')
  expect(again).not.toContain('Keep the saved one')
})

test('a text field is tied to its label and says what is wrong with it', () => {
  const plain = html(
    createElement(TextField, {
      label: 'Supergroup chat ID',
      value: '-100123',
      onChange: nothing,
      mono: true,
      hint: 'A forum supergroup.',
    }),
  )
  expect(attribute(plain, 'input', 'id')).toBeTruthy()
  expect(attribute(plain, 'input', 'id')).toBe(attribute(plain, 'label', 'for'))
  expect(attribute(plain, 'input', 'type')).toBe('text')
  expect(plain).toContain('font-mono')
  expect(plain).toContain('A forum supergroup.')
  expect(plain).not.toContain('aria-invalid')
  expect(plain).not.toContain('role="alert"')

  const wrong = html(
    createElement(TextField, {
      label: 'Supergroup chat ID',
      value: 'my group',
      onChange: nothing,
      problem: 'A supergroup’s id is a number.',
    }),
  )
  expect(wrong).toContain('aria-invalid="true"')
  expect(wrong).toMatch(/<span role="alert"[^>]*>A supergroup’s id is a number\.<\/span>/)

  expect(
    attribute(
      html(
        createElement(TextField, {
          label: 'From',
          type: 'time',
          value: '22:00',
          onChange: nothing,
        }),
      ),
      'input',
      'type',
    ),
  ).toBe('time')
})

test('a switch row names its switch after the setting', () => {
  const row = html(
    createElement(SwitchRow, {
      label: 'Quiet hours',
      description: 'Notices wait until they end.',
      checked: true,
      onChange: nothing,
    }),
  )
  expect(row).toContain('role="switch"')
  expect(row).toContain('aria-checked="true"')
  expect(row).toContain('aria-label="Quiet hours"')
  expect(row).toContain('Notices wait until they end.')
})

test('a card is a section named by its title, with its state beside it', () => {
  const card = html(
    createElement(
      SetupCard,
      {
        labelledBy: 'system-health',
        icon: createElement('svg'),
        title: 'Health',
        description: 'The home and its database.',
        action: createElement(Chip, { tone: 'success' }, 'Healthy'),
      },
      createElement(Facts, null, createElement(Fact, { label: 'Sandbox' }, 'Off')),
    ),
  )
  expect(card).toMatch(/^<section aria-labelledby="system-health"/)
  expect(card).toMatch(/<h2 id="system-health"[^>]*>Health<\/h2>/)
  expect(card).toContain('The home and its database.')
  expect(card).toContain('Healthy')
  expect(card).toMatch(/<dt[^>]*>Sandbox<\/dt><dd[^>]*>Off<\/dd>/)
  // A card may hold nothing but its heading.
  expect(
    html(
      createElement(SetupCard, {
        labelledBy: 'empty',
        icon: null,
        title: 'Empty',
        description: '',
      }),
    ),
  ).toContain('>Empty</h2>')
})

test('a fact that is good or needs attention is coloured; a plain one is not', () => {
  const fact = (tone: 'success' | 'warning' | undefined, value: string) =>
    html(createElement(Fact, { label: 'Docker', tone }, value))
  expect(fact('success', 'Ready')).toMatch(/<dd class="[^"]*text-success[^"]*">Ready<\/dd>/)
  expect(fact('warning', 'Unavailable')).toMatch(
    /<dd class="[^"]*text-warning[^"]*">Unavailable<\/dd>/,
  )
  expect(fact(undefined, 'Off')).toMatch(/<dd class="[^"]*text-foreground[^"]*">Off<\/dd>/)
})

test('a notice is a status unless it reports what just went wrong', () => {
  const note = html(createElement(Notice, { tone: 'warning' }, 'No Brave API key is saved yet.'))
  expect(note).toMatch(/^<div role="status"/)
  expect(note).toContain('No Brave API key is saved yet.')
  expect(note).toContain('aria-hidden="true"')

  const failure = html(
    createElement(
      Notice,
      {
        tone: 'warning',
        role: 'alert',
        title: 'That did not work.',
        actions: createElement('button', { type: 'button' }, 'Try again'),
      },
      'the daemon is not running',
    ),
  )
  expect(failure).toMatch(/^<div role="alert"/)
  expect(failure).toContain('<div class="font-semibold">That did not work.</div>')
  expect(failure).toContain('>Try again</button>')
})

test('a banner leads with the sentence that matters and carries one action', () => {
  const banner = html(
    createElement(
      Banner,
      {
        tone: 'warning',
        lead: 'LM Studio: not answering.',
        action: createElement('button', { type: 'button' }, 'Open LM Studio'),
      },
      '1 chat model runs on it.',
    ),
  )
  expect(banner).toMatch(/^<div role="status"/)
  expect(banner).toContain(
    '<span class="font-semibold text-foreground">LM Studio: not answering.</span>',
  )
  expect(banner).toContain('<span class="text-muted-foreground">1 chat model runs on it.</span>')
  expect(banner).toContain('<svg')
  expect(banner).toContain('>Open LM Studio</button>')
  // The quiet one is a plain card line, without a mark.
  const quiet = html(
    createElement(Banner, { tone: 'neutral', lead: 'Ollama has not been tested.' }),
  )
  expect(quiet).not.toContain('<svg')
  expect(quiet).toContain('bg-card')
})

test('a check says whether it passed in words, not only with a mark', () => {
  const list = html(
    createElement(
      CheckList,
      null,
      createElement(CheckItem, { ok: true, label: 'Bot identity' }, '@paperboat_bot'),
      createElement(
        CheckItem,
        { ok: false, label: 'Privacy Mode is OFF' },
        'BotFather → Group Privacy → Turn off',
      ),
    ),
  )
  expect(list).toMatch(/^<ul/)
  expect(list).toContain('<span class="sr-only">Passed: </span>')
  expect(list).toContain('<span class="sr-only">Failed: </span>')
  expect(list).toContain('@paperboat_bot')
  // What is left to do stands out; what is fine does not.
  expect(list).toMatch(/text-warning">BotFather → Group Privacy → Turn off<\/span>/)
  expect(list).toMatch(/text-muted-foreground">@paperboat_bot<\/span>/)
})

test('a list row gives a thing its name, its state, what there is to know and what can be done', () => {
  const list = html(
    createElement(
      CardList,
      null,
      createElement(
        ListRow,
        {
          title: 'docs_search',
          chip: createElement(Chip, { tone: 'neutral' }, 'Disabled'),
          meta: createElement('span', null, 'http'),
          actions: createElement('button', { type: 'button' }, 'Enable'),
        },
        createElement(Notice, { tone: 'success' }, '3 tools: search, fetch_page, list_sources'),
      ),
      createElement(ListRow, { title: 'bootstrap' }),
    ),
  )
  expect(list).toMatch(/^<ul class="[^"]*list-none[^"]*"><li /)
  expect(list.match(/<li /g)).toHaveLength(2)
  const text = list
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  expect(text).toBe(
    'docs_search Disabled http Enable 3 tools: search, fetch_page, list_sources bootstrap',
  )
  // A row with nothing but a name has no empty boxes around it.
  expect(list).toMatch(/bootstrap<\/span><\/div><\/div><\/li><\/ul>$/)
})

test('a select is tied to its label and shows the choice that is made', () => {
  const select = html(
    createElement(SelectField, {
      label: 'Transport',
      value: 'http',
      options: [
        { value: 'stdio', label: 'stdio' },
        { value: 'http', label: 'http' },
      ],
      onChange: nothing,
    }),
  )
  expect(attribute(select, 'select', 'id')).toBeTruthy()
  expect(attribute(select, 'select', 'id')).toBe(attribute(select, 'label', 'for'))
  expect(select).toContain('<option value="http" selected="">http</option>')
  expect(select).toContain('<option value="stdio">stdio</option>')
})
