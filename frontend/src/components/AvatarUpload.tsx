import { useCallback, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { ImageUp, Trash2, ZoomIn } from 'lucide-react'
import { Avatar } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import {
  AVATAR_ACCEPT,
  avatarRejectionReason,
  removeAvatar,
  renderCrop,
  uploadAvatar,
} from '@/lib/avatars'
import { displayName } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { UserSummary } from '@/types/api'

/**
 * Picture control for an account. Omit `userId` to edit your own; pass one to
 * edit a colleague's, which the API gates on users.edit.
 */
export function AvatarUpload({
  user,
  userId,
  onChanged,
  className,
}: {
  user?: UserSummary | null
  userId?: number | string
  onChanged?: (user: UserSummary) => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const hasPicture = Boolean(user?.avatar ?? user?.profileImage ?? user?.profile_image)

  const pick = (file?: File) => {
    if (!file) return
    const rejection = avatarRejectionReason(file)
    if (rejection) {
      setError(rejection)
      return
    }
    setError('')
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setSource(URL.createObjectURL(file))
  }

  const close = useCallback(() => {
    if (busy) return
    if (source) URL.revokeObjectURL(source)
    setSource('')
    setArea(null)
  }, [busy, source])

  const save = async () => {
    if (!area) return
    setBusy(true)
    setError('')
    try {
      const blob = await renderCrop(source, area)
      const updated = await uploadAvatar(blob, userId)
      onChanged?.(updated)
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That picture could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setError('')
    try {
      const updated = await removeAvatar(userId)
      onChanged?.(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That picture could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <Avatar user={user} className="size-20" />

      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <ImageUp />
          {hasPicture ? 'Change picture' : 'Add picture'}
        </Button>
        {hasPicture && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 />
            Remove
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="sr-only"
        aria-label="Choose a profile picture"
        onChange={(event) => {
          pick(event.target.files?.[0])
          // Reset so choosing the same file twice still fires a change.
          event.target.value = ''
        }}
      />

      {error && !source && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Frame the picture</DialogTitle>
            <DialogDescription>
              Drag to move and use the slider to zoom. The square is what everyone else sees.
            </DialogDescription>
          </DialogHeader>

          <div className="relative h-72 overflow-hidden rounded-lg bg-muted">
            {source && (
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setArea(pixels)}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.01}
              aria-label="Zoom"
              onValueChange={([next]) => setZoom(next)}
            />
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            <Button type="button" disabled={busy || !area} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save picture'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this picture?</AlertDialogTitle>
            <AlertDialogDescription>
              {displayName(user)} will show their initials again until a new picture is added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clear()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
