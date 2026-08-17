<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Contact;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeSession;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Models\Workspace;
use App\Services\WhatsAppConversationAnalyst;
use App\Support\TaskStatuses;
use App\Support\WorkspaceFeatures;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * One WhatsApp account, three audiences.
 *
 * The properties worth pinning are the boundaries, not the happy path: a number
 * nobody recognises gets no answer at all; a client can cause work to be raised
 * but can never run a command; a group is silent until it is addressed; and an
 * employee reaching in from their phone gets exactly their own permissions and
 * the same clock rules as the web client.
 */
class WhatsAppIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-whatsapp-bridge-token';

    private const STAFF_JID = '639170000001@s.whatsapp.net';

    private const CLIENT_JID = '639170000002@s.whatsapp.net';

    private const STRANGER_JID = '639170000009@s.whatsapp.net';

    private const GROUP_JID = '120363000000000001@g.us';

    private User $staff;

    private User $manager;

    private Client $client;

    private Contact $contact;

    private Project $project;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();

        config()->set('services.whatsapp.url', 'http://whatsapp.test');
        config()->set('services.whatsapp.token', self::TOKEN);
        config()->set('services.whatsapp.trigger', 'kernix');
        config()->set('services.whatsapp.country_code', '63');

        Http::preventStrayRequests();
        Http::fake([
            'http://whatsapp.test/send' => Http::response(['wa_message_id' => 'wamid.TEST']),
            'http://whatsapp.test/status' => Http::response([
                'state' => 'open',
                'jid' => '639170000000@s.whatsapp.net',
                'qr' => null,
                'last_error' => null,
                'connected_at' => '2026-08-18T09:00:00+08:00',
            ]),
            'http://whatsapp.test/pair' => Http::response([
                'state' => 'awaiting_scan', 'jid' => null, 'qr' => 'data:image/png;base64,AAA',
                'last_error' => null, 'connected_at' => null,
            ]),
        ]);

        Workspace::query()->update([WorkspaceFeatures::enabledColumn(WorkspaceFeatures::WHATSAPP) => true]);

        $admin = User::query()->findOrFail(1);
        $this->manager = User::factory()->create([
            'role_id' => $this->roleFor(['tasks.assign', 'tasks.create', 'messages.view'])->id,
            'first_name' => 'Dana',
            'last_name' => 'Reyes',
            'phone_1' => '0917 000 0003',
        ]);
        $this->staff = User::factory()->create([
            'role_id' => $this->roleFor(['time.track', 'tasks.comment', 'tasks.log_time', 'tasks.create', 'tasks.assign', 'messages.view'])->id,
            'first_name' => 'Ana',
            'last_name' => 'Cruz',
            // Written the local way on purpose: the same number as STAFF_JID.
            'phone_1' => '0917 000 0001',
        ]);

        $this->client = Client::query()->create(['name' => 'Northwind', 'created_by' => $admin->id]);
        $this->contact = Contact::query()->create([
            'client_id' => $this->client->id,
            'first_name' => 'Bea',
            'last_name' => 'Santos',
            'phone_1' => '+63 917 000 0002',
            'created_by' => $admin->id,
        ]);
        $this->project = Project::query()->create([
            'client_id' => $this->client->id,
            'name' => 'Northwind app',
            'manager_user_id' => $this->manager->id,
            'created_by' => $admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $this->project->id,
            'title' => 'Ship the pricing page',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'assignee_user_id' => $this->staff->id,
            'created_by' => $admin->id,
        ]);
    }

    // --- who is talking -----------------------------------------------------

    public function test_the_inbound_endpoint_refuses_a_caller_without_the_shared_secret(): void
    {
        $this->postJson('/api/whatsapp/inbound', ['jid' => self::STAFF_JID, 'text' => 'in'])->assertStatus(401);
        $this->withToken('not-the-token')
            ->postJson('/api/whatsapp/inbound', ['jid' => self::STAFF_JID, 'text' => 'in'])
            ->assertStatus(401);

        $this->assertSame(0, WhatsAppMessage::query()->count());
    }

    public function test_a_number_nobody_recognises_is_logged_and_never_answered(): void
    {
        $this->inbound(self::STRANGER_JID, 'hello?')
            ->assertOk()
            ->assertJsonPath('data.reason', 'unknown_sender');

        $logged = WhatsAppMessage::query()->withoutGlobalScope('workspace')->sole();
        $this->assertSame('ignored', $logged->status);
        $this->assertNull($logged->user_id);
        Http::assertNothingSent();
    }

    public function test_an_employee_is_recognised_from_the_number_on_their_record(): void
    {
        $this->inbound(self::STAFF_JID, 'in')->assertJsonPath('data.handled', true);

        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->where('jid', self::STAFF_JID)->sole();
        $this->assertSame(WhatsAppChat::STAFF, $chat->audience);
        $this->assertSame((int) $this->staff->id, (int) $chat->user_id);

        $this->assertNotNull(TimeSession::query()->where('user_id', $this->staff->id)->whereNull('clock_out_at')->first());
        $this->assertOutboundContains('Clocked in');
    }

    public function test_an_employee_only_gets_their_own_permissions(): void
    {
        $stranger = User::factory()->create([
            'role_id' => $this->roleFor([])->id,
            'phone_1' => '0917 000 0007',
        ]);

        $this->inbound('639170000007@s.whatsapp.net', 'in');

        $this->assertOutboundContains('does not have permission');
        $this->assertSame(0, TimeSession::query()->where('user_id', $stranger->id)->count());
    }

    public function test_the_clock_gate_still_applies_to_a_note_from_whatsapp(): void
    {
        $this->inbound(self::STAFF_JID, "note {$this->task->id} looked at the invoice");
        $this->assertOutboundContains('Clock in first');
        $this->assertSame(0, TaskNote::query()->where('task_id', $this->task->id)->count());

        $this->inbound(self::STAFF_JID, 'in');
        $this->inbound(self::STAFF_JID, "note {$this->task->id} looked at the invoice");

        $this->assertSame('looked at the invoice', TaskNote::query()->where('task_id', $this->task->id)->sole()->body);
    }

    public function test_the_workspace_switch_stops_inbound_and_outbound(): void
    {
        Workspace::query()->update([WorkspaceFeatures::enabledColumn(WorkspaceFeatures::WHATSAPP) => false]);

        $this->inbound(self::STAFF_JID, 'in')->assertJsonPath('data.reason', 'feature_disabled');
        $this->assertNull(TimeSession::query()->where('user_id', $this->staff->id)->first());
        Http::assertNothingSent();
    }

    // --- group chats --------------------------------------------------------

    public function test_a_group_is_silent_until_it_is_addressed(): void
    {
        $this->inGroup('so are we shipping the pricing page or not', self::STAFF_JID)
            ->assertJsonPath('data.status', 'ignored');

        // Logged all the same: it is the context the assistant reads later.
        $logged = WhatsAppMessage::query()->withoutGlobalScope('workspace')->latest('id')->first();
        $this->assertStringContainsString('shipping the pricing page', (string) $logged->body);
        Http::assertNothingSent();
    }

    public function test_a_group_is_tied_to_a_project_from_inside_the_chat(): void
    {
        $this->inGroup("kernix link project {$this->project->id}", self::STAFF_JID)
            ->assertJsonPath('data.handled', true);

        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->where('jid', self::GROUP_JID)->sole();
        $this->assertSame((int) $this->project->id, (int) $chat->project_id);
        $this->assertSame((int) $this->client->id, (int) $chat->client_id);
        $this->assertOutboundContains('Northwind app');
    }

    public function test_asking_the_group_to_capture_work_raises_the_tasks_the_model_found(): void
    {
        $this->mapGroupToProject();
        $this->fakeAnalyst([
            'intent' => 'create_tasks',
            'summary' => 'Two things were agreed.',
            'reply' => 'Got it — two jobs out of that.',
            'tasks' => [
                ['title' => 'Rework the pricing table copy', 'description' => 'Ana asked for shorter tiers.', 'type' => 'task', 'urgency' => 'normal', 'assignee_name' => 'Ana Cruz', 'due_date' => null, 'estimated_minutes' => 120],
                ['title' => 'Fix the checkout total on mobile', 'description' => 'Reported in the group.', 'type' => 'bug', 'urgency' => 'high', 'assignee_name' => null, 'due_date' => null, 'estimated_minutes' => null],
            ],
        ]);

        $this->inGroup('kernix task', self::STAFF_JID)->assertJsonPath('data.handled', true);

        $tasks = Task::query()->where('project_id', $this->project->id)->whereKeyNot($this->task->id)->get();
        $this->assertCount(2, $tasks);

        $reworked = $tasks->firstWhere('title', 'Rework the pricing table copy');
        // The name in the conversation is matched against real people.
        $this->assertSame((int) $this->staff->id, (int) $reworked->assignee_user_id);
        // Nobody named falls to whoever manages the project, never to nobody.
        $this->assertSame((int) $this->manager->id, (int) $tasks->firstWhere('title', 'Fix the checkout total on mobile')->assignee_user_id);
        // Provenance is on the task itself, not only in a log file.
        $this->assertStringContainsString('Raised from WhatsApp', (string) $reworked->notes()->first()->body);

        $this->assertOutboundContains('Rework the pricing table copy');
    }

    public function test_capturing_work_needs_a_project_and_permission(): void
    {
        // Mapped nowhere yet.
        $this->inGroup('kernix task', self::STAFF_JID);
        $this->assertOutboundContains('which project this chat is about');
        $this->assertSame(1, Task::query()->count());

        $this->mapGroupToProject();
        $outsider = User::factory()->create(['role_id' => $this->roleFor([])->id, 'phone_1' => '0917 000 0008']);
        $this->inGroup('kernix task', '639170000008@s.whatsapp.net');
        $this->assertOutboundContains('does not have permission');
        $this->assertSame(1, Task::query()->count());
        $this->assertNotNull($outsider->fresh());
    }

    public function test_a_client_complaining_in_the_project_group_is_picked_up(): void
    {
        $this->mapGroupToProject();
        $this->fakeAnalyst([
            'intent' => 'create_tasks',
            'summary' => 'The client says exports are broken.',
            'reply' => 'Thanks — raised, and somebody is on it.',
            'tasks' => [[
                'title' => 'CSV export produces an empty file',
                'description' => 'Client reported it in the project group.',
                'type' => 'bug', 'urgency' => 'high', 'assignee_name' => null, 'due_date' => null, 'estimated_minutes' => null,
            ]],
        ]);

        // An unrecognised number in a mapped group is the client on the job.
        $this->inGroup('the export button gives me an empty file again', self::CLIENT_JID);

        $raised = Task::query()->where('title', 'CSV export produces an empty file')->sole();
        $this->assertSame((int) $this->project->id, (int) $raised->project_id);
        $this->assertOutboundContains('raised, and somebody is on it');
    }

    public function test_an_unrecognised_voice_in_an_unmapped_group_is_left_alone(): void
    {
        $this->inGroup('is this the right number for the studio', self::STRANGER_JID)
            ->assertJsonPath('data.reason', 'unknown_sender');

        $this->assertSame(1, Task::query()->count());
        Http::assertNothingSent();
    }

    // --- clients ------------------------------------------------------------

    public function test_a_client_report_becomes_an_assigned_task_and_the_manager_hears_about_it(): void
    {
        $this->fakeAnalyst([
            'intent' => 'create_tasks',
            'summary' => 'Checkout is failing on mobile for the client.',
            'reply' => 'Thanks for flagging that — we have raised it and will come back to you.',
            'tasks' => [[
                'title' => 'Checkout fails on mobile Safari',
                'description' => 'Bea: "cannot pay on my iPhone, spinner never stops".',
                'type' => 'bug', 'urgency' => 'high', 'assignee_name' => null, 'due_date' => null, 'estimated_minutes' => null,
            ]],
        ]);

        $this->inbound(self::CLIENT_JID, 'hi, nobody can pay on iPhone since this morning')
            ->assertOk();

        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->where('jid', self::CLIENT_JID)->sole();
        $this->assertSame(WhatsAppChat::CLIENT, $chat->audience);
        $this->assertSame((int) $this->contact->id, (int) $chat->contact_id);

        $raised = Task::query()->where('title', 'Checkout fails on mobile Safari')->sole();
        $this->assertSame((int) $this->project->id, (int) $raised->project_id);
        $this->assertSame((int) $this->manager->id, (int) $raised->assignee_user_id);

        // The client is answered, and the manager is told in their own chat.
        $this->assertOutboundContains('will come back to you');
        $this->assertOutboundContains('reported something on WhatsApp');
    }

    public function test_a_client_question_is_passed_to_a_person_rather_than_answered(): void
    {
        $this->fakeAnalyst([
            'intent' => 'answer',
            'summary' => 'Client asked what a second language would cost.',
            'reply' => 'Good question — I have passed it to Dana, who will come back to you.',
            'tasks' => [],
        ]);

        $this->inbound(self::CLIENT_JID, 'how much would it be to add Spanish?');

        $this->assertSame(1, Task::query()->count());
        $this->assertOutboundContains('passed it to Dana');
        $this->assertOutboundContains('needs a person');
    }

    public function test_nothing_a_client_types_is_ever_a_command(): void
    {
        $this->fakeAnalyst(['intent' => 'none', 'summary' => '', 'reply' => '', 'tasks' => []]);

        $this->inbound(self::CLIENT_JID, 'kernix in');

        $this->assertSame(0, TimeSession::query()->count());
        // Silence: nothing to raise, nothing to answer.
        Http::assertNothingSent();
    }

    // --- scheduled messages -------------------------------------------------

    public function test_due_reminders_go_only_to_people_with_something_due(): void
    {
        $this->seenChatFor($this->staff, self::STAFF_JID);
        Task::query()->whereKey($this->task->id)->update(['due_date' => today()->subDay()]);

        $this->artisan('whatsapp:due-reminders')->assertSuccessful();

        $this->assertOutboundContains('Overdue');
        $this->assertOutboundContains('#'.$this->task->id);

        // The manager has nothing assigned and due, so hears nothing.
        $sentTo = WhatsAppMessage::query()->withoutGlobalScope('workspace')
            ->where('direction', WhatsAppMessage::OUTBOUND)->pluck('jid')->unique();
        $this->assertSame([self::STAFF_JID], $sentTo->values()->all());
    }

    public function test_the_client_digest_reports_progress_in_plain_words(): void
    {
        $this->seenChatFor(null, self::CLIENT_JID);
        Task::query()->whereKey($this->task->id)->update(['status_value_id' => TaskStatuses::id(TaskStatuses::COMPLETE)]);

        $this->artisan('whatsapp:client-digest')->assertSuccessful();

        $this->assertOutboundContains('Northwind app — where we are');
        $this->assertOutboundContains('Ship the pricing page');
        // No internal ids in a client's message.
        Http::assertSent(fn ($request) => $request->url() === 'http://whatsapp.test/send'
            && ! str_contains((string) $request['text'], '#'.$this->task->id));
    }

    public function test_the_digest_also_reaches_the_project_group_and_skips_a_muted_chat(): void
    {
        $group = $this->mapGroupToProject();
        Task::query()->whereKey($this->task->id)->update(['status_value_id' => TaskStatuses::id(TaskStatuses::COMPLETE)]);

        $this->artisan('whatsapp:client-digest')->assertSuccessful();
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/send')
            && str_contains((string) $request['text'], 'Northwind app — where we are'));

        $group->forceFill(['muted' => true])->save();
        $this->artisan('whatsapp:client-digest')->assertSuccessful();
        // Still just the one, from before it was muted.
        Http::assertSentCount(1);
    }

    public function test_the_manager_brief_lists_what_slipped_on_their_own_projects(): void
    {
        $this->seenChatFor($this->manager, '639170000003@s.whatsapp.net');
        Task::query()->whereKey($this->task->id)->update(['due_date' => today()->subDays(3)]);

        $this->artisan('whatsapp:manager-brief')->assertSuccessful();

        $this->assertOutboundContains('Your projects this morning');
        $this->assertOutboundContains('Ana Cruz');
    }

    // --- operating it -------------------------------------------------------

    public function test_the_chat_directory_and_the_qr_are_settings_work(): void
    {
        $this->inbound(self::STAFF_JID, 'status');

        $viewer = User::factory()->create(['role_id' => $this->roleFor([])->id]);
        Sanctum::actingAs($viewer);
        $this->getJson('/api/whatsapp/chats')->assertStatus(403);
        $this->postJson('/api/whatsapp/bridge/pair')->assertStatus(403);

        Sanctum::actingAs(User::query()->findOrFail(1));
        $this->getJson('/api/whatsapp/chats')
            ->assertOk()
            ->assertJsonPath('data.0.audience', WhatsAppChat::STAFF);
        $this->postJson('/api/whatsapp/bridge/pair')
            ->assertOk()
            ->assertJsonPath('data.qr', 'data:image/png;base64,AAA');
    }

    public function test_an_operator_can_point_a_chat_at_a_project_and_stop_it_acting(): void
    {
        $this->inGroup('anything at all', self::STAFF_JID);
        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->where('jid', self::GROUP_JID)->sole();

        Sanctum::actingAs(User::query()->findOrFail(1));
        $this->patchJson("/api/whatsapp/chats/{$chat->id}", [
            'project_id' => $this->project->id,
            'intake_enabled' => false,
        ])->assertOk()->assertJsonPath('data.intake_enabled', false);

        $this->inGroup('kernix task', self::STAFF_JID);
        $this->assertOutboundContains('switched off');
    }

    public function test_a_failed_send_is_recorded_on_the_message(): void
    {
        $this->seenChatFor($this->staff, self::STAFF_JID);
        // A separate host, because an added stub never overrides one already
        // registered for the same URL.
        config()->set('services.whatsapp.url', 'http://whatsapp-down.test');
        Http::fake(['http://whatsapp-down.test/send' => Http::response(['message' => 'not linked'], 409)]);

        TaskNote::query()->create([
            'task_id' => $this->task->id,
            'body' => 'Ping',
            'assigned_user_id' => $this->staff->id,
            'created_by' => $this->manager->id,
            'is_message' => true,
        ]);

        $message = WhatsAppMessage::query()->withoutGlobalScope('workspace')
            ->where('direction', WhatsAppMessage::OUTBOUND)->latest('id')->sole();
        $this->assertSame('failed', $message->status);
        $this->assertNotNull($message->error);
    }

    // --- helpers -----------------------------------------------------------

    private function inbound(string $jid, string $text): TestResponse
    {
        return $this->withToken(self::TOKEN)->postJson('/api/whatsapp/inbound', [
            'jid' => $jid,
            'sender_jid' => $jid,
            'text' => $text,
            'wa_message_id' => 'wamid.'.mb_substr(md5($jid.$text), 0, 10),
        ]);
    }

    private function inGroup(string $text, string $senderJid): TestResponse
    {
        return $this->withToken(self::TOKEN)->postJson('/api/whatsapp/inbound', [
            'jid' => self::GROUP_JID,
            'sender_jid' => $senderJid,
            'chat_subject' => 'Northwind build',
            'text' => $text,
            'is_group' => true,
            'wa_message_id' => 'wamid.'.mb_substr(md5($text.$senderJid), 0, 10),
        ]);
    }

    private function mapGroupToProject(): WhatsAppChat
    {
        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->firstOrNew(['jid' => self::GROUP_JID]);
        $chat->fill([
            'kind' => WhatsAppChat::GROUP,
            'audience' => WhatsAppChat::UNKNOWN,
            'subject' => 'Northwind build',
            'project_id' => $this->project->id,
            'client_id' => $this->client->id,
            'workspace_id' => $this->project->workspace_id,
            'intake_enabled' => true,
            'muted' => false,
        ])->save();

        return $chat->refresh();
    }

    /** A chat the account has already spoken to, which is what the schedules act on. */
    private function seenChatFor(?User $user, string $jid): WhatsAppChat
    {
        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->firstOrNew(['jid' => $jid]);
        $chat->fill([
            'kind' => WhatsAppChat::DIRECT,
            'audience' => $user ? WhatsAppChat::STAFF : WhatsAppChat::CLIENT,
            'user_id' => $user?->id,
            'contact_id' => $user ? null : $this->contact->id,
            'client_id' => $user ? null : $this->client->id,
            'project_id' => $user ? null : $this->project->id,
            'workspace_id' => $this->project->workspace_id,
            'subject' => $user ? trim($user->first_name.' '.$user->last_name) : 'Bea Santos',
            'intake_enabled' => true,
            'muted' => false,
            'last_inbound_at' => now(),
        ])->save();

        return $chat->refresh();
    }

    /**
     * The model is not what is under test here — what the app does with its answer
     * is, so the answer is fixed.
     *
     * @param  array{intent: string, summary: string, reply: string, tasks: array<int, array<string, mixed>>}  $result
     */
    private function fakeAnalyst(array $result): void
    {
        $this->mock(WhatsAppConversationAnalyst::class, function ($mock) use ($result) {
            $mock->shouldReceive('available')->andReturn(true);
            $mock->shouldReceive('read')->andReturn($result);
        });
    }

    private function assertOutboundContains(string $needle): void
    {
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/send')
            && str_contains((string) $request['text'], $needle));
    }

    /**
     * @param  array<int, string>  $permissions
     */
    private function roleFor(array $permissions): Role
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "WhatsApp role {$this->roleSequence}",
            'key_name' => "whatsapp_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique(['dashboard.view', 'tasks.view', ...$permissions]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));

        return $role;
    }
}
