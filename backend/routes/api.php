<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AiTaskGenerationController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AvatarController;
use App\Http\Controllers\Api\BootstrapController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ExtensionController;
use App\Http\Controllers\Api\ExtensionPairingController;
use App\Http\Controllers\Api\FieldController;
use App\Http\Controllers\Api\InvitationAcceptanceController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\OliverController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\ProjectMemoryController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\TaskAttachmentController;
use App\Http\Controllers\Api\TaskCompletionProofController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\TaskEmailController;
use App\Http\Controllers\Api\TaskEstimateRequestController;
use App\Http\Controllers\Api\TaskFolderController;
use App\Http\Controllers\Api\TaskNoteController;
use App\Http\Controllers\Api\TaskSubtaskController;
use App\Http\Controllers\Api\TaskWorkRequestController;
use App\Http\Controllers\Api\TimeController;
use App\Http\Controllers\Api\TimerController;
use App\Http\Controllers\Api\TimesheetController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\UserSettingsController;
use App\Http\Controllers\Api\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::post('/extension/pairings/exchange', [ExtensionPairingController::class, 'exchange'])
    ->middleware('throttle:5,1');

Route::get('/invitations/{token}', [InvitationAcceptanceController::class, 'preview'])
    ->where('token', '[A-Fa-f0-9]{64}')
    ->middleware('throttle:30,1');
Route::post('/invitations/{token}/accept', [InvitationAcceptanceController::class, 'accept'])
    ->where('token', '[A-Fa-f0-9]{64}')
    ->middleware('throttle:5,1');

