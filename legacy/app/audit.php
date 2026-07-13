<?php
/**
 * Audit log writer with field diff support.
 */

class Audit
{
    public static function log(
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        ?string $summary = null,
        ?array $changes = null
    ): void {
        try {
            DB::insert('audit_logs', [
                'user_id'      => Auth::id(),
                'action'       => $action,
                'entity_type'  => $entityType,
                'entity_id'    => $entityId,
                'summary'      => $summary,
                'changes_json' => $changes ? json_encode($changes) : null,
                'ip_address'   => $_SERVER['REMOTE_ADDR'] ?? null,
                'user_agent'   => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 500),
            ]);
        } catch (Throwable $e) {
            error_log('[AUDIT] ' . $e->getMessage());
        }
    }

    public static function diff(array $old, array $new, array $skip = ['updated_at']): array
    {
        $diff = [];
        foreach ($new as $k => $v) {
            if (in_array($k, $skip, true)) continue;
            $oldVal = $old[$k] ?? null;
            if ((string)$oldVal !== (string)$v) {
                $diff[$k] = [$oldVal, $v];
            }
        }
        return $diff;
    }
}
