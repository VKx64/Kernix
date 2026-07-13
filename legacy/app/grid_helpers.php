<?php
/**
 * Grid helpers — v3.
 * - th() reads sort/dir from $_GET automatically (no need to pass)
 * - delete_url() helper for clean modal delete buttons
 */

function th(array $col): string
{
    $key        = $col['key']         ?? '';
    $colId      = $col['col']         ?? $key;
    $label      = $col['label']       ?? '';
    $sortable   = $col['sortable']    ?? false;
    $sortKey    = $col['sort_key']    ?? $key;
    $filter     = $col['filter']      ?? 'none';
    $opts       = $col['options']     ?? [];
    $ph         = $col['placeholder'] ?? '';
    $alignRight = $col['align_right'] ?? false;
    $width      = $col['width']       ?? '';
    $hasFilter  = $filter !== 'none';

    $currentSort = $_GET['sort'] ?? '';
    $currentDir  = $_GET['dir']  ?? 'asc';

    $activeFilter = false;
    if ($key !== '') {
        $activeFilter = !empty($_GET[$key])
            || !empty($_GET['from_' . $key])
            || !empty($_GET['to_'   . $key]);
    }

    $widthStyle = $width ? " style=\"min-width:{$width}\"" : '';
    $out = "<th data-col=\"" . e($colId) . "\"" . $widthStyle . ">";
    $out .= "<div class=\"th-inner\">";

    $labelClasses = 'th-label';
    if ($hasFilter)               $labelClasses .= ' has-filter';
    if ($sortable && !$hasFilter) $labelClasses .= ' sortable';
    $sortAttr = (!$hasFilter && $sortable) ? " data-sort=\"" . e($sortKey) . "\"" : '';

    $dot     = '<span class="filter-dot"' . ($activeFilter ? '' : ' style="display:none"') . '></span>';
    $chevron = $hasFilter ? ' <span class="th-filter-icon">▾</span>' : '';

    $sortInd = '';
    if ($sortable && $currentSort === $sortKey) {
        $sortInd = ' <span class="th-sort">' . ($currentDir === 'asc' ? '↑' : '↓') . '</span>';
    }

    $out .= "<div class=\"{$labelClasses}\"{$sortAttr}>{$label}{$dot}{$sortInd}{$chevron}</div>";

    if ($hasFilter || $sortable) {
        $popoverClass = 'col-filter-popover' . ($alignRight ? ' align-right' : '');
        $paramAttr    = $key !== '' ? " data-param=\"" . e($key) . "\"" : '';
        $out .= "<div class=\"{$popoverClass}\"{$paramAttr}>";
        $out .= "<div class=\"col-filter-popover-title\">" . e($label) . "</div>";

        if ($sortable) {
            $ascActive  = ($currentSort === $sortKey && $currentDir === 'asc')  ? ' active' : '';
            $descActive = ($currentSort === $sortKey && $currentDir === 'desc') ? ' active' : '';
            $out .= "<div class=\"col-sort-btns\">";
            $out .= "<button type=\"button\" class=\"col-sort-btn{$ascActive}\" data-sort-col=\"" . e($sortKey) . "\" data-sort-dir=\"asc\">↑ Asc</button>";
            $out .= "<button type=\"button\" class=\"col-sort-btn{$descActive}\" data-sort-col=\"" . e($sortKey) . "\" data-sort-dir=\"desc\">↓ Desc</button>";
            $out .= "</div>";
            if ($hasFilter) $out .= "<div class=\"col-filter-sep\"></div>";
        }

        switch ($filter) {
            case 'text':
                $val = e($_GET[$key] ?? '');
                $ph2 = e($ph ?: 'Search…');
                $out .= "<input class=\"col-search\" type=\"text\" data-param=\"" . e($key) . "\" value=\"{$val}\" placeholder=\"{$ph2}\">";
                break;

            case 'select':
                $out .= "<select class=\"col-select\" data-param=\"" . e($key) . "\">";
                $out .= "<option value=\"\">All</option>";
                foreach ($opts as $o) {
                    $sel = (string)($_GET[$key] ?? '') === (string)$o['v'] ? ' selected' : '';
                    $out .= "<option value=\"" . e($o['v']) . "\"{$sel}>" . e($o['l']) . "</option>";
                }
                $out .= "</select>";
                break;

            case 'multiselect':
                $selected = array_filter(explode(',', $_GET[$key] ?? ''));
                $curLabel = 'All';
                if (count($selected) === 1) {
                    foreach ($opts as $o) { if ((string)$o['v'] === $selected[0]) { $curLabel = $o['l']; break; } }
                } elseif (count($selected) > 1) {
                    $curLabel = count($selected) . ' selected';
                }
                $out .= "<div class=\"col-multi-summary\"><span class=\"multi-current-label\">" . e($curLabel) . "</span></div>";
                if (count($opts) > 6) {
                    $out .= "<div class=\"col-multi-search\"><input type=\"text\" placeholder=\"Search…\"></div>";
                }
                $out .= "<div class=\"col-multi-list\">";
                $allChecked = empty($selected);
                $out .= "<div class=\"col-multi-item all-item\">"
                      . "<input type=\"checkbox\" data-all-toggle=\"1\"" . ($allChecked ? ' checked' : '') . ">"
                      . "<label>All</label></div>";
                foreach ($opts as $o) {
                    $chk = in_array((string)$o['v'], $selected, true) ? ' checked' : '';
                    $out .= "<div class=\"col-multi-item\">"
                          . "<input type=\"checkbox\" value=\"" . e($o['v']) . "\"{$chk}>"
                          . "<label>" . e($o['l']) . "</label></div>";
                }
                $out .= "</div>";
                break;

            case 'date_range':
                $from = e($_GET['from_' . $key] ?? '');
                $to   = e($_GET['to_'   . $key] ?? '');
                $out .= "<div class=\"col-dates\">"
                      . "<div class=\"col-date-row\"><div class=\"col-date-label\">From</div>"
                      . "<input class=\"col-date\" type=\"date\" data-param=\"from_{$key}\" value=\"{$from}\"></div>"
                      . "<div class=\"col-date-row\"><div class=\"col-date-label\">To</div>"
                      . "<input class=\"col-date\" type=\"date\" data-param=\"to_{$key}\" value=\"{$to}\"></div>"
                      . "</div>";
                break;
        }

        if ($hasFilter && $key !== '') {
            $out .= "<button type=\"button\" class=\"col-filter-clear\">Clear filter</button>";
        }

        $out .= "</div>";
    }

    $out .= "</div></th>";
    return $out;
}

