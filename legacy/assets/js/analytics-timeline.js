/**
 * Analytics — Timeline tab renderer.
 *
 * Mounts at #ana-timeline-mount and reads the data payload from its
 * data-payload attribute (set by the server-side view).
 *
 * Layout:
 *   - Day columns across the top (one per date in range)
 *   - 4-hour gridlines within each day (00 / 04 / 08 / 12 / 16 / 20)
 *   - One row per user, sticky left column with their avatar+name
 *   - Each session is a rounded pill positioned at its real time
 *   - Inside the pill, a fill shows logged_minutes / net_minutes
 *   - Over-logged (logged > net) flips the whole pill red
 *   - Compressed working-hours range: y-axis auto-fits to earliest/latest
 *     activity across the whole visible range, padded to nearest 4h.
 */
(function () {
  'use strict';

  const mount = document.getElementById('ana-timeline-mount');
  if (!mount) return;

  let payload;
  try {
    payload = JSON.parse(mount.dataset.payload || '{}');
  } catch (e) {
    mount.innerHTML = '<div class="ana-empty">Could not parse timeline data.</div>';
    return;
  }

  const rows = payload.rows || [];
  const fromStr = payload.from;
  const toStr   = payload.to;
  if (!fromStr || !toStr || rows.length === 0) {
    mount.innerHTML = '<div class="ana-empty">No data for this range.</div>';
    return;
  }

  /* ------- date helpers ------- */
  function parseLocalDate(s) {
    // Parse "YYYY-MM-DD" as local midnight (avoids TZ surprises)
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  function parseDbDateTime(s) {
    // Parse "YYYY-MM-DD HH:MM:SS" (server local). Treat as local.
    if (!s) return null;
    const [d, t = '00:00:00'] = s.split(' ');
    const [y, mo, da] = d.split('-').map(Number);
    const [hh, mm, ss] = t.split(':').map(Number);
    return new Date(y, mo - 1, da, hh || 0, mm || 0, ss || 0);
  }
  function dateKey(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function startOfDay(dt) {
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
  }
  function fmtTime(dt) {
    let h = dt.getHours();
    const m = String(dt.getMinutes()).padStart(2, '0');
    const am = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12;
    return `${h}:${m}${am}`;
  }
  function fmtMinutes(m) {
    if (!m) return '0m';
    const sign = m < 0 ? '-' : '';
    m = Math.abs(m);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return `${sign}${mm}m`;
    if (mm === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${mm}m`;
  }

  /* ------- build day list ------- */
  const fromDt = parseLocalDate(fromStr);
  const toDt   = parseLocalDate(toStr);
  const days = [];
  for (let d = new Date(fromDt); d <= toDt; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  if (days.length === 0) {
    mount.innerHTML = '<div class="ana-empty">Empty date range.</div>';
    return;
  }

  /* ------- compute compressed y-axis (working hours band) -------
     Scan all sessions to find earliest hour and latest hour.
     Pad to nearest 4-hour boundary. Default 8am–6pm if no data. */
  let minHour = 24, maxHour = 0, anyActivity = false;
  rows.forEach(row => {
    (row.sessions || []).forEach(s => {
      const sIn  = parseDbDateTime(s.clock_in_at);
      const sOut = parseDbDateTime(s.effective_out);
      if (!sIn || !sOut) return;
      anyActivity = true;

      // Walk through each calendar day this session touches and record the
      // clipped start/end hours on that day. This correctly accounts for
      // sessions crossing midnight: the prev day contributes (inHour..24)
      // and the next day contributes (0..outHour).
      const sessionEnd = sOut.getTime();
      let cursor = startOfDay(sIn);
      while (cursor.getTime() < sessionEnd) {
        const dayStart = cursor.getTime();
        const dayEnd   = new Date(cursor); dayEnd.setDate(dayEnd.getDate() + 1);
        const clipStart = Math.max(sIn.getTime(), dayStart);
        const clipEnd   = Math.min(sessionEnd, dayEnd.getTime());
        if (clipEnd > clipStart) {
          const hStart = (clipStart - dayStart) / 3600000;
          const hEnd   = (clipEnd   - dayStart) / 3600000;
          if (hStart < minHour) minHour = hStart;
          if (hEnd   > maxHour) maxHour = hEnd;
        }
        cursor = dayEnd;
        // safety stop in case of weird data
        if ((cursor.getTime() - sIn.getTime()) > 1000 * 60 * 60 * 48) break;
      }
    });
  });
  if (!anyActivity) { minHour = 8; maxHour = 18; }
  // Pad to nearest 4-hour boundary, with at least 1 hour of padding
  minHour = Math.max(0,  Math.floor((minHour - 0.25) / 4) * 4);
  maxHour = Math.min(24, Math.ceil ((maxHour + 0.25) / 4) * 4);
  if (maxHour - minHour < 4) maxHour = Math.min(24, minHour + 4);

  const hoursPerDay = maxHour - minHour;

  /* ------- layout constants ------- */
  const DAY_COL_PX     = Math.max(120, Math.min(220, 1100 / days.length));
  const ROW_HEIGHT_PX  = 56;
  const USER_COL_PX    = 200;

  /* ------- build skeleton ------- */
  mount.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atl-wrap';
  mount.appendChild(wrap);

  // Header row: blank user-col + day labels
  const header = document.createElement('div');
  header.className = 'atl-header';
  header.style.gridTemplateColumns = `${USER_COL_PX}px repeat(${days.length}, ${DAY_COL_PX}px)`;

  const headerCorner = document.createElement('div');
  headerCorner.className = 'atl-header-corner';
  headerCorner.textContent = `${fromStr} → ${toStr}`;
  header.appendChild(headerCorner);

  days.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'atl-header-day';
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    const dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    cell.innerHTML = `
      <div class="atl-header-weekday">${weekday}</div>
      <div class="atl-header-date">${dayLabel}</div>
    `;
    // 4-hour tick labels under the date
    const ticksWrap = document.createElement('div');
    ticksWrap.className = 'atl-header-ticks';
    for (let h = minHour; h <= maxHour; h += 4) {
      const tick = document.createElement('span');
      tick.className = 'atl-header-tick';
      tick.style.left = `${((h - minHour) / hoursPerDay) * 100}%`;
      tick.textContent = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
      ticksWrap.appendChild(tick);
    }
    cell.appendChild(ticksWrap);
    header.appendChild(cell);
  });
  wrap.appendChild(header);

  /* ------- body rows ------- */
  const body = document.createElement('div');
  body.className = 'atl-body';
  wrap.appendChild(body);

  rows.forEach(row => {
    const userRow = document.createElement('div');
    userRow.className = 'atl-row';
    userRow.style.gridTemplateColumns = `${USER_COL_PX}px repeat(${days.length}, ${DAY_COL_PX}px)`;
    userRow.style.minHeight = `${ROW_HEIGHT_PX}px`;
    if (!row.has_activity) userRow.classList.add('atl-row-inactive');

    // User column (sticky)
    const userCell = document.createElement('div');
    userCell.className = 'atl-user-cell';
    const initials = (row.name || row.username || '').split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
    const avatarHtml = row.image
      ? `<img class="atl-avatar" src="${BASE_URL()}/uploads/${escapeAttr(row.image)}" alt="">`
      : `<span class="atl-avatar atl-avatar-initials">${escapeHtml(initials || '?')}</span>`;
    const totals = row.totals || {};
    const summary = totals.net_minutes
      ? `${fmtMinutes(totals.net_minutes)} clocked · ${fmtMinutes(totals.logged_minutes)} logged`
      : (row.unattributed_total > 0 ? `${fmtMinutes(row.unattributed_total)} unattributed` : 'No activity');
    userCell.innerHTML = `
      ${avatarHtml}
      <div class="atl-user-meta">
        <div class="atl-user-name">${escapeHtml(row.name || row.username || '—')}</div>
        <div class="atl-user-sub">${escapeHtml(summary)}</div>
      </div>
    `;
    userRow.appendChild(userCell);

    // Day cells
    days.forEach(d => {
      const dayCell = document.createElement('div');
      dayCell.className = 'atl-day-cell';

      // Vertical 4-hour gridlines
      for (let h = minHour; h <= maxHour; h += 4) {
        const grid = document.createElement('div');
        grid.className = 'atl-gridline';
        grid.style.left = `${((h - minHour) / hoursPerDay) * 100}%`;
        if (h === minHour || h === maxHour) grid.classList.add('atl-gridline-edge');
        dayCell.appendChild(grid);
      }

      // Today highlight
      if (dateKey(d) === dateKey(new Date())) {
        dayCell.classList.add('atl-day-today');
      }

      // Place pills for sessions that touch this day
      (row.sessions || []).forEach(s => {
        const sIn  = parseDbDateTime(s.clock_in_at);
        const sOut = parseDbDateTime(s.effective_out);
        if (!sIn || !sOut) return;

        // Clip session to this day's [minHour, maxHour] window
        const dayStart = startOfDay(d);
        const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
        const clipStart = new Date(Math.max(sIn.getTime(),  dayStart.getTime()));
        const clipEnd   = new Date(Math.min(sOut.getTime(), dayEnd.getTime()));
        if (clipEnd <= clipStart) return; // session doesn't touch this day

        // Convert to hour positions within the displayed band
        const inHour  = (clipStart - dayStart) / 3600000;
        const outHour = (clipEnd   - dayStart) / 3600000;
        // Outside the band entirely? skip
        if (outHour <= minHour || inHour >= maxHour) return;

        const drawIn  = Math.max(minHour, inHour);
        const drawOut = Math.min(maxHour, outHour);
        const leftPct  = ((drawIn  - minHour) / hoursPerDay) * 100;
        const widthPct = ((drawOut - drawIn) / hoursPerDay) * 100;
        if (widthPct < 0.3) return; // too thin to be useful

        const pill = document.createElement('div');
        pill.className = 'atl-pill';
        pill.style.left  = `${leftPct}%`;
        pill.style.width = `${widthPct}%`;
        if (s.over_logged) pill.classList.add('atl-pill-over');
        else if (s.pct >= 100) pill.classList.add('atl-pill-full');
        if (s.is_open) pill.classList.add('atl-pill-open');
        if (s.net_minutes === 0 || s.logged_minutes === 0) pill.classList.add('atl-pill-empty-fill');

        // Fill (clipped to 100% visually)
        const fill = document.createElement('div');
        fill.className = 'atl-pill-fill';
        const fillPct = Math.min(100, Math.max(0, s.pct));
        fill.style.width = `${fillPct}%`;
        pill.appendChild(fill);

        // Label inside pill (shown only if wide enough)
        const label = document.createElement('div');
        label.className = 'atl-pill-label';
        const labelText = `${fmtMinutes(s.logged_minutes)} / ${fmtMinutes(s.net_minutes)} · ${s.pct}%`;
        label.textContent = labelText;
        pill.appendChild(label);

        // Tooltip
        const tipLines = [
          `${escapeHtml(row.name || row.username || '—')}`,
          `In:  ${fmtTime(sIn)}${s.is_open ? '  (still clocked in)' : ''}`,
          `Out: ${s.is_open ? '—' : fmtTime(sOut)}`,
          `Clocked: ${fmtMinutes(s.gross_minutes)}${s.break_minutes ? ` (${fmtMinutes(s.break_minutes)} break)` : ''}`,
          `Logged on tasks: ${fmtMinutes(s.logged_minutes)}`,
          `Coverage: ${s.pct}%${s.over_logged ? '  ⚠ over-logged' : ''}`,
        ];
        pill.title = tipLines.join('\n');

        dayCell.appendChild(pill);
      });

      // Unattributed chip for this day
      const dKey = dateKey(d);
      const ua = (row.unattributed || {})[dKey];
      if (ua && ua > 0) {
        const chip = document.createElement('div');
        chip.className = 'atl-unattributed-chip';
        chip.textContent = `+${fmtMinutes(ua)} unattributed`;
        chip.title = `Task time logged on ${dKey} but not inside any clocked-in session.`;
        dayCell.appendChild(chip);
      }

      userRow.appendChild(dayCell);
    });

    body.appendChild(userRow);
  });

  /* ------- helpers ------- */
  function BASE_URL() {
    return document.querySelector('meta[name=app-base]')?.content || '';
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
