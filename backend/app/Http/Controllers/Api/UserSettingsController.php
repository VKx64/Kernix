<?php

namespace App\Http\Controllers\Api;

use App\Models\UserSetting;
use App\Support\UserSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The signed-in employee's own preferences. These are personal, not workspace
 * administration, so there is no permission to check and no route that names a
 * user: everybody may read and write their own, and nobody else's.
 */
class UserSettingsController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        return $this->data(UserSettings::for($request->user()));
    }

    public function update(Request $request): JsonResponse
    {
        $this->rejectUnknown($request);
        $patch = $request->validate(UserSettings::rules());

        $setting = UserSetting::query()->firstOrNew(['user_id' => $request->user()->id]);
        // The patch is partial, so it merges over what is stored rather than
        // replacing it, and the whole bag is re-coerced before it is written.
        $setting->values = UserSettings::coerce(array_merge($setting->values ?? [], $patch));
        $setting->save();

        $this->audit($request, 'user_settings.update', $setting, ['after' => $patch]);

        return $this->data($setting->values);
    }

    /**
     * A key nobody recognises is a bug in the caller, not a preference to keep
     * for later, so it is named back rather than quietly stored.
     */
    private function rejectUnknown(Request $request): void
    {
        $unknown = array_diff(array_keys($request->all()), UserSettings::keys());
        if ($unknown === []) {
            return;
        }

        throw ValidationException::withMessages(array_map(
            fn (string $key) => 'Unknown setting "'.$key.'".',
            array_combine($unknown, $unknown),
        ));
    }
}
