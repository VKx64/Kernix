<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Stores account pictures.
 *
 * Uploads are always decoded and re-encoded rather than written through. That
 * discards EXIF (which carries GPS on phone photos), and it means a file that
 * is both a valid image and a valid script cannot survive the round trip.
 */
class AvatarStorage
{
    public const DISK = 'local';

    /** Kilobytes. The client crops before sending, so this is headroom, not a target. */
    public const MAX_FILE_KB = 8192;

    /** Stored square edge in pixels. Twice the largest place an avatar is drawn. */
    public const EDGE = 512;

    public const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    public function store(User $user, UploadedFile $file): string
    {
        $this->assertStorable($file);

        $image = $this->decode($file);
        $square = $this->cropToSquare($image);
        imagedestroy($image);

        $name = Str::ulid()->toBase32().'.webp';
        $path = "avatars/{$user->id}/{$name}";

        ob_start();
        imagewebp($square, null, 82);
        $encoded = (string) ob_get_clean();
        imagedestroy($square);

        Storage::disk(self::DISK)->put($path, $encoded);
        $this->forget($user);

        $user->forceFill(['profile_image' => $path])->save();

        return $path;
    }

    public function remove(User $user): void
    {
        $this->forget($user);
        $user->forceFill(['profile_image' => null])->save();
    }

    /** True when the stored value is a file this service owns rather than an external URL. */
    public static function isStoredPath(?string $value): bool
    {
        return filled($value) && ! Str::startsWith($value, ['http://', 'https://', '//', 'data:']);
    }

    private function forget(User $user): void
    {
        $current = $user->getRawOriginal('profile_image');
        if (self::isStoredPath($current)) {
            Storage::disk(self::DISK)->delete($current);
        }
    }

    private function assertStorable(UploadedFile $file): void
    {
        if (! $file->isValid()) {
            throw ValidationException::withMessages(['avatar' => ['That file did not finish uploading.']]);
        }
        if ($file->getSize() > self::MAX_FILE_KB * 1024) {
            throw ValidationException::withMessages(['avatar' => ['Pictures must be 8 MB or smaller.']]);
        }

        // getMimeType() reads the file's own bytes; the client-supplied type is
        // not trusted, so a renamed script cannot pass as a picture here.
        if (! in_array($file->getMimeType(), self::ACCEPTED_MIME, true)) {
            throw ValidationException::withMessages(['avatar' => ['Use a JPEG, PNG, WebP, or GIF image.']]);
        }
    }

    /** @return \GdImage */
    private function decode(UploadedFile $file)
    {
        $image = @imagecreatefromstring((string) file_get_contents($file->getRealPath()));
        if ($image === false) {
            throw ValidationException::withMessages(['avatar' => ['That image could not be read.']]);
        }

        return $image;
    }

    /**
     * @param  \GdImage  $image
     * @return \GdImage
     */
    private function cropToSquare($image)
    {
        $width = imagesx($image);
        $height = imagesy($image);
        $edge = min($width, $height);
        $sourceX = intdiv($width - $edge, 2);
        $sourceY = intdiv($height - $edge, 2);

        $square = imagecreatetruecolor(self::EDGE, self::EDGE);
        // Transparent source pixels would otherwise land on black.
        imagealphablending($square, false);
        imagesavealpha($square, true);
        imagefill($square, 0, 0, imagecolorallocatealpha($square, 0, 0, 0, 127));
        imagecopyresampled($square, $image, 0, 0, $sourceX, $sourceY, self::EDGE, self::EDGE, $edge, $edge);

        return $square;
    }
}
