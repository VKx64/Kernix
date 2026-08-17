<?php

namespace Database\Seeders;

use App\Models\AiTaskGeneration;
use App\Models\AiUsageEvent;
use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Contact;
use App\Models\FieldValue;
use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use App\Models\NoteAttachment;
use App\Models\OliverAction;
use App\Models\OliverConversation;
use App\Models\OliverMessage;
use App\Models\Project;
use App\Models\ProjectAiProfile;
use App\Models\ProjectForm;
use App\Models\ProjectMemoryEntry;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TaskCompletionProof;
use App\Models\TaskEmail;
use App\Models\TaskEstimateDecision;
use App\Models\TaskEstimateRequest;
use App\Models\TaskFolder;
use App\Models\TaskNote;
use App\Models\TaskNoteReaction;
use App\Models\TaskWorkRequest;
use App\Models\TimeBreak;
use App\Models\TimeEntry;
use App\Models\TimeSession;
use App\Models\TimesheetDescription;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\UserSetting;
use App\Models\Workspace;
use App\Support\FormPresets;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use LogicException;

/**
 * QC — fills in every screen the demo seeder leaves empty, so a manual pass
 * over the whole application has something to look at on each one: contacts,
 * folders, public forms and their submissions, attachments, approval queues,
 * timesheets and attendance, invitations, the audit trail, Oliver threads, and
 * the AI project-manager surfaces.
 *
 * It is deliberately excluded from `DatabaseSeeder::run` and only runs when
 * named explicitly, after the demo seeder:
 *
 *   php artisan db:seed --class=DemoWorkspaceSeeder
 *   php artisan db:seed --class=QcDataSeeder
 *
 * Every row is created through `firstOrCreate`/`updateOrCreate` on a stable
 * natural key and every timestamp is derived from the calendar rather than
 * randomised, so running this twice leaves the same row counts and the same
 * values. Attachment rows are backed by real files written to the storage
 * disk, so download and preview paths work rather than 404.
 */
class QcDataSeeder extends Seeder
{
    // QC credential only, never used in production. This seeder is not invoked
    // by the default seed path.
    private const QC_PASSWORD = 'DemoPass123!Demo';

    private User $admin;

    private Workspace $workspace;

    /** @var array<string, int> */
    private array $statuses = [];

    public function run(): void
    {
        $admin = User::query()->find(1);
        if (! $admin) {
            throw new LogicException('Run the default seed (php artisan db:seed) before QcDataSeeder.');
        }
        if (Task::query()->count() === 0) {
            throw new LogicException('Run DemoWorkspaceSeeder before QcDataSeeder; this seeder decorates its clients, projects, and tasks.');
        }

        $this->admin = $admin;
        $this->workspace = Workspace::query()->orderBy('id')->firstOrFail();

        $this->seedClientDetails();
        $people = $this->seedPeople();
        $this->seedContacts();
        $this->seedProjectMembership($people);
        $folders = $this->seedTaskFolders();
        $this->fileTasksIntoFolders($folders);
        $this->seedTaskDescriptions();
        $this->seedConversations($people);
        $this->seedNoteReactions($people);
        $this->seedAttachments($people);
        $this->seedCompletionProofs($people);
        $this->seedWorkRequests($people);
        $this->seedEstimateRequests($people);
        $forms = $this->seedProjectForms();
        $this->seedFormSubmissions($forms);
        $this->seedTaskEmails();
        $this->seedAttendance();
        $this->seedTimesheetDescriptions();
        $this->seedUserSettings($people);
        $this->seedInvitations();
        $this->seedOliver($people);
        $this->seedAiProjectManager($people);
        $this->seedAuditTrail($people);
    }

    /**
     * The demo seeder gives clients a name and a retainer and nothing else, so
     * the client detail screen has empty contact blocks and one unused status.
     */
    private function seedClientDetails(): void
    {
        $details = [
            'Northwind Creative' => ['active', 'https://northwind.example', 'hello@northwind.example', '+63 2 8555 0101', '18 Mabini Street', 'Makati', 'Metro Manila', '1229', 'Philippines', 'Retainer renews every January. Invoices go to accounts@northwind.example.'],
            'Bluepeak Studios' => ['on_hold', 'https://bluepeak.example', 'studio@bluepeak.example', '+63 2 8555 0102', '4F Skyline Tower, 88 Ortigas Ave', 'Pasig', 'Metro Manila', '1605', 'Philippines', 'Paused while their brand lead is on leave until the end of the quarter.'],
            'Ironclad Media' => ['active', 'https://ironclad.example', 'production@ironclad.example', '+63 32 555 0103', '9 Osmena Boulevard', 'Cebu City', 'Cebu', '6000', 'Philippines', 'Video work only. All scripts need legal sign-off before shooting.'],
            'Lumen Digital' => ['active', 'https://lumendigital.example', 'team@lumendigital.example', '+1 415 555 0104', '2201 Mission Street', 'San Francisco', 'California', '94110', 'United States', 'Timezone gap: they review overnight our time, so replies land the next morning.'],
            'Solstice Brands' => ['prospect', 'https://solstice.example', 'newbiz@solstice.example', '+61 2 5550 0105', '30 Kent Street', 'Sydney', 'New South Wales', '2000', 'Australia', 'Pitch sent, waiting on their board to approve the annual budget.'],
            'Anchor & Co.' => ['inactive', null, 'ops@anchor.example', null, null, null, null, null, 'Philippines', 'Dormant since the investor deck shipped; keep the record for history.'],
        ];

        foreach ($details as $name => [$status, $website, $email, $phone, $address, $city, $province, $zip, $country, $notes]) {
            $client = Client::query()->where('name', $name)->first();
            if (! $client) {
                continue;
            }
            $client->update([
                'status_value_id' => $this->fieldValueId('client_status', $status),
                'website' => $website,
                'email' => $email,
                'phone' => $phone,
                'address' => $address,
                'city' => $city,
                'province' => $province,
                'zip_code' => $zip,
                'country' => $country,
                'timezone' => $country === 'United States' ? 'America/Los_Angeles' : ($country === 'Australia' ? 'Australia/Sydney' : 'Asia/Manila'),
                'notes' => $notes,
            ]);
        }
    }

