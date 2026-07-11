/**
 * One-release Profile Group compatibility projection.
 *
 * This module intentionally contains no legacy-table SQL. Every operation is
 * backed by the canonical Team-template aggregate.
 */
import type {
  HarnessTemplate,
  ProfileGroup,
  ProfileGroupMember,
  ProfileGroupWithCount,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as harnessTemplateRepo from './harnessTemplates.ts'

export type MemberInput = harnessTemplateRepo.CompatibilityMemberInput

function project(template: HarnessTemplate): ProfileGroup {
  return {
    id: template.id,
    name: template.name,
    userMd: template.userMd,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    revision: template.currentRevision,
    compatibilityManaged: template.compatibilityManaged,
  }
}

export function insert(
  db: BazilionDb,
  value: Omit<ProfileGroup, 'createdAt' | 'updatedAt' | 'revision' | 'compatibilityManaged'>,
): ProfileGroup {
  return db.raw.transaction(() => project(harnessTemplateRepo.insertCompatibility(db, value)))()
}

export function get(db: BazilionDb, id: string): ProfileGroup | null {
  const template = harnessTemplateRepo.get(db, id)
  return template ? project(template) : null
}

export function list(db: BazilionDb): ProfileGroupWithCount[] {
  return harnessTemplateRepo.list(db).map((template) => ({
    ...project(template),
    memberCount: harnessTemplateRepo.slots(db, template.id).length,
  }))
}

export interface UpdateProfileGroupPatch {
  name?: string
  userMd?: string | null
}

export function update(db: BazilionDb, id: string, patch: UpdateProfileGroupPatch): void {
  harnessTemplateRepo.updateCompatibilityMetadata(db, id, patch)
}

export function remove(db: BazilionDb, id: string): void {
  harnessTemplateRepo.removeCompatibility(db, id)
}

export function members(db: BazilionDb, profileGroupId: string): ProfileGroupMember[] {
  return harnessTemplateRepo.slots(db, profileGroupId).map((slot) => ({
    profileGroupId,
    position: slot.position,
    profileId: slot.profileId,
    agentName: slot.agentName,
    modelOverride: slot.modelOverride,
    reasoningLevel: slot.reasoningLevel,
    slotId: slot.slotId,
  }))
}

export function findReferencingProfile(
  db: BazilionDb,
  profileId: string,
): Array<{ id: string; name: string }> {
  return harnessTemplateRepo.findReferencingProfile(db, profileId)
}

/**
 * Legacy positional replacement preserves stable ids by prior ordinal.
 * Appends allocate ids and a shorter list tombstones only the removed suffix.
 */
export function replaceMembers(
  db: BazilionDb,
  profileGroupId: string,
  newMembers: MemberInput[],
): void {
  harnessTemplateRepo.replaceCompatibilityMembers(db, profileGroupId, newMembers)
}
