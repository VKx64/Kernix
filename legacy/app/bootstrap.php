<?php
/**
 * Loads all core app files in the right order.
 *
 * ROUND 33 FIX: re-adds time_helpers.php which round 29's bootstrap
 * accidentally clobbered. That file holds fmt_duration() and parse_duration(),
 * used by tasks, profile, timer, and the time tracking strip.
 */

require __DIR__ . '/config.php';
require __DIR__ . '/db.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/time_helpers.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/permissions.php';
require __DIR__ . '/storage.php';
require __DIR__ . '/mailer.php';
require __DIR__ . '/audit.php';
require __DIR__ . '/grid_helpers.php';
require __DIR__ . '/themes.php';
