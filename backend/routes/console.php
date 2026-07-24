<?php

use App\Services\AiEstimateInactivityService;
use Illuminate\Support\Facades\Schedule;

Schedule::call(fn () => app(AiEstimateInactivityService::class)->rejectInactive())
    ->name('reject-inactive-ai-estimate-requests')
    ->everyFifteenMinutes()
    ->withoutOverlapping();
