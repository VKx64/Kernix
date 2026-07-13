<?php
/**
 * Task shelf — round 17 redesign
 * - 2 column layout
 * - All metadata inline-editable (click to edit, save on change)
 * - Time tracking strip at top of right column above tabs
 * - Edit Task button removed
 *
 * Vars: $task, $notes, $subtasks, $totalEstimated, $totalActual, $users,
 *       $projects, $statusValues, $urgValues, $typeValues, $isAdmin
 */
$urgKey   = $task['urgency_key'] ?? 'normal';
$canEdit  = Perm::can('tasks.edit');
$delTpl   = delete_url_template('tasks', 'delete');

// Build JSON option lists for the inline pickers (status/urgency/type/assignee)
$statusOptions = array_map(fn($v) => [
    'id' => (int)$v['id'], 'label' => $v['label'],
    'color' => $v['color'] ?? null, 'key' => $v['key_name'] ?? null,
], $statusValues);

$urgencyOptions = array_map(fn($v) => [
    'id' => (int)$v['id'], 'label' => $v['label'],
    'color' => $v['color'] ?? null, 'key' => $v['key_name'] ?? null,
], $urgValues);

$typeOptions = array_map(fn($v) => [
    'id' => (int)$v['id'], 'label' => $v['label'],
    'color' => $v['color'] ?? null, 'key' => $v['key_name'] ?? null,
], $typeValues);

$assigneeOptions = array_map(fn($u) => [
    'id' => (int)$u['id'],
    'label' => trim($u['first_name'] . ' ' . $u['last_name']),
    'image' => $u['profile_image'] ?? null,
], $users);
?>

