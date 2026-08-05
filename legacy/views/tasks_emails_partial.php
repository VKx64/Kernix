<?php
/** Emails partial — task email thread (newest first). */

if (empty($emails)): ?>
  <div class="empty-state">
    No emails sent yet. Use the <strong>New Email</strong> button above to send one.
  </div>
<?php else: foreach ($emails as $em):
    $atts = $em['attachments'] ?? [];
    $images = []; $others = [];
    foreach ($atts as $a) {
        $mime = $a['mime_type'] ?? '';
        if (str_starts_with($mime, 'image/')) $images[] = $a;
        else                                   $others[] = $a;
    }
    $statusColor = match($em['status']) {
        'sent'   => 'var(--success)',
        'failed' => 'var(--danger)',
        default  => 'var(--text-muted)',
    };
?>
  <div class="email-card">
    <div class="email-card-header">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
        <?php if (!empty($em['sender_image'])): ?>
          <img src="<?= e(Storage::url('local', $em['sender_image'])) ?>" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0">
        <?php else: ?>
          <span class="avatar" style="width:24px;height:24px;font-size:9px;flex-shrink:0"><?= e(substr($em['sender_name'] ?? '?',0,2)) ?></span>
        <?php endif; ?>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:13px"><?= e($em['sender_name'] ?: 'Unknown') ?></div>
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            to <?= e($em['to_addresses']) ?>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">
        <span style="font-size:11px;color:var(--text-muted);white-space:nowrap"><?= fmt_datetime($em['created_at']) ?></span>
        <span style="font-size:10px;color:<?= $statusColor ?>;text-transform:uppercase;font-weight:600;letter-spacing:.05em">
          <?= e($em['status']) ?>
        </span>
      </div>
    </div>

    <div class="email-card-subject"><?= e($em['subject']) ?></div>

    <?php if (!empty($em['cc_addresses'])): ?>
      <div class="email-card-meta">cc: <?= e($em['cc_addresses']) ?></div>
    <?php endif; ?>

    <button class="email-card-toggle" type="button" data-email-toggle>
      <span class="email-expand-label">Show full message</span>
    </button>

    <div class="email-card-body" style="display:none">
      <div class="email-body-content"><?= nl2br(e($em['body'])) ?></div>

      <?php if (!empty($images)): ?>
        <div class="email-att-images">
          <?php foreach ($images as $img):
              $url = Storage::url($img['storage_driver'] ?? 'local', $img['storage_path']);
          ?>
            <div class="email-att-image-wrap">
              <img src="<?= e($url) ?>" class="note-att-image" data-fullsize="<?= e($url) ?>" alt="<?= e($img['original_name']) ?>" loading="lazy">
            </div>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>

      <?php if (!empty($others)): ?>
        <div class="email-att-files">
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

      <?php if ($em['status'] === 'failed' && !empty($em['error_message'])): ?>
        <div class="email-error">
          <strong>Send failed:</strong> <?= e($em['error_message']) ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
<?php endforeach; endif; ?>
