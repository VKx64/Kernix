<?php
/**
 * Time-related helpers.
 * Include from bootstrap.php after helpers.php.
 */

/**
 * Format minutes as "2h 30m", "45m", "1d 4h", etc.
 */
function fmt_duration(?int $minutes): string
{
    if ($minutes === null || $minutes <= 0) return '—';
    if ($minutes < 60) return $minutes . 'm';
    $hours = intdiv($minutes, 60);
    $mins  = $minutes % 60;
    if ($hours < 24) {
        return $mins ? "{$hours}h {$mins}m" : "{$hours}h";
    }
    $days  = intdiv($hours, 24);
    $hours = $hours % 24;
    return $hours ? "{$days}d {$hours}h" : "{$days}d";
}

/**
 * Parse "1h 30m", "2h", "45m", "90" (minutes) → minutes int.
 */
function parse_duration(?string $str): ?int
{
    if ($str === null || trim($str) === '') return null;
    $str = strtolower(trim($str));
    // Plain number = minutes
    if (ctype_digit($str)) return (int)$str;
    $total = 0;
    if (preg_match('/(\d+)\s*d/', $str, $m)) $total += (int)$m[1] * 1440;
    if (preg_match('/(\d+)\s*h/', $str, $m)) $total += (int)$m[1] * 60;
    if (preg_match('/(\d+)\s*m/', $str, $m)) $total += (int)$m[1];
    return $total > 0 ? $total : null;
}

/**
 * Common timezone list for dropdowns — grouped by region.
 */
function common_timezones(): array
{
    return [
        'Common' => [
            'UTC'                  => 'UTC',
            'Asia/Manila'          => 'Manila (PHT)',
            'Asia/Singapore'       => 'Singapore (SGT)',
            'Asia/Tokyo'           => 'Tokyo (JST)',
            'Asia/Shanghai'        => 'Shanghai (CST)',
            'Asia/Kolkata'         => 'India (IST)',
            'Asia/Dubai'           => 'Dubai (GST)',
        ],
        'Americas' => [
            'America/New_York'     => 'New York (ET)',
            'America/Chicago'      => 'Chicago (CT)',
            'America/Denver'       => 'Denver (MT)',
            'America/Los_Angeles'  => 'Los Angeles (PT)',
            'America/Toronto'      => 'Toronto (ET)',
            'America/Mexico_City'  => 'Mexico City (CST)',
            'America/Sao_Paulo'    => 'São Paulo (BRT)',
        ],
        'Europe' => [
            'Europe/London'        => 'London (GMT/BST)',
            'Europe/Paris'         => 'Paris (CET)',
            'Europe/Berlin'        => 'Berlin (CET)',
            'Europe/Madrid'        => 'Madrid (CET)',
            'Europe/Amsterdam'     => 'Amsterdam (CET)',
            'Europe/Moscow'        => 'Moscow (MSK)',
        ],
        'Oceania' => [
            'Australia/Sydney'     => 'Sydney (AEST)',
            'Australia/Melbourne'  => 'Melbourne (AEST)',
            'Australia/Perth'      => 'Perth (AWST)',
            'Pacific/Auckland'     => 'Auckland (NZST)',
        ],
    ];
}

/**
 * Render timezone dropdown options grouped.
 */
function timezone_options_html(?string $selected): string
{
    $out = '<option value="">— None —</option>';
    foreach (common_timezones() as $group => $zones) {
        $out .= '<optgroup label="' . e($group) . '">';
        foreach ($zones as $tz => $label) {
            $sel  = $selected === $tz ? ' selected' : '';
            $out .= "<option value=\"" . e($tz) . "\"{$sel}>" . e($label) . "</option>";
        }
        $out .= '</optgroup>';
    }
    return $out;
}