<div class="ts17" data-task-id="<?= e($task['id']) ?>">

  <!-- HEADER -->
  <div class="ts17-header">
    <div class="ts17-breadcrumb">
      <?= e($task['client_name'] ?? '—') ?>
      <span style="opacity:.5">›</span>
      <?= e($task['project_name'] ?? '—') ?>
    </div>
    <div class="ts17-title-row">
      <button type="button" class="ts17-type-badge"
              data-inline-select="type_value_id"
              data-current-id="<?= e($task['type_value_id']??'') ?>"
              title="Click to change type">
        <span class="ts17-pill-current pill" style="font-size:11px">
          <?= e($task['type_label'] ?? 'Type') ?>
        </span>
      </button>
      <h2 class="ts17-title"
          data-inline="title"
          title="Click to edit"><?= e($task['title']) ?></h2>
    </div>
  </div>

  <!-- 2-COLUMN BODY -->
  <div class="ts17-body">

    <!-- LEFT — Details + Subtasks -->
    <div class="ts17-col-left">

      <!-- DETAILS card -->
      <div class="ts17-card">
        <div class="ts17-card-title">Details</div>

        <div class="ts17-details-cols">
          <!-- Left sub-column: editable -->
          <div class="ts17-fields">
            <div class="ts17-field">
              <div class="ts17-flabel">Status</div>
              <div class="ts17-fvalue">
                <button type="button" class="ts17-pill-btn"
                        data-inline-select="status_value_id"
                        data-current-id="<?= e($task['status_value_id']??'') ?>">
                  <span class="ts17-pill-current pill"
                        style="<?= $task['status_color']?'background:'.e($task['status_color']).'22;color:'.e($task['status_color']).';border-color:'.e($task['status_color']).'44':'' ?>">
                    <?= e($task['status_label'] ?? '— Set —') ?>
                  </span>
                  <svg class="icon icon-sm" style="opacity:.4"><use href="#i-chevron-down"/></svg>
                </button>
              </div>
            </div>

            <div class="ts17-field">
              <div class="ts17-flabel">Urgency</div>
              <div class="ts17-fvalue">
                <button type="button" class="ts17-pill-btn"
                        data-inline-select="urgency_value_id"
                        data-current-id="<?= e($task['urgency_value_id']??'') ?>">
                  <span class="ts17-pill-current pill pill-urgency-<?= e($urgKey) ?>">
                    <?= e($task['urgency_label'] ?? '— Set —') ?>
                  </span>
                  <svg class="icon icon-sm" style="opacity:.4"><use href="#i-chevron-down"/></svg>
                </button>
              </div>
            </div>

            <div class="ts17-field">
              <div class="ts17-flabel">Assignee</div>
              <div class="ts17-fvalue">
                <button type="button" class="ts17-pill-btn"
                        data-inline-select="assignee_user_id"
                        data-current-id="<?= e($task['assignee_user_id']??'') ?>">
                  <span class="ts17-assignee-current" title="<?= e($task['assignee_name'] ?? 'Unassigned') ?>">
                    <?php if (!empty($task['assignee_name'])): ?>
                      <?php if (!empty($task['assignee_image'])): ?>
                        <img src="<?= e(Storage::url('local', $task['assignee_image'])) ?>" class="avatar" style="width:20px;height:20px;object-fit:cover" alt="<?= e($task['assignee_name']) ?>">
                      <?php else: ?>
                        <span class="avatar" style="width:20px;height:20px;font-size:9px"><?= e(substr($task['assignee_name'],0,2)) ?></span>
                      <?php endif; ?>
                    <?php else: ?>
                      <span class="muted" style="font-size:11px">Unassigned</span>
                    <?php endif; ?>
                  </span>
                  <svg class="icon icon-sm" style="opacity:.4"><use href="#i-chevron-down"/></svg>
                </button>
              </div>
            </div>

            <div class="ts17-field">
              <div class="ts17-flabel">Due Date</div>
              <div class="ts17-fvalue">
                <button type="button" class="ts17-pill-btn"
                        data-inline-date="due_date"
                        data-current-value="<?= e($task['due_date'] ?? '') ?>">
                  <span class="ts17-date-current">
                    <?php if ($task['due_date']):
                        $over = new DateTime($task['due_date']) < new DateTime('today');
                    ?>
                      <span style="<?= $over?'color:var(--danger);font-weight:600':'' ?>"><?= fmt_date($task['due_date']) ?></span>
                    <?php else: ?>
                      <span class="muted">— Set date —</span>
                    <?php endif; ?>
                  </span>
                  <svg class="icon icon-sm" style="opacity:.4"><use href="#i-chevron-down"/></svg>
                </button>
              </div>
            </div>

            <!-- Estimated time — admin only edit, everyone sees -->
            <div class="ts17-field">
              <div class="ts17-flabel">Estimated</div>
              <div class="ts17-fvalue">
                <?php if ($isAdmin): ?>
                  <span class="ts17-pill-btn" id="ts17-est-detail"
                        data-inline-duration="estimated_minutes"
                        data-current-value="<?= e((int)($task['estimated_minutes'] ?? 0) ?: '') ?>"
                        title="Click to edit (admin)">
                    <span><?= fmt_duration((int)($task['estimated_minutes'] ?? 0) ?: null) ?></span>
                  </span>
                <?php else: ?>
                  <span class="muted" style="font-size:13px"><?= fmt_duration((int)($task['estimated_minutes'] ?? 0) ?: null) ?></span>
                <?php endif; ?>
              </div>
            </div>
          </div>

          <!-- Right sub-column: read-only meta -->
          <div class="ts17-fields ts17-fields-meta">
            <div class="ts17-field">
              <div class="ts17-flabel">Created By</div>
              <div class="ts17-fvalue muted"><?= e($task['creator_name'] ?? '—') ?></div>
            </div>
            <div class="ts17-field">
              <div class="ts17-flabel">Created</div>
              <div class="ts17-fvalue muted"><?= fmt_date($task['created_at']) ?></div>
            </div>
            <?php if ($task['client_timezone']): ?>
            <div class="ts17-field">
              <div class="ts17-flabel">Client Time</div>
              <div class="ts17-fvalue">
                <div class="tz-cell" data-tz="<?= e($task['client_timezone']) ?>">
                  <span class="tz-time" style="font-weight:600">--:--</span>
                  <span style="opacity:.6;font-size:11px"> · <?= e($task['client_timezone']) ?></span>
                </div>
              </div>
            </div>
            <?php endif; ?>
          </div>
        </div>

        <!-- Description (inline editable) -->
        <div class="ts17-description-wrap">
          <div class="ts17-flabel">Description</div>
          <div class="ts17-description"
               data-inline="description"
               data-placeholder="Click to add a description…"><?= e($task['description'] ?? '') ?: '' ?></div>
        </div>
      </div>

      <!-- SUBTASKS card -->
      <div class="ts17-card">
        <div class="ts17-card-title">
          Subtasks <span style="color:var(--text-muted);font-weight:400">(<?= count($subtasks) ?>)</span>
        </div>
        <div id="subtasks-container" data-task-id="<?= e($task['id']) ?>">
          <?php
            $totalEst = $totalEstimated;
            $totalAct = $totalActual;
            require VIEWS_PATH . '/tasks_subtasks_partial.php';
          ?>
        </div>
        <?php if ($canEdit): ?>
        <div class="subtask-add-row">
          <input type="text"
                 class="subtask-add-input"
                 id="subtask-quick-add"
                 placeholder="+ Add subtask… (press Enter)">
        </div>
        <?php endif; ?>
      </div>

    </div>

    <!-- RIGHT — Time tracking strip + Tabs -->
    <div class="ts17-col-right">

      <!-- TIME TRACKING — slim one-row strip -->
      <?php
        $taskEstOnly = (int)($task['estimated_minutes'] ?? 0);
        $taskActOnly = (int)($task['actual_minutes']    ?? 0);
        $initPct = $totalEstimated > 0 ? round(($totalActual / $totalEstimated) * 100) : 0;
        $initOver = $initPct > 100;
      ?>
      <div class="ts17-time-strip"
           id="ts17-time-strip"
           data-task-est="<?= e($taskEstOnly) ?>"
           data-task-act="<?= e($taskActOnly) ?>"
           data-sub-est="<?= e($totalEstimated - $taskEstOnly) ?>"
           data-sub-act="<?= e($totalActual    - $taskActOnly) ?>">
        <div class="ts17-time-cell">
          <div class="ts17-time-label">Estimated</div>
          <div class="ts17-time-value" id="ts17-est-display">
            <?= fmt_duration($totalEstimated ?: null) ?>
          </div>
        </div>
        <div class="ts17-time-cell">
          <div class="ts17-time-label">Actual</div>
          <div class="ts17-time-value ts17-time-actual" id="ts17-act-display">
            <?= fmt_duration($totalActual ?: null) ?>
          </div>
        </div>
        <div class="ts17-time-cell" id="ts17-pct-cell" style="<?= $totalEstimated > 0 ? '' : 'display:none' ?>">
          <div class="ts17-time-label">Progress</div>
          <div class="ts17-time-value"
               id="ts17-pct-display"
               style="<?= $initOver?'color:var(--danger)':'' ?>"><?= $initPct ?>%</div>
        </div>
        <div class="ts17-time-cell ts17-time-bar-cell" id="ts17-bar-cell" style="<?= $totalEstimated > 0 ? '' : 'display:none' ?>">
          <div class="ts17-time-bar">
            <div class="ts17-time-bar-fill"
                 id="ts17-bar-fill"
                 style="width:<?= min(100,$initPct) ?>%;background:<?= $initOver?'var(--danger)':'linear-gradient(90deg,var(--primary),var(--accent))' ?>"></div>
          </div>
        </div>
      </div>

      <!-- TABS (Notes / Emails / Activity) -->
      <div class="ts17-card" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="ts-tabs">
          <button type="button" class="ts-tab active" data-tab="notes">Notes</button>
          <button type="button" class="ts-tab" data-tab="emails">Emails</button>
          <button type="button" class="ts-tab" data-tab="activity">Activity</button>
        </div>

        <!-- NOTES TAB -->
        <div class="ts-tab-panel ts-tab-panel-active" data-panel="notes" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
          <div class="notes-list" id="notes-list-<?= e($task['id']) ?>" style="flex:1;overflow-y:auto;margin:0 -4px;padding:0 4px">
            <?php require VIEWS_PATH . '/tasks_notes_partial.php'; ?>
          </div>
          <form data-note-form-v2 data-task-id="<?= e($task['id']) ?>" style="border-top:1px solid var(--glass-border-2);padding-top:12px;margin-top:12px" enctype="multipart/form-data">
            <?= csrf_field() ?>
            <input type="hidden" name="task_id" value="<?= e($task['id']) ?>">
            <textarea name="note_body" placeholder="Add a note or message…" style="width:100%;min-height:60px;font-size:13px;margin-bottom:8px"></textarea>

            <!-- Time row (hidden until +Time clicked) -->
            <div class="note-time-row" id="note-time-row" style="display:none">
              <span style="font-size:13px">⏱</span>
              <label style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Time:</label>
              <input type="text" name="time_spent" id="note-time-input"
                     placeholder="e.g. 30m, 1h 15m"
                     style="width:120px;font-size:12px;padding:5px 8px">
              <?php if (!empty($subtasks)): ?>
                <label style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">on:</label>
                <select name="subtask_id" style="font-size:12px;flex:1;min-width:120px">
                  <option value="">(this task)</option>
                  <?php foreach ($subtasks as $s): ?>
                    <option value="<?= e($s['id']) ?>"><?= e($s['title']) ?></option>
                  <?php endforeach; ?>
                </select>
              <?php else: ?>
                <input type="hidden" name="subtask_id" value="">
              <?php endif; ?>
              <button type="button" class="note-time-clear" id="note-time-clear" title="Remove time">&times;</button>
            </div>

            <div class="note-attach-preview" id="note-attach-preview" style="display:none"></div>

            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <label class="btn btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px" title="Attach files">
                <svg class="icon icon-sm"><use href="#i-plus"/></svg> Attach
                <input type="file" name="attachments[]" multiple style="display:none" id="note-attach-input" accept="image/*,application/pdf">
              </label>
              <button type="button" class="btn btn-sm" id="note-add-time-btn" style="display:inline-flex;align-items:center;gap:6px">
                <span style="font-size:13px">⏱</span> Time
              </button>
              <select name="assigned_user_id" style="flex:1;font-size:12px;min-width:120px">
                <option value="">(General note)</option>
                <?php foreach ($users as $u): ?>
                  <option value="<?= e($u['id']) ?>">→ <?= e($u['first_name'].' '.$u['last_name']) ?></option>
                <?php endforeach; ?>
              </select>
              <button type="submit" class="btn btn-primary btn-sm">
                <svg class="icon icon-sm"><use href="#i-send"/></svg> Send
              </button>
            </div>
          </form>
        </div>

        <!-- EMAILS TAB — inline composer + thread -->
        <div class="ts-tab-panel" data-panel="emails" style="flex:1;display:none;flex-direction:column;overflow:hidden">
          <div class="emails-list" id="emails-list-<?= e($task['id']) ?>" style="flex:1;overflow-y:auto;margin:0 -4px 12px;padding:0 4px">
            <div class="muted" style="text-align:center;padding:20px;font-size:12px">Loading…</div>
          </div>

          <!-- Inline email composer -->
          <form id="email-composer-form" enctype="multipart/form-data"
                class="email-composer-inline" style="border-top:1px solid var(--glass-border-2);padding-top:12px">
            <?= csrf_field() ?>
            <input type="hidden" name="task_id" value="<?= e($task['id']) ?>">

            <div id="email-composer-warning" class="email-warning" style="display:none"></div>

            <!-- From (display only) -->
            <div class="email-row email-row-from">
              <span class="email-row-label">From</span>
              <span class="email-row-value muted" id="email-from-display">—</span>
            </div>

            <!-- To with contact chips -->
            <div class="email-row email-row-to">
              <span class="email-row-label">To <span class="required">*</span></span>
              <input type="text" name="to" id="email-to-input"
                     placeholder="email@example.com" autocomplete="off">
            </div>
            <div id="email-contact-suggestions" class="email-contact-suggestions"></div>

            <!-- Cc/Bcc collapsible -->
            <div class="email-cc-bcc" id="email-cc-bcc" style="display:none">
              <div class="email-row email-row-small">
                <span class="email-row-label">Cc</span>
                <input type="text" name="cc" id="email-cc-input" placeholder="(optional)" autocomplete="off">
              </div>
              <div class="email-row email-row-small">
                <span class="email-row-label">Bcc</span>
                <input type="text" name="bcc" id="email-bcc-input" placeholder="(optional)" autocomplete="off">
              </div>
            </div>

            <!-- Subject -->
            <div class="email-row">
              <span class="email-row-label">Subject <span class="required">*</span></span>
              <input type="text" name="subject" id="email-subject-input" maxlength="500" autocomplete="off">
            </div>

            <!-- Message -->
            <textarea name="body" id="email-body-input"
                      placeholder="Type your message here…"
                      class="email-body-input"></textarea>

            <!-- Attachments preview -->
            <div class="note-attach-preview" id="email-attach-preview" style="display:none"></div>

            <!-- Toolbar -->
            <div class="email-toolbar">
              <div class="email-toolbar-left">
                <label class="email-toolbar-btn" title="Attach files">
                  <svg class="icon icon-sm"><use href="#i-plus"/></svg>
                  <input type="file" name="attachments[]" multiple style="display:none" id="email-attach-input">
                </label>
                <button type="button" class="email-toolbar-btn" id="email-toggle-cc" title="Show Cc/Bcc">
                  Cc/Bcc
                </button>
              </div>
              <button type="submit" class="btn btn-primary btn-sm" id="email-send-btn">
                <svg class="icon icon-sm"><use href="#i-send"/></svg> Send Email
              </button>
            </div>
          </form>
        </div>

        <!-- ACTIVITY TAB -->
        <div class="ts-tab-panel" data-panel="activity" style="flex:1;display:none;flex-direction:column;overflow:hidden">
          <div class="activity-list" id="activity-list-<?= e($task['id']) ?>" style="flex:1;overflow-y:auto;margin:0 -4px;padding:0 4px">
            <div class="muted" style="text-align:center;padding:20px;font-size:12px">Loading…</div>
          </div>
        </div>
      </div>

    </div>

  </div>

  <!-- Inline picker popover (one shared element, repositioned per click) -->
  <div class="ts17-popover" id="ts17-popover">
    <div class="ts17-popover-inner"></div>
  </div>

  <!-- SUBTASK MODAL -->
  <?php if ($canEdit): ?>
  <div class="modal-backdrop" id="subtask-modal">
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Subtask</h2>
        <button class="modal-close" data-modal-close>&times;</button>
      </div>
      <div class="modal-body">
        <form id="subtask-form" data-subtask-form>
          <?= csrf_field() ?>
          <input type="hidden" name="task_id" value="<?= e($task['id']) ?>">
          <input type="hidden" name="id" value="">
          <div class="form-grid">
            <div class="form-row full">
              <label>Title <span class="required">*</span></label>
              <input type="text" name="title" required>
            </div>
            <div class="form-row">
              <label>Assignee</label>
              <select name="assignee_user_id">
                <option value="">— Unassigned —</option>
                <?php foreach ($users as $u): ?>
                  <option value="<?= e($u['id']) ?>"><?= e($u['first_name'].' '.$u['last_name']) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
            <div class="form-row">
              <label>Status</label>
              <select name="status_value_id">
                <option value="">—</option>
                <?php foreach ($statusValues as $sv): ?>
                  <option value="<?= e($sv['id']) ?>"><?= e($sv['label']) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
            <div class="form-row">
              <label>Due Date</label>
              <input type="date" name="due_date">
            </div>
            <?php if ($isAdmin): ?>
              <div class="form-row">
                <label>Estimated <span style="font-size:10px;color:var(--text-muted)">(admin)</span></label>
                <input type="text" name="estimated_minutes" placeholder="e.g. 30m, 1h 30m">
              </div>
            <?php endif; ?>
            <div class="form-row<?= $isAdmin?'':' full' ?>">
              <label>Actual Time Spent</label>
              <input type="text" name="actual_minutes" placeholder="e.g. 45m, 1h">
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button type="button" class="btn" data-modal-close>Cancel</button>
          <button type="submit" form="subtask-form" class="btn btn-primary">Save Subtask</button>
        </div>
      </div>
    </div>
  </div>
  <?php endif; ?>

  <?php /* round 18: email composer is inline in the Emails tab, no modal needed */ ?>

