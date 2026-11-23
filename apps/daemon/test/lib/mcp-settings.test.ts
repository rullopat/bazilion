import { expect, test } from 'vitest'
import { looksOutward, toolAsks } from '../../src/lib/mcp/settings.ts'

test('a tool asks first by default when its name says it sends or changes something', () => {
  for (const name of [
    'send-mail',
    'send-draft-message',
    'conversations_add_message',
    'createEvent',
    'update-page-markdown',
    'delete_file',
    'reply-to-message',
    'API-patch-page',
    'API-post-page',
    'modify_sheet_values',
    'manage_event',
    'insert_doc_elements',
    'upsertRecord',
    'rename_file',
    'mark_as_read',
  ])
    expect(looksOutward(name), name).toBe(true)
  for (const name of [
    'list-mail-messages',
    'search_gmail_messages',
    'get-settings',
    'read_page',
    'API-post-search',
    'API-post-database-query',
  ])
    expect(looksOutward(name), name).toBe(false)
})

test('the operator’s choices override the default for those tools only', () => {
  const choices = { 'list-mail-messages': true, 'send-mail': false }
  expect(toolAsks(choices, 'list-mail-messages')).toBe(true)
  expect(toolAsks(choices, 'send-mail')).toBe(false)
  // A tool without a choice, one the server added later too, follows the default.
  expect(toolAsks(choices, 'send-draft')).toBe(true)
  expect(toolAsks(choices, 'get-settings')).toBe(false)
})
