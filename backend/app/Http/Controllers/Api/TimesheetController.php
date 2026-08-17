<?php

namespace App\Http\Controllers\Api;

use App\Services\TimesheetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The employee's own timesheet: Client, Date, Description, Hours, copied into
 * the agency's payroll spreadsheet. Only the requesting user's time appears,
 * which is why `time.track` is the whole of the authorization here.
 */
class TimesheetController extends ApiController
{
    public function __construct(private readonly TimesheetService $timesheet) {}

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $data = $request->validate([
            'cutoff' => ['sometimes', Rule::in(TimesheetService::CUTOFFS)],
            'offset' => ['sometimes', 'integer', 'between:-240,240'],
        ]);

        return $this->data($this->timesheet->summary(
            $request->user(),
            $data['cutoff'] ?? 'semi',
            (int) ($data['offset'] ?? 0),
        ));
    }

    public function updateDescription(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        // Trimmed before validation so trailing space cannot smuggle a row past
        // the length limit or stand in for a description.
        if (is_string($request->input('body'))) {
            $request->merge(['body' => trim($request->input('body'))]);
        }
        $data = $request->validate([
            'task_id' => ['required', 'integer', 'exists:tasks,id'],
            'date' => ['required', 'date_format:Y-m-d'],
            'body' => ['required', 'string', 'max:500'],
        ]);

        $row = $this->timesheet->describe(
            $request->user(),
            (int) $data['task_id'],
            $data['date'],
            $data['body'],
        );
        abort_if($row === null, 422, 'You have no tracked time on that task for that date.');

        $this->audit($request, 'timesheet.describe', null, [
            'task_id' => $data['task_id'],
            'date' => $data['date'],
            'edited' => $row['edited'],
        ]);

        return $this->data($row);
    }

    /**
     * The hours for a row the clock never saw — a task finished without a
     * timer running, which is most of them for anybody who works in one sitting
     * and marks it done at the end.
     *
     * An absent value clears what was typed and leaves the row blank again.
     * That is deliberately different from sending zero, which is a person
     * saying the task took no billable time.
     */
    public function updateHours(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $data = $request->validate([
            'task_id' => ['required', 'integer', 'exists:tasks,id'],
            'date' => ['required', 'date_format:Y-m-d'],
            // A day has 1440 minutes; anything past that is a typo, not a shift.
            'minutes' => ['present', 'nullable', 'integer', 'min:0', 'max:1440'],
        ]);

        $row = $this->timesheet->setHours(
            $request->user(),
            (int) $data['task_id'],
            $data['date'],
            $data['minutes'] === null ? null : (int) $data['minutes'],
        );
        abort_if($row === null, 422, 'That task has no timesheet row of yours on that date.');

        $this->audit($request, 'timesheet.hours', null, [
            'task_id' => $data['task_id'],
            'date' => $data['date'],
            'minutes' => $data['minutes'],
        ]);

        return $this->data($row);
    }
}
