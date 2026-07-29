export type Submission = {
  token: number
  requestKey: string
}

export type SubmissionState = {
  nextToken: number
  active: Submission | null
}

export function emptySubmissionState(): SubmissionState {
  return { nextToken: 0, active: null }
}

export function beginSubmission(state: SubmissionState, requestKey: string): { state: SubmissionState; submission: Submission } {
  const submission = { token: state.nextToken + 1, requestKey }
  return { submission, state: { nextToken: submission.token, active: submission } }
}

export function submissionCanBegin(state: SubmissionState): boolean {
  return state.active === null
}

export function resetSubmissionForRequest(state: SubmissionState): SubmissionState {
  return { ...state, active: null }
}

export function isCurrentSubmission(state: SubmissionState, submission: Submission, currentRequestKey: string | null = submission.requestKey): boolean {
  return currentRequestKey === submission.requestKey && state.active?.token === submission.token && state.active.requestKey === submission.requestKey
}
