<?php

namespace App\Support;

/**
 * One delivery-health rule for the whole portfolio, so a project card and a
 * client row can never disagree about what "at risk" means. Health is derived
 * from task counts alone; nobody sets it by hand.
 */
final class DeliveryHealth
{
    public const DONE = 'done';

    public const OFFTRACK = 'offtrack';

    public const ATRISK = 'atrisk';

    public const ONTRACK = 'ontrack';

    /** Worst first: a client inherits the lowest-ranked health among its projects. */
    private const SEVERITY = [
        self::OFFTRACK => 0,
        self::ATRISK => 1,
        self::ONTRACK => 2,
        self::DONE => 3,
    ];

    private const OFFTRACK_OVERDUE = 3;

    private const OFFTRACK_BLOCKED = 2;

    /**
     * Finished work outranks trouble: a project whose tasks all landed late but
     * are now closed reads `done`, not `offtrack`. A project with no tasks has
     * nothing to be at risk about, so it reads `ontrack`.
     */
    public static function forCounts(int $total, int $open, int $overdue, int $blocked): string
    {
        if ($open === 0 && $total > 0) {
            return self::DONE;
        }
        if ($overdue >= self::OFFTRACK_OVERDUE || $blocked >= self::OFFTRACK_BLOCKED) {
            return self::OFFTRACK;
        }
        if ($overdue > 0 || $blocked > 0) {
            return self::ATRISK;
        }

        return self::ONTRACK;
    }

    /** @param iterable<int, string> $healths */
    public static function worst(iterable $healths): string
    {
        $worst = null;
        foreach ($healths as $health) {
            $rank = self::SEVERITY[$health] ?? self::SEVERITY[self::ONTRACK];
            if ($worst === null || $rank < $worst) {
                $worst = $rank;
            }
        }

        return $worst === null ? self::ONTRACK : array_search($worst, self::SEVERITY, true);
    }
}
