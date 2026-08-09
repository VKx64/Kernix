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
}
