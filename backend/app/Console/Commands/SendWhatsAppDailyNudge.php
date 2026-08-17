<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Models\WhatsAppChat;
use App\Services\TimeTrackingService;
use App\Services\WhatsAppNotifier;
use App\Support\CurrentWorkspace;
use App\Support\UserSettings;
use Illuminate\Console\Command;
use Throwable;

/**
 * The end-of-day reminder: hours short of the target, or a clock still running.
 *
 * Nobody is chased for being short by a few minutes, and nobody who has logged
 * their day hears anything at all — a nudge that arrives every evening whatever
 * you did is one people learn to ignore.
 */
class SendWhatsAppDailyNudge extends Command
{
    protected $signature = 'whatsapp:daily-nudge {--dry-run : List who would be messaged without sending anything}';

    protected $description = 'Remind linked WhatsApp numbers about unlogged hours and a clock left running.';

    /** Below this many minutes short of the target, the day counts as logged. */
    private const TOLERANCE_MINUTES = 15;

    public function handle(WhatsAppNotifier $notifier, TimeTrackingService $timeTracking): int
    {
        // Only people the account has actually spoken to, or been spoken to by:
        // sending the first thing anybody ever hears from Kernix at half five in
        // the evening, unprompted, is not the introduction it should make.
        $chats = WhatsAppChat::query()
            ->withoutGlobalScope('workspace')
            ->where('audience', WhatsAppChat::STAFF)
            ->whereNotNull('user_id')
            ->where('muted', false)
            ->get();
        $sent = 0;

        foreach ($chats as $chat) {
            $user = User::query()->withoutGlobalScope('workspace')->find($chat->user_id);
            if (! $user || $user->status !== 'active' || $user->archived_at) {
                continue;
            }

            try {
                $body = CurrentWorkspace::use(
                    CurrentWorkspace::forUser($user),
                    fn () => $this->message($user, $timeTracking),
                );
            } catch (Throwable $exception) {
                report($exception);

                continue;
            }

            if ($body === null) {
                continue;
            }

            if ($this->option('dry-run')) {
                $this->line(sprintf('%s (%s): %s', $user->username, $chat->number(), str_replace("\n", ' / ', $body)));

                continue;
            }

            if ($notifier->notifyUser($user, $body)) {
                $sent++;
            }
        }

        $this->info($this->option('dry-run') ? 'Dry run complete.' : "Queued {$sent} WhatsApp reminder(s).");

        return self::SUCCESS;
    }

    private function message(User $user, TimeTrackingService $timeTracking): ?string
    {
        $status = $timeTracking->statusData($user);
        $target = (int) UserSettings::for($user)['daily_target_minutes'];
        $logged = (int) $status['today_minutes'];
        $short = $target - $logged;

        $lines = [];

        if ($status['is_clocked_in']) {
            $lines[] = 'You are still clocked in. Send `out` when you are done for the day.';
        }

        if ($short > self::TOLERANCE_MINUTES) {
            $lines[] = sprintf(
                'Logged today: %dh %02dm of %dh %02dm. Send `tasks` to see what is open, or log the rest in Kernix.',
                intdiv($logged, 60),
                $logged % 60,
                intdiv($target, 60),
                $target % 60,
            );
        }

        return $lines === [] ? null : implode("\n\n", $lines);
    }
}
