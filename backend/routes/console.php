<?php

use App\Services\AiEstimateInactivityService;
use Illuminate\Support\Facades\Schedule;

Schedule::call(fn () => app(AiEstimateInactivityService::class)->rejectInactive())
    ->name('reject-inactive-ai-estimate-requests')
    ->everyFifteenMinutes()
    ->withoutOverlapping();

// The WhatsApp day, in the app's timezone and on weekdays only: a reminder that
// arrives on a Sunday is noise, and one that arrives at midnight is worse.
//
// Managers are briefed before the studio starts, so they can move work before
// anybody asks; employees hear what is due once they are likely to be awake; the
// hours nudge waits until the end of the day, when being short of the target
// actually means something.
Schedule::command('whatsapp:manager-brief')
    ->name('whatsapp-manager-brief')
    ->weekdays()
    ->at('08:30')
    ->withoutOverlapping();

Schedule::command('whatsapp:due-reminders')
    ->name('whatsapp-due-reminders')
    ->weekdays()
    ->at('09:00')
    ->withoutOverlapping();

Schedule::command('whatsapp:daily-nudge')
    ->name('whatsapp-daily-nudge')
    ->weekdays()
    ->at('17:30')
    ->withoutOverlapping();

// Clients hear from the studio once a week, at the start of it.
Schedule::command('whatsapp:client-digest')
    ->name('whatsapp-client-digest')
    ->weeklyOn(1, '09:30')
    ->withoutOverlapping();

Schedule::command('form-submissions:prune')
    ->name('prune-form-submissions')
    ->daily()
    ->withoutOverlapping();
