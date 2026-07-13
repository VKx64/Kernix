/**
 * Time Tracker — topbar widget + sidebar mini timer
 *
 * Server is source of truth. Client ticks every second for smoothness,
 * resyncs every 60s from server, and after any action.
 */
(function () {
  'use strict';

  const BASE = document.querySelector('meta[name=app-base]')?.content || '';
  const CSRF = document.querySelector('meta[name=csrf]')?.content || '';
  if (!document.querySelector('meta[name=user-id]')?.content) return; // not logged in

  const widgetState  = document.getElementById('time-widget-state');
  const widgetMenu   = document.getElementById('time-widget-menu');
  const sidebarTimer = document.getElementById('sidebar-timer');
  const sidebarClock = document.getElementById('mini-timer-clock');
  const sidebarBtns  = document.getElementById('mini-timer-buttons');

  if (!widgetState || !sidebarTimer) return;

  // Local state, syncs from server
  let state = {
    status: 'out',           // 'out' | 'working' | 'break'
    clock_in_at: null,
    break_start_at: null,
    worked_seconds: 0,        // worked time at the moment of last sync (excluding open break)
    break_seconds: 0,         // completed break time
    today_minutes: 0,         // for 'out' state
    last_clock_out: null,
    serverOffsetMs: 0,        // (server - client) at sync time
    syncedAtMs: 0,            // client timestamp of last sync
  };

  /* -------------------------------------------------------
     Formatters
  ------------------------------------------------------- */
  function fmtHM(secs) {
    if (!secs || secs < 0) secs = 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
    return `${m}m`;
  }
  function fmtHMS(secs) {
    if (!secs || secs < 0) secs = 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const opts = { hour: 'numeric', minute: '2-digit' };
    if (state.user_timezone) opts.timeZone = state.user_timezone;
    return d.toLocaleTimeString('en-US', opts);
  }

  /* -------------------------------------------------------
     Live elapsed calculation from last sync
  ------------------------------------------------------- */
  function liveWorkedSeconds() {
    if (state.status === 'out') return state.today_minutes * 60;
    const elapsedSinceSync = Math.floor((Date.now() - state.syncedAtMs) / 1000);
    if (state.status === 'working') {
      return state.worked_seconds + elapsedSinceSync;
    }
    // on break — worked stays frozen
    return state.worked_seconds;
  }

  function liveBreakSeconds() {
    if (state.status !== 'break') return state.break_seconds;
    // ROUND 22 FIX: use server-computed elapsed seconds + ticks since sync
    // (was parsing break_start_at as local time which double-counted hours
    //  when server TZ differed from browser TZ)
    const elapsedSinceSync = Math.floor((Date.now() - state.syncedAtMs) / 1000);
    const openSec = (state.break_started_seconds_ago || 0) + elapsedSinceSync;
    return state.break_seconds + Math.max(0, openSec);
  }

  /* -------------------------------------------------------
     Server sync
  ------------------------------------------------------- */
  async function syncState() {
    try {
      const res = await fetch(`${BASE}/index.php?p=time&action=status`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      applyState(data);
    } catch (e) {
      // Don't toast — silent on network blips
      console.warn('time tracker sync failed', e);
    }
  }

  function applyState(data) {
    state.status         = data.status || 'out';
    state.clock_in_at    = data.clock_in_at || null;
    state.break_start_at = data.break_start_at || null;
    state.worked_seconds = data.worked_seconds || (data.worked_minutes ? data.worked_minutes * 60 : 0);
    state.break_seconds  = (data.break_minutes || 0) * 60;
    state.today_minutes  = data.today_minutes || 0;
    state.last_clock_out = data.last_clock_out || null;
    state.user_timezone  = data.user_timezone || null;
    state.break_started_seconds_ago = data.break_started_seconds_ago || 0;
    if (data.server_now) {
      state.serverOffsetMs = new Date(data.server_now).getTime() - Date.now();
    }
    state.syncedAtMs = Date.now();
    render();
  }

  /* -------------------------------------------------------
     Render
  ------------------------------------------------------- */
  function render() {
    const worked = liveWorkedSeconds();
    const onBreak = state.status === 'break';
    const working = state.status === 'working';
    const isOut   = state.status === 'out';

    // Topbar widget label
    if (isOut) {
      if (state.today_minutes > 0) {
        widgetState.innerHTML = `<span class="tw-dot tw-dot-off"></span>Clocked out · <strong>${fmtHM(state.today_minutes * 60)}</strong> today`;
      } else {
        widgetState.innerHTML = `<span class="tw-dot tw-dot-off"></span>Not clocked in`;
      }
      widgetState.parentElement.className = 'time-widget-trigger tw-out';
    } else if (working) {
      widgetState.innerHTML = `<span class="tw-dot tw-dot-on"></span>${fmtTime(state.clock_in_at)} · <strong>${fmtHM(worked)}</strong>`;
      widgetState.parentElement.className = 'time-widget-trigger tw-working';
    } else if (onBreak) {
      const breakSec = liveBreakSeconds() - state.break_seconds;
      widgetState.innerHTML = `<span class="tw-dot tw-dot-break"></span>On break · <strong>${fmtHM(breakSec)}</strong>`;
      widgetState.parentElement.className = 'time-widget-trigger tw-break';
    }

    // Sidebar mini timer
    sidebarTimer.dataset.state = state.status;
    if (isOut) {
      // Clocked out — hide the sidebar timer entirely (topbar widget handles in/out)
      sidebarClock.innerHTML = '';
      sidebarBtns.innerHTML = '';
    } else if (working) {
      sidebarClock.innerHTML = renderStackedClock(worked, 'working');
      sidebarBtns.innerHTML = `
        <button type="button" class="mini-btn mini-btn-break" data-action="break-start" title="Take a break">BREAK</button>
        <button type="button" class="mini-btn mini-btn-out"   data-action="clock-out"  title="End your day">OUT</button>
      `;
    } else if (onBreak) {
      const breakSec = liveBreakSeconds() - state.break_seconds;
      sidebarClock.innerHTML = renderStackedClock(breakSec, 'break');
      sidebarClock.title = 'On break';
      sidebarBtns.innerHTML = `<button type="button" class="mini-btn mini-btn-resume" data-action="break-end">RESUME</button>`;
    }

    renderDropdown();
  }

  /**
   * Render the stacked HH/MM display + 60-second bar row.
   * Bars: 12 of them, one per 5 seconds. As seconds tick, bars fill in.
   * The "current" bar (the one in progress) pulses; filled bars stay bright;
   * unfilled bars stay dim. Hour/minute readout updates as time elapses.
   */
  function renderStackedClock(secs, mode) {
    if (!secs || secs < 0) secs = 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    // Filled bar count: 1 bar lights up at the START of each 5s interval.
    // So seconds 0-4 = bar 1 pulsing, seconds 5-9 = bar 1 lit + bar 2 pulsing, etc.
    const filledCount = Math.floor(s / 5);   // bars fully lit
    const currentBar  = filledCount;          // index of the pulsing bar
    let bars = '';
    for (let i = 0; i < 12; i++) {
      let cls = 'mt-bar';
      if (i < filledCount)       cls += ' mt-bar-on';
      else if (i === currentBar) cls += ' mt-bar-pulse';
      bars += `<span class="${cls}"></span>`;
    }
    return `
      <div class="mt-hh">${String(h).padStart(2, '0')}</div>
      <div class="mt-mm">${String(m).padStart(2, '0')}</div>
      <div class="mt-bars" data-mode="${mode}">${bars}</div>
    `;
  }

  function renderDropdown() {
    const worked = liveWorkedSeconds();
    const breakTotal = state.break_seconds;
    let html = '';

    if (state.status === 'out') {
      html += `<div class="tw-section">
        <div class="tw-label">Today</div>
        <div class="tw-big">${state.today_minutes > 0 ? fmtHM(state.today_minutes * 60) : 'Not clocked in yet'}</div>
        ${state.last_clock_out ? `<div class="tw-sub">Last clock-out: ${fmtTime(state.last_clock_out)}</div>` : ''}
      </div>
      <div class="tw-actions">
        <button class="btn btn-primary" data-action="clock-in" style="width:100%">
          <svg class="icon"><use href="#i-play"/></svg> Clock In
        </button>
      </div>`;
    } else if (state.status === 'working') {
      html += `<div class="tw-section">
        <div class="tw-row"><span class="tw-label">Clocked in</span><strong>${fmtTime(state.clock_in_at)}</strong></div>
        <div class="tw-row"><span class="tw-label">Worked</span><strong style="color:var(--success,#22c55e);font-variant-numeric:tabular-nums">${fmtHMS(worked)}</strong></div>
        ${breakTotal > 0 ? `<div class="tw-row"><span class="tw-label">Breaks</span><strong>${fmtHM(breakTotal)}</strong></div>` : ''}
      </div>
      <div class="tw-actions">
        <button class="btn" data-action="break-start" style="flex:1">
          <svg class="icon icon-sm"><use href="#i-pause"/></svg> Take Break
        </button>
        <button class="btn btn-danger" data-action="clock-out" style="flex:1">
          Clock Out
        </button>
      </div>`;
    } else if (state.status === 'break') {
      const breakSec = liveBreakSeconds() - state.break_seconds;
      html += `<div class="tw-section">
        <div class="tw-row"><span class="tw-label">On break since</span><strong>${fmtTime(state.break_start_at)}</strong></div>
        <div class="tw-row"><span class="tw-label">Break duration</span><strong style="color:#f59e0b;font-variant-numeric:tabular-nums">${fmtHMS(breakSec)}</strong></div>
        <div class="tw-row"><span class="tw-label">Worked today</span><strong>${fmtHM(worked)}</strong></div>
      </div>
      <div class="tw-actions">
        <button class="btn btn-primary" data-action="break-end" style="width:100%">
          <svg class="icon"><use href="#i-play"/></svg> Back to Work
        </button>
      </div>`;
    }

    widgetMenu.innerHTML = html;
  }

  /* -------------------------------------------------------
     Tick (every second for HMS update)
  ------------------------------------------------------- */
  setInterval(() => {
    if (state.status === 'working' || state.status === 'break') render();
  }, 1000);

  // Resync from server every 60s
  setInterval(syncState, 60_000);

  /* -------------------------------------------------------
     Actions
  ------------------------------------------------------- */
  async function doAction(action, extraBody = {}) {
    const fd = new FormData();
    fd.append('_csrf', CSRF);
    Object.entries(extraBody).forEach(([k,v]) => fd.append(k, v));
    try {
      const res = await fetch(`${BASE}/index.php?p=time&action=${action}`, {
        method: 'POST',
        body: fd,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (data.ok) {
        if (data.state) applyState(data.state);
        else            syncState();
        window.showToast?.(data.message || 'Done.', 'success');
      } else {
        window.showToast?.(data.message || 'Action failed.', 'error');
      }
      return data;
    } catch (e) {
      window.showToast?.('Network error.', 'error');
      return { ok: false };
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (!btn.closest('#time-widget-menu, #sidebar-timer, #clockout-modal')) return;
    const action = btn.dataset.action;

    if (action === 'clock-in')    { await doAction('clock_in');    return; }
    if (action === 'break-start') { await doAction('break_start'); return; }
    if (action === 'break-end')   { await doAction('break_end');   return; }
    if (action === 'clock-out')   { openClockOutModal();          return; }
  });

  /* -------------------------------------------------------
     Clock Out modal — shows worked vs task time
  ------------------------------------------------------- */
  async function openClockOutModal() {
    const body = document.getElementById('clockout-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Loading summary…</div>';
    window.openModal?.('clockout-modal');

    try {
      const res = await fetch(`${BASE}/index.php?p=time&action=summary`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      const worked    = data.session?.worked_minutes || 0;
      const breakMins = data.session?.break_minutes  || 0;
      const taskMins  = data.task_minutes || 0;
      const gap       = worked - taskMins;

      body.innerHTML = `
        <div class="clockout-summary">
          <div class="co-row"><span>Clocked in</span><strong>${fmtTime(data.session?.clock_in_at)}</strong></div>
          <div class="co-row co-big"><span>Worked</span><strong style="color:var(--primary-hover)">${fmtHM(worked * 60)}</strong></div>
          ${breakMins ? `<div class="co-row"><span>Breaks</span><strong>${fmtHM(breakMins * 60)}</strong></div>` : ''}
          <div class="co-row"><span>Time logged on tasks today</span><strong>${fmtHM(taskMins * 60)}</strong></div>
          ${gap > 5 ? `
            <div class="co-gap">
              <div style="color:#f59e0b;font-weight:600;font-size:13px;margin-bottom:4px">
                ⚠ ${fmtHM(gap * 60)} unaccounted
              </div>
              <div style="font-size:11px;color:var(--text-muted)">
                Your clocked time exceeds time logged on tasks. Want to add a note?
              </div>
            </div>
          ` : ''}
        </div>
        <div class="form-row" style="margin-top:14px">
          <label>Notes <span style="font-size:10px;color:var(--text-muted)">(optional)</span></label>
          <textarea id="clockout-notes" rows="3" placeholder="What did you work on? Anything blocking?" style="width:100%"></textarea>
        </div>
      `;
    } catch (e) {
      body.innerHTML = '<div style="padding:20px;color:var(--danger)">Could not load summary.</div>';
    }
  }

  document.getElementById('clockout-confirm')?.addEventListener('click', async () => {
    const notes = document.getElementById('clockout-notes')?.value || '';
    const data  = await doAction('clock_out', { notes });
    if (data.ok) window.closeModal?.('clockout-modal');
  });

  /* -------------------------------------------------------
     Init
  ------------------------------------------------------- */
  syncState();

  // External event from clock-in prompt
  window.addEventListener('clock-state-changed', () => syncState());

})();
