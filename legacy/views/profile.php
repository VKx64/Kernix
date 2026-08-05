<?php
/**
 * Profile page view — user self-service settings + stats
 * Vars: $me, $tzList, $weekTime, $todayTime, $recentNotes, $unreadMessages, $myOpenTasks
 */
$avatarUrl = !empty($me['profile_image'])
    ? Storage::url('local', $me['profile_image'])
    : null;
$displayName = trim(($me['first_name'] ?? '') . ' ' . ($me['last_name'] ?? ''));
$usernameProper = ucfirst(strtolower($me['username'] ?? ''));
?>

<!-- PAGE HEADER -->
<div class="list-page-header">
  <div class="list-page-header-left">
    <h1>My Profile</h1>
    <div class="list-page-meta">
      <span class="muted">Update your personal info, contact details, and password.</span>
    </div>
  </div>
</div>

<div class="profile-grid">
  <!-- LEFT: Main form -->
  <div class="profile-main">

    <!-- AVATAR + IDENTITY CARD -->
    <div class="ts17-card profile-identity-card">
      <div class="profile-identity">
        <div class="profile-avatar-wrap">
          <?php if ($avatarUrl): ?>
            <img src="<?= e($avatarUrl) ?>" alt="" class="profile-avatar-img" id="profile-avatar-img">
          <?php else: ?>
            <div class="profile-avatar-fallback" id="profile-avatar-fallback">
              <?= e(initials($me['first_name'] ?? '', $me['last_name'] ?? '')) ?>
            </div>
          <?php endif; ?>
          <div class="profile-avatar-actions">
            <label class="btn btn-sm" style="cursor:pointer" title="Upload new image">
              <svg class="icon icon-sm"><use href="#i-plus"/></svg> Change
              <input type="file" id="avatar-upload-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none">
            </label>
            <?php if ($avatarUrl): ?>
              <button type="button" class="btn btn-sm" id="avatar-remove-btn" title="Remove image">
                Remove
              </button>
            <?php endif; ?>
          </div>
        </div>
        <div class="profile-identity-info">
          <div class="profile-name"><?= e($displayName) ?></div>
          <div class="profile-username">@<?= e($usernameProper) ?></div>
          <div class="profile-meta">
            <span class="pill"><?= e($me['role_name'] ?? 'No role') ?></span>
            <?php if ($me['department_label']): ?>
              <span class="pill" style="margin-left:6px"><?= e($me['department_label']) ?></span>
            <?php endif; ?>
            <?php if ($me['status'] === 'active'): ?>
              <span class="muted" style="margin-left:10px;font-size:11px">● Active</span>
            <?php else: ?>
              <span style="margin-left:10px;font-size:11px;color:var(--danger)">● Inactive</span>
            <?php endif; ?>
          </div>
        </div>
      </div>
    </div>

    <!-- PERSONAL INFO -->
    <div class="ts17-card">
      <div class="ts17-card-title">Personal Information</div>
      <form id="profile-form" data-profile-form>
        <?= csrf_field() ?>
        <div class="form-grid">
          <div class="form-row">
            <label>First Name <span class="required">*</span></label>
            <input type="text" name="first_name" value="<?= e($me['first_name'] ?? '') ?>" required>
            <span class="field-error" data-error="first_name"></span>
          </div>
          <div class="form-row">
            <label>Last Name <span class="required">*</span></label>
            <input type="text" name="last_name" value="<?= e($me['last_name'] ?? '') ?>" required>
            <span class="field-error" data-error="last_name"></span>
          </div>
          <div class="form-row">
            <label>Username</label>
            <input type="text" value="<?= e($me['username'] ?? '') ?>" disabled>
            <span class="muted" style="font-size:11px">Contact an admin to change your username.</span>
          </div>
          <div class="form-row">
            <label>Birthdate</label>
            <input type="date" name="birthdate" value="<?= e($me['birthdate'] ?? '') ?>">
            <span class="field-error" data-error="birthdate"></span>
          </div>
          <div class="form-row">
            <label>Timezone</label>
            <select name="timezone">
              <option value="">— Use default —</option>
              <?php foreach ($tzList as $tz): ?>
                <option value="<?= e($tz) ?>" <?= ($me['timezone'] ?? '') === $tz ? 'selected' : '' ?>>
                  <?= e($tz) ?>
                </option>
              <?php endforeach; ?>
            </select>
          </div>
        </div>

        <div class="ts17-card-title" style="margin-top:18px">Contact</div>
        <div class="form-grid">
          <div class="form-row">
            <label>Personal Email</label>
            <input type="email" name="personal_email" value="<?= e($me['personal_email'] ?? '') ?>">
            <span class="field-error" data-error="personal_email"></span>
          </div>
          <div class="form-row">
            <label>Work Email</label>
            <input type="email" name="imagic_email" value="<?= e($me['imagic_email'] ?? '') ?>">
            <span class="field-error" data-error="imagic_email"></span>
          </div>
          <div class="form-row">
            <label>Phone 1</label>
            <input type="text" name="phone_1" value="<?= e($me['phone_1'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>Phone 2</label>
            <input type="text" name="phone_2" value="<?= e($me['phone_2'] ?? '') ?>">
          </div>
          <div class="form-row full">
            <label>Home Address</label>
            <input type="text" name="home_address" value="<?= e($me['home_address'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>Barangay</label>
            <input type="text" name="barangay" value="<?= e($me['barangay'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>City</label>
            <input type="text" name="city" value="<?= e($me['city'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>Province</label>
            <input type="text" name="province" value="<?= e($me['province'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>ZIP Code</label>
            <input type="text" name="zip_code" value="<?= e($me['zip_code'] ?? '') ?>">
          </div>
        </div>

        <div class="ts17-card-title" style="margin-top:18px">Payment Details</div>
        <div class="form-grid">
          <div class="form-row">
            <label>Wise Account</label>
            <input type="text" name="wise_account" value="<?= e($me['wise_account'] ?? '') ?>">
          </div>
          <div class="form-row">
            <label>GCash Account</label>
            <input type="text" name="gcash_account" value="<?= e($me['gcash_account'] ?? '') ?>">
          </div>
        </div>

        <div style="text-align:right;margin-top:14px">
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>

    <!-- PASSWORD -->
    <div class="ts17-card">
      <div class="ts17-card-title">Change Password</div>
      <form id="password-form" data-password-form>
        <?= csrf_field() ?>
        <div class="form-grid">
          <div class="form-row full">
            <label>Current Password <span class="required">*</span></label>
            <input type="password" name="current_password" autocomplete="current-password" required>
            <span class="field-error" data-error="current_password"></span>
          </div>
          <div class="form-row">
            <label>New Password <span class="required">*</span></label>
            <input type="password" name="new_password" autocomplete="new-password" required>
            <span class="muted" style="font-size:11px">At least 8 characters.</span>
            <span class="field-error" data-error="new_password"></span>
          </div>
          <div class="form-row">
            <label>Confirm New Password <span class="required">*</span></label>
            <input type="password" name="confirm_password" autocomplete="new-password" required>
            <span class="field-error" data-error="confirm_password"></span>
          </div>
        </div>
        <div style="text-align:right;margin-top:14px">
          <button type="submit" class="btn btn-primary">Change Password</button>
        </div>
      </form>
    </div>
  </div>

  <!-- RIGHT: Stats + recent activity -->
  <div class="profile-side">
    <div class="ts17-card">
      <div class="ts17-card-title">At a Glance</div>
      <div class="profile-stats">
        <div class="profile-stat">
          <div class="profile-stat-label">Time logged today</div>
          <div class="profile-stat-value"><?= e(fmt_duration($todayTime ?: null)) ?></div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-label">Time logged this week</div>
          <div class="profile-stat-value"><?= e(fmt_duration($weekTime ?: null)) ?></div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-label">Open tasks assigned to me</div>
          <div class="profile-stat-value"><?= number_format($myOpenTasks) ?></div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-label">Unread messages</div>
          <div class="profile-stat-value <?= $unreadMessages > 0 ? 'profile-stat-warn' : '' ?>">
            <?= number_format($unreadMessages) ?>
          </div>
        </div>
      </div>
      <div class="profile-stats-footer">
        <span class="muted" style="font-size:11px">A dedicated analytics page is coming soon.</span>
      </div>
    </div>

    <div class="ts17-card">
      <div class="ts17-card-title">Recent Activity</div>
      <?php if (empty($recentNotes)): ?>
        <div class="muted" style="text-align:center;padding:14px 0;font-size:12px">
          No recent notes.
        </div>
      <?php else: ?>
        <div class="profile-activity">
          <?php foreach ($recentNotes as $n): ?>
            <a href="<?= e(url('tasks') . '&action=index&open=' . (int)$n['task_id']) ?>"
               class="profile-activity-item" title="Open task">
              <div class="profile-activity-task">
                <?= e($n['task_title'] ?? 'Untitled task') ?>
                <?php if ($n['client_name']): ?>
                  <span class="muted">· <?= e($n['client_name']) ?></span>
                <?php endif; ?>
              </div>
              <?php if (!empty($n['body'])): ?>
                <div class="profile-activity-body"><?= e(mb_substr($n['body'], 0, 120)) ?><?= mb_strlen($n['body']) > 120 ? '…' : '' ?></div>
              <?php endif; ?>
              <div class="profile-activity-meta">
                <?php if (!empty($n['time_minutes'])): ?>
                  <span class="note-time-chip" style="margin:0;padding:2px 8px;font-size:10px">
                    ⏱ <?= e(fmt_duration((int)$n['time_minutes'])) ?>
                  </span>
                <?php endif; ?>
                <span class="muted"><?= e(fmt_datetime($n['created_at'])) ?></span>
              </div>
            </a>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</div>