function toggle_pill(string $label, string $param, bool $active = false, string $variant = ''): string
{
    $activeClass  = $active ? ' active' . ($variant ? " active-{$variant}" : '') : '';
    $variantAttr  = $variant ? " data-active-variant=\"{$variant}\"" : '';
    $checked      = $active ? ' checked' : '';
    return "<label class=\"toggle-pill{$activeClass}\"{$variantAttr}>"
         . "<span class=\"pill-switch\">"
         . "<input type=\"checkbox\" data-toggle-param=\"" . e($param) . "\"{$checked}>"
         . "<span class=\"pill-switch-track\"></span>"
         . "<span class=\"pill-switch-thumb\"></span>"
         . "</span>"
         . e($label)
         . "</label>";
}

function columns_selector(array $columns, string $moduleKey): string
{
    $out  = "<div style=\"position:relative\">";
    $out .= "<button type=\"button\" class=\"btn-columns\">"
          . "<svg class=\"icon icon-sm\"><use href=\"#i-columns\"/></svg> Columns</button>";
    $out .= "<div class=\"columns-popover\">";
    $out .= "<div class=\"columns-popover-title\">Show / Hide</div>";
    foreach ($columns as $c) {
        $out .= "<label class=\"col-toggle-item\">"
              . "<input type=\"checkbox\" data-col-id=\"" . e($c['id']) . "\" checked>"
              . e($c['label'])
              . "</label>";
    }
    $out .= "</div></div>";
    return $out;
}

/**
 * Build a delete URL that's safe inside JS strings.
 * Returns a plain URL (no HTML encoding needed because used in data-* with JS template).
 */
function delete_url_template(string $page, string $action = 'delete'): string
{
    // URL-encoded for JS — plain &, no &amp;
    return APP_BASE . '/index.php?p=' . urlencode($page) . '&action=' . urlencode($action) . '&id=';
}
