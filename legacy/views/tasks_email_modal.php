<?php /** Email composer modal — included inside task shelf */ ?>
<div class="modal-backdrop" id="email-composer-modal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 class="modal-title">New Email</h2>
      <button class="modal-close" data-modal-close>&times;</button>
    </div>
    <div class="modal-body">
      <div id="email-composer-warning" class="email-warning" style="display:none"></div>

      <form id="email-composer-form" enctype="multipart/form-data">
        <?= csrf_field() ?>
        <input type="hidden" name="task_id" value="<?= e($task['id']) ?>">

        <div class="email-row email-row-from">
          <span class="email-row-label">From</span>
          <span class="email-row-value muted" id="email-from-display">—</span>
        </div>

        <div class="email-row email-row-to">
          <span class="email-row-label">To <span class="required">*</span></span>
          <div class="email-recipient-picker" id="email-to-picker">
            <input type="text" name="to" id="email-to-input" placeholder="email@example.com or pick a contact below" autocomplete="off">
          </div>
        </div>
        <div class="email-contact-suggestions" id="email-contact-suggestions"></div>
        <span class="field-error" data-error="to"></span>

        <div class="email-row email-row-small">
          <span class="email-row-label">Cc</span>
          <input type="text" name="cc" id="email-cc-input" placeholder="(optional)" autocomplete="off">
        </div>

        <div class="email-row email-row-small">
          <span class="email-row-label">Bcc</span>
          <input type="text" name="bcc" id="email-bcc-input" placeholder="(optional)" autocomplete="off">
        </div>

        <div class="email-row">
          <span class="email-row-label">Subject <span class="required">*</span></span>
          <input type="text" name="subject" id="email-subject-input" maxlength="500" autocomplete="off">
        </div>
        <span class="field-error" data-error="subject"></span>

        <textarea name="body" id="email-body-input" placeholder="Type your message here…" class="email-body-input"></textarea>
        <span class="field-error" data-error="body"></span>

        <!-- Attachments preview -->
        <div class="note-attach-preview" id="email-attach-preview" style="display:none"></div>

        <div class="email-toolbar">
          <div class="email-toolbar-left">
            <label class="email-toolbar-btn" title="Attach files">
              <svg class="icon icon-sm"><use href="#i-plus"/></svg> Attach Files
              <input type="file" name="attachments[]" multiple style="display:none" id="email-attach-input">
            </label>
          </div>
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
