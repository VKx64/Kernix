<?php
/**
 * Notes partial — round 21
 * - Shows logged time on each note
 * - Edit button visible to author within 24h, admin always
 */

$uid     = Auth::id();
$isAdmin = Perm::isAdmin();

if (empty($notes)): ?>
  <div class="empty-state">No notes yet. Add the first one below.</div>
<?php else: foreach ($notes as $n):
    $unread = empty($n['read_at']) && $n['assigned_user_id'] == $uid;
    $isMine = $n['created_by'] == $uid;
    $atts   = $n['attachments'] ?? [];

    $ageHours = (time() - strtotime($n['created_at'])) / 3600;
    $canEdit  = $isAdmin || ($isMine && $ageHours <= 24);
    $canDelete = $isAdmin || $isMine;

    $hoursLeft = max(0, 24 - $ageHours);

    $images = []; $others = [];
    foreach ($atts as $a) {
        $mime = $a['mime_type'] ?? '';
        if (str_starts_with($mime, 'image/')) $images[] = $a;
        else                                   $others[] = $a;
    }
?>
  <div class="note-card <?= $unread?'note-unread':'' ?>" data-note-id="<?= e($n['id']) ?>">
    <div class="note-card-meta">
      <div style="display:flex;align-items:center;gap:8px">
        <?php if (!empty($n['author_image'])): ?>
          <img src="<?= e(Storage::url('local', $n['author_image'])) ?>" style="width:22px;height:22px;border-radius:50%;object-fit:cover">
        <?php else: ?>
          <span class="avatar" style="width:22px;height:22px;font-size:9px"><?= e(substr($n['author_name'] ?? '?',0,2)) ?></span>
        <?php endif; ?>
        <span class="note-author"><?= e($n['author_name'] ?: 'Unknown') ?></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="note-date"><?= fmt_datetime($n['created_at']) ?></span>
        <?php if ($canEdit): ?>
          <button class="note-edit-btn" data-note-edit="<?= e($n['id']) ?>" title="Edit note">
            <svg class="icon icon-sm"><use href="#i-pencil"/></svg>
          </button>
        <?php endif; ?>
        <?php if ($canDelete): ?>
          <button class="note-del-btn" data-note-delete="<?= e($n['id']) ?>" title="Delete note">&times;</button>
        <?php endif; ?>
      </div>
    </div>

    <!-- Body + time view mode -->
    <div class="note-view-mode">
      <?php if (!empty($n['body'])): ?>
        <div class="note-body"><?= nl2br(e($n['body'])) ?></div>
      <?php endif; ?>

      <?php if (!empty($n['time_minutes'])): ?>
        <div class="note-time-chip" title="Time logged">
          <span class="note-time-icon">⏱</span>
          <span class="note-time-amount"><?= e(fmt_duration((int)$n['time_minutes'])) ?></span>
          <?php if (!empty($n['subtask_title'])): ?>
            <span class="note-time-sub"> on <em><?= e($n['subtask_title']) ?></em></span>
          <?php endif; ?>
          <?php if (!empty($n['time_logger_name']) && $n['time_logger_name'] !== $n['author_name']): ?>
            <span class="note-time-sub"> · logged by <?= e($n['time_logger_name']) ?></span>
          <?php endif; ?>
        </div>
      <?php endif; ?>
    </div>

    <!-- Edit mode (hidden by default, shown by JS) -->
    <?php if ($canEdit): ?>
    <div class="note-edit-mode" style="display:none">
      <textarea class="note-edit-body" data-note-id="<?= e($n['id']) ?>"
                style="width:100%;min-height:60px;font-size:13px;margin-bottom:6px"><?= e($n['body'] ?? '') ?></textarea>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted)">
          <span style="font-size:13px">⏱</span> Time:
          <input type="text" class="note-edit-time"
                 value="<?= e($n['time_minutes'] ? fmt_duration((int)$n['time_minutes']) : '') ?>"
                 placeholder="e.g. 30m"
                 style="width:80px;font-size:12px;padding:3px 6px">
        </label>
        <span style="font-size:10px;color:var(--text-muted)">
          <?php if (!$isAdmin && $isMine): ?>
            <?php if ($hoursLeft >= 1): ?>
              <?= round($hoursLeft, 1) ?>h left to edit
            <?php else: ?>
              <?= round($hoursLeft * 60) ?>m left to edit
            <?php endif; ?>
          <?php endif; ?>
        </span>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm" data-note-cancel-edit="<?= e($n['id']) ?>" type="button">Cancel</button>
          <button class="btn btn-primary btn-sm" data-note-save-edit="<?= e($n['id']) ?>" type="button">Save</button>
        </div>
      </div>
    </div>
    <?php endif; ?>

    <?php if (!empty($images)): ?>
      <div class="note-att-images">
        <?php foreach ($images as $img):
            $url = Storage::url($img['storage_driver'] ?? 'local', $img['storage_path']);
        ?>
          <div class="note-att-image-wrap">
            <img src="<?= e($url) ?>" class="note-att-image" data-fullsize="<?= e($url) ?>" alt="<?= e($img['original_name']) ?>" loading="lazy">
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if (!empty($others)): ?>
      <div class="note-att-files">
        <?php foreach ($others as $f):
            $url = Storage::url($f['storage_driver'] ?? 'local', $f['storage_path']);
            $sizeKb = round(($f['file_size'] ?? 0) / 1024);
        ?>
          <a href="<?= e($url) ?>" target="_blank" rel="noopener" class="note-att-file">
            <span class="note-att-icon">📎</span>
            <span class="note-att-filename"><?= e($f['original_name']) ?></span>
            <span class="note-att-size"><?= $sizeKb ?> KB</span>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($n['assigned_name']): ?>
      <div class="note-assigned">→ <strong><?= e($n['assigned_name']) ?></strong></div>
    <?php endif; ?>
  </div>
<?php endforeach; endif; ?>
