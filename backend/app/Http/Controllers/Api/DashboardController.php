<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeSession;
use App\Support\SingleClient;
use App\Support\TimeSessionCleanup;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends ApiController
{
    public function __invoke(Request $request): JsonResponse
    {
        $this->permission($request, 'dashboard.view');
        $range = $request->validate([
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);
        $from = Carbon::parse($range['from'] ?? now()->startOfMonth())->startOfDay();
        $to = Carbon::parse($range['to'] ?? now())->endOfDay();
        $userId = $request->user()->id;
        $canTasks = $request->user()->canDo('tasks.view');
        $canMessages = $request->user()->canDo('messages.view');
        $canProjects = $request->user()->canDo('projects.view');
        $canClients = $request->user()->canDo('clients.view');
        $canTrackTime = $request->user()->canDo('time.track');
        $canViewTeamTime = $request->user()->canDo('time.view_team');
        $canSeeTaskTime = $canTasks && $canTrackTime;

        $counts = [];
        if ($canTasks) {
            $tasks = Task::query()->where('assignee_user_id', $userId)->whereNull('archived_at');
            if (SingleClient::enabled()) {
                $tasks->whereHas('project', fn ($query) => $query->where('client_id', SingleClient::id() ?? 0));
            }
            $counts['my_tasks'] = $tasks->count();
        }
        if ($canMessages) {
            $unread = TaskNote::query()->where('is_message', true)->where('assigned_user_id', $userId)->whereNull('read_at');
            $this->scopeNotes($unread);
            $counts['unread_messages'] = $unread->count();
        }
        if ($canProjects) {
            $projects = Project::query()->whereNull('archived_at');
            if (SingleClient::enabled()) {
                $projects->where('client_id', SingleClient::id() ?? 0);
            }
            $counts['active_projects'] = $projects->count();
            $counts['open_projects'] = $counts['active_projects'];
        }
        if ($canClients) {
            $clients = Client::query()->whereNull('archived_at');
            if (SingleClient::enabled()) {
                $clients->whereKey(SingleClient::id() ?? 0);
            }
            $counts['active_clients'] = $clients->count();
        }

        $response = [
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'counts' => (object) $counts,
        ];

        if ($canSeeTaskTime) {
            $notes = TaskNote::query()
                ->where('time_logged_by', $userId)
                ->where('time_minutes', '>', 0);
            $this->scopeNotes($notes);
            $todayMinutes = (clone $notes)->whereDate('created_at', today())->sum('time_minutes');
            $rangeNotes = (clone $notes)->whereBetween('created_at', [$from, $to]);
            $rangeMinutes = (clone $rangeNotes)->sum('time_minutes');
            $entries = (clone $rangeNotes)->with(['task.project.client'])->latest()->limit(30)->get()->map(fn (TaskNote $note) => [
                'id' => $note->id,
                'task_id' => $note->task_id,
                'task_title' => $note->task?->title,
                'project_name' => $note->task?->project?->name,
                'client_name' => $note->task?->project?->client?->name,
                'time_minutes' => (int) $note->time_minutes,
                'created_at' => $note->created_at,
            ]);
            $projectChart = $canProjects
                ? $this->breakdown($userId, $from, $to, 'projects.id', 'projects.name')
                : [];
            $clientChart = $canClients
                ? $this->breakdown($userId, $from, $to, 'clients.id', 'clients.name')
                : [];

            $response += [
                'today_minutes' => (int) $todayMinutes,
                'range_minutes' => (int) $rangeMinutes,
                'entries' => $entries,
                'project_chart' => $projectChart,
                'client_chart' => $clientChart,
                'time' => [
                    'today_minutes' => (int) $todayMinutes,
                    'week_minutes' => (int) $rangeMinutes,
                    'by_project' => $projectChart,
                ],
            ];
        }

        if ($canViewTeamTime) {
            $response['team_time'] = $this->teamTime();
        }

        return $this->data($response);
    }

    private function scopeNotes($query): void
    {
        if (SingleClient::enabled()) {
            $query->whereHas('task.project', fn ($project) => $project->where('client_id', SingleClient::id() ?? 0));
        }
    }

    private function breakdown(int $userId, Carbon $from, Carbon $to, string $groupId, string $groupName): array
    {
        $query = DB::table('task_notes')
            ->join('tasks', 'tasks.id', '=', 'task_notes.task_id')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->join('clients', 'clients.id', '=', 'projects.client_id')
            ->whereNull('task_notes.deleted_at')
            ->where('task_notes.time_logged_by', $userId)
            ->where('task_notes.time_minutes', '>', 0)
            ->whereBetween('task_notes.created_at', [$from, $to]);
        if (SingleClient::enabled()) {
            $query->where('projects.client_id', SingleClient::id() ?? 0);
        }

        return $query->groupBy($groupId, $groupName)
            ->orderByDesc(DB::raw('SUM(task_notes.time_minutes)'))
            ->limit(9)
            ->get([$groupName.' as name', DB::raw('SUM(task_notes.time_minutes) as minutes')])
            ->map(fn ($row) => ['name' => $row->name, 'minutes' => (int) $row->minutes])
            ->all();
    }

    private function teamTime(): array
    {
        TimeSessionCleanup::closeStale();
        $sessions = TimeSession::query()
            ->with(['user', 'breaks'])
            ->whereNull('clock_out_at')
            ->latest('clock_in_at')
            ->get()
            ->map(function (TimeSession $session): array {
                $currentBreak = $session->breaks->firstWhere('end_at', null);

                return [
                    'id' => $session->id,
                    'clock_in_at' => $session->clock_in_at,
                    'state' => $currentBreak ? 'break' : 'working',
                    'current_break_started_at' => $currentBreak?->start_at,
                    'user' => $this->userSummary($session->user),
                ];
            })->values();

        return [
            'clocked_in_count' => $sessions->count(),
            'working_count' => $sessions->where('state', 'working')->count(),
            'on_break_count' => $sessions->where('state', 'break')->count(),
            'sessions' => $sessions,
        ];
    }
}
