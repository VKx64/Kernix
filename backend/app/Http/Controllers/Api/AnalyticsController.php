<?php

namespace App\Http\Controllers\Api;

use App\Support\SingleClient;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AnalyticsController extends ApiController
{
    public function __invoke(Request $request): JsonResponse
    {
        $this->permission($request, 'analytics.view');
        $range = $request->validate([
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'user_id' => ['sometimes', 'integer', 'exists:users,id'],
        ]);
        $from = Carbon::parse($range['from'] ?? now()->startOfMonth())->startOfDay();
        $to = Carbon::parse($range['to'] ?? now())->endOfDay();
        $base = DB::table('task_notes')
            ->join('tasks', 'tasks.id', '=', 'task_notes.task_id')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->join('clients', 'clients.id', '=', 'projects.client_id')
            ->leftJoin('users', 'users.id', '=', 'task_notes.time_logged_by')
            ->whereNull('task_notes.deleted_at')
            ->where('task_notes.time_minutes', '>', 0)
            ->whereBetween('task_notes.created_at', [$from, $to]);
        if (isset($range['user_id'])) {
            $base->where('task_notes.time_logged_by', $range['user_id']);
        }
        if (SingleClient::enabled()) {
            $base->where('projects.client_id', SingleClient::id() ?? 0);
        }

        $total = (int) (clone $base)->sum('task_notes.time_minutes');
        $count = (int) (clone $base)->count('task_notes.id');
        $entries = (clone $base)->orderByDesc('task_notes.created_at')->limit(200)->get([
            'task_notes.id', 'task_notes.task_id', 'tasks.title as task_title', 'projects.name as project_name',
            'clients.name as client_name', 'users.first_name', 'users.last_name', 'users.username',
            'task_notes.time_minutes', 'task_notes.created_at',
        ])->map(fn ($row) => [
            'id' => $row->id, 'task_id' => $row->task_id, 'task_title' => $row->task_title,
            'project_name' => $row->project_name, 'client_name' => $row->client_name,
            'user_name' => trim($row->first_name.' '.$row->last_name) ?: ($row->username ?: 'Unknown'),
            'user' => ['name' => trim($row->first_name.' '.$row->last_name) ?: ($row->username ?: 'Unknown'), 'username' => $row->username],
            'time_minutes' => (int) $row->time_minutes, 'created_at' => $row->created_at,
        ]);
        $byProject = (clone $base)->groupBy('projects.id', 'projects.name')
            ->orderByDesc(DB::raw('SUM(task_notes.time_minutes)'))
            ->get(['projects.name', DB::raw('SUM(task_notes.time_minutes) as minutes'), DB::raw('COUNT(task_notes.id) as count')]);
        // Build the display name in PHP for SQL portability.
        $byUser = (clone $base)->groupBy('users.id', 'users.first_name', 'users.last_name', 'users.username')
            ->orderByDesc(DB::raw('SUM(task_notes.time_minutes)'))
            ->get(['users.first_name', 'users.last_name', 'users.username', DB::raw('SUM(task_notes.time_minutes) as minutes'), DB::raw('COUNT(task_notes.id) as count')])
            ->map(fn ($row) => [
                'name' => trim($row->first_name.' '.$row->last_name) ?: ($row->username ?: 'Unknown'),
                'minutes' => (int) $row->minutes, 'count' => (int) $row->count,
            ]);
        $timeline = (clone $base)->groupBy(DB::raw('DATE(task_notes.created_at)'))
            ->orderBy(DB::raw('DATE(task_notes.created_at)'))
            ->get([DB::raw('DATE(task_notes.created_at) as date'), DB::raw('SUM(task_notes.time_minutes) as minutes'), DB::raw('COUNT(task_notes.id) as count')]);

        return $this->data([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'totals' => ['minutes' => $total, 'entries' => $count, 'users' => $byUser->count(), 'projects' => $byProject->count()],
            'entries' => $entries,
            'by_project' => $byProject,
            'by_user' => $byUser,
            'timeline' => $timeline,
        ]);
    }
}
