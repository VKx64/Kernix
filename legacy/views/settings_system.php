<?php
/**
 * @var array       $s, bool $canEdit
 * @var array       $clients         list of active clients in DB
 * @var array|null  $singleClient    the current singleton (if mode is on)
 */
$scMode      = !empty($s['single_client_mode']);
$scId        = (int)($s['single_client_id'] ?? 0);
$clientCount = count($clients);
?>

<div class="page-header">
  <a href="<?= e(url('settings')) ?>" class="back-link">← Back to Settings</a>
  <h2>System Settings</h2>
  <p class="muted">Configure branding, logos and timezone.</p>
</div>

<form data-ajax-form action="<?= e(url('settings',['action'=>'save_system'])) ?>" method="post" id="form-system" enctype="multipart/form-data">
  <?= csrf_field() ?>

  <!-- General card -->
  <div class="config-card">
    <div class="config-card-header">
      <h3>General</h3>
      <p>Application-wide preferences</p>
    </div>
    <div class="config-card-body">
      <div class="config-row">
        <div class="config-row-label">
          <strong>Default Timezone</strong>
          <span>Used for displaying dates and times</span>
        </div>
        <div class="config-row-control">
          <select name="default_timezone">
            <?php
            $tz  = $s['default_timezone'] ?? 'UTC';
            $tzs = ['UTC','Asia/Manila','Asia/Singapore','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Australia/Sydney'];
            foreach ($tzs as $t): ?>
              <option value="<?= e($t) ?>" <?= $tz===$t?'selected':'' ?>><?= e($t) ?></option>
            <?php endforeach; ?>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- Branding card -->
  <div class="config-card">
    <div class="config-card-header">
      <h3>Branding</h3>
      <p>Logos and favicon displayed throughout the app</p>
    </div>
    <div class="config-card-body">
      <?php foreach ([
          ['system_logo',   'System Logo',   'Shown on the login page'],
          ['sidebar_logo',  'Sidebar Icon',  'Small icon in the left sidebar'],
          ['email_logo',    'Email Logo',    'Used in outbound emails'],
          ['favicon',       'Favicon',       'Browser tab icon — 32×32 recommended'],
      ] as [$field, $label, $desc]): ?>
        <div class="config-row">
          <div class="config-row-label">
            <strong><?= e($label) ?></strong>
            <span><?= e($desc) ?></span>
          </div>
          <div class="config-row-control">
            <?php if (!empty($s[$field])): ?>
              <div class="file-preview">
                <img src="<?= e(Storage::url($s['storage_driver']??'local', $s[$field])) ?>" alt="">
                <label class="file-preview-remove">
                  <input type="checkbox" name="<?= e($field) ?>_clear" value="1">
                  Remove
                </label>
              </div>
            <?php endif; ?>
            <?php if ($canEdit): ?>
              <input type="file" name="<?= e($field) ?>" accept="image/*">
            <?php endif; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>

  <?php if ($canEdit): ?>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save System Settings</button>
    </div>
  <?php endif; ?>
</form>

<!-- ============================================================
     SINGLE CLIENT MODE
     Hides client UI everywhere; auto-attaches projects/contacts to one client.
     ============================================================ -->
