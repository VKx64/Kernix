# RBAC browser scenarios

Run these against a freshly rebuilt local Compose stack. Use separate browser profiles for the Administrator and constrained user whenever both sessions must remain active. Give temporary records an `RBAC Browser` prefix.

## Administrator

1. Sign in as Administrator and open **Administration → Roles**.
2. Open Administrator and verify **System role · Full access** is read-only.
3. Create `RBAC Browser Constrained` with Dashboard, Tasks → View/Comment, and Time → Track own time. Verify dependencies select and lock automatically.
4. Create `rbac-browser-user` with that role. In a separate profile, sign in as this user.
5. Edit the role, add Tasks → Log task time, and save. Verify the warning reports one affected user and the constrained session is forced back to sign-in on its next request.
6. Verify a direct request to `/settings/roles` while signed in as Administrator still opens normally.
7. With the constrained user clocked in from its separate profile, open Dashboard and verify **Team time now** shows that user and the correct Working/On break state.
8. Create `RBAC Browser Task` in an existing project, archive it, switch the Tasks filter to Archived, restore it, and verify it returns to the active queue.

## Constrained role

1. Sign in as `rbac-browser-user` and confirm navigation shows Dashboard and Tasks, with no Users, Roles, Settings, Fields, Clients, Projects, or Analytics entries.
2. Open `/settings/roles` directly and verify the in-app 403 state; Profile and Sign out must remain available.
3. Clock in, open a task, add a comment, and log time after the Administrator adds that permission.
4. Verify task assignee, estimate, email, archive, and metadata controls remain absent.
5. Clock out and verify task writes show the clock-in requirement and produce no mutation.
6. Confirm Dashboard omits unauthorized cards/charts and the team-time widget.

## Cleanup

1. As Administrator, restore the temporary user if archived, assign it to a retained non-temporary role, then archive it.
2. Delete `RBAC Browser Constrained` after its assigned-user count reaches zero.
3. Archive `RBAC Browser Task` and confirm no `RBAC Browser` projects, clients, contacts, tasks, or roles remain active.
