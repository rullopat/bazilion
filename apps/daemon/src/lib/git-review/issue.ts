/**
 * Machine-readable issue codes for Git review. One union so a report can merge findings from
 * identity, change listing and patch reading without a second ad-hoc shape.
 *
 * Codes are the contract surfaces render; messages are for operators and must not embed host paths.
 */
export type ReviewIssueCode =
  | 'unborn_head'
  | 'invalid_base'
  | 'unknown_base'
  | 'git_output_limit'
  | 'file_limit'
  | 'patch_unavailable'
  | 'unstable'

export interface ReviewIssue {
  code: ReviewIssueCode
  message: string
}