<div class="config-card" id="single-client-card">
  <div class="config-card-header">
    <h3>Single Client Mode</h3>
    <p>Hide all client UI and auto-attach projects/contacts to one designated client. Useful when this instance serves a single client.</p>
  </div>
  <div class="config-card-body">

    <!-- The toggle row — always visible -->
    <div class="config-row">
      <div class="config-row-label">
        <strong>Enabled</strong>
        <span>
          <?php if ($scMode && $singleClient): ?>
            On — all projects/contacts attach to <strong><?= e($singleClient['name']) ?></strong>.
          <?php elseif ($scMode && !$singleClient): ?>
            On, but the designated client is missing. Please re-select below.
          <?php else: ?>
            Off — the app behaves normally with multiple clients.
          <?php endif; ?>
        </span>
      </div>
      <div class="config-row-control">
        <?php if ($canEdit): ?>
          <label class="toggle-pill <?= $scMode ? 'active' : '' ?>">
            <span class="pill-switch">
              <input type="checkbox" id="sc-mode-toggle" <?= $scMode ? 'checked' : '' ?>>
              <span class="pill-switch-track"></span>
              <span class="pill-switch-thumb"></span>
            </span>
            <span id="sc-mode-toggle-label"><?= $scMode ? 'On' : 'Off' ?></span>
          </label>
        <?php else: ?>
          <span class="muted"><?= $scMode ? 'On' : 'Off' ?></span>
        <?php endif; ?>
      </div>
    </div>

    <?php if ($canEdit): ?>

    <!-- CASE: turning OFF — confirm form -->
    <form data-ajax-form action="<?= e(url('settings',['action'=>'save_single_client'])) ?>" method="post" id="sc-form-off" style="display:none">
      <?= csrf_field() ?>
      <input type="hidden" name="single_client_mode" value="0">
      <input type="hidden" name="sc_action" value="off">
      <div class="config-row" style="border-top: 1px solid var(--glass-border); padding-top: 14px">
        <div class="config-row-label">
          <strong>Turn off single-client mode</strong>
          <span>Existing clients and their links to projects/contacts are preserved; the UI just re-appears.</span>
        </div>
        <div class="config-row-control">
          <button type="submit" class="btn btn-primary">Turn off</button>
        </div>
      </div>
    </form>

    <!-- CASE: editing the existing single client (mode is on AND a client is set) -->
    <?php if ($scMode && $singleClient): ?>
    <form data-ajax-form action="<?= e(url('settings',['action'=>'save_single_client'])) ?>" method="post" id="sc-form-edit">
      <?= csrf_field() ?>
      <input type="hidden" name="single_client_mode" value="1">
      <input type="hidden" name="sc_action" value="edit">
      <div class="config-row" style="border-top: 1px solid var(--glass-border); padding-top: 14px">
        <div class="config-row-label">
          <strong>Client Details</strong>
          <span>This is the only place to edit this client while single-client mode is on.</span>
        </div>
        <div class="config-row-control" style="flex-direction:column;align-items:stretch;gap:10px;min-width:320px">
          <input type="text" name="sc_edit_name"    placeholder="Client name *" value="<?= e($singleClient['name']    ?? '') ?>">
          <input type="email" name="sc_edit_email"  placeholder="Email"         value="<?= e($singleClient['email']   ?? '') ?>">
          <input type="text" name="sc_edit_phone"   placeholder="Phone"         value="<?= e($singleClient['phone']   ?? '') ?>">
          <input type="url"  name="sc_edit_website" placeholder="Website"       value="<?= e($singleClient['website'] ?? '') ?>">
          <textarea name="sc_edit_notes" placeholder="Notes" rows="3"><?= e($singleClient['notes'] ?? '') ?></textarea>
          <div><button type="submit" class="btn btn-primary">Save client details</button></div>
        </div>
      </div>
    </form>
    <?php endif; ?>

    <!-- CASE: turning ON — show appropriate sub-form based on client count -->
    <?php if (!$scMode): ?>

      <?php if ($clientCount === 0): ?>
        <!-- CASE A: 0 clients — must create one -->
        <form data-ajax-form action="<?= e(url('settings',['action'=>'save_single_client'])) ?>" method="post" id="sc-form-create" style="display:none">
          <?= csrf_field() ?>
          <input type="hidden" name="single_client_mode" value="1">
          <input type="hidden" name="sc_action" value="create">
          <div class="config-row" style="border-top: 1px solid var(--glass-border); padding-top: 14px">
            <div class="config-row-label">
              <strong>Create the single client</strong>
              <span>No clients exist yet. Enter the details for the client this instance will serve.</span>
            </div>
            <div class="config-row-control" style="flex-direction:column;align-items:stretch;gap:10px;min-width:320px">
              <input type="text" name="sc_new_name"    placeholder="Client name *">
              <input type="email" name="sc_new_email"  placeholder="Email">
              <input type="text" name="sc_new_phone"   placeholder="Phone">
              <input type="url"  name="sc_new_website" placeholder="Website">
              <textarea name="sc_new_notes" placeholder="Notes" rows="3"></textarea>
              <div><button type="submit" class="btn btn-primary">Create &amp; enable</button></div>
            </div>
          </div>
        </form>

      <?php elseif ($clientCount === 1): ?>
        <!-- CASE C: exactly 1 client — auto-pick it -->
        <form data-ajax-form action="<?= e(url('settings',['action'=>'save_single_client'])) ?>" method="post" id="sc-form-pick" style="display:none">
          <?= csrf_field() ?>
          <input type="hidden" name="single_client_mode" value="1">
          <input type="hidden" name="sc_action" value="pick">
          <input type="hidden" name="sc_pick_client_id" value="<?= (int)$clients[0]['id'] ?>">
          <div class="config-row" style="border-top: 1px solid var(--glass-border); padding-top: 14px">
            <div class="config-row-label">
              <strong>Confirm</strong>
              <span>The one existing client, <strong><?= e($clients[0]['name']) ?></strong>, will be the designated single client.</span>
            </div>
            <div class="config-row-control">
              <button type="submit" class="btn btn-primary">Enable</button>
            </div>
          </div>
        </form>

      <?php else: ?>
        <!-- CASE D: 2+ clients — pick which one -->
        <form data-ajax-form action="<?= e(url('settings',['action'=>'save_single_client'])) ?>" method="post" id="sc-form-pick" style="display:none">
          <?= csrf_field() ?>
          <input type="hidden" name="single_client_mode" value="1">
          <input type="hidden" name="sc_action" value="pick">
          <div class="config-row" style="border-top: 1px solid var(--glass-border); padding-top: 14px">
            <div class="config-row-label">
              <strong>Pick the single client</strong>
              <span>You have <?= $clientCount ?> clients. Choose which one this instance will serve. Other clients stay in the database but are hidden from the UI.</span>
            </div>
            <div class="config-row-control" style="flex-direction:column;align-items:stretch;gap:10px;min-width:320px">
              <select name="sc_pick_client_id" required>
                <option value="">— Select client —</option>
                <?php foreach ($clients as $cl): ?>
                  <option value="<?= (int)$cl['id'] ?>"><?= e($cl['name']) ?></option>
                <?php endforeach; ?>
              </select>
              <div><button type="submit" class="btn btn-primary">Enable</button></div>
            </div>
          </div>
        </form>
      <?php endif; ?>

    <?php endif; ?>

    <script>
    // Toggle UX: when user flips the switch, reveal the appropriate sub-form.
    // The actual state change happens only on submit.
    (function () {
      const tog   = document.getElementById('sc-mode-toggle');
      if (!tog) return;
      const label = document.getElementById('sc-mode-toggle-label');
      const offF  = document.getElementById('sc-form-off');
      const onF   = document.querySelector('#sc-form-create, #sc-form-pick');
      const editF = document.getElementById('sc-form-edit');
      tog.addEventListener('change', () => {
        const isOn = tog.checked;
        label.textContent = isOn ? 'On' : 'Off';
        tog.closest('.toggle-pill').classList.toggle('active', isOn);
        // If currently ON in DB, the "edit" form is showing — toggling OFF reveals the confirm-off form
        if (editF) {
          editF.style.display = isOn ? '' : 'none';
          if (offF) offF.style.display = isOn ? 'none' : '';
        } else {
          // Currently OFF in DB — toggling ON reveals the create/pick form
          if (onF) onF.style.display = isOn ? '' : 'none';
        }
      });
    })();
    </script>

    <?php endif; ?>
  </div>
</div>
