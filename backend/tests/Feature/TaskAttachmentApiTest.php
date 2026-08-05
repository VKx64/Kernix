<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskAttachmentApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Task $task;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);

        $client = Client::query()->create(['name' => 'Attachment client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Attachment project',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Task with files',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_files_upload_list_download_and_delete_without_exposing_storage_paths(): void
    {
        $response = $this->post("/api/tasks/{$this->task->id}/attachments", [
            'files' => [
                UploadedFile::fake()->create('storyboard.png', 24, 'image/png'),
                UploadedFile::fake()->create('brief.pdf', 12, 'application/pdf'),
            ],
        ])->assertCreated()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.original_name', 'storyboard.png')
            ->assertJsonPath('data.0.can_preview', true)
            ->assertJsonPath('data.0.uploaded_by.id', $this->admin->id);

        $this->assertArrayNotHasKey('storage_path', $response->json('data.0'));
        $this->assertArrayNotHasKey('file_name', $response->json('data.0'));

        $imageId = $response->json('data.0.id');
        $stored = TaskAttachment::query()->findOrFail($imageId);
        Storage::disk('local')->assertExists($stored->storage_path);

        $this->getJson("/api/tasks/{$this->task->id}/attachments")
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->getJson("/api/tasks/{$this->task->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data.attachments')
            ->assertJsonPath('data.attachments.0.original_name', 'brief.pdf');

        $download = $this->get("/api/tasks/{$this->task->id}/attachments/{$imageId}");
        $download->assertOk();
        $this->assertStringContainsString('attachment;', (string) $download->headers->get('content-disposition'));
        $this->assertSame('nosniff', $download->headers->get('x-content-type-options'));

        $preview = $this->get("/api/tasks/{$this->task->id}/attachments/{$imageId}?inline=1");
        $preview->assertOk();
        $this->assertStringContainsString('inline;', (string) $preview->headers->get('content-disposition'));

        $this->deleteJson("/api/tasks/{$this->task->id}/attachments/{$imageId}")->assertNoContent();
        Storage::disk('local')->assertMissing($stored->storage_path);
        $this->assertSoftDeleted('task_attachments', ['id' => $imageId]);
        $this->getJson("/api/tasks/{$this->task->id}/attachments")->assertOk()->assertJsonCount(1, 'data');

        $this->assertSame(2, AuditLog::query()->where('action', 'task.attachment.create')->count());
        $this->assertSame(1, AuditLog::query()->where('action', 'task.attachment.delete')->count());
    }

    public function test_executables_are_rejected_and_attachments_stay_scoped_to_their_task(): void
    {
        $this->post("/api/tasks/{$this->task->id}/attachments", [
            'files' => [UploadedFile::fake()->create('payload.php', 4, 'text/x-php')],
        ])->assertStatus(422);

        $this->assertSame(0, TaskAttachment::query()->count());

        $otherTask = Task::query()->create([
            'project_id' => $this->task->project_id,
            'title' => 'Unrelated task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $attachment = TaskAttachment::query()->create([
            'task_id' => $this->task->id,
            'original_name' => 'notes.txt',
            'file_name' => 'notes.txt',
            'storage_path' => "task-attachments/{$this->task->id}/notes.txt",
            'mime_type' => 'text/plain',
            'file_size' => 10,
            'uploaded_by' => $this->admin->id,
        ]);

        $this->getJson("/api/tasks/{$otherTask->id}/attachments/{$attachment->id}")->assertNotFound();
        $this->deleteJson("/api/tasks/{$otherTask->id}/attachments/{$attachment->id}")->assertNotFound();
    }

    public function test_uploads_require_an_active_clock_in(): void
    {
        TimeSession::query()->where('user_id', $this->admin->id)->update(['clock_out_at' => now()]);

        $this->post("/api/tasks/{$this->task->id}/attachments", [
            'files' => [UploadedFile::fake()->create('late.png', 8, 'image/png')],
        ])->assertStatus(409)->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        $this->assertSame(0, TaskAttachment::query()->count());
    }
}
