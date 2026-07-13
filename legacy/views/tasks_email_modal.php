<?php /** Email composer modal — included inside task shelf */ ?>
<div class="modal-backdrop" id="email-composer-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title">New Email</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <div id="email-composer-warning" style="display:none;padding:12px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:var(--radius);margin-bottom:14px;font-size:13px"></div>

      <form id="email-composer-form" enctype="multipart/form-data">
        <?= csrf_field() ?>
        <input type="hidden" name="task_id" value="<?= e($task['id']) ?>">

        <div class="form-grid">
          <div class="form-row full" style="display:flex;gap:8px;align-items:center">
            <label style="margin:0;flex-shrink:0;width:50px">From</label>
            <div style="flex:1;font-size:13px;color:var(--text-muted)" id="email-from-display">—</div>
          </div>

          <div class="form-row full" style="display:flex;gap:8px;align-items:flex-start">
            <label style="margin:6px 0 0;flex-shrink:0;width:50px">To <span class="required">*</span></label>
            <div style="flex:1;min-width:0">
              <div class="email-recipient-picker" id="email-to-picker">
                <input type="text" name="to" id="email-to-input" placeholder="email@example.com or pick a contact below" style="width:100%">
              </div>
              <div class="email-contact-suggestions" id="email-contact-suggestions"></div>
              <span class="field-error" data-error="to"></span>
            </div>
          </div>

          <div class="form-row full" style="display:flex;gap:8px;align-items:center">
            <label style="margin:0;flex-shrink:0;width:50px">Cc</label>
            <input type="text" name="cc" id="email-cc-input" placeholder="(optional)" style="flex:1">
          </div>

          <div class="form-row full" style="display:flex;gap:8px;align-items:center">
            <label style="margin:0;flex-shrink:0;width:50px">Bcc</label>
            <input type="text" name="bcc" id="email-bcc-input" placeholder="(optional)" style="flex:1">
          </div>

          <div class="form-row full">
            <label>Subject <span class="required">*</span></label>
            <input type="text" name="subject" id="email-subject-input" maxlength="500">
            <span class="field-error" data-error="subject"></span>
          </div>

          <div class="form-row full">
            <label>Message <span class="required">*</span></label>
            <textarea name="body" id="email-body-input" style="min-height:180px;font-family:inherit;line-height:1.5"></textarea>
            <span class="field-error" data-error="body"></span>
          </div>
        </div>

        <!-- Attachments preview -->
        <div class="note-attach-preview" id="email-attach-preview" style="display:none"></div>

        <div style="margin-top:10px">
          <label class="btn btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
            <svg class="icon icon-sm"><use href="#i-plus"/></svg> Attach Files
            <input type="file" name="attachments[]" multiple style="display:none" id="email-attach-input">
          </label>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <div class="modal-footer-left"></div>
      <div class="modal-footer-right">
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="submit" form="email-composer-form" class="btn btn-primary" id="email-send-btn">
          <svg class="icon icon-sm"><use href="#i-send"/></svg> Send Email
        </button>
      </div>
    </div>
  </div>
</div>
