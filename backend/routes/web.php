<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\InvitationAcceptanceController;
use App\Http\Controllers\Api\RegistrationController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
// Public by necessity, so it is rate limited harder than login.
Route::post('/register', [RegistrationController::class, 'store'])->middleware('throttle:5,1');
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');

Route::get('/api/invitations/{token}', [InvitationAcceptanceController::class, 'preview'])
    ->where('token', '[A-Fa-f0-9]{64}')
    ->middleware('throttle:30,1');
Route::post('/api/invitations/{token}/accept', [InvitationAcceptanceController::class, 'accept'])
    ->where('token', '[A-Fa-f0-9]{64}')
    ->middleware('throttle:5,1');
