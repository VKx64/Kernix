# Kernix — archived legacy cPanel installation walkthrough

> **Warning:** This archived guide applies only to the preserved legacy PHP
> application. It predates the Laravel/Vite Docker stack and refers to files
> that were not present in the supplied archive. For local installation, follow
> `README.md` instead.

> The `imagicagency.com/production`, `imagicagency_production`,
> `public_html/production`, and `production-cpanel.zip` names below are
> historical deployment identifiers retained verbatim so the archived procedure
> remains understandable. They are not the current Kernix brand or recommended
> defaults for a new deployment.

This archived guide targeted **imagicagency.com/production** using cPanel only.
Substitute your own domain, directory, database, and archive names for any new
Kernix deployment.

---

## Step 1 — Confirm the database exists

You already created the database. Confirm in cPanel:

1. Open **cPanel → MySQL Databases**
2. You should see `imagicagency_production` in the **Current Databases** list
3. Scroll down and confirm `imagicagency_production` user is shown with **ALL PRIVILEGES** on that database

If the user is not added to the database yet:
- Scroll to **Add User To Database**
- Pick the user: `imagicagency_production`
- Pick the database: `imagicagency_production`
- Click **Add**
- On the next screen, check **ALL PRIVILEGES**, then click **Make Changes**

---

## Step 2 — Import the database schema

1. In cPanel, open **phpMyAdmin**
2. In the left sidebar, click on `imagicagency_production`
3. Click the **Import** tab at the top
4. Click **Choose File** and select `schema.sql` (from the project zip)
5. Scroll down and click **Import**
6. Wait for the green success message

You should now see ~15 tables in the database (users, tasks, projects, etc.).

---

## Step 3 — Upload the files

1. In cPanel, open **File Manager**
2. Navigate to `public_html/production/` (the empty folder you already made)
3. Click **Upload** at the top
4. Upload the file `production-cpanel.zip`
5. Once uploaded, go back to the file manager
6. **Right-click** the zip → **Extract**
7. When the popup appears, the extraction path should already be `/public_html/production/`. Click **Extract Files**
8. Once done, you can delete the zip file

After extraction, `public_html/production/` should contain folders: `app`, `assets`, `modules`, `uploads`, `views`, plus `index.php`, `.htaccess`, and `schema.sql`.

> ⚠️ Make sure hidden files are visible in File Manager. Click **Settings** (top right) → check **"Show Hidden Files (dotfiles)"** → Save. This is needed to see the `.htaccess` files.

---

## Step 4 — Set folder permissions for uploads

1. In File Manager, navigate into `public_html/production/`
2. Right-click the `uploads` folder → **Change Permissions** (or **Permissions**)
3. Set to **755** (boxes: Owner read/write/execute, Group read/execute, World read/execute)
4. Click **Change Permissions**

If file uploads later don't work, retry this with **775**.

---

## Step 5 — Verify it works

1. Open a browser and go to: **https://imagicagency.com/production**
2. You should see the login page
3. Sign in with:
   - **Username:** `admin`
   - **Password:** the private legacy admin password configured by the operator
4. You'll land on the Dashboard with empty stat cards (zeros across the board — that's normal until you add data)

---

## Step 6 — Change the admin password immediately

Until we build the user profile module, change it via phpMyAdmin:

1. Open **phpMyAdmin → imagicagency_production → users table → Browse**
2. Click the **edit** (pencil) icon on the admin row
3. We need to set a new hashed password. The easiest method:
   - Open a new browser tab
   - Go to **https://bcrypt-generator.com/** (or any bcrypt generator)
   - Enter your new password, rounds = 10
   - Copy the resulting hash (starts with `$2y$10$...`)
4. Paste that hash into the `password_hash` field in phpMyAdmin
5. Click **Go** to save

Log out and log back in with your new password to confirm.

---

## Troubleshooting

**"Database connection failed"**
- The DB user is not added to the database, or the password in `app/config.php` doesn't match what you set in cPanel
- To check: cPanel → MySQL Databases → see if user is listed under your database with ALL PRIVILEGES

**Blank white page**
- Edit `app/config.php` and temporarily change `define('APP_DEBUG', false);` to `define('APP_DEBUG', true);` to see the error
- Or check cPanel → Errors (or Error Log) for the PHP error message
- Change it back to `false` once fixed

**404 Not Found at /production**
- Make sure `index.php` is directly inside `public_html/production/`, not nested in another folder
- Confirm cPanel's MultiPHP is set to PHP 8.2 for your domain

**Login form doesn't accept the password**
- The schema may not have imported cleanly. Re-import and try again
- Or set a new hash manually as in Step 6

**Sidebar logo shows "I" instead of your logo**
- That's expected. Upload logos via Settings once that module is built. Until then, the placeholder is fine.

---

## What works right now

- Login / logout with secure password hashing
- Sidebar navigation (only shows what your role can access)
- Dashboard with live counters
- Dark / light theme toggle (top right)
- User dropdown menu
- 403 / 404 pages
- All security: CSRF, prepared statements, htaccess protection, audit logging

## What's stubbed (coming next)

- **Settings** — system, SMTP, storage configuration
- **Users / Roles / Fields** — management screens
- **Clients / Contacts / Projects / Tasks** — full CRUD + list views
- **Task detail page** — with sticky notes shelf
- **Messages** — task notes assigned to you
- **Profile** — edit your own info & password

Each module slots in cleanly to the existing skeleton. Tell me which to build first when you've kicked the tires.
