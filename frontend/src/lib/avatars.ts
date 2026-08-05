import { api } from './api'
import type { ApiEnvelope, UserSummary } from '../types/api'

export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

/** Matches the server ceiling; the crop is sent, so this is only a guard. */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024

export const AVATAR_OUTPUT_EDGE = 512

export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

export function avatarRejectionReason(file: File): string {
  if (!AVATAR_ACCEPT.split(',').includes(file.type)) {
    return 'Use a JPEG, PNG, WebP, or GIF image.'
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Pictures must be 8 MB or smaller.'
  }
  return ''
}

/**
 * Renders the selected crop to a square canvas. The server re-encodes whatever
 * arrives, so this only has to carry the framing the user chose.
 */
export async function renderCrop(source: string, area: CropArea): Promise<Blob> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_OUTPUT_EDGE
  canvas.height = AVATAR_OUTPUT_EDGE

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the image.')

  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    AVATAR_OUTPUT_EDGE,
    AVATAR_OUTPUT_EDGE,
  )

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('This browser could not prepare the image.')),
      'image/webp',
      0.9,
    )
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('That image could not be read.')))
    image.src = source
  })
}

/** `userId` targets a colleague; omit it to change your own picture. */
export async function uploadAvatar(blob: Blob, userId?: number | string): Promise<UserSummary> {
  const form = new FormData()
  form.append('avatar', blob, 'avatar.webp')
  const path = userId === undefined ? '/api/profile/avatar' : `/api/users/${userId}/avatar`
  const response = await api.post<ApiEnvelope<UserSummary> | UserSummary>(path, form)

  return unwrapUser(response)
}

export async function removeAvatar(userId?: number | string): Promise<UserSummary> {
  const path = userId === undefined ? '/api/profile/avatar' : `/api/users/${userId}/avatar`
  const response = await api.delete<ApiEnvelope<UserSummary> | UserSummary>(path)

  return unwrapUser(response)
}

function unwrapUser(response: ApiEnvelope<UserSummary> | UserSummary): UserSummary {
  return response && typeof response === 'object' && 'data' in response
    ? (response as ApiEnvelope<UserSummary>).data
    : response as UserSummary
}
