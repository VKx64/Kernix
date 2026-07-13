<?php

namespace App\Http\Middleware;

use App\Models\SystemSetting;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApplyWorkspaceTimezone
{
    public function handle(Request $request, Closure $next): Response
    {
        $timezone = SystemSetting::query()->value('default_timezone') ?: config('app.timezone');
        if (in_array($timezone, timezone_identifiers_list(), true)) {
            config(['app.timezone' => $timezone]);
            date_default_timezone_set($timezone);
        }

        return $next($request);
    }
}
