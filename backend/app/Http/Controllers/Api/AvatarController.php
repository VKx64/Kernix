<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\AvatarStorage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AvatarController extends ApiController
{
    public function __construct(private readonly AvatarStorage $storage)
    {
    }

    /** The picture itself. Behind the session, like every other stored file. */
    public function show(Request $request, User $user): BinaryFileResponse|StreamedResponse|Response
    {
        $path = $user->getRawOriginal('profile_image');
        abort_unless(AvatarStorage::isStoredPath($path), 404, 'This account has no picture.');

        $disk = Storage::disk(AvatarStorage::DISK);
        abort_unless($disk->exists($path), 404, 'This picture is no longer stored on the server.');

        $headers = [
            'Content-Type' => 'image/webp',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            // Private: the response is session-scoped, so a shared cache must
            // not hand one account's picture to the next viewer.
            'Cache-Control' => 'private, max-age=604800',
        ];

        $absolute = $disk->path($path);

        return is_file($absolute)
            ? response()->file($absolute, $headers)
            : $disk->response($path, null, $headers);
    }

    public function storeOwn(Request $request): JsonResponse
    {
        return $this->put($request, $request->user());
    }

    public function destroyOwn(Request $request): JsonResponse
    {
        return $this->clear($request, $request->user());
    }

    public function store(Request $request, User $user): JsonResponse
    {
        $this->authorizeManaging($request, $user);

        return $this->put($request, $user);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        $this->authorizeManaging($request, $user);

        return $this->clear($request, $user);
    }

    /** Setting someone else's picture is a user edit; setting your own is not. */
    private function authorizeManaging(Request $request, User $user): void
    {
        if ($request->user()->is($user)) {
            return;
        }
        $this->permission($request, 'users.edit');
    }

    private function put(Request $request, User $user): JsonResponse
    {
        $request->validate(['avatar' => ['required', 'file']]);

        $this->storage->store($user, $request->file('avatar'));
        $this->audit($request, 'user.avatar.update', $user);

        return $this->data($this->userSummary($user->fresh()));
    }

    private function clear(Request $request, User $user): JsonResponse
    {
        $this->storage->remove($user);
        $this->audit($request, 'user.avatar.remove', $user);

        return $this->data($this->userSummary($user->fresh()));
    }
}
