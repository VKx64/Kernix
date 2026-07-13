import type { WorkerRequest, WorkerResponse } from './types'

export async function sendWorker<T>(message: WorkerRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as WorkerResponse<T>
  if (!response?.ok) throw Object.assign(new Error(response?.error.message ?? 'The extension service worker did not respond.'), response?.error)
  return response.data
}