<script>
(function () {
  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF = document.querySelector('meta[name=csrf]')?.content || '';

  // ============================================================
  //  Profile form submit
  // ============================================================
  document.querySelector('[data-profile-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    form.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    const fd = new FormData(form);
    const btn = form.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const res = await fetch(`${BASE}/index.php?p=profile&action=save`, {
        method: 'POST', body: fd, headers: {'X-Requested-With': 'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.(j.message || 'Saved.', 'success');
      } else if (j.errors) {
        Object.entries(j.errors).forEach(([f, m]) => {
          const er = form.querySelector(`[data-error="${f}"]`);
          if (er) er.textContent = m;
        });
        window.showToast?.(j.message || 'Please fix the errors.', 'error');
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch {
      window.showToast?.('Network error.', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  });

  // ============================================================
  //  Password form submit
  // ============================================================
  document.querySelector('[data-password-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    form.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    const fd = new FormData(form);
    const btn = form.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Changing…'; }
    try {
      const res = await fetch(`${BASE}/index.php?p=profile&action=change_password`, {
        method: 'POST', body: fd, headers: {'X-Requested-With': 'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        form.reset();
        window.showToast?.(j.message || 'Password changed.', 'success');
      } else if (j.errors) {
        Object.entries(j.errors).forEach(([f, m]) => {
          const er = form.querySelector(`[data-error="${f}"]`);
          if (er) er.textContent = m;
        });
        window.showToast?.(j.message || 'Please fix the errors.', 'error');
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch {
      window.showToast?.('Network error.', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Change Password'; }
  });

  // ============================================================
  //  Avatar upload
  // ============================================================
  const uploadInput = document.getElementById('avatar-upload-input');
  if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('avatar', file);
      try {
        const res = await fetch(`${BASE}/index.php?p=profile&action=upload_avatar`, {
          method: 'POST', body: fd, headers: {'X-Requested-With': 'XMLHttpRequest'}
        });
        const j = await res.json();
        if (j.ok) {
          window.showToast?.(j.message || 'Avatar updated.', 'success');
          // Reload to reflect new image everywhere (topbar dropdown too)
          setTimeout(() => location.reload(), 600);
        } else {
          window.showToast?.(j.message || 'Upload failed.', 'error');
        }
      } catch {
        window.showToast?.('Network error.', 'error');
      }
      uploadInput.value = '';
    });
  }

  document.getElementById('avatar-remove-btn')?.addEventListener('click', async () => {
    if (!confirm('Remove your profile image?')) return;
    const fd = new FormData();
    fd.append('_csrf', CSRF);
    try {
      const res = await fetch(`${BASE}/index.php?p=profile&action=remove_avatar`, {
        method: 'POST', body: fd, headers: {'X-Requested-With': 'XMLHttpRequest'}
      });
      const j = await res.json();
      if (j.ok) {
        window.showToast?.(j.message || 'Removed.', 'success');
        setTimeout(() => location.reload(), 500);
      } else {
        window.showToast?.(j.message || 'Failed.', 'error');
      }
    } catch {
      window.showToast?.('Network error.', 'error');
    }
  });

  // Theme preset picker removed — light/dark is the only switch now
  // (handled globally by the theme-toggle button in the topbar).
})();
</script>
