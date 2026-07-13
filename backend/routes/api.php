<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BootstrapController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ExtensionController;
use App\Http\Controllers\Api\ExtensionPairingController;
use App\Http\Controllers\Api\FieldController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\TaskEmailController;
use App\Http\Controllers\Api\TaskNoteController;
use App\Http\Controllers\Api\TaskSubtaskController;
use App\Http\Controllers\Api\TimeController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/extension/pairings/exchange', [ExtensionPairingController::class, 'exchange'])
    ->middleware('throttle:5,1');

Route::middleware(['auth:sanctum', 'active', 'workspace.timezone', 'web-api'])->group(function () {
    Route::post('/extension/pairings', [ExtensionPairingController::class, 'store']);
    Route::get('/extension/devices', [ExtensionPairingController::class, 'devices']);
    Route::delete('/extension/devices/{token}', [ExtensionPairingController::class, 'destroyDevice']);

    Route::get('/user', [AuthController::class, 'user']);
    Route::patch('/user', [ProfileController::class, 'update']);
    Route::get('/profile', [ProfileController::class, 'show']);
    Route::patch('/profile', [ProfileController::class, 'update']);
    Route::get('/bootstrap', BootstrapController::class);
    Route::get('/dashboard', DashboardController::class);
    Route::get('/analytics', AnalyticsController::class);

    Route::get('/settings/context', [SettingsController::class, 'context']);
    Route::get('/settings', [SettingsController::class, 'show']);
    Route::patch('/settings', [SettingsController::class, 'update']);
    Route::patch('/settings/{section}', [SettingsController::class, 'update'])->whereIn('section', ['system', 'smtp', 'storage']);

    Route::get('/time', [TimeController::class, 'status']);
    Route::post('/time/clock-in', [TimeController::class, 'clockIn']);
    Route::post('/time/clock-out', [TimeController::class, 'clockOut']);
    Route::post('/time/break-start', [TimeController::class, 'breakStart']);
    Route::post('/time/break-end', [TimeController::class, 'breakEnd']);
    Route::get('/time/clocked-users', [TimeController::class, 'clockedUsers']);
    Route::get('/time/summary', [TimeController::class, 'summary']);

    Route::get('/messages/unread-count', [MessageController::class, 'unreadCount']);
    Route::post('/messages/mark-all-read', [MessageController::class, 'markAllRead']);
    Route::get('/messages', [MessageController::class, 'index']);
    Route::get('/messages/{message}', [MessageController::class, 'show']);
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
    Route::apiResource('projects', ProjectController::class)->except(['destroy']);

    Route::post('/tasks/{task}/archive', [TaskController::class, 'archive']);
    Route::post('/tasks/{task}/restore', [TaskController::class, 'restore']);
    Route::get('/tasks/{task}/activity', [TaskController::class, 'activity']);
    Route::post('/tasks/{task}/notes', [TaskNoteController::class, 'store']);
    Route::patch('/tasks/{task}/notes/{note}', [TaskNoteController::class, 'update']);
    Route::delete('/tasks/{task}/notes/{note}', [TaskNoteController::class, 'destroy']);
    Route::post('/tasks/{task}/subtasks', [TaskSubtaskController::class, 'store']);
    Route::patch('/tasks/{task}/subtasks/{subtask}', [TaskSubtaskController::class, 'update']);
    Route::patch('/tasks/{task}/subtasks/{subtask}/complete', [TaskSubtaskController::class, 'complete']);
    Route::delete('/tasks/{task}/subtasks/{subtask}', [TaskSubtaskController::class, 'destroy']);
    Route::get('/tasks/{task}/emails', [TaskEmailController::class, 'index']);
    Route::post('/tasks/{task}/emails', [TaskEmailController::class, 'store']);
    Route::get('/tasks/{task}/emails/{email}', [TaskEmailController::class, 'show']);
    Route::delete('/tasks/{task}/emails/{email}', [TaskEmailController::class, 'destroy']);
    Route::apiResource('tasks', TaskController::class)->except(['destroy']);

    Route::post('/users/{user}/archive', [UserController::class, 'archive']);
    Route::post('/users/{user}/restore', [UserController::class, 'restore']);
    Route::apiResource('users', UserController::class)->except(['destroy']);

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
