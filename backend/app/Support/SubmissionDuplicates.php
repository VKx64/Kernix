<?php

namespace App\Support;

use App\Models\FormSubmission;

/**
 * A PHP port of the quick-capture duplicate heuristic in
 * frontend/src/lib/taskCapture.ts (captureKeywords + findDuplicateTask), run
 * against submissions on the same form instead of tasks. Computed once at
 * submit time and stored, never recomputed on read, and it never blocks a
 * submission — only flags one for the reviewer.
 */
final class SubmissionDuplicates
{
    public const THRESHOLD = 0.5;

    public const WINDOW_HOURS = 24;

    /** @return array<int, string> */
    public static function keywords(string $title): array
    {
        $normalized = preg_replace('/[^a-z0-9\s]/', ' ', mb_strtolower($title)) ?? '';

        return array_values(array_filter(
            preg_split('/\s+/', trim($normalized)) ?: [],
            fn (string $word): bool => mb_strlen($word) > 3
        ));
    }

    /**
     * The most similar prior submission on the same form, from the same
     * lowercased email, within the trailing window — or null. The candidate
     * submission's own title (already saved, so it has an id) is compared
     * against the incoming one; both are re-derived from their own snapshot.
     */
    public static function find(FormSubmission $submission): ?FormSubmission
    {
        $email = mb_strtolower(trim((string) $submission->from_email));
        if ($email === '') {
            return null;
        }
        $keywords = self::keywords(self::titleOf($submission));
        if (count($keywords) < 2) {
            return null;
        }
        $denominator = max(2, count($keywords));

        $candidates = FormSubmission::query()
            ->where('project_form_id', $submission->project_form_id)
            ->whereRaw('LOWER(from_email) = ?', [$email])
            ->where('id', '!=', $submission->id ?? 0)
            ->where('created_at', '>=', now()->subHours(self::WINDOW_HOURS))
            ->get();

        $best = null;
        $bestScore = 0.0;
        foreach ($candidates as $candidate) {
            $other = array_flip(self::keywords(self::titleOf($candidate)));
            if ($other === []) {
                continue;
            }
            $shared = count(array_filter($keywords, fn (string $word): bool => isset($other[$word])));
            $score = $shared / $denominator;
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $candidate;
            }
        }

        return $bestScore >= self::THRESHOLD ? $best : null;
    }

    /**
     * The title a submission would convert to, re-derived from its own
     * snapshot rather than the live form — same rule the converter follows.
     */
    public static function titleOf(FormSubmission $submission): string
    {
        foreach (($submission->form_snapshot['fields'] ?? []) as $field) {
            if (($field['maps'] ?? null) === 'title') {
                $answer = $submission->answers[$field['id']] ?? null;

                return is_string($answer) ? $answer : '';
            }
        }

        return '';
    }
}