</div>

<script type="application/json" id="ts17-options-data">
<?= json_encode([
    'status'   => $statusOptions,
    'urgency'  => $urgencyOptions,
    'type'     => $typeOptions,
    'assignee' => $assigneeOptions,
]) ?>
</script>

<script>
(function () {
  const root   = document.querySelector('.ts17');
  if (!root) return;
  const taskId = root.dataset.taskId;
  const BASE   = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF   = document.querySelector('meta[name=csrf]')?.content || '';
  const OPTS   = JSON.parse(document.getElementById('ts17-options-data').textContent);
  const popover     = document.getElementById('ts17-popover');
  const popoverBody = popover.querySelector('.ts17-popover-inner');

  /* ============================================================
     Inline save — generic update endpoint
  ============================================================ */
  async function saveField(field, value) {
    if (window.checkClockedIn && !await window.checkClockedIn()) return null;

    const fd = new FormData();
    fd.append('_csrf', CSRF);
    fd.append('task_id', taskId);
    fd.append('field', field);
    fd.append('value', value ?? '');

    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=update_field`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('Saved.', 'success');
        return j;
      } else if (j.reason === 'not_clocked_in') {
        window.showClockInPrompt?.();
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch {
      window.showToast?.('Network error.', 'error');
    }
    return null;
  }

  /* ============================================================
     Popover positioning + close
  ============================================================ */
  function showPopoverAt(anchor) {
    const r = anchor.getBoundingClientRect();
    popover.style.display = 'block';
    popover.style.position = 'fixed';
    popover.style.top  = (r.bottom + 4) + 'px';
    popover.style.left = r.left + 'px';
    popover.style.minWidth = Math.max(180, r.width) + 'px';
    popover._anchor = anchor;
  }
  function hidePopover() {
    popover.style.display = 'none';
    popoverBody.innerHTML = '';
    popover._anchor = null;
  }
  document.addEventListener('click', (e) => {
    if (popover.style.display === 'block'
        && !popover.contains(e.target)
        && !e.target.closest('[data-inline-select],[data-inline-date]')) {
      hidePopover();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover.style.display === 'block') hidePopover();
  });
  window.addEventListener('resize', hidePopover);

  /* ============================================================
     Inline pill picker (status / urgency / type / assignee)
  ============================================================ */
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inline-select]');
    if (!btn) return;
    e.stopPropagation();
    const field = btn.dataset.inlineSelect;
    const current = btn.dataset.currentId || '';

    let opts, mode;
    if (field === 'status_value_id')   { opts = OPTS.status;   mode = 'pill'; }
    if (field === 'urgency_value_id')  { opts = OPTS.urgency;  mode = 'pill'; }
    if (field === 'type_value_id')     { opts = OPTS.type;     mode = 'pill'; }
    if (field === 'assignee_user_id')  { opts = OPTS.assignee; mode = 'avatar'; }
    if (!opts) return;

    let html = '<div class="ts17-popover-list">';
    // "None" option for clearable fields
    html += `<button type="button" class="ts17-popover-item ${!current?'active':''}" data-pick="">
      <span class="muted">— None —</span>
    </button>`;
    opts.forEach(o => {
      const active = String(o.id) === String(current) ? 'active' : '';
      if (mode === 'pill') {
        const style = o.color
          ? `background:${o.color}22;color:${o.color};border-color:${o.color}44`
          : '';
        const cls = (field === 'urgency_value_id' && o.key)
          ? `pill pill-urgency-${o.key}` : 'pill';
        html += `<button type="button" class="ts17-popover-item ${active}" data-pick="${o.id}">
          <span class="${cls}" style="${style}">${escapeHtml(o.label)}</span>
        </button>`;
      } else {
        // Avatar mode (assignee picker) — use profile image when available
        const initials = o.label.substring(0,2);
        const av = o.image
          ? `<img src="${BASE}/uploads/${escapeHtml(o.image)}" class="avatar" style="width:20px;height:20px;object-fit:cover" alt="">`
          : `<span class="avatar" style="width:20px;height:20px;font-size:9px">${escapeHtml(initials)}</span>`;
        html += `<button type="button" class="ts17-popover-item ${active}" data-pick="${o.id}">
          ${av}
          <span>${escapeHtml(o.label)}</span>
        </button>`;
      }
    });
    html += '</div>';
    popoverBody.innerHTML = html;
    showPopoverAt(btn);

    // Wire picks
    popover.querySelectorAll('[data-pick]').forEach(item => {
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const newId = item.dataset.pick;
        hidePopover();
        const result = await saveField(field, newId);
        if (!result) return;
        updatePillDisplay(btn, field, newId, result.display);
      });
    });
  });

  function updatePillDisplay(btn, field, newId, display) {
    btn.dataset.currentId = newId || '';
    if (field === 'assignee_user_id') {
      const cur = btn.querySelector('.ts17-assignee-current');
      if (display?.label && newId) {
        const img = display.image
          ? `<img src="${BASE}/uploads/${escapeHtml(display.image)}" class="avatar" style="width:20px;height:20px;object-fit:cover" alt="${escapeHtml(display.label)}">`
          : `<span class="avatar" style="width:20px;height:20px;font-size:9px">${escapeHtml(display.label.substring(0,2))}</span>`;
        cur.innerHTML = img;
        cur.setAttribute('title', display.label);
      } else {
        cur.innerHTML = '<span class="muted" style="font-size:11px">Unassigned</span>';
        cur.setAttribute('title', 'Unassigned');
      }
    } else {
      const pill = btn.querySelector('.ts17-pill-current');
      if (display?.label && newId) {
        pill.textContent = display.label;
        if (field === 'urgency_value_id') {
          pill.className = 'ts17-pill-current pill pill-urgency-' + (display.key || 'normal');
          pill.removeAttribute('style');
        } else if (display.color) {
          pill.className = 'ts17-pill-current pill';
          pill.style.cssText = `background:${display.color}22;color:${display.color};border-color:${display.color}44`;
        } else {
          pill.className = 'ts17-pill-current pill';
          pill.style.cssText = field === 'type_value_id' ? 'font-size:11px' : '';
        }
      } else {
        pill.className = 'ts17-pill-current pill';
        pill.style.cssText = field === 'type_value_id' ? 'font-size:11px' : '';
        pill.textContent = '— Set —';
      }
    }
  }

  /* ============================================================
     Inline date picker
  ============================================================ */
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inline-date]');
    if (!btn) return;
    e.stopPropagation();
    const field = btn.dataset.inlineDate;
    const current = btn.dataset.currentValue || '';

    popoverBody.innerHTML = `
      <div style="padding:12px;display:flex;flex-direction:column;gap:8px;min-width:200px">
        <input type="date" id="ts17-date-input" value="${escapeHtml(current)}"
               style="width:100%;font-size:13px;padding:6px">
        <div style="display:flex;gap:6px">
          <button type="button" class="btn btn-sm btn-primary" id="ts17-date-save" style="flex:1">Save</button>
          ${current ? '<button type="button" class="btn btn-sm" id="ts17-date-clear">Clear</button>' : ''}
        </div>
      </div>
    `;
    showPopoverAt(btn);
    const input = document.getElementById('ts17-date-input');
    setTimeout(() => input.focus(), 50);

    document.getElementById('ts17-date-save').addEventListener('click', async () => {
      const v = input.value;
      hidePopover();
      const result = await saveField(field, v);
      if (!result) return;
      updateDateDisplay(btn, v, result.display);
    });
    document.getElementById('ts17-date-clear')?.addEventListener('click', async () => {
      hidePopover();
      const result = await saveField(field, '');
      if (!result) return;
      updateDateDisplay(btn, '', null);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') document.getElementById('ts17-date-save').click();
    });
  });

  function updateDateDisplay(btn, newVal, display) {
    btn.dataset.currentValue = newVal || '';
    const cur = btn.querySelector('.ts17-date-current');
    if (newVal && display?.label) {
      const style = display.overdue ? 'color:var(--danger);font-weight:600' : '';
      cur.innerHTML = `<span style="${style}">${escapeHtml(display.label)}</span>`;
    } else {
      cur.innerHTML = '<span class="muted">— Set date —</span>';
    }
  }

  /* ============================================================
     Inline text editing — title & description
  ============================================================ */
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-inline]');
    if (!el) return;
    if (el._editing) return;
    e.stopPropagation();

    const field   = el.dataset.inline;
    const isMulti = field === 'description';
    const original = el.textContent.trim();
    const isEmpty = el.classList.contains('is-empty');

    el._editing = true;
    el.classList.add('ts17-editing');

    const input = document.createElement(isMulti ? 'textarea' : 'input');
    if (!isMulti) input.type = 'text';
    input.value = isEmpty ? '' : original;
    input.className = 'ts17-inline-input';
    if (isMulti) input.rows = 4;

    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    if (!isMulti) input.select();

    const finish = async (commit) => {
      if (el._finishing) return;
      el._finishing = true;
      el._editing = false;
      el.classList.remove('ts17-editing');
      const newVal = input.value.trim();

      if (!commit || newVal === original) {
        // Restore
        renderInlineText(el, field, original);
        el._finishing = false;
        return;
      }

      const result = await saveField(field, newVal);
      if (result) {
        renderInlineText(el, field, newVal);
      } else {
        renderInlineText(el, field, original);
      }
      el._finishing = false;
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        input.value = original;
        finish(false);
      }
      if (ev.key === 'Enter' && !isMulti) {
        ev.preventDefault();
        input.blur();
      }
      if (ev.key === 'Enter' && isMulti && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        input.blur();
      }
    });
  });

  function renderInlineText(el, field, value) {
    el.classList.remove('is-empty');
    if (!value && el.dataset.placeholder) {
      el.classList.add('is-empty');
      el.textContent = el.dataset.placeholder;
    } else {
      el.textContent = value;
    }
  }

  // Initialize empty description placeholder
  root.querySelectorAll('[data-inline][data-placeholder]').forEach(el => {
    if (!el.textContent.trim()) {
      el.classList.add('is-empty');
      el.textContent = el.dataset.placeholder;
    }
  });

  /* ============================================================
     ROUND 20 — Time strip recalculation + animation
  ============================================================ */
  function fmtDurationJS(minutes) {
    if (!minutes || minutes <= 0) return '—';
    if (minutes < 60) return minutes + 'm';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  }

  function updateTimeStrip() {
    const strip = document.getElementById('ts17-time-strip');
    if (!strip) return;
    const taskEst = parseInt(strip.dataset.taskEst || 0, 10);
    const taskAct = parseInt(strip.dataset.taskAct || 0, 10);
    const subEst  = parseInt(strip.dataset.subEst  || 0, 10);
    const subAct  = parseInt(strip.dataset.subAct  || 0, 10);
    const totalEst = taskEst + subEst;
    const totalAct = taskAct + subAct;

    const estEl  = document.getElementById('ts17-est-display');
    const actEl  = document.getElementById('ts17-act-display');
    const pctEl  = document.getElementById('ts17-pct-display');
    const pctCell= document.getElementById('ts17-pct-cell');
    const barEl  = document.getElementById('ts17-bar-fill');
    const barCell= document.getElementById('ts17-bar-cell');

    // Update displayed values with subtle pulse animation
    if (estEl) {
      estEl.textContent = fmtDurationJS(totalEst);
      estEl.dataset.currentValue = taskEst || '';
      flashUpdate(estEl);
    }
    if (actEl) {
      actEl.textContent = fmtDurationJS(totalAct);
      actEl.dataset.currentValue = taskAct || '';
      flashUpdate(actEl);
    }

    if (totalEst > 0) {
      const pct = Math.round((totalAct / totalEst) * 100);
      const over = pct > 100;
      if (pctCell) pctCell.style.display = '';
      if (barCell) barCell.style.display = '';
      if (pctEl) {
        pctEl.textContent = pct + '%';
        pctEl.style.color = over ? 'var(--danger)' : '';
        flashUpdate(pctEl);
      }
      if (barEl) {
        // Animate width + color
        barEl.style.width = Math.min(100, pct) + '%';
        barEl.style.background = over
          ? 'var(--danger)'
          : 'linear-gradient(90deg, var(--primary), var(--accent))';
      }
    } else {
      if (pctCell) pctCell.style.display = 'none';
      if (barCell) barCell.style.display = 'none';
    }
  }

  function flashUpdate(el) {
    el.classList.remove('ts17-value-flash');
    // Force reflow so animation restarts even on rapid edits
    void el.offsetWidth;
    el.classList.add('ts17-value-flash');
  }
  window.updateTimeStrip = updateTimeStrip;

  /* ============================================================
     Inline duration (estimated/actual)
  ============================================================ */
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-inline-duration]');
    if (!el) return;
    if (el._editing) return;
    e.stopPropagation();

    const field = el.dataset.inlineDuration;
    const original = el.textContent.trim();
    el._editing = true;
    el.classList.add('ts17-editing');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ts17-inline-input';
    input.placeholder = 'e.g. 1h 30m';
    input.value = (original === '—') ? '' : original;
    input.style.width = '80px';

    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit) => {
      if (el._finishing) return;
      el._finishing = true;
      el._editing = false;
      el.classList.remove('ts17-editing');
      const newVal = input.value.trim();

      if (!commit) {
        el.textContent = original;
        el._finishing = false;
        return;
      }

      const result = await saveField(field, newVal);
      if (result) {
        // ROUND 20: update strip totals + animate bar after saving estimated/actual
        const strip = document.getElementById('ts17-time-strip');
        if (strip) {
          // Server returned the new value as parsed minutes
          const newMin = result.display?.value || 0;
          if (field === 'estimated_minutes') {
            strip.dataset.taskEst = newMin;
          } else if (field === 'actual_minutes') {
            strip.dataset.taskAct = newMin;
          }
          updateTimeStrip();
        } else {
          el.textContent = result.display?.label || '—';
        }
      } else {
        el.textContent = original;
      }
      el._finishing = false;
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { input.value = ''; finish(false); }
      if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
    });
  });

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ============================================================
     Re-tick clocks
  ============================================================ */
  if (window.dispatchEvent) window.dispatchEvent(new Event('DOMContentLoaded'));

  /* ============================================================
     SUBTASK MODAL — same as before
  ============================================================ */
  const subModal = document.getElementById('subtask-modal');
  const subForm  = document.getElementById('subtask-form');

  document.querySelectorAll('[data-subtask-new]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!subForm) return;
      subForm.reset();
      subForm.elements['id'].value = '';
      subForm.elements['task_id'].value = taskId;
      const title = subModal.querySelector('.modal-title');
      if (title) title.textContent = 'New Subtask';
    });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-subtask-edit]');
    if (!btn) return;
    const rec = JSON.parse(btn.dataset.subtask || '{}');
    if (!subForm) return;
    subForm.reset();
    Object.entries(rec).forEach(([k,v]) => {
      const el = subForm.elements[k];
      if (el) el.value = v ?? '';
    });
    const title = subModal.querySelector('.modal-title');
    if (title) title.textContent = 'Edit Subtask';
    window.openModal?.('subtask-modal');
  });

  if (subForm) {
    subForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (window.checkClockedIn && !await window.checkClockedIn()) return;
      const fd  = new FormData(subForm);
      try {
        const res  = await fetch(`${BASE}/index.php?p=tasks&action=save_subtask`, {
          method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          window.showToast?.(j.message || 'Saved.', 'success');
          window.closeModal?.('subtask-modal');
          reloadSubtasks();
        } else if (j.reason === 'not_clocked_in') {
          window.showClockInPrompt?.();
        } else {
          window.showToast?.(j.message || 'Failed.', 'error');
        }
      } catch { window.showToast?.('Network error.', 'error'); }
    });
  }

  document.addEventListener('change', async (e) => {
    const cb = e.target;
    if (!cb.matches('[data-subtask-toggle]')) return;
    if (window.checkClockedIn && !await window.checkClockedIn()) { cb.checked = !cb.checked; return; }
    const id  = cb.dataset.subtaskToggle;
    const fd  = new FormData();
    fd.append('_csrf', CSRF);
    fd.append('id', id);
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=toggle_subtask`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) reloadSubtasks();
      else { window.showToast?.(j.message || 'Failed.', 'error'); cb.checked = !cb.checked; }
    } catch { window.showToast?.('Network error.', 'error'); cb.checked = !cb.checked; }
  });

  async function reloadSubtasks() {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    const res = await fetch(`${BASE}/index.php?p=tasks&action=subtasks_partial&id=${taskId}`, {
      headers: {'X-Requested-With':'XMLHttpRequest'}
    });
    container.innerHTML = await res.text();
  }
  window.reloadSubtasks = reloadSubtasks;

  /* ============================================================
     ROUND 19 — Inline subtask add (quick-add input)
  ============================================================ */
  const quickAddInput = document.getElementById('subtask-quick-add');
  if (quickAddInput) {
    quickAddInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const title = quickAddInput.value.trim();
      if (!title) return;
      if (window.checkClockedIn && !await window.checkClockedIn()) return;

      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('task_id', taskId);
      fd.append('title', title);
      quickAddInput.disabled = true;
      try {
        const res = await fetch(`${BASE}/index.php?p=tasks&action=save_subtask`, {
          method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          quickAddInput.value = '';
          window.showToast?.('Subtask added.', 'success');
          await reloadSubtasks();
        } else if (j.reason === 'not_clocked_in') {
          window.showClockInPrompt?.();
        } else {
          window.showToast?.(j.message || 'Failed.', 'error');
        }
      } catch {
        window.showToast?.('Network error.', 'error');
      }
      quickAddInput.disabled = false;
      quickAddInput.focus();
    });
  }

  /* ============================================================
     ROUND 19 — Inline subtask TITLE edit (click subtask title)
  ============================================================ */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.subtask-row .subtask-title');
    if (!el) return;
    if (el._editing) return;
    const row = el.closest('.subtask-row');
    if (!row) return;
    const subtaskId = row.dataset.subtaskId;
    if (!subtaskId) return;
    e.stopPropagation();

    const original = el.textContent.trim();
    el._editing = true;
    el.classList.add('subtask-title-editing');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.className = 'subtask-title-input';

    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit) => {
      if (el._finishing) return;
      el._finishing = true;
      el._editing = false;
      el.classList.remove('subtask-title-editing');
      const newVal = input.value.trim();

      if (!commit || !newVal || newVal === original) {
        el.textContent = original;
        el._finishing = false;
        return;
      }

      if (window.checkClockedIn && !await window.checkClockedIn()) {
        el.textContent = original;
        el._finishing = false;
        return;
      }

      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('task_id', taskId);
      fd.append('id', subtaskId);
      fd.append('title', newVal);
      try {
        const res = await fetch(`${BASE}/index.php?p=tasks&action=save_subtask`, {
          method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          el.textContent = newVal;
          window.showToast?.('Subtask updated.', 'success');
        } else if (j.reason === 'not_clocked_in') {
          window.showClockInPrompt?.();
          el.textContent = original;
        } else {
          window.showToast?.(j.message || 'Failed.', 'error');
          el.textContent = original;
        }
      } catch {
        window.showToast?.('Network error.', 'error');
        el.textContent = original;
      }
      el._finishing = false;
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { input.value = original; finish(false); }
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    });
  });

  /* ============================================================
     NOTE FORM v2 — with attachments + image preview
  ============================================================ */
  const noteForm  = document.querySelector('[data-note-form-v2]');
  const attachIn  = document.getElementById('note-attach-input');
  const previewEl = document.getElementById('note-attach-preview');
  let stagedFiles = [];

  function renderPreview() {
    if (!previewEl) return;
    if (stagedFiles.length === 0) {
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
      return;
    }
    previewEl.style.display = '';
    previewEl.innerHTML = stagedFiles.map((sf, i) => {
      const isImage = sf.file.type.startsWith('image/');
      const inner = isImage
        ? `<img src="${sf.url}" alt="">`
        : `<div class="note-att-icon">📄</div><div class="note-att-name">${escapeHtml(sf.file.name)}</div>`;
      return `<div class="note-att-staged" data-i="${i}">
        ${inner}
        <button type="button" class="note-att-remove" data-i="${i}" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  if (attachIn) {
    attachIn.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(f => {
        const obj = { file: f };
        if (f.type.startsWith('image/')) obj.url = URL.createObjectURL(f);
        stagedFiles.push(obj);
      });
      renderPreview();
      attachIn.value = '';
    });
  }

  if (previewEl) {
    previewEl.addEventListener('click', (e) => {
      const rm = e.target.closest('.note-att-remove');
      if (!rm) return;
      const i = parseInt(rm.dataset.i, 10);
      if (stagedFiles[i]?.url) URL.revokeObjectURL(stagedFiles[i].url);
      stagedFiles.splice(i, 1);
      renderPreview();
    });
  }

  if (noteForm) {
    noteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (window.checkClockedIn && !await window.checkClockedIn()) return;
      const body = noteForm.elements['note_body'].value.trim();
      const timeSpent = (noteForm.elements['time_spent']?.value || '').trim();
      if (!body && stagedFiles.length === 0 && !timeSpent) {
        window.showToast?.('Add a message, attachment, or time.', 'error');
        return;
      }
      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('task_id', taskId);
      fd.append('note_body', body);
      fd.append('assigned_user_id', noteForm.elements['assigned_user_id'].value);
      if (timeSpent) fd.append('time_spent', timeSpent);
      const subSel = noteForm.elements['subtask_id'];
      if (subSel && subSel.value) fd.append('subtask_id', subSel.value);
      stagedFiles.forEach(sf => fd.append('attachments[]', sf.file));

      const btn = noteForm.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(`${BASE}/index.php?p=tasks&action=add_note`, {
          method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          noteForm.reset();
          stagedFiles.forEach(sf => sf.url && URL.revokeObjectURL(sf.url));
          stagedFiles = [];
          renderPreview();
          // Hide the time row again
          document.getElementById('note-time-row').style.display = 'none';
          const list = document.getElementById('notes-list-' + taskId);
          if (list) {
            const r = await fetch(`${BASE}/index.php?p=tasks&action=notes_partial&id=${taskId}`, {
              headers: {'X-Requested-With':'XMLHttpRequest'}
            });
            list.innerHTML = await r.text();
            list.scrollTop = list.scrollHeight;
          }
          // If time was added, refresh the strip from server-side totals
          if (timeSpent) await refreshTimeStripFromServer();
        } else if (j.reason === 'not_clocked_in') {
          window.showClockInPrompt?.();
        } else {
          window.showToast?.(j.message || 'Failed.', 'error');
        }
      } catch { window.showToast?.('Network error.', 'error'); }
      if (btn) btn.disabled = false;
    });
  }

  /* ============================================================
     ROUND 21 — +Time button, note edit flow, strip refresh
  ============================================================ */
  const addTimeBtn = document.getElementById('note-add-time-btn');
  const timeRow    = document.getElementById('note-time-row');
  const timeInput  = document.getElementById('note-time-input');
  const timeClear  = document.getElementById('note-time-clear');

  if (addTimeBtn && timeRow) {
    addTimeBtn.addEventListener('click', () => {
      timeRow.style.display = 'flex';
      setTimeout(() => timeInput?.focus(), 10);
    });
  }
  if (timeClear) {
    timeClear.addEventListener('click', () => {
      timeRow.style.display = 'none';
      if (timeInput) timeInput.value = '';
      const subSel = document.querySelector('[data-note-form-v2] select[name=subtask_id]');
      if (subSel) subSel.value = '';
    });
  }

  // Refresh the time strip totals from a fresh server query
  async function refreshTimeStripFromServer() {
    try {
      const r = await fetch(`${BASE}/index.php?p=tasks&action=time_totals&id=${taskId}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await r.json();
      if (!j.ok) return;
      const strip = document.getElementById('ts17-time-strip');
      if (!strip) return;
      strip.dataset.taskEst = j.task_estimated;
      strip.dataset.taskAct = j.task_actual;
      strip.dataset.subEst  = j.sub_estimated;
      strip.dataset.subAct  = j.sub_actual;
      if (typeof window.updateTimeStrip === 'function') window.updateTimeStrip();
      // Also update Estimated in Details card if shown
      const estDetail = document.getElementById('ts17-est-detail');
      if (estDetail) {
        const span = estDetail.querySelector('span');
        if (span) span.textContent = fmtDurationJS(j.task_estimated);
        estDetail.dataset.currentValue = j.task_estimated || '';
      }
    } catch {}
  }
  window.refreshTimeStripFromServer = refreshTimeStripFromServer;

  // NOTE EDIT FLOW (inline)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-note-edit]');
    if (!btn) return;
    const card = btn.closest('.note-card');
    if (!card) return;
    card.querySelector('.note-view-mode').style.display = 'none';
    card.querySelector('.note-edit-mode').style.display = 'block';
    card.querySelector('.note-edit-body')?.focus();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-note-cancel-edit]');
    if (!btn) return;
    const card = btn.closest('.note-card');
    if (!card) return;
    card.querySelector('.note-view-mode').style.display = '';
    card.querySelector('.note-edit-mode').style.display = 'none';
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-note-save-edit]');
    if (!btn) return;
    const card = btn.closest('.note-card');
    const id = btn.dataset.noteSaveEdit;
    if (!card || !id) return;
    const bodyEl = card.querySelector('.note-edit-body');
    const timeEl = card.querySelector('.note-edit-time');

    if (window.checkClockedIn && !await window.checkClockedIn()) return;

    btn.disabled = true;
    const fd = new FormData();
    fd.append('_csrf', CSRF);
    fd.append('id', id);
    fd.append('body', bodyEl ? bodyEl.value : '');
    fd.append('time_spent', timeEl ? timeEl.value : '');
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=edit_note`, {
        method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.('Note updated.', 'success');
        // Re-render notes list
        const list = document.getElementById('notes-list-' + taskId);
        if (list) {
          const r = await fetch(`${BASE}/index.php?p=tasks&action=notes_partial&id=${taskId}`, {
            headers: {'X-Requested-With':'XMLHttpRequest'}
          });
          list.innerHTML = await r.text();
        }
        await refreshTimeStripFromServer();
      } else if (j.reason === 'not_clocked_in') {
        window.showClockInPrompt?.();
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch { window.showToast?.('Network error.', 'error'); }
    btn.disabled = false;
  });

  // Also refresh strip after delete
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-note-delete]')) {
      // The delete handler is in round11 — wait a tick then refresh
      setTimeout(() => refreshTimeStripFromServer(), 600);
    }
  });

  /* Click image attachments for lightbox */
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.note-att-image');
    if (!img) return;
    window.openLightbox?.(img.dataset.fullsize || img.src);
  });

  /* ============================================================
     TABS + Lazy load emails/activity
  ============================================================ */
  let emailsLoaded = false;
  let activityLoaded = false;

  root.querySelectorAll('.ts-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      root.querySelectorAll('.ts-tab').forEach(t => t.classList.toggle('active', t === tab));
      root.querySelectorAll('.ts-tab-panel').forEach(p => {
        const on = p.dataset.panel === target;
        p.classList.toggle('ts-tab-panel-active', on);
        p.style.display = on ? 'flex' : 'none';
      });
      if (target === 'emails') {
        if (!emailsLoaded) { loadEmails(); emailsLoaded = true; }
        initEmailComposer();
      }
      if (target === 'activity' && !activityLoaded) { loadActivity(); activityLoaded = true; }
    });
  });

  async function loadEmails() {
    const list = document.getElementById('emails-list-' + taskId);
    if (!list) return;
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=emails_partial&id=${taskId}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      list.innerHTML = await res.text();
    } catch { list.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Failed to load.</div>'; }
  }
  window.reloadEmails = loadEmails;

  async function loadActivity() {
    const list = document.getElementById('activity-list-' + taskId);
    if (!list) return;
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=activity_partial&id=${taskId}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      list.innerHTML = await res.text();
    } catch { list.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Failed to load.</div>'; }
  }

  /* Email expand/collapse */
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-email-toggle]');
    if (!toggle) return;
    const card = toggle.closest('.email-card');
    const body = card.querySelector('.email-card-body');
    const label = toggle.querySelector('.email-expand-label');
    if (body.style.display === 'none') {
      body.style.display = 'block';
      if (label) label.textContent = 'Hide message';
    } else {
      body.style.display = 'none';
      if (label) label.textContent = 'Show full message';
    }
  });

  /* ============================================================
     EMAIL COMPOSER (same as round 10)
  ============================================================ */
  // round 18: no separate 'New Email' button — composer always visible
  const emailForm   = document.getElementById('email-composer-form');
  const eAttachIn   = document.getElementById('email-attach-input');
  const ePreviewEl  = document.getElementById('email-attach-preview');
  let emailStaged   = [];

  function renderEmailPreview() {
    if (!ePreviewEl) return;
    if (emailStaged.length === 0) {
      ePreviewEl.style.display = 'none';
      ePreviewEl.innerHTML = '';
      return;
    }
    ePreviewEl.style.display = '';
    ePreviewEl.innerHTML = emailStaged.map((sf, i) => {
      const isImg = sf.file.type.startsWith('image/');
      const inner = isImg
        ? `<img src="${sf.url}" alt="">`
        : `<div class="note-att-name">${escapeHtml(sf.file.name)}</div>`;
      return `<div class="note-att-staged">${inner}<button type="button" class="note-att-remove" data-email-i="${i}">&times;</button></div>`;
    }).join('');
  }

  if (ePreviewEl) {
    ePreviewEl.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-email-i]');
      if (!rm) return;
      const i = parseInt(rm.dataset.emailI, 10);
      if (emailStaged[i]?.url) URL.revokeObjectURL(emailStaged[i].url);
      emailStaged.splice(i, 1);
      renderEmailPreview();
    });
  }

  if (eAttachIn) {
    eAttachIn.addEventListener('change', (e) => {
      Array.from(e.target.files || []).forEach(f => {
        const obj = { file: f };
        if (f.type.startsWith('image/')) obj.url = URL.createObjectURL(f);
        emailStaged.push(obj);
      });
      renderEmailPreview();
      eAttachIn.value = '';
    });
  }

  // round 18: composer is inline — populate fields when the Emails tab is first shown
  let composerInit = false;
  async function initEmailComposer() {
    if (composerInit) return;
    composerInit = true;
    try {
      const res = await fetch(`${BASE}/index.php?p=tasks&action=email_compose_data&id=${taskId}`, {
        headers: {'X-Requested-With':'XMLHttpRequest'}
      });
      const data = await res.json();
      if (!data.ok) { composerInit = false; return; }

      const fromDisplay = document.getElementById('email-from-display');
      const warning     = document.getElementById('email-composer-warning');
      if (data.configured) {
        if (fromDisplay) fromDisplay.textContent = `${data.from_name || ''} <${data.from_email}>`.trim();
        if (warning) warning.style.display = 'none';
      } else {
        if (fromDisplay) fromDisplay.textContent = 'SMTP not configured';
        if (warning) {
          warning.style.display = '';
          warning.innerHTML = '⚠ SMTP is not configured. <a href="' + BASE + '/index.php?p=settings&section=smtp" style="color:var(--primary-hover)">Set it up here</a> before sending.';
        }
      }

      const subject = document.getElementById('email-subject-input');
      if (subject && !subject.value) {
        if (data.last_subject) {
          subject.value = data.last_subject.startsWith('Re:') ? data.last_subject : 'Re: ' + data.last_subject;
        } else {
          subject.value = data.task_title || '';
        }
      }

      const toInput = document.getElementById('email-to-input');
      if (toInput && !toInput.value) toInput.value = data.last_to || '';

      const sugg = document.getElementById('email-contact-suggestions');
      if (sugg) {
        if (data.contacts && data.contacts.length > 0) {
          sugg.innerHTML = '<div class="email-contact-label">Client contacts:</div>' + data.contacts.map(c => {
            const fullName = (c.first_name + ' ' + (c.last_name || '')).trim();
            return `<button type="button" class="email-contact-chip" data-email="${escapeHtml(c.email)}">${escapeHtml(fullName)}</button>`;
          }).join('');
        } else {
          sugg.innerHTML = '<div class="muted" style="font-size:11px;padding:4px 0">No contacts with email for this client.</div>';
        }
      }

      const body = document.getElementById('email-body-input');
      if (body && !body.value) body.value = `\n\n---\n${data.sender_name || ''}`;
    } catch {
      composerInit = false;
    }
  }

  // Cc/Bcc toggle
  document.getElementById('email-toggle-cc')?.addEventListener('click', () => {
    const block = document.getElementById('email-cc-bcc');
    if (!block) return;
    block.style.display = (block.style.display === 'none' || !block.style.display) ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.email-contact-chip');
    if (!chip) return;
    const email = chip.dataset.email;
    const to    = document.getElementById('email-to-input');
    const cur   = to.value.trim();
    if (!cur) {
      to.value = email;
    } else if (cur.split(',').map(s => s.trim()).includes(email)) {
      to.value = cur.split(',').map(s => s.trim()).filter(s => s !== email).join(', ');
    } else {
      to.value = cur + ', ' + email;
    }
    chip.classList.toggle('active');
  });

  if (emailForm) {
    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (window.checkClockedIn && !await window.checkClockedIn()) return;
      emailForm.querySelectorAll('.field-error').forEach(el => el.textContent = '');
      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('task_id', emailForm.elements['task_id'].value);
      fd.append('to', emailForm.elements['to'].value);
      fd.append('cc', emailForm.elements['cc'].value);
      fd.append('bcc', emailForm.elements['bcc'].value);
      fd.append('subject', emailForm.elements['subject'].value);
      fd.append('body', emailForm.elements['body'].value);
      emailStaged.forEach(sf => fd.append('attachments[]', sf.file));

      const btn = document.getElementById('email-send-btn');
      if (btn) { btn.disabled = true; btn.innerHTML = 'Sending…'; }
      try {
        const res = await fetch(`${BASE}/index.php?p=tasks&action=send_email`, {
          method: 'POST', body: fd, headers: {'X-Requested-With':'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          window.showToast?.('Email sent.', 'success');
          // Clear composer for next email
          emailForm.reset();
          emailStaged.forEach(sf => sf.url && URL.revokeObjectURL(sf.url));
          emailStaged = [];
          renderEmailPreview();
          composerInit = false;
          initEmailComposer();
          // Reload the email thread
          loadEmails();
        } else if (j.reason === 'not_clocked_in') {
          window.showClockInPrompt?.();
        } else if (j.errors) {
          Object.entries(j.errors).forEach(([f, m]) => {
            const errEl = emailForm.querySelector(`[data-error="${f}"]`);
            if (errEl) errEl.textContent = m;
          });
        } else {
          window.showToast?.(j.message || 'Send failed.', 'error');
        }
      } catch { window.showToast?.('Network error.', 'error'); }
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="icon icon-sm"><use href="#i-send"/></svg> Send Email'; }
    });
  }

})();
</script>
