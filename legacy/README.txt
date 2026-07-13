KERNIX LEGACY PATCH NOTES — NOT FOR LOCAL INSTALLATION
=======================================================
Use README.md for the current Docker setup. The migration referenced below was
not present in the supplied archive; Docker uses docker/mysql/001-schema.sql.
Historical paths and the `imagicagency_production` database name below are
retained only to describe the original patch procedure.

ANALYTICS — INSTALL
===================

WHAT'S IN THIS ZIP
------------------
  index.php                              (updated — adds analytics route)
  modules/analytics.php                  (NEW — module)
  views/analytics.php                    (NEW — page + tab strip)
  views/layout.php                       (updated — sidebar nav + i-chart icon)
  assets/css/components.css              (updated — analytics styling appended)
  migrations/round45_analytics.sql       (NEW — run once in phpMyAdmin)


INSTALL STEPS
-------------
1. Upload all files to public_html/production/ (overwrite when prompted)

2. Run the migration in phpMyAdmin:
   - Open phpMyAdmin → select database `imagicagency_production`
   - Click "SQL" tab
   - Paste the contents of migrations/round45_analytics.sql
   - Click "Go"
   - This grants `analytics.view` to the admin role only

3. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R)

4. As an admin, you should now see "Analytics" in the sidebar above Settings.


HOW IT WORKS
------------
- Tabs are defined in modules/analytics.php → analytics_tabs()
- For now there's one tab: "Login Time vs Logged Work"
- Date range defaults to current month, with quick-presets:
  This Week / This Month / Last Month / This Year / All Time
- The current month report shows, per user:
  - Clocked Time: total time_sessions duration (minus breaks)
  - Logged Work: total time_minutes from task_notes
  - Difference: clocked - logged (positive = clocked but not logged)
  - Utilization %: logged / clocked (color-coded bar)
- Users sorted by lowest utilization first (people needing attention surface up)
- Users with zero activity drop to the bottom in muted style


ADDING NEW TABS LATER
---------------------
To add another report tab (e.g. "Task Throughput"):

  1. modules/analytics.php → analytics_tabs():
     Add: 'task_throughput' => 'Task Throughput',

  2. Add a case to handle_index() and handle_data():
     case 'task_throughput':
       $data = _analytics_load_task_throughput($from, $to);
       break;

  3. Write _analytics_load_task_throughput() helper that returns the data array.

  4. In views/analytics.php, add a new <?php elseif (...): ?> block
     OR split tabs into views/analytics_tabs/<slug>.php partials.
