import { api, unwrap } from './api'
import type { ApiEnvelope, CompletionProof, EntityId, Task } from '../types/api'

export const MIN_PROOF_SUMMARY = 20

export function taskProofs(task: Task | null): CompletionProof[] {
  return task?.completionProofs ?? task?.completion_proofs ?? []
}

/** The one that decides what the task is doing right now. */
export function latestProof(task: Task | null): CompletionProof | null {
  return taskProofs(task)[0] ?? null
}

export function proofState(proof: CompletionProof | null) {
  if (!proof) return null
  const missing = proof.aiMissingEvidence ?? proof.ai_missing_evidence ?? []

  return {
    status: proof.status,
    aiState: proof.aiState ?? proof.ai_state ?? 'queued',
    verdict: proof.aiVerdict ?? proof.ai_verdict ?? null,
    message: proof.aiMessage ?? proof.ai_message ?? '',
    missing,
    reviewMode: proof.reviewMode ?? proof.review_mode ?? null,
    reviewReason: proof.reviewReason ?? proof.review_reason ?? '',
    awaitsHumanReview: Boolean(proof.awaitsHumanReview ?? proof.awaits_human_review),
    submitter: proof.submittedBy ?? proof.submitted_by ?? null,
    reviewer: proof.reviewedBy ?? proof.reviewed_by ?? null,
    submittedAt: proof.createdAt ?? proof.created_at ?? '',
  }
}

export async function submitCompletionProof(
  taskId: EntityId,
  summary: string,
  files: File[],
  adminOverride = false,
): Promise<CompletionProof> {
  const form = new FormData()
  form.append('summary', summary)
  files.forEach((file) => form.append('files[]', file))
  if (adminOverride) form.append('admin_override', '1')
  const response = await api.post<ApiEnvelope<CompletionProof> | CompletionProof>(`/api/tasks/${taskId}/completion-proofs`, form)

  return unwrap(response)
}

export async function settleCompletionProof(
  taskId: EntityId,
  proofId: EntityId,
  approved: boolean,
  reason: string,
  adminOverride = false,
): Promise<CompletionProof> {
  const response = await api.post<ApiEnvelope<CompletionProof> | CompletionProof>(
    `/api/tasks/${taskId}/completion-proofs/${proofId}/${approved ? 'approve' : 'reject'}`,
    { reason: reason || undefined, admin_override: adminOverride ? 1 : undefined },
  )

  return unwrap(response)
}