    /**
     * Roles other than Employee never appear in the demo data, so permission
     * differences cannot be checked by signing in as somebody. Each account
     * here also carries the profile fields the people screens display.
     *
     * @return array<string, User>
     */
    private function seedPeople(): array
    {
        $roles = Role::query()->pluck('id', 'key_name');
        foreach (['project_management_role', 'employee_role', 'client_role'] as $key) {
            if (! isset($roles[$key])) {
                throw new LogicException("Role {$key} is missing; run the default seed before QcDataSeeder.");
            }
        }

        $definitions = [
            // username, first, last, role, department, status, start date offset in months
            ['dvillanueva', 'Diego', 'Villanueva', 'project_management_role', 'management', 'active', 26],
            ['jocampo', 'Jasmine', 'Ocampo', 'project_management_role', 'operations', 'active', 14],
            ['tmendoza', 'Teodoro', 'Mendoza', 'employee_role', 'development', 'active', 9],
            ['rgarcia', 'Rosa', 'Garcia', 'employee_role', 'design', 'active', 5],
            ['kdelacruz', 'Kai', 'Dela Cruz', 'employee_role', 'production', 'inactive', 31],
            ['cportal', 'Camille', 'Portal', 'client_role', 'operations', 'active', 3],
        ];

        $people = [];
        foreach ($definitions as [$username, $first, $last, $roleKey, $department, $status, $months]) {
            $people[$username] = User::query()->firstOrCreate(
                ['username' => $username],
                [
                    'role_id' => $roles[$roleKey],
                    'password_hash' => Hash::make(self::QC_PASSWORD),
                    'first_name' => $first,
                    'last_name' => $last,
                    'department_value_id' => $this->fieldValueId('user_department', $department),
                    'status' => $status,
                    'timezone' => 'Asia/Manila',
                    'theme_preset' => 'imagic_purple',
                ],
            );
        }

        // Set outside firstOrCreate so an existing QC database picks these up
        // too, and so the demo employees stop looking half-filled.
        $contactable = [
            'msantos' => ['maria.santos@kernix.example', 'production', 18, 'Quezon City'],
            'lcruz' => ['liam.cruz@kernix.example', 'development', 12, 'Makati'],
            'areyes' => ['ava.reyes@kernix.example', 'design', 7, 'Pasig'],
            'nbautista' => ['noah.bautista@kernix.example', 'operations', 22, 'Taguig'],
            'sramirez' => ['sofia.ramirez@kernix.example', 'production', 4, 'Mandaluyong'],
            'dvillanueva' => ['diego.villanueva@kernix.example', 'management', 26, 'Makati'],
            'jocampo' => ['jasmine.ocampo@kernix.example', 'operations', 14, 'Cebu City'],
            'tmendoza' => ['teodoro.mendoza@kernix.example', 'development', 9, 'Davao City'],
            'rgarcia' => ['rosa.garcia@kernix.example', 'design', 5, 'Iloilo City'],
            'kdelacruz' => ['kai.delacruz@kernix.example', 'production', 31, 'Baguio'],
            'cportal' => ['camille.portal@northwind.example', 'operations', 3, 'Makati'],
        ];
        $today = Carbon::today();
        foreach ($contactable as $username => [$email, $department, $months, $city]) {
            User::query()->where('username', $username)->update([
                'imagic_email' => $email,
                'personal_email' => Str::before($email, '@').'@personalmail.example',
                'phone_1' => '+63 917 555 '.str_pad((string) (1000 + $months), 4, '0', STR_PAD_LEFT),
                'department_value_id' => $this->fieldValueId('user_department', $department),
                'start_date' => $today->copy()->subMonths($months)->startOfMonth()->toDateString(),
                'birthdate' => $today->copy()->subYears(24 + ($months % 12))->subDays($months * 3)->toDateString(),
                'city' => $city,
                'province' => 'Metro Manila',
                'timezone' => 'Asia/Manila',
            ]);
        }

        // Membership and an active workspace, the same two things the default
        // seed guarantees for accounts it inserts directly.
        foreach ($people as $person) {
            DB::table('workspace_user')->insertOrIgnore([
                'workspace_id' => $this->workspace->getKey(),
                'user_id' => $person->id,
                'role_id' => $person->role_id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        User::query()->whereIn('username', array_keys($people))->whereNull('active_workspace_id')
            ->update(['active_workspace_id' => $this->workspace->getKey()]);

        // Sign-in history, so the people list has a "last seen" column worth
        // sorting and one account that has genuinely never signed in.
        foreach (['msantos' => 1, 'lcruz' => 2, 'areyes' => 3, 'dvillanueva' => 1, 'tmendoza' => 5, 'kdelacruz' => 120] as $username => $daysAgo) {
            User::query()->where('username', $username)->update([
                'last_login_at' => Carbon::now()->subDays($daysAgo)->setTime(9, 12),
                'last_login_ip' => '203.0.113.'.(10 + $daysAgo % 40),
            ]);
        }

        return $people;
    }

    private function seedContacts(): void
    {
        $definitions = [
            // client, first, last, title, email, phone, status, notes
            ['Northwind Creative', 'Beatrice', 'Lim', 'Marketing Director', 'beatrice.lim@northwind.example', '+63 917 555 2001', 'active', 'Decision maker on anything touching the homepage.'],
            ['Northwind Creative', 'Elias', 'Tan', 'Brand Manager', 'elias.tan@northwind.example', '+63 917 555 2002', 'active', 'Sends the weekly asset list every Monday morning.'],
            ['Northwind Creative', 'Paolo', 'Reyes', 'Former CMO', 'paolo.reyes@northwind.example', null, 'inactive', 'Left the company; kept for older email threads.'],
            ['Bluepeak Studios', 'Marisol', 'Vega', 'Creative Lead', 'marisol.vega@bluepeak.example', '+63 917 555 2003', 'active', 'On leave until the quarter ends. Route approvals to her deputy.'],
            ['Ironclad Media', 'Hugo', 'Salazar', 'Executive Producer', 'hugo.salazar@ironclad.example', '+63 917 555 2004', 'active', 'Signs off on every script before a shoot is booked.'],
            ['Ironclad Media', 'Nadia', 'Cruz', 'Production Coordinator', 'nadia.cruz@ironclad.example', '+63 917 555 2005', 'active', null],
            ['Lumen Digital', 'Aaron', 'Whitfield', 'Head of Growth', 'aaron.whitfield@lumendigital.example', '+1 415 555 2006', 'active', 'Reviews overnight Manila time; expect next-morning replies.'],
            ['Lumen Digital', 'Priya', 'Raman', 'SEO Specialist', 'priya.raman@lumendigital.example', null, 'active', null],
            ['Solstice Brands', 'Gemma', 'Ashford', 'Procurement', 'gemma.ashford@solstice.example', '+61 2 5550 2007', 'active', 'Holds the pitch until the board approves the annual budget.'],
            ['Anchor & Co.', 'Reginald', 'Ocampo', 'Managing Partner', 'reginald.ocampo@anchor.example', null, 'inactive', 'Dormant account contact.'],
        ];

        foreach ($definitions as [$clientName, $first, $last, $title, $email, $phone, $status, $notes]) {
            $client = Client::query()->where('name', $clientName)->first();
            if (! $client) {
                continue;
            }
            Contact::query()->firstOrCreate(
                ['client_id' => $client->id, 'first_name' => $first, 'last_name' => $last],
                [
                    'title' => $title,
                    'email' => $email,
                    'phone_1' => $phone,
                    'status' => $status,
                    'notes' => $notes,
                    'created_by' => $this->admin->id,
                ],
            );
        }
    }

    /**
     * Project membership decides what a non-admin can see, so leaving it empty
     * makes every restricted-visibility path untestable.
     *
     * @param  array<string, User>  $people
     */
    private function seedProjectMembership(array $people): void
    {
        $byName = Project::query()->pluck('id', 'name');
        $usernames = User::query()->pluck('id', 'username');

        $memberships = [
            'Website Relaunch' => ['dvillanueva', 'tmendoza', 'msantos', 'lcruz', 'cportal'],
            'Q3 Social Campaign' => ['dvillanueva', 'areyes', 'rgarcia'],
            'Brand Identity Refresh' => ['jocampo', 'rgarcia', 'lcruz'],
            'Product Launch Video' => ['jocampo', 'nbautista', 'sramirez'],
            'SEO Overhaul' => ['dvillanueva', 'msantos', 'tmendoza'],
            'App Redesign' => ['jocampo', 'areyes', 'tmendoza'],
            'Investor Deck' => ['dvillanueva', 'nbautista'],
        ];

        foreach ($memberships as $projectName => $members) {
            $projectId = $byName[$projectName] ?? null;
            if (! $projectId) {
                continue;
            }
            foreach ($members as $username) {
                if (! isset($usernames[$username])) {
                    continue;
                }
                DB::table('project_user')->insertOrIgnore([
                    'project_id' => $projectId,
                    'user_id' => $usernames[$username],
                    'assigned_by' => $this->admin->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        // Project managers, so the projects list is not a column of one name.
        foreach (['Brand Identity Refresh' => 'jocampo', 'Product Launch Video' => 'jocampo', 'App Redesign' => 'jocampo', 'SEO Overhaul' => 'dvillanueva'] as $projectName => $username) {
            if (isset($byName[$projectName], $people[$username])) {
                Project::query()->whereKey($byName[$projectName])->update(['manager_user_id' => $people[$username]->id]);
            }
        }

        // Descriptions and dates: the project header renders an empty block
        // without them, and the schedule column has nothing to sort by.
        $today = Carbon::today();
        $schedule = [
            'Website Relaunch' => ['Rebuild the marketing site on the new design system, migrate 40 legacy pages, and cut over DNS in one weekend window.', -60, 45],
            'Q3 Social Campaign' => ['Three-month paid and organic push across four channels, with creative refreshed every fortnight.', -30, 60],
            'Brand Identity Refresh' => ['New wordmark, palette, and a 30-page guideline document. Paused pending the client brand lead.', -90, 120],
            'Product Launch Video' => ['Two-minute hero film plus six cutdowns for paid placement. Includes a two-day studio shoot.', -20, 40],
            'SEO Overhaul' => ['Technical audit, information architecture rework, and twelve months of content briefs.', -75, 90],
            'App Redesign' => ['End-to-end redesign of the onboarding and account flows, delivered as a Figma library plus specs.', -45, 150],
            'Investor Deck' => ['Series B narrative and 24-slide deck, with a data room appendix.', -15, 10],
        ];
        foreach ($schedule as $projectName => [$description, $startOffset, $dueOffset]) {
            if (! isset($byName[$projectName])) {
                continue;
            }
            Project::query()->whereKey($byName[$projectName])->update([
                'description' => $description,
                'start_date' => $today->copy()->addDays($startOffset)->toDateString(),
                'due_date' => $today->copy()->addDays($dueOffset)->toDateString(),
            ]);
        }
    }

    /**
     * Folders are nested one level, and one project is left flat on purpose so
     * the no-folder rendering path stays exercisable.
     *
     * @return array<string, TaskFolder> keyed by "Project / Folder"
     */
    private function seedTaskFolders(): array
    {
        $byName = Project::query()->pluck('id', 'name');
        $tree = [
            'Website Relaunch' => ['Discovery' => [], 'Build' => ['Templates', 'Integrations'], 'Launch' => []],
            'Q3 Social Campaign' => ['Creative' => [], 'Scheduling' => []],
            'Product Launch Video' => ['Pre-production' => ['Scripting'], 'Post' => []],
            'App Redesign' => ['Research' => [], 'Screens' => ['Onboarding', 'Account']],
        ];

        $folders = [];
        foreach ($tree as $projectName => $children) {
            $projectId = $byName[$projectName] ?? null;
            if (! $projectId) {
                continue;
            }
            $order = 0;
            foreach ($children as $parentName => $grandchildren) {
                $order += 10;
                $parent = TaskFolder::query()->firstOrCreate(
                    ['project_id' => $projectId, 'parent_id' => null, 'name' => $parentName],
                    ['sort_order' => $order, 'created_by' => $this->admin->id],
                );
                $folders["{$projectName} / {$parentName}"] = $parent;

                $childOrder = 0;
                foreach ($grandchildren as $childName) {
                    $childOrder += 10;
                    $folders["{$projectName} / {$parentName} / {$childName}"] = TaskFolder::query()->firstOrCreate(
                        ['project_id' => $projectId, 'parent_id' => $parent->id, 'name' => $childName],
                        ['sort_order' => $childOrder, 'created_by' => $this->admin->id],
                    );
                }
            }
        }

        return $folders;
    }

    /** @param array<string, TaskFolder> $folders */
    private function fileTasksIntoFolders(array $folders): void
    {
        $filing = [
            'Fix broken checkout links' => 'Website Relaunch / Build / Integrations',
            'Deliver revised homepage copy' => 'Website Relaunch / Discovery',
            'Build homepage hero section' => 'Website Relaunch / Build / Templates',
            'Review new landing page build' => 'Website Relaunch / Build / Templates',
            'Finalize sitemap structure' => 'Website Relaunch / Discovery',
            'Urgent: hotfix contact form' => 'Website Relaunch / Launch',
            'Ship social ad creatives batch 2' => 'Q3 Social Campaign / Creative',
            'Publish Q3 campaign teaser' => 'Q3 Social Campaign / Scheduling',
            'Schedule next social batch' => 'Q3 Social Campaign / Scheduling',
            'Approve final storyboard' => 'Product Launch Video / Pre-production / Scripting',
            'Awaiting legal sign-off on script' => 'Product Launch Video / Pre-production / Scripting',
            'Check video export against brief' => 'Product Launch Video / Post',
            'QA the mobile app redesign flow' => 'App Redesign / Screens / Onboarding',
            'Draft app onboarding copy' => 'App Redesign / Screens / Onboarding',
            'Research competitor app patterns' => 'App Redesign / Research',
        ];

        foreach ($filing as $title => $folderKey) {
            if (! isset($folders[$folderKey])) {
                continue;
            }
            Task::query()->where('title', $title)->whereNull('task_folder_id')
                ->update(['task_folder_id' => $folders[$folderKey]->id]);
        }
    }

    /**
     * Demo tasks carry a title and nothing else, so the task detail pane opens
     * on an empty description on every single one.
     */
    private function seedTaskDescriptions(): void
    {
        $descriptions = [
            'Fix broken checkout links' => "Three product tiles on the pricing page point at the retired /checkout-v1 route and 404.\n\nExpected: each tile links to the matching plan in the new checkout. Reproduced on Chrome and Safari, desktop and mobile.",
            'Deliver revised homepage copy' => "Second pass on the homepage after the client feedback call.\n\nShorten the hero to one sentence, drop the third value prop entirely, and rewrite the testimonial intro so it does not repeat the hero verb.",
            'Ship social ad creatives batch 2' => "Six statics and two 15-second cutdowns, sized for feed and story.\n\nUse the refreshed palette from the brand deck, not the launch colours.",
            'Waiting on client brand assets' => "Blocked until Northwind sends the vector logo set and the licensed display face.\n\nChased twice by email; next chase goes through Beatrice directly.",
            'QA the mobile app redesign flow' => "Full pass over onboarding on a real device, not the simulator.\n\nCheck: keyboard does not cover the continue button, back gesture does not skip the consent step, and the error state on a failed OTP is readable at the smallest supported text size.",
            'Urgent: hotfix contact form' => "Submissions have been silently failing since the DNS change. The form reports success and nothing arrives.\n\nSuspect the SPF record. Verify a real submission end to end before closing.",
            'Draft long-term SEO roadmap' => "Twelve-month view: technical fixes first, then the content programme.\n\nOne page, no jargon, aimed at a reader who does not work in search.",
            'Build homepage hero section' => "Implement the hero from the approved design, including the reduced-motion variant.\n\nImage must be responsive down to 320px without cropping the subject's face.",
            'Ship teaser trailer v1' => "First cut of the teaser, graded and mixed.\n\nDelivered as ProRes plus an H.264 review copy with burned-in timecode.",
        ];

        foreach ($descriptions as $title => $description) {
            Task::query()->where('title', $title)->whereNull('description')->update(['description' => $description]);
        }
    }

    /**
     * Notes and messages both live in `task_notes`; the demo seeder writes five
     * standalone notes and no threads at all, so neither the discussion view
     * nor the Messages inbox has anything to show.
     *
     * @param  array<string, User>  $people
     */
    private function seedConversations(array $people): void
    {
        $now = Carbon::now();

        // Plain discussion notes, including one with logged time against it.
        $notes = [
            ['Fix broken checkout links', 'msantos', 'Traced it to the redirect map — the old /checkout-v1 rows were dropped in the migration. Restoring them locally now.', 25],
            ['Fix broken checkout links', 'lcruz', 'Confirmed on staging: two of the three tiles resolve after the restore. The third points at a plan that no longer exists.', null],
            ['QA the mobile app redesign flow', 'areyes', 'Keyboard covers the continue button on the smallest supported device. Everything else in onboarding passes.', 40],
            ['Ship social ad creatives batch 2', 'areyes', 'Batch 2 statics are in the shared drive. Cutdowns need the new end card before they can go out.', null],
            ['Blocked on API credentials', 'msantos', 'Requested a scoped key from their platform team. No reply for four days.', null],
            ['Draft long-term SEO roadmap', 'msantos', 'First outline done. Holding the content programme section until the audit numbers land.', 60],
        ];
        foreach ($notes as [$taskTitle, $username, $body, $minutes]) {
            $task = Task::query()->where('title', $taskTitle)->first();
            $author = User::query()->where('username', $username)->first();
            if (! $task || ! $author) {
                continue;
            }
            TaskNote::query()->firstOrCreate(
                ['task_id' => $task->id, 'created_by' => $author->id, 'body' => $body],
                [
                    'is_message' => false,
                    'time_minutes' => $minutes,
                    'time_logged_by' => $minutes ? $author->id : null,
                ],
            );
        }

        // Message threads: a root message with `is_message`, then replies
        // hanging off it by `conversation_id`. Two threads stay unread so the
        // inbox badge has something to count.
        // `assigned_user_id` on a message is its recipient, not the task's
        // assignee, and it is what the inbox filters and the unread badge read.
        // Each thread is between two named people and the messages alternate
        // between them; the last message in a thread marked unread is left with
        // a null `read_at` so the badge has something to count.
        $threads = [
            [
                'task' => 'Urgent: hotfix contact form',
                'between' => ['dvillanueva', 'lcruz'],
                'unread_tail' => false,
                'messages' => [
                    ['Can you take this one ahead of the hero section? The client is fielding calls because nothing is reaching their inbox.', 3],
                    ['Picking it up now. I can have a verified end-to-end submission within the hour.', 2],
                    ['Perfect. Reply here once a real submission lands so I can tell them.', 1],
                ],
            ],
            [
                'task' => 'Waiting on client brand assets',
                'between' => ['jocampo', 'rgarcia'],
                'unread_tail' => true,
                'messages' => [
                    ['Have we heard anything on the logo set? Two other tasks are stacked behind this one.', 5],
                    ['Chased twice by email, no reply. Next chase goes to Beatrice directly.', 4],
                    ['Go through Beatrice then, and copy me so I can escalate if it stays quiet.', 2],
                ],
            ],
            [
                'task' => 'Approve final storyboard',
                'between' => ['sramirez', 'jocampo'],
                'unread_tail' => true,
                'messages' => [
                    ['Storyboard is ready for review. Frames 8 to 11 changed after the legal note.', 1],
                ],
            ],
            [
                'task' => 'Submit SEO audit report',
                'between' => ['dvillanueva', 'msantos'],
                'unread_tail' => true,
                'messages' => [
                    ['Client asked whether the audit will cover their subdomains too. Does the current scope include them?', 1],
                    ['Only the main domain today. Adding both subdomains is about an hour on top — I raised an estimate request for it.', 0],
                ],
            ],
        ];

        foreach ($threads as $thread) {
            $task = Task::query()->where('title', $thread['task'])->first();
            $participants = User::query()->whereIn('username', $thread['between'])->get()->keyBy('username');
            if (! $task || $participants->count() !== 2) {
                continue;
            }
            $ordered = [$participants[$thread['between'][0]], $participants[$thread['between'][1]]];

            $root = null;
            $lastIndex = count($thread['messages']) - 1;
            foreach ($thread['messages'] as $index => [$body, $daysAgo]) {
                $author = $ordered[$index % 2];
                $recipient = $ordered[($index + 1) % 2];
                $unread = $thread['unread_tail'] && $index === $lastIndex;
                $at = $now->copy()->subDays($daysAgo);

                $message = TaskNote::query()->firstOrCreate(
                    ['task_id' => $task->id, 'created_by' => $author->id, 'body' => $body],
                    [
                        'is_message' => true,
                        'conversation_id' => $root?->id,
                        'assigned_user_id' => $recipient->id,
                        'read_at' => $unread ? null : $at->copy()->addHour(),
                        'read_by_user_id' => $unread ? null : $recipient->id,
                        'created_at' => $at,
                        'updated_at' => $at,
                    ],
                );

                // The first message in a thread is its own conversation root,
                // which is how `TaskMessageService::start` records it.
                if ($root === null) {
                    $message->forceFill(['conversation_id' => $message->conversation_id ?? $message->id])->saveQuietly();
                    $root = $message;
                }
            }
        }
    }

    /** @param array<string, User> $people */
    private function seedNoteReactions(array $people): void
    {
        $reactors = User::query()->whereIn('username', ['msantos', 'lcruz', 'areyes', 'dvillanueva'])->get()->keyBy('username');
        $notes = TaskNote::query()->orderBy('id')->limit(8)->get();
        $emoji = ['👍', '🎉', '👀', '🔥'];

        foreach ($notes as $index => $note) {
            // Every third note is left without reactions so the empty state
            // renders next to the populated one.
            if ($index % 3 === 2) {
                continue;
            }
            foreach ($reactors->values() as $offset => $reactor) {
                if (($index + $offset) % 2 !== 0) {
                    continue;
                }
                TaskNoteReaction::query()->firstOrCreate([
                    'task_note_id' => $note->id,
                    'user_id' => $reactor->id,
                    'emoji' => $emoji[($index + $offset) % count($emoji)],
                ]);
            }
        }
    }

    /**
     * Attachment rows without files behind them 404 on download and render a
     * broken preview, so each row here is backed by a real file written to the
     * storage disk.
     *
     * @param  array<string, User>  $people
     */
    private function seedAttachments(array $people): void
    {
        $definitions = [
            ['Fix broken checkout links', 'msantos', 'checkout-404.png', 'image/png'],
            ['Fix broken checkout links', 'msantos', 'redirect-map.csv', 'text/csv'],
            ['QA the mobile app redesign flow', 'areyes', 'onboarding-keyboard-overlap.png', 'image/png'],
            ['Review new landing page build', 'lcruz', 'landing-page-review.png', 'image/png'],
            ['Ship teaser trailer v1', 'sramirez', 'teaser-shotlist.txt', 'text/plain'],
            ['Deliver revised homepage copy', 'lcruz', 'homepage-copy-v2.txt', 'text/plain'],
        ];

        foreach ($definitions as [$taskTitle, $username, $originalName, $mime]) {
            $task = Task::query()->where('title', $taskTitle)->first();
            $uploader = User::query()->where('username', $username)->first();
            if (! $task || ! $uploader) {
                continue;
            }
            $existing = TaskAttachment::query()->where('task_id', $task->id)->where('original_name', $originalName)->first();
            if ($existing) {
                continue;
            }
            $contents = $this->fileContents($mime, $originalName);
            $fileName = Str::ulid()->toBase32().'.'.pathinfo($originalName, PATHINFO_EXTENSION);
            $path = "task-attachments/{$task->id}/{$fileName}";
            Storage::disk('local')->put($path, $contents);

            TaskAttachment::query()->create([
                'task_id' => $task->id,
                'original_name' => $originalName,
                'file_name' => $fileName,
                'storage_path' => $path,
                'mime_type' => $mime,
                'file_size' => strlen($contents),
                'storage_driver' => 'local',
                'uploaded_by' => $uploader->id,
            ]);
        }

        // One note carries an attachment, so the note attachment path is not
        // dead across the whole database.
        $note = TaskNote::query()->where('is_message', false)->orderBy('id')->first();
        if ($note && ! NoteAttachment::query()->where('note_id', $note->id)->exists()) {
            $contents = $this->fileContents('image/png', 'note-evidence.png');
            $fileName = Str::ulid()->toBase32().'.png';
            $path = "note-attachments/{$note->id}/{$fileName}";
            Storage::disk('local')->put($path, $contents);
            NoteAttachment::query()->create([
                'note_id' => $note->id,
                'original_name' => 'note-evidence.png',
                'file_name' => $fileName,
                'storage_path' => $path,
                'mime_type' => 'image/png',
                'file_size' => strlen($contents),
                'storage_driver' => 'local',
                'uploaded_by' => $note->created_by,
            ]);
        }
    }

    /**
     * One proof in each state the review screen can show: waiting on a human,
     * approved, rejected, and one the AI reviewer has already ruled on.
     *
     * @param  array<string, User>  $people
     */
    private function seedCompletionProofs(array $people): void
    {
        $now = Carbon::now();
        $definitions = [
            [
                'task' => 'Review new landing page build',
                'submitted_by' => 'areyes',
                'summary' => 'Reviewed every breakpoint against the design. Fixed two spacing bugs and one wrong heading level. Screenshots attached for 320, 768, and 1440.',
                'status' => 'pending', 'ai_state' => 'queued', 'ai_verdict' => null,
                'reviewed_by' => null, 'review_mode' => null, 'review_reason' => null, 'days_ago' => 1,
            ],
            [
                'task' => 'Finalize sitemap structure',
                'submitted_by' => 'msantos',
                'summary' => 'Sitemap signed off by the client on the call. 42 pages, 4 removed, 3 merged. Final version is in the shared drive.',
                'status' => 'approved', 'ai_state' => 'decided', 'ai_verdict' => 'approve',
                'reviewed_by' => 'dvillanueva', 'review_mode' => 'human', 'review_reason' => 'Matches what the client agreed on the call.', 'days_ago' => 9,
            ],
            [
                'task' => 'Approve brand mood board',
                'submitted_by' => 'lcruz',
                'summary' => 'Mood board done.',
                'status' => 'rejected', 'ai_state' => 'decided', 'ai_verdict' => 'insufficient',
                'reviewed_by' => 'jocampo', 'review_mode' => 'human', 'review_reason' => 'No evidence attached and the summary does not say which direction was chosen. Resubmit with the board itself.', 'days_ago' => 11,
            ],
            [
                'task' => 'Ship teaser trailer v1',
                'submitted_by' => 'sramirez',
                'summary' => 'Graded and mixed. ProRes master plus an H.264 review copy with burned-in timecode uploaded. Runtime 1:52, two frames under the brief.',
                'status' => 'approved', 'ai_state' => 'decided', 'ai_verdict' => 'approve',
                'reviewed_by' => null, 'review_mode' => 'ai', 'review_reason' => 'Deliverables named in the brief are all present and the runtime is within tolerance.', 'days_ago' => 5,
            ],
            [
                'task' => 'Close out onboarding survey',
                'submitted_by' => 'msantos',
                'summary' => 'Survey closed at 212 responses. Summary deck shared with the client and the raw export archived.',
                'status' => 'pending', 'ai_state' => 'decided', 'ai_verdict' => 'reject',
                'reviewed_by' => null, 'review_mode' => null, 'review_reason' => null, 'days_ago' => 2,
            ],
        ];

        foreach ($definitions as $definition) {
            $task = Task::query()->where('title', $definition['task'])->first();
            $submitter = User::query()->where('username', $definition['submitted_by'])->first();
            if (! $task || ! $submitter) {
                continue;
            }
            $reviewer = $definition['reviewed_by'] ? User::query()->where('username', $definition['reviewed_by'])->first() : null;
            $at = $now->copy()->subDays($definition['days_ago']);

            TaskCompletionProof::query()->firstOrCreate(
                ['task_id' => $task->id, 'submitted_by' => $submitter->id],
                [
                    'summary' => $definition['summary'],
                    'status' => $definition['status'],
                    'ai_state' => $definition['ai_state'],
                    'ai_verdict' => $definition['ai_verdict'],
                    'ai_message' => $definition['ai_verdict'] === null ? null : match ($definition['ai_verdict']) {
                        'approve' => 'Every deliverable named in the task description is accounted for in the summary.',
                        'insufficient' => 'The summary does not describe what was produced and no evidence is attached.',
                        default => 'The summary describes work that does not match the task description.',
                    },
                    'ai_missing_evidence' => $definition['ai_verdict'] === 'insufficient' ? ['The mood board itself', 'Which direction the client chose'] : null,
                    'reviewed_by' => $reviewer?->id,
                    'review_mode' => $definition['review_mode'],
                    'review_reason' => $definition['review_reason'],
                    'reviewed_at' => $definition['status'] === 'pending' ? null : $at->copy()->addHours(4),
                    'previous_status_value_id' => $this->fieldValueId('task_status', 'quality_check'),
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );
        }
    }

    /** @param array<string, User> $people */
    private function seedWorkRequests(array $people): void
    {
        $now = Carbon::now();
        $definitions = [
            ['Urgent: replace expired SSL cert', 'tmendoza', 'Nobody is assigned and the certificate expires tomorrow. I have done this on two other projects.', TaskWorkRequest::PENDING, null, null, 0],
            ['Resolve font licensing issue', 'rgarcia', 'I already have the licence paperwork from the brand refresh, so this is quick for me.', TaskWorkRequest::APPROVED, 'dvillanueva', 'Makes sense — you have the context.', 3],
            ['High priority: reshoot damaged b-roll', 'lcruz', 'I can take the reshoot if nobody else is free this week.', TaskWorkRequest::DECLINED, 'jocampo', 'Sofia is already booked for the studio day; keeping it with her.', 2],
            ['Blocked by third-party vendor delay', 'msantos', 'Happy to chase the vendor while this sits blocked.', TaskWorkRequest::WITHDRAWN, null, null, 6],
        ];

        foreach ($definitions as [$taskTitle, $username, $reason, $status, $deciderUsername, $decisionReason, $daysAgo]) {
            $task = Task::query()->where('title', $taskTitle)->first();
            $requester = User::query()->where('username', $username)->first();
            if (! $task || ! $requester) {
                continue;
            }
            $decider = $deciderUsername ? User::query()->where('username', $deciderUsername)->first() : null;
            $at = $now->copy()->subDays($daysAgo);

            TaskWorkRequest::query()->firstOrCreate(
                ['task_id' => $task->id, 'requester_user_id' => $requester->id],
                [
                    'reason' => $reason,
                    'status' => $status,
                    'decided_by' => $decider?->id,
                    'decision_reason' => $decisionReason,
                    'decided_at' => $status === TaskWorkRequest::PENDING ? null : $at->copy()->addHours(6),
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );
        }
    }

    /**
     * The estimate workflow has the most states of anything in the app: a
     * human queue, an AI reviewer, an employee who has to answer back, and an
     * override path. One request per state, each with its decision history.
     *
     * @param  array<string, User>  $people
     */
    private function seedEstimateRequests(array $people): void
    {
        $now = Carbon::now();
        $definitions = [
            [
                'task' => 'Ship social ad creatives batch 2', 'requested_by' => 'areyes', 'reviewer' => 'dvillanueva',
                'requested' => 60, 'approved' => null, 'status' => 'pending', 'review_mode' => 'human', 'ai_state' => null,
                'request_reason' => 'The end card was redesigned after the estimate, so both cutdowns need re-rendering.',
                'decision_reason' => null, 'decided_by' => null, 'days_ago' => 1, 'awaiting' => false,
            ],
            [
                'task' => 'Submit SEO audit report', 'requested_by' => 'msantos', 'reviewer' => 'dvillanueva',
                'requested' => 90, 'approved' => 60, 'status' => 'approved', 'review_mode' => 'human', 'ai_state' => null,
                'request_reason' => 'They added two subdomains to the scope after the kickoff.',
                'decision_reason' => 'Approving an hour rather than 90 minutes — the second subdomain reuses the first crawl.',
                'decided_by' => 'dvillanueva', 'days_ago' => 4, 'awaiting' => false,
            ],
            [
                'task' => 'Build homepage hero section', 'requested_by' => 'lcruz', 'reviewer' => null,
                'requested' => 120, 'approved' => null, 'status' => 'rejected', 'review_mode' => 'ai', 'ai_state' => 'decided',
                'request_reason' => 'Needs more time.',
                'decision_reason' => 'The request does not say what changed since the original estimate, and the task description has not been edited.',
                'decided_by' => null, 'days_ago' => 6, 'awaiting' => false,
            ],
            [
                'task' => 'QA the mobile app redesign flow', 'requested_by' => 'areyes', 'reviewer' => null,
                'requested' => 45, 'approved' => null, 'status' => 'pending', 'review_mode' => 'ai', 'ai_state' => 'waiting_employee',
                'request_reason' => 'Device testing is slower than the simulator pass I estimated against.',
                'decision_reason' => null, 'decided_by' => null, 'days_ago' => 2, 'awaiting' => true,
            ],
            [
                'task' => 'Revise rejected ad variant', 'requested_by' => 'sramirez', 'reviewer' => 'jocampo',
                'requested' => 30, 'approved' => 30, 'status' => 'approved', 'review_mode' => 'ai', 'ai_state' => 'overridden',
                'request_reason' => 'Third revision round on the same variant after new client feedback.',
                'decision_reason' => 'Overriding the automatic rejection: the feedback arrived after the estimate was set.',
                'decided_by' => 'jocampo', 'days_ago' => 3, 'awaiting' => false,
            ],
        ];

        foreach ($definitions as $definition) {
            $task = Task::query()->where('title', $definition['task'])->first();
            $requester = User::query()->where('username', $definition['requested_by'])->first();
            if (! $task || ! $requester) {
                continue;
            }
            $reviewer = $definition['reviewer'] ? User::query()->where('username', $definition['reviewer'])->first() : null;
            $decider = $definition['decided_by'] ? User::query()->where('username', $definition['decided_by'])->first() : null;
            $at = $now->copy()->subDays($definition['days_ago']);
            $resolved = $definition['status'] !== 'pending';

            $request = TaskEstimateRequest::query()->firstOrCreate(
                ['task_id' => $task->id, 'requested_by' => $requester->id],
                [
                    'reviewer_user_id' => $reviewer?->id,
                    'base_estimated_minutes' => (int) ($task->estimated_minutes ?? 0),
                    'requested_additional_minutes' => $definition['requested'],
                    'approved_additional_minutes' => $definition['approved'],
                    'effective_additional_minutes' => $definition['approved'] ?? 0,
                    'status' => $definition['status'],
                    'request_reason' => $definition['request_reason'],
                    'decision_reason' => $definition['decision_reason'],
                    'decided_by' => $decider?->id,
                    'decided_at' => $resolved ? $at->copy()->addHours(3) : null,
                    'review_mode' => $definition['review_mode'],
                    'ai_state' => $definition['ai_state'],
                    'awaiting_employee_since' => $definition['awaiting'] ? $at->copy()->addHour() : null,
                    'decision_source' => $resolved ? ($decider ? 'human' : 'ai') : null,
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );

            if (! $request->wasRecentlyCreated || ! $resolved) {
                continue;
            }

            TaskEstimateDecision::query()->create([
                'task_estimate_request_id' => $request->id,
                'source' => $decider ? 'human' : 'ai',
                'action' => $definition['status'] === 'approved' ? 'approve' : 'reject',
                'approved_additional_minutes' => $definition['approved'],
                'reason' => (string) $definition['decision_reason'],
                'decided_by' => $decider?->id,
                'prior_status' => 'pending',
                'prior_effective_additional_minutes' => 0,
                'created_at' => $at->copy()->addHours(3),
            ]);

            // The overridden request has an AI decision behind the human one,
            // so the decision history renders with more than a single row.
            if ($definition['ai_state'] === 'overridden') {
                TaskEstimateDecision::query()->create([
                    'task_estimate_request_id' => $request->id,
                    'source' => 'ai',
                    'action' => 'reject',
                    'approved_additional_minutes' => null,
                    'reason' => 'A third revision round on the same deliverable usually means the estimate itself was wrong.',
                    'decided_by' => null,
                    'prior_status' => 'pending',
                    'prior_effective_additional_minutes' => 0,
                    'created_at' => $at->copy()->addHour(),
                ]);
            }
        }
    }

    /**
     * Public intake forms, one per state the builder can produce: two presets
     * live, one paused, and one that has closed by date.
     *
     * @return array<string, ProjectForm>
     */
    private function seedProjectForms(): array
    {
        $today = Carbon::today();
        $definitions = [
            ['Website Relaunch', FormPresets::BUG_REPORT, 'live', null, true],
            ['Website Relaunch', FormPresets::FEATURE_REQUEST, 'live', null, false],
            ['App Redesign', FormPresets::BUG_REPORT, 'paused', null, false],
            ['Q3 Social Campaign', FormPresets::FEATURE_REQUEST, 'live', $today->copy()->subDays(3), false],
        ];

        $forms = [];
        foreach ($definitions as [$projectName, $preset, $state, $closesOn, $autoConvert]) {
            $project = Project::query()->where('name', $projectName)->first();
            if (! $project) {
                continue;
            }
            $key = "{$projectName} / {$preset}";
            $existing = ProjectForm::query()->where('project_id', $project->id)
                ->where('title', $preset === FormPresets::BUG_REPORT ? 'Bug Report' : 'Feature Request')
                ->first();

            $form = $existing ?: FormPresets::create($project, $this->admin, $preset);
            $form->update([
                'state' => $state,
                'closes_on' => $closesOn?->toDateString(),
                'auto_convert' => $autoConvert,
            ]);
            $forms[$key] = $form->fresh();
        }

        return $forms;
    }

    /**
     * Submissions in every state the triage screen sorts into, plus a
     * near-duplicate pair so the duplicate banner has something to point at.
     *
     * @param  array<string, ProjectForm>  $forms
     */
    private function seedFormSubmissions(array $forms): void
    {
        $now = Carbon::now();
        $bugForm = $forms['Website Relaunch / '.FormPresets::BUG_REPORT] ?? null;
        $featureForm = $forms['Website Relaunch / '.FormPresets::FEATURE_REQUEST] ?? null;
        if (! $bugForm) {
            return;
        }

        $definitions = [
            [$bugForm, 'Beatrice Lim', 'beatrice.lim@northwind.example', 'Pricing page tiles go to a 404', 'All three plan buttons on /pricing land on a page that says the link is retired. Started some time after the new site went up.', 'new', 2, null],
            [$bugForm, 'Elias Tan', 'elias.tan@northwind.example', 'Plan buttons on pricing are broken', 'The three buttons under the plans give a 404. Same as what Beatrice reported, adding a screenshot.', 'new', 1, 'duplicate'],
            [$bugForm, 'Nadia Cruz', 'nadia.cruz@ironclad.example', 'Contact form says sent but nothing arrives', 'Submitted the contact form four times today. It shows the thank-you message every time and nothing reaches our inbox.', 'converted', 4, null],
            [$bugForm, 'Anonymous', null, 'test test test', 'asdf', 'declined', 6, null],
            [$featureForm ?: $bugForm, 'Aaron Whitfield', 'aaron.whitfield@lumendigital.example', 'Let us export the audit as a spreadsheet', 'The PDF is fine for reading but we want to sort the issues by severity and assign them internally.', 'new', 3, null],
            [$featureForm ?: $bugForm, 'Priya Raman', 'priya.raman@lumendigital.example', 'Add a dark mode to the public dashboard', 'Half the team works evenings and the white background is rough at night.', 'converted', 8, null],
        ];

        $firstReference = null;
        foreach ($definitions as $index => [$form, $fromName, $fromEmail, $title, $details, $status, $daysAgo, $marker]) {
            $snapshot = $form->toSnapshot();
            $answers = [];
            foreach ($snapshot['fields'] as $field) {
                $answers[$field['id']] = match ($field['maps'] ?? null) {
                    'title' => $title,
                    'description' => $details,
                    default => $this->answerForField($field),
                };
            }

            // A fixed reference rather than a generated one: it is the natural
            // key that makes a second run of this seeder a no-op, and the
            // reference is what the triage screen shows anyway.
            $reference = 'SUB-QCSEED'.chr(ord('A') + $index);
            $existing = FormSubmission::query()->where('reference', $reference)->first();
            if ($existing) {
                $firstReference ??= $existing;

                continue;
            }

            $at = $now->copy()->subDays($daysAgo);
            $task = $status === 'converted' ? $this->convertedTaskFor($form, $title, $details, $at) : null;

            $submission = FormSubmission::query()->create([
                'project_form_id' => $form->id,
                'project_id' => $form->project_id,
                'reference' => $reference,
                'from_name' => $fromName,
                'from_email' => $fromEmail,
                'answers' => $answers,
                'form_snapshot' => $snapshot,
                'status' => $status,
                'task_id' => $task?->id,
                'possible_duplicate_of' => $marker === 'duplicate' ? $firstReference?->id : null,
                'decline_reason' => $status === 'declined' ? 'Not a real report — no description of a problem.' : null,
                'decided_by' => $status === 'new' ? null : $this->admin->id,
                'decided_at' => $status === 'new' ? null : $at->copy()->addHours(5),
                'ip_hash' => hash('sha256', 'qc-seed-'.$daysAgo),
                'user_agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
                'created_at' => $at,
            ]);
            $firstReference ??= $submission;

            // One submission carries an uploaded file, backed by a real image
            // so the attachment preview works.
            if ($marker === 'duplicate') {
                $contents = $this->fileContents('image/png', 'pricing-404.png');
                $fileName = Str::ulid()->toBase32().'.png';
                $path = "form-submissions/{$submission->id}/{$fileName}";
                Storage::disk('local')->put($path, $contents);
                FormSubmissionFile::query()->create([
                    'form_submission_id' => $submission->id,
                    'original_name' => 'pricing-404.png',
                    'file_name' => $fileName,
                    'storage_path' => $path,
                    'mime_type' => 'image/png',
                    'file_size' => strlen($contents),
                    'storage_driver' => 'local',
                ]);
            }
        }
    }

    /** @param array<string, mixed> $field */
    private function answerForField(array $field): mixed
    {
        return match ($field['type'] ?? 'short_text') {
            'long_text' => 'Added by the QC seeder so every field on the form has an answer to render.',
            'choice', 'select' => $field['choices'][0] ?? null,
            'multi_choice' => array_slice($field['choices'] ?? [], 0, 1),
            'number' => 2,
            'date' => Carbon::today()->toDateString(),
            'email' => 'qc-reporter@example.com',
            default => 'Provided by the QC seeder.',
        };
    }

    private function convertedTaskFor(ProjectForm $form, string $title, string $details, Carbon $at): Task
    {
        return Task::query()->firstOrCreate(
            ['title' => $title, 'project_id' => $form->project_id],
            [
                'description' => $details,
                'status_value_id' => $this->fieldValueId('task_status', 'pending'),
                'urgency_value_id' => $this->fieldValueId('task_urgency', 'normal'),
                'type_value_id' => $this->fieldValueId('task_type', 'request'),
                'due_date' => $at->copy()->addDays(7)->toDateString(),
                'estimated_minutes' => 60,
                'actual_minutes' => 0,
                'created_by' => $this->admin->id,
                'created_at' => $at,
                'updated_at' => $at,
            ],
        );
    }

    private function seedTaskEmails(): void
    {
        $now = Carbon::now();
        $definitions = [
            ['Fix broken checkout links', 'beatrice.lim@northwind.example', 'elias.tan@northwind.example', 'Checkout links — fixed and verified', "Hi Beatrice,\n\nAll three plan buttons now resolve to the right checkout. I verified each one on desktop and mobile.\n\nThe third tile pointed at a plan that no longer exists, so it now goes to the closest current plan. Let me know if you would rather it be hidden.\n\nThanks,\nMaria", 'sent', 1],
            ['Waiting on client brand assets', 'marisol.vega@bluepeak.example', null, 'Chasing the logo set (third time)', "Hi Marisol,\n\nWe are still missing the vector logo set and the licensed display face. Two other pieces of work are waiting on them.\n\nIs there someone else on your side who can send them while you are away?\n\nThanks,\nJasmine", 'sent', 4],
            ['Urgent: replace expired SSL cert', 'aaron.whitfield@lumendigital.example', null, 'Certificate expiring tomorrow', "Hi Aaron,\n\nYour certificate expires tomorrow and we do not have access to renew it. Can you either renew on your side or grant us access today?\n\nThanks,\nAdmin", 'queued', 0],
            ['Approve brand mood board', 'marisol.vega@bluepeak.example', null, 'Mood board — three directions', "Hi Marisol,\n\nAttached are the three directions we discussed.\n\nThanks,\nLiam", 'failed', 12],
        ];

        foreach ($definitions as [$taskTitle, $to, $cc, $subject, $body, $status, $daysAgo]) {
            $task = Task::query()->where('title', $taskTitle)->first();
            if (! $task) {
                continue;
            }
            $at = $now->copy()->subDays($daysAgo);
            TaskEmail::query()->firstOrCreate(
                ['task_id' => $task->id, 'subject' => $subject],
                [
                    'sent_by' => $task->assignee_user_id ?? $this->admin->id,
                    'to_addresses' => $to,
                    'cc_addresses' => $cc,
                    'subject' => $subject,
                    'body' => $body,
                    'status' => $status,
                    'error_message' => $status === 'failed' ? 'Connection to the SMTP host timed out after 30 seconds.' : null,
                    'sent_at' => $status === 'sent' ? $at : null,
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );
        }
    }

    /**
     * The demo seeder writes timer entries but no clock-in sessions, so the
     * attendance screen is empty and the entries hang off no session at all.
     * Sessions here wrap the existing entries, one per person per working day,
     * plus one session left open so the "currently clocked in" state renders.
     */
    private function seedAttendance(): void
    {
        $now = Carbon::now();
        // Only entries that are closed and not already filed under a session:
        // a running timer has no end to wrap a session around, and an entry
        // that already has a session would open a second one on the next run.
        $rows = TimeEntry::query()->whereNull('session_id')->whereNotNull('ended_at')
            ->orderBy('user_id')->orderBy('started_at')->get();
        $byUserAndDay = [];
        foreach ($rows as $row) {
            $byUserAndDay[$row->user_id][$row->started_at->toDateString()][] = $row;
        }

        foreach ($byUserAndDay as $userId => $days) {
            foreach ($days as $day => $entries) {
                $first = $entries[0];
                $last = $entries[count($entries) - 1];
                $clockIn = $first->started_at->copy()->subMinutes(10);
                $clockOut = ($last->ended_at ?? $last->started_at)->copy()->addMinutes(15);

                $session = TimeSession::query()->firstOrCreate(
                    ['user_id' => $userId, 'clock_in_at' => $clockIn],
                    ['clock_out_at' => $clockOut, 'notes' => null],
                );

                TimeEntry::query()->whereIn('id', collect($entries)->pluck('id'))
                    ->whereNull('session_id')->update(['session_id' => $session->id]);

                // Lunch is recorded twice by design: as a break entry on the
                // timer and as a break on the attendance session.
                foreach ($entries as $entry) {
                    if ($entry->kind !== 'break') {
                        continue;
                    }
                    TimeBreak::query()->firstOrCreate(
                        ['session_id' => $session->id, 'start_at' => $entry->started_at],
                        ['end_at' => $entry->ended_at],
                    );
                }
            }
        }

        $this->seedOpenSession();
    }

    /**
     * One person is left clocked in with a running timer. The demo entries only
     * cover hours that have already passed, so without this the "on the clock"
     * state is unreachable whenever QC starts outside working hours.
     */
    private function seedOpenSession(): void
    {
        $now = Carbon::now();
        $user = User::query()->where('username', 'msantos')->first();
        if (! $user) {
            return;
        }
        if (TimeSession::query()->where('user_id', $user->id)->whereNull('clock_out_at')->exists()) {
            return;
        }

        $session = TimeSession::query()->create([
            'user_id' => $user->id,
            'clock_in_at' => $now->copy()->subMinutes(95),
            'clock_out_at' => null,
            'notes' => 'Working from the office today.',
        ]);

        $task = Task::query()->where('assignee_user_id', $user->id)
            ->whereHas('status', fn ($status) => $status->where('key_name', 'in_progress'))
            ->orderBy('id')->first();

        TimeEntry::query()->create([
            'user_id' => $user->id,
            'session_id' => $session->id,
            'task_id' => $task?->id,
            'kind' => 'work',
            'started_at' => $now->copy()->subMinutes(40),
            'ended_at' => null,
        ]);
    }

    /**
     * A timesheet with hours but no descriptions cannot be reviewed, which is
     * most of what the timesheet screen is for.
     */
    private function seedTimesheetDescriptions(): void
    {
        $bodies = [
            'Traced the broken redirects and restored the retired routes, then verified each plan button end to end.',
            'Second pass on the homepage copy after the client call; cut the hero to one sentence.',
            'Rendered and uploaded the batch 2 statics, blocked on the new end card for the cutdowns.',
            'Device pass over the onboarding flow; logged the keyboard overlap and two smaller issues.',
            'Audit crawl finished; started writing up the technical findings section.',
            'Chased the client for brand assets and prepared the handover notes while blocked.',
        ];

        $entries = TimeEntry::query()->where('kind', 'work')->whereNotNull('task_id')
            ->orderBy('user_id')->orderBy('started_at')->get();

        $seen = [];
        foreach ($entries as $index => $entry) {
            $workDate = $entry->started_at->toDateString();
            $key = "{$entry->user_id}|{$entry->task_id}|{$workDate}";
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            // Two days in five are left blank on purpose, so the missing
            // description state is visible next to the filled one.
            if ($index % 5 >= 3) {
                continue;
            }

            TimesheetDescription::query()->firstOrCreate(
                ['user_id' => $entry->user_id, 'task_id' => $entry->task_id, 'work_date' => $workDate],
                ['body' => $bodies[$index % count($bodies)]],
            );
        }
    }

    /** @param array<string, User> $people */
    private function seedUserSettings(array $people): void
    {
        $overrides = [
            'msantos' => ['daily_target_minutes' => 480, 'row_density' => 'compact', 'start_page' => 'tasks', 'daily_digest' => 'am'],
            'lcruz' => ['auto_start_timer' => true, 'break_reminders' => true, 'timesheet_cutoff' => 'month'],
            'areyes' => ['start_page' => 'oliver', 'notify_email' => true, 'timesheet_date_format' => 'mon'],
            'dvillanueva' => ['row_density' => 'compact', 'timesheet_header_row' => true, 'daily_digest' => 'pm'],
            'tmendoza' => ['daily_target_minutes' => 360, 'weekly_target_minutes' => 1800, 'idle_detection' => true],
        ];

        foreach ($overrides as $username => $values) {
            $user = User::query()->where('username', $username)->first();
            if (! $user) {
                continue;
            }
            UserSetting::query()->updateOrCreate(['user_id' => $user->id], ['values' => $values]);
        }
    }

    /** One invitation in each state the invitations screen can show. */
    private function seedInvitations(): void
    {
        $now = Carbon::now();
        $roles = Role::query()->pluck('id', 'key_name');
        $projectIds = Project::query()->orderBy('id')->pluck('id')->all();

        $definitions = [
            ['new.designer@kernix.example', 'employee_role', 'pending', 5, [0, 2]],
            ['contract.editor@kernix.example', 'employee_role', 'pending', -2, [3]],
            ['second.pm@kernix.example', 'project_management_role', 'accepted', 20, []],
            ['wrong.address@kernix.example', 'employee_role', 'revoked', 10, []],
        ];

        foreach ($definitions as [$email, $roleKey, $state, $daysFromNow, $projectOffsets]) {
            if (! isset($roles[$roleKey])) {
                continue;
            }
            $invitation = UserInvitation::query()->firstOrCreate(
                ['email' => $email],
                [
                    'token_hash' => hash('sha256', 'qc-seed-invitation-'.$email),
                    'role_id' => $roles[$roleKey],
                    'invited_by' => $this->admin->id,
                    'accepted_user_id' => null,
                    'expires_at' => $now->copy()->addDays($daysFromNow),
                    'accepted_at' => $state === 'accepted' ? $now->copy()->subDays(2) : null,
                    'revoked_at' => $state === 'revoked' ? $now->copy()->subDay() : null,
                    'created_at' => $now->copy()->subDays(3),
                    'updated_at' => $now->copy()->subDays(3),
                ],
            );

            foreach ($projectOffsets as $offset) {
                if (! isset($projectIds[$offset])) {
                    continue;
                }
                DB::table('invitation_project')->insertOrIgnore([
                    'user_invitation_id' => $invitation->id,
                    'project_id' => $projectIds[$offset],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    /**
     * Oliver threads, including one where an action was taken and later undone,
     * and one that ended in an error.
     *
     * @param  array<string, User>  $people
     */
    private function seedOliver(array $people): void
    {
        $now = Carbon::now();
        $threads = [
            [
                'user' => 'dvillanueva', 'title' => 'What is overdue this week?', 'days_ago' => 1,
                'messages' => [
                    ['user', "What's overdue right now, and who is it sitting with?", null],
                    ['assistant', "Five tasks are past their due date.\n\nThree are with Maria Santos, one with Liam Cruz, and one is unassigned — \"Resolve font licensing issue\" on Brand Identity Refresh, four days over.\n\nThe unassigned one is the only blocker without an owner.", null],
                    ['user', 'Assign the font licensing one to Rosa.', null],
                    ['assistant', 'Assigned "Resolve font licensing issue" to Rosa Garcia.', 'assign'],
                ],
            ],
            [
                'user' => 'msantos', 'title' => 'My week', 'days_ago' => 3,
                'messages' => [
                    ['user', 'How many hours have I logged this week and against what?', null],
                    ['assistant', "You have logged 21 hours 40 minutes since Monday.\n\nMost of it — about 13 hours — went to the SEO audit report. The rest is split between the checkout link fix and the sitemap work that closed on Tuesday.", null],
                ],
            ],
            [
                'user' => 'jocampo', 'title' => 'Retainer burn', 'days_ago' => 6,
                'messages' => [
                    ['user', 'Which clients are close to burning their retainer?', null],
                    ['assistant', 'I could not finish that one — the analytics request timed out. Try again in a moment.', null],
                ],
                'error_on_last' => 'upstream_timeout',
            ],
        ];

        foreach ($threads as $thread) {
            $user = User::query()->where('username', $thread['user'])->first();
            if (! $user) {
                continue;
            }
            $at = $now->copy()->subDays($thread['days_ago']);
            $conversation = OliverConversation::query()->firstOrCreate(
                ['user_id' => $user->id, 'title' => $thread['title']],
                [
                    'last_message_at' => $at->copy()->addMinutes(count($thread['messages'])),
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );
            if (! $conversation->wasRecentlyCreated) {
                continue;
            }

            $lastIndex = count($thread['messages']) - 1;
            foreach ($thread['messages'] as $index => [$role, $body, $actionType]) {
                $message = OliverMessage::query()->create([
                    'conversation_id' => $conversation->id,
                    'role' => $role,
                    'body' => $body,
                    'actions' => $actionType ? [['type' => $actionType, 'entity_type' => 'Task', 'summary' => 'Assigned "Resolve font licensing issue" to Rosa Garcia.']] : null,
                    'error_code' => ($index === $lastIndex && isset($thread['error_on_last'])) ? $thread['error_on_last'] : null,
                    'created_at' => $at->copy()->addMinutes($index),
                ]);

                if (! $actionType) {
                    continue;
                }
                $task = Task::query()->where('title', 'Resolve font licensing issue')->first();
                $rosa = User::query()->where('username', 'rgarcia')->first();
                if (! $task || ! $rosa) {
                    continue;
                }
                OliverAction::query()->create([
                    'user_id' => $user->id,
                    'message_id' => $message->id,
                    'type' => $actionType,
                    'entity_type' => 'Task',
                    'entity_id' => $task->id,
                    'before' => ['assignee_user_id' => null],
                    'after' => ['assignee_user_id' => $rosa->id],
                    'summary' => 'Assigned "Resolve font licensing issue" to Rosa Garcia.',
                    'created_at' => $at->copy()->addMinutes($index),
                    'updated_at' => $at->copy()->addMinutes($index),
                ]);
            }
        }
    }

    /**
     * The AI project manager surfaces — brief, memory, task generation, usage
     * and cost — are all empty in demo data, which hides four screens.
     *
     * @param  array<string, User>  $people
     */
    private function seedAiProjectManager(array $people): void
    {
        $now = Carbon::now();

        // Feature toggles, so both the enabled and the disabled rendering of
        // each AI panel is reachable.
        Project::query()->whereIn('name', ['Website Relaunch', 'SEO Overhaul', 'App Redesign'])->update([
            'ai_estimate_review_enabled' => true,
            'ai_task_creation_enabled' => true,
            'ai_memory_enabled' => true,
        ]);
        Project::query()->where('name', 'Website Relaunch')->update([
            'ai_estimate_review_rules' => "Approve anything under 30 minutes without asking.\nAlways reject a request that does not name what changed since the estimate.\nScope added by the client after kickoff is a valid reason.",
        ]);

        $briefs = [
            ['Website Relaunch', 'approved', "Northwind's marketing site, rebuilt on the new design system.\n\nThe client cares most about the pricing and case study pages; everything else can ship in the second wave. Beatrice Lim signs off on anything that touches the homepage. Copy changes go through Elias Tan first.\n\nThe cutover happens in a single weekend window, so anything that cannot be rolled back in an hour does not go in that release."],
            ['SEO Overhaul', 'draft', "Twelve-month search programme for Lumen Digital.\n\nThey review overnight Manila time, so a question asked at 5pm gets answered the next morning. Technical fixes come before content — Priya has been clear that briefs written against the old architecture get thrown away."],
            ['App Redesign', 'empty', null],
        ];
        foreach ($briefs as [$projectName, $status, $brief]) {
            $project = Project::query()->where('name', $projectName)->first();
            if (! $project) {
                continue;
            }
            ProjectAiProfile::query()->updateOrCreate(
                ['project_id' => $project->id],
                [
                    'draft_brief' => $status === 'approved' ? null : $brief,
                    'approved_brief' => $status === 'approved' ? $brief : null,
                    'brief_status' => $status,
                    'version' => $status === 'approved' ? 3 : ($status === 'draft' ? 1 : 0),
                    'approved_by' => $status === 'approved' ? $this->admin->id : null,
                    'approved_at' => $status === 'approved' ? $now->copy()->subDays(9) : null,
                ],
            );
        }

        $memories = [
            ['Website Relaunch', 'rule', 'approved', 5, 'Anything touching the homepage needs Beatrice Lim to sign off before it ships.', 'Raised on three separate tasks; the one that skipped it was reverted.', 'Finalize sitemap structure'],
            ['Website Relaunch', 'estimating', 'approved', 4, 'Template work on this project runs about 40% over the first estimate because of the legacy content migration.', 'Five completed tasks averaged 1.4x their estimate.', 'Build homepage hero section'],
            ['Website Relaunch', 'lesson', 'pending', 3, 'The redirect map has to be checked after every migration — dropped rows have caused two separate 404 incidents.', 'Both "Fix broken checkout links" and the earlier pricing incident had the same root cause.', 'Fix broken checkout links'],
            ['Website Relaunch', 'client_preference', 'rejected', 2, 'The client prefers meetings on Friday afternoons.', 'Mentioned once in a note.', null],
            ['SEO Overhaul', 'workflow', 'approved', 4, 'Technical fixes ship before any content brief is written; briefs against the old architecture get discarded.', 'Stated directly by Priya Raman on the kickoff call and repeated in two notes.', 'Draft long-term SEO roadmap'],
            ['SEO Overhaul', 'rule', 'pending', 3, 'Questions asked after 5pm Manila time are answered the next morning — do not treat overnight silence as a blocker.', 'Observed across the last six exchanges with the client.', null],
            ['App Redesign', 'lesson', 'archived', 2, 'Simulator passes miss keyboard overlap bugs; onboarding QA has to run on a real device.', 'Found during the batch 2 device pass.', 'QA the mobile app redesign flow'],
        ];
        foreach ($memories as [$projectName, $category, $status, $importance, $content, $evidence, $sourceTaskTitle]) {
            $project = Project::query()->where('name', $projectName)->first();
            if (! $project) {
                continue;
            }
            $sourceTask = $sourceTaskTitle ? Task::query()->where('title', $sourceTaskTitle)->first() : null;
            $resolved = in_array($status, ['approved', 'rejected', 'archived'], true);

            ProjectMemoryEntry::query()->firstOrCreate(
                ['project_id' => $project->id, 'content_hash' => hash('sha256', mb_strtolower(trim($content)))],
                [
                    'source_task_id' => $sourceTask?->id,
                    'category' => $category,
                    'content' => $content,
                    'evidence' => $evidence,
                    'status' => $status,
                    'importance' => $importance,
                    'proposed_by_type' => 'ai',
                    'reviewed_by' => $resolved ? $this->admin->id : null,
                    'reviewed_at' => $resolved ? $now->copy()->subDays(4) : null,
                    'rejection_reason' => $status === 'rejected' ? 'Mentioned once in passing; not a standing preference.' : null,
                    'created_at' => $now->copy()->subDays(7),
                    'updated_at' => $now->copy()->subDays($resolved ? 4 : 7),
                ],
            );
        }

        $generations = [
            ['Website Relaunch', 'dvillanueva', 'created', 'Break down the launch weekend: DNS cutover, smoke tests, and the rollback plan.', 0, 'Created 6 tasks in Launch.', 2],
            ['App Redesign', 'jocampo', 'needs_input', 'Plan the account screens.', 1, null, 1],
            ['SEO Overhaul', 'dvillanueva', 'undone', 'Generate twelve monthly content briefs.', 0, 'Created 12 tasks; undone by Diego Villanueva.', 5],
        ];
        foreach ($generations as [$projectName, $username, $status, $prompt, $rounds, $summary, $daysAgo]) {
            $project = Project::query()->where('name', $projectName)->first();
            $requester = User::query()->where('username', $username)->first();
            if (! $project || ! $requester) {
                continue;
            }
            $at = $now->copy()->subDays($daysAgo);
            AiTaskGeneration::query()->firstOrCreate(
                ['project_id' => $project->id, 'initial_prompt' => $prompt],
                [
                    'requested_by' => $requester->id,
                    'status' => $status,
                    'clarification_rounds' => $rounds,
                    'result_summary' => $summary,
                    'undo_expires_at' => $status === 'created' ? $at->copy()->addMinutes(30) : null,
                    'created_at' => $at,
                    'updated_at' => $at,
                ],
            );
        }

        // Usage and cost, so the AI spend panel is not a row of zeroes.
        $usage = [
            ['estimate_review', 'Website Relaunch', 'dvillanueva', 'TaskEstimateRequest', 'anthropic/claude-sonnet-4', 3200, 480, 0.01344, 'succeeded', 6],
            ['estimate_review', 'App Redesign', 'jocampo', 'TaskEstimateRequest', 'anthropic/claude-sonnet-4', 2900, 410, 0.01203, 'succeeded', 3],
            ['completion_audit', 'Product Launch Video', 'sramirez', 'TaskCompletionProof', 'anthropic/claude-sonnet-4', 4100, 620, 0.01722, 'succeeded', 5],
            ['task_creation', 'Website Relaunch', 'dvillanueva', 'AiTaskGeneration', 'anthropic/claude-opus-4', 5600, 1900, 0.09750, 'succeeded', 2],
            ['task_creation', 'SEO Overhaul', 'dvillanueva', 'AiTaskGeneration', 'anthropic/claude-opus-4', 6100, 2400, 0.11550, 'succeeded', 5],
            ['project_memory', 'Website Relaunch', null, 'ProjectMemoryLearningRun', 'anthropic/claude-sonnet-4', 7800, 900, 0.02754, 'succeeded', 7],
            ['oliver', 'SEO Overhaul', 'jocampo', 'OliverConversation', 'anthropic/claude-sonnet-4', 2200, 0, 0.00660, 'failed', 6],
            ['oliver', null, 'msantos', 'OliverConversation', 'anthropic/claude-sonnet-4', 3400, 520, 0.01452, 'succeeded', 3],
        ];
        foreach ($usage as [$feature, $projectName, $username, $sourceType, $model, $promptTokens, $completionTokens, $cost, $status, $daysAgo]) {
            $project = $projectName ? Project::query()->where('name', $projectName)->first() : null;
            $user = $username ? User::query()->where('username', $username)->first() : null;
            // Keyed on the generation id, not on the timestamp: `now()` moves
            // between runs and would insert a second copy of every event.
            $at = Carbon::today()->subDays($daysAgo)->setTime(11, 20);
            AiUsageEvent::query()->firstOrCreate(
                ['external_generation_id' => 'gen-qc-'.$feature.'-'.$daysAgo],
                [
                    'feature' => $feature,
                    'source_type' => $sourceType,
                    'created_at' => $at,
                    'project_id' => $project?->id,
                    'user_id' => $user?->id,
                    'model' => $model,
                    'prompt_tokens' => $promptTokens,
                    'completion_tokens' => $completionTokens,
                    'total_tokens' => $promptTokens + $completionTokens,
                    'cost_usd' => $cost,
                    'status' => $status,
                    'updated_at' => $at,
                ],
            );
        }
    }

    /**
     * The activity feed on the dashboard reads from the audit log, which the
     * demo seeder never writes to.
     *
     * @param  array<string, User>  $people
     */
    private function seedAuditTrail(array $people): void
    {
        $now = Carbon::now();
        $entries = [
            ['dvillanueva', 'task.create', 'Task', 'Build homepage hero section', 'Created task "Build homepage hero section"', 8],
            ['msantos', 'task.status_change', 'Task', 'Fix broken checkout links', 'Moved "Fix broken checkout links" to In Progress', 6],
            ['dvillanueva', 'task.assign', 'Task', 'Submit SEO audit report', 'Assigned "Submit SEO audit report" to Maria Santos', 6],
            ['admin', 'client.update', 'Client', null, 'Updated retainer for Ironclad Media to 100 hours', 5],
            ['jocampo', 'project.update', 'Project', null, 'Put Brand Identity Refresh on hold', 5],
            ['lcruz', 'task.complete', 'Task', 'Finalize sitemap structure', 'Completed "Finalize sitemap structure"', 4],
            ['dvillanueva', 'estimate.approve', 'Task', 'Submit SEO audit report', 'Approved 60 extra minutes on "Submit SEO audit report"', 4],
            ['admin', 'user.invite', 'User', null, 'Invited new.designer@kernix.example as Employee Role', 3],
            ['areyes', 'task.status_change', 'Task', 'QA the mobile app redesign flow', 'Moved "QA the mobile app redesign flow" to Quality Check', 2],
            ['admin', 'settings.update', 'SystemSetting', null, 'Changed the default timezone to Asia/Manila', 2],
            ['jocampo', 'form.create', 'ProjectForm', null, 'Published the bug report form for Website Relaunch', 1],
            ['msantos', 'submission.decline', 'FormSubmission', null, 'Declined submission from an anonymous reporter', 1],
        ];

        foreach ($entries as [$username, $action, $entityType, $taskTitle, $summary, $daysAgo]) {
            $user = User::query()->where('username', $username)->first();
            $entityId = $taskTitle ? Task::query()->where('title', $taskTitle)->value('id') : null;
            $at = $now->copy()->subDays($daysAgo)->setTime(10 + ($daysAgo % 6), 15);

            AuditLog::query()->firstOrCreate(
                ['action' => $action, 'summary' => $summary],
                [
                    'user_id' => $user?->id,
                    'entity_type' => $entityType,
                    'entity_id' => $entityId,
                    'changes_json' => null,
                    'ip_address' => '203.0.113.'.(20 + $daysAgo),
                    'user_agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
                    'created_at' => $at,
                ],
            );
        }
    }

    /**
     * Real bytes for attachment rows. Images are drawn rather than embedded so
     * a preview shows something recognisable at thumbnail size; without GD a
     * one-pixel PNG still keeps the download path honest.
     */
    private function fileContents(string $mime, string $name): string
    {
        if ($mime === 'image/png') {
            return $this->pngContents($name);
        }
        if ($mime === 'text/csv') {
            return "old_path,new_path,status\n/checkout-v1/starter,/checkout/starter,restored\n/checkout-v1/team,/checkout/team,restored\n/checkout-v1/legacy,,plan retired\n";
        }

        return "QC seed file: {$name}\n\nThis file exists so the attachment row it belongs to has real bytes behind it and the download path can be checked.\n";
    }

    private function pngContents(string $name): string
    {
        if (! function_exists('imagecreatetruecolor')) {
            // 1x1 transparent PNG.
            return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        }

        $image = imagecreatetruecolor(640, 360);
        $background = imagecolorallocate($image, 24, 24, 32);
        $foreground = imagecolorallocate($image, 226, 226, 236);
        $accent = imagecolorallocate($image, 138, 92, 246);
        imagefilledrectangle($image, 0, 0, 640, 360, $background);
        imagefilledrectangle($image, 0, 0, 640, 8, $accent);
        imagestring($image, 5, 24, 160, 'Kernix QC seed', $foreground);
        imagestring($image, 3, 24, 190, $name, $foreground);

        ob_start();
        imagepng($image);
        $contents = (string) ob_get_clean();
        imagedestroy($image);

        return $contents;
    }

    private function fieldValueId(string $fieldKey, string $valueKey): int
    {
        $cacheKey = "{$fieldKey}.{$valueKey}";
        if (isset($this->statuses[$cacheKey])) {
            return $this->statuses[$cacheKey];
        }

        $id = FieldValue::query()
            ->where('key_name', $valueKey)
            ->whereHas('field', fn ($field) => $field->where('key_name', $fieldKey))
            ->value('id');

        if (! $id) {
            throw new LogicException("Missing field value {$fieldKey}.{$valueKey}; run the default seed before QcDataSeeder.");
        }

        return $this->statuses[$cacheKey] = (int) $id;
    }
}
