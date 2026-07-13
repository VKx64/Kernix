<?php
/**
 * Theme preset registry — round 29
 *
 * Each preset has:
 *   id        — key stored in users.theme_preset
 *   name      — display label
 *   swatches  — array of 3 colors for the picker swatches (primary, accent, app_bg)
 */
if (!function_exists('theme_presets')):
function theme_presets(): array
{
    return [
        [
            'id'       => 'imagic_purple',
            'name'     => 'Kernix Purple',
            'swatches' => ['#8b5cf6', '#fbbf24', '#0f0820'],
        ],
        [
            'id'       => 'midnight_blue',
            'name'     => 'Midnight Blue',
            'swatches' => ['#3b82f6', '#06b6d4', '#050a1f'],
        ],
        [
            'id'       => 'forest_green',
            'name'     => 'Forest Green',
            'swatches' => ['#10b981', '#facc15', '#051410'],
        ],
        [
            'id'       => 'rose_dusk',
            'name'     => 'Rose Dusk',
            'swatches' => ['#ec4899', '#fb923c', '#1a0a14'],
        ],
        [
            'id'       => 'slate_mono',
            'name'     => 'Slate Mono',
            'swatches' => ['#64748b', '#fbbf24', '#0d1117'],
        ],
        [
            'id'       => 'ocean_teal',
            'name'     => 'Ocean Teal',
            'swatches' => ['#22d3ee', '#0ea5e9', '#0a1929'],
        ],
    ];
}

endif;

if (!function_exists('theme_preset_ids')):
function theme_preset_ids(): array
{
    return array_map(fn($p) => $p['id'], theme_presets());
}

endif;

if (!function_exists('theme_preset_default')):
function theme_preset_default(): string
{
    return 'imagic_purple';
}

endif;

if (!function_exists('theme_preset_for_user')):
function theme_preset_for_user(?array $user): string
{
    if (!$user) return theme_preset_default();
    $p = $user['theme_preset'] ?? null;
    if (!$p) return theme_preset_default();
    return in_array($p, theme_preset_ids(), true) ? $p : theme_preset_default();
}
endif;
