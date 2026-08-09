<?php

namespace App\Support;

/**
 * Turns a task title into the line a timesheet reads in: "Fix broken checkout
 * links" becomes "Fixed broken checkout links". The verbs are an explicit list
 * rather than a rule, because English past tense has no rule that survives
 * contact with "cut", "wrote" and "ran"; an unknown first word is left alone so
 * the worst case is an unedited title rather than an invented word.
 */
final class PastTense
{
    /** @var array<string, string> */
    public const VERBS = [
        'add' => 'Added',
        'rebuild' => 'Rebuilt',
        'remove' => 'Removed',
        'rotate' => 'Rotated',
        'restore' => 'Restored',
        'enforce' => 'Enforced',
        'close' => 'Closed',
        'write' => 'Wrote',
        'merge' => 'Merged',
        'collapse' => 'Collapsed',
        'replace' => 'Replaced',
        'cut' => 'Cut',
        'seed' => 'Seeded',
        'instrument' => 'Instrumented',
        'triage' => 'Triaged',
        'refresh' => 'Refreshed',
        'publish' => 'Published',
        'map' => 'Mapped',
        'stop' => 'Stopped',
        'verify' => 'Verified',
        'check' => 'Checked',
        'fix' => 'Fixed',
        'update' => 'Updated',
        'agree' => 'Agreed',
        'push' => 'Pushed',
        'test' => 'Tested',
        'implement' => 'Implemented',
        'improve' => 'Improved',
        'connect' => 'Connected',
        'prepare' => 'Prepared',
        'build' => 'Built',
        'upgrade' => 'Upgraded',
        'reproduce' => 'Reproduced',
        'lock' => 'Locked',
        'alert' => 'Alerted',
        'move' => 'Moved',
        'rewrite' => 'Rewrote',
        'ship' => 'Shipped',
        'audit' => 'Audited',
        'copy' => 'Copied',
        'draft' => 'Drafted',
        'review' => 'Reviewed',
        'send' => 'Sent',
        'plan' => 'Planned',
        'design' => 'Designed',
        'create' => 'Created',
        'set' => 'Set',
        'run' => 'Ran',
        'fold' => 'Folded',
        'split' => 'Split',
        'land' => 'Landed',
    ];

    public static function describe(string $title): string
    {
        // Anything after an em-dash is the aside a title carries for the board,
        // not something payroll needs to read.
        $clean = trim((string) preg_split('/\s+—\s*/u', trim($title), 2)[0]);
        $clean = trim(preg_replace('/\.$/u', '', $clean));
        if ($clean === '') {
            return '';
        }

        $parts = preg_split('/\s+/u', $clean, 2);
        $verb = self::VERBS[mb_strtolower($parts[0])] ?? null;

        return $verb === null ? $clean : trim($verb.' '.($parts[1] ?? ''));
    }
}