Route::middleware(['auth:sanctum', 'active', 'workspace.timezone', 'web-api'])->group(function () {
    Route::post('/extension/pairings', [ExtensionPairingController::class, 'store']);
    Route::get('/extension/devices', [ExtensionPairingController::class, 'devices']);
    Route::delete('/extension/devices/{token}', [ExtensionPairingController::class, 'destroyDevice']);

    Route::get('/user', [AuthController::class, 'user']);
    Route::patch('/user', [ProfileController::class, 'update']);
    Route::get('/profile', [ProfileController::class, 'show']);
    Route::patch('/profile', [ProfileController::class, 'update']);
    Route::post('/profile/avatar', [AvatarController::class, 'storeOwn']);
    Route::delete('/profile/avatar', [AvatarController::class, 'destroyOwn']);
    Route::get('/bootstrap', BootstrapController::class);
    Route::get('/dashboard', DashboardController::class);
    Route::get('/analytics', AnalyticsController::class);

    Route::get('/settings/context', [SettingsController::class, 'context']);
    Route::get('/settings', [SettingsController::class, 'show']);
    Route::patch('/settings', [SettingsController::class, 'update']);
    Route::patch('/settings/{section}', [SettingsController::class, 'update'])->whereIn('section', ['system', 'smtp', 'storage', 'ai']);
    Route::post('/settings/ai/test', [SettingsController::class, 'testAi']);

    // Personal preferences, distinct from the workspace settings above.
    Route::get('/me/settings', [UserSettingsController::class, 'show']);
    Route::patch('/me/settings', [UserSettingsController::class, 'update']);

    Route::get('/time', [TimeController::class, 'status']);
    Route::post('/time/clock-in', [TimeController::class, 'clockIn']);
    Route::post('/time/clock-out', [TimeController::class, 'clockOut']);
    Route::post('/time/break-start', [TimeController::class, 'breakStart']);
    Route::post('/time/break-end', [TimeController::class, 'breakEnd']);
    Route::get('/time/timer', [TimerController::class, 'status']);
    Route::post('/time/timer/start', [TimerController::class, 'start']);
    Route::post('/time/timer/break', [TimerController::class, 'break']);
    Route::post('/time/timer/resume', [TimerController::class, 'resume']);
    Route::post('/time/timer/stop', [TimerController::class, 'stop']);
    Route::get('/time/clocked-users', [TimeController::class, 'clockedUsers']);
    Route::get('/time/summary', [TimeController::class, 'summary']);
    Route::get('/timesheet', [TimesheetController::class, 'index']);
    Route::put('/timesheet/description', [TimesheetController::class, 'updateDescription']);

    Route::get('/messages/unread-count', [MessageController::class, 'unreadCount']);
    Route::post('/messages/mark-all-read', [MessageController::class, 'markAllRead']);
    Route::get('/messages/recipients', [MessageController::class, 'recipients']);
    Route::get('/messages', [MessageController::class, 'index']);
    Route::post('/messages', [MessageController::class, 'store']);
    Route::get('/messages/{message}', [MessageController::class, 'show']);
    Route::post('/messages/{message}/replies', [MessageController::class, 'reply']);
    Route::patch('/messages/{message}/read', [MessageController::class, 'read']);
    Route::patch('/messages/{message}/unread', [MessageController::class, 'unread']);

    Route::post('/clients/{client}/archive', [ClientController::class, 'archive']);
    Route::post('/clients/{client}/restore', [ClientController::class, 'restore']);
    Route::apiResource('clients', ClientController::class)->except(['destroy']);
    Route::post('/contacts/{contact}/archive', [ContactController::class, 'archive']);
    Route::post('/contacts/{contact}/restore', [ContactController::class, 'restore']);
    Route::apiResource('contacts', ContactController::class)->except(['destroy']);
    Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
    Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
    Route::post('/projects/{project}/ai-task-generations', [AiTaskGenerationController::class, 'store']);
    Route::get('/ai-task-generations/{generation}', [AiTaskGenerationController::class, 'show']);
    Route::post('/ai-task-generations/{generation}/messages', [AiTaskGenerationController::class, 'reply']);
    Route::post('/ai-task-generations/{generation}/undo', [AiTaskGenerationController::class, 'undo']);
    Route::get('/projects/{project}/ai-memory', [ProjectMemoryController::class, 'show']);
    Route::post('/projects/{project}/ai-memory/brief-draft', [ProjectMemoryController::class, 'draftBrief']);
    Route::patch('/projects/{project}/ai-memory/brief', [ProjectMemoryController::class, 'updateBrief']);
    Route::patch('/projects/{project}/ai-memory/entries/{entry}', [ProjectMemoryController::class, 'updateEntry']);
    Route::scopeBindings()->group(function () {
        Route::get('/projects/{project}/task-folders', [TaskFolderController::class, 'index']);
        Route::post('/projects/{project}/task-folders', [TaskFolderController::class, 'store']);
        Route::patch('/projects/{project}/task-folders/{taskFolder}', [TaskFolderController::class, 'update']);
        Route::delete('/projects/{project}/task-folders/{taskFolder}', [TaskFolderController::class, 'destroy']);
    });
    Route::apiResource('projects', ProjectController::class)->except(['destroy']);

    Route::post('/tasks/{task}/archive', [TaskController::class, 'archive']);
    Route::post('/tasks/{task}/restore', [TaskController::class, 'restore']);
    Route::get('/tasks/{task}/activity', [TaskController::class, 'activity']);
    Route::get('/task-work-requests/pending', [TaskWorkRequestController::class, 'pending']);
    Route::get('/tasks/{task}/work-requests', [TaskWorkRequestController::class, 'index']);
    Route::post('/tasks/{task}/work-requests', [TaskWorkRequestController::class, 'store']);
    Route::post('/tasks/{task}/work-requests/{workRequest}/approve', [TaskWorkRequestController::class, 'approve']);
    Route::post('/tasks/{task}/work-requests/{workRequest}/decline', [TaskWorkRequestController::class, 'decline']);
    Route::post('/tasks/{task}/work-requests/{workRequest}/withdraw', [TaskWorkRequestController::class, 'withdraw']);
    Route::get('/tasks/{task}/estimate-requests', [TaskEstimateRequestController::class, 'index']);
    Route::post('/tasks/{task}/estimate-requests', [TaskEstimateRequestController::class, 'store']);
    Route::post('/tasks/{task}/estimate-requests/{estimateRequest}/approve', [TaskEstimateRequestController::class, 'approve']);
    Route::post('/tasks/{task}/estimate-requests/{estimateRequest}/reject', [TaskEstimateRequestController::class, 'reject']);
    Route::post('/tasks/{task}/estimate-requests/{estimateRequest}/override', [TaskEstimateRequestController::class, 'override']);
    Route::post('/tasks/{task}/notes', [TaskNoteController::class, 'store']);
    Route::patch('/tasks/{task}/notes/{note}', [TaskNoteController::class, 'update']);
    Route::delete('/tasks/{task}/notes/{note}', [TaskNoteController::class, 'destroy']);
    Route::post('/tasks/{task}/subtasks', [TaskSubtaskController::class, 'store']);
    Route::patch('/tasks/{task}/subtasks/{subtask}', [TaskSubtaskController::class, 'update']);
    Route::patch('/tasks/{task}/subtasks/{subtask}/complete', [TaskSubtaskController::class, 'complete']);
    Route::delete('/tasks/{task}/subtasks/{subtask}', [TaskSubtaskController::class, 'destroy']);
    Route::get('/oliver', [OliverController::class, 'show']);
    Route::post('/oliver/messages', [OliverController::class, 'send']);
    Route::delete('/oliver/messages', [OliverController::class, 'clear']);
    Route::get('/oliver/insights', [OliverController::class, 'insights']);
    Route::get('/oliver/actions', [OliverController::class, 'actions']);
    Route::post('/oliver/actions/{action}/undo', [OliverController::class, 'undo']);
    Route::get('/workspaces', [WorkspaceController::class, 'index']);
    Route::post('/workspaces', [WorkspaceController::class, 'store']);
    Route::patch('/workspaces/{workspace}', [WorkspaceController::class, 'update']);
    Route::post('/workspaces/{workspace}/activate', [WorkspaceController::class, 'activate']);
    Route::get('/workspaces/{workspace}/members', [WorkspaceController::class, 'members']);
    Route::post('/workspaces/{workspace}/members', [WorkspaceController::class, 'addMember']);
    Route::delete('/workspaces/{workspace}/members/{user}', [WorkspaceController::class, 'removeMember']);
    Route::get('/tasks/{task}/completion-proofs', [TaskCompletionProofController::class, 'index']);
    Route::post('/tasks/{task}/completion-proofs', [TaskCompletionProofController::class, 'store']);
    Route::post('/tasks/{task}/completion-proofs/{proof}/approve', [TaskCompletionProofController::class, 'approve']);
    Route::post('/tasks/{task}/completion-proofs/{proof}/reject', [TaskCompletionProofController::class, 'reject']);
    Route::get('/tasks/{task}/attachments', [TaskAttachmentController::class, 'index']);
    Route::post('/tasks/{task}/attachments', [TaskAttachmentController::class, 'store']);
    Route::get('/tasks/{task}/attachments/{attachment}', [TaskAttachmentController::class, 'show']);
    Route::delete('/tasks/{task}/attachments/{attachment}', [TaskAttachmentController::class, 'destroy']);
    Route::get('/tasks/{task}/emails', [TaskEmailController::class, 'index']);
    Route::post('/tasks/{task}/emails', [TaskEmailController::class, 'store']);
    Route::get('/tasks/{task}/emails/{email}', [TaskEmailController::class, 'show']);
    Route::delete('/tasks/{task}/emails/{email}', [TaskEmailController::class, 'destroy']);
    Route::apiResource('tasks', TaskController::class);

    // Any signed-in person may read a colleague's picture; changing someone
    // else's is gated on users.edit inside the controller.
    Route::get('/users/{user}/avatar', [AvatarController::class, 'show']);
    Route::post('/users/{user}/avatar', [AvatarController::class, 'store']);
    Route::delete('/users/{user}/avatar', [AvatarController::class, 'destroy']);
    Route::post('/users/{user}/archive', [UserController::class, 'archive']);
    Route::post('/users/{user}/restore', [UserController::class, 'restore']);
    Route::apiResource('users', UserController::class)->except(['destroy']);

    Route::get('/invitations', [InvitationController::class, 'index']);
    Route::post('/invitations', [InvitationController::class, 'store']);
    Route::post('/invitations/{invitation}/revoke', [InvitationController::class, 'revoke'])
        ->whereNumber('invitation');

    Route::get('/roles/permissions', [RoleController::class, 'permissions']);
    Route::apiResource('roles', RoleController::class);

    Route::post('/fields/{field}/values', [FieldController::class, 'storeValue']);
    Route::patch('/fields/{field}/values/{value}', [FieldController::class, 'updateValue']);
    Route::delete('/fields/{field}/values/{value}', [FieldController::class, 'destroyValue']);
    Route::apiResource('fields', FieldController::class);
});

Route::prefix('extension')->middleware([
    'auth:sanctum', 'active', 'workspace.timezone', 'abilities:extension-api',
])->group(function () {
    Route::get('/bootstrap', [ExtensionController::class, 'bootstrap']);
    Route::get('/tasks', [ExtensionController::class, 'tasks']);
    Route::patch('/tasks/{task}/status', [ExtensionController::class, 'updateStatus']);
    Route::post('/tasks/{task}/notes', [ExtensionController::class, 'storeNote']);
    Route::post('/time/{action}', [ExtensionController::class, 'timeAction'])
        ->whereIn('action', ['clock-in', 'clock-out', 'break-start', 'break-end']);
    Route::delete('/session', [ExtensionController::class, 'destroySession']);
});
