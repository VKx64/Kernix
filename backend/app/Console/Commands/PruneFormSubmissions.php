<?php

namespace App\Console\Commands;

use App\Services\FormSubmissionRetentionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class PruneFormSubmissions extends Command
{
    protected $signature = 'form-submissions:prune';

    protected $description = 'Delete decided (converted/declined) form submissions and their files past the retention window';

    public function handle(FormSubmissionRetentionService $retention): int
    {
        $result = $retention->prune();

        $message = sprintf(
            'form-submissions:prune done: %d submission(s), %d file(s), %d byte(s) reclaimed',
            $result['submissions'],
            $result['files'],
            $result['bytes'],
        );

        Log::info($message);
        $this->info($message);

        return self::SUCCESS;
    }
}
