<?php

namespace Database\Factories;

use App\Models\FormSubmission;
use App\Models\ProjectForm;
use Illuminate\Database\Eloquent\Factories\Factory;

class FormSubmissionFactory extends Factory
{
    protected $model = FormSubmission::class;

    public function definition(): array
    {
        return [
            'project_form_id' => fn () => ProjectForm::factory()->create()->id,
            'project_id' => fn (array $attributes) => ProjectForm::query()->findOrFail($attributes['project_form_id'])->project_id,
            'reference' => fn () => self::reference(),
            'from_name' => fake()->name(),
            'from_email' => fake()->unique()->safeEmail(),
            'form_snapshot' => fn (array $attributes) => ProjectForm::query()->findOrFail($attributes['project_form_id'])->toSnapshot(),
            'answers' => fn (array $attributes) => self::defaultAnswers($attributes['form_snapshot'] ?? []),
            'status' => 'new',
            'task_id' => null,
            'possible_duplicate_of' => null,
            'decline_reason' => null,
            'decided_by' => null,
            'decided_at' => null,
            'ip_hash' => null,
            'user_agent' => null,
        ];
    }

    public static function reference(): string
    {
        return FormSubmission::generateReference();
    }

    /** @param array<string, mixed> $snapshot */
    private static function defaultAnswers(array $snapshot): array
    {
        $answers = [];
        foreach (($snapshot['fields'] ?? []) as $field) {
            if (($field['maps'] ?? null) === 'title') {
                $answers[$field['id']] = fake()->sentence();
            } elseif (($field['maps'] ?? null) === 'description') {
                $answers[$field['id']] = fake()->paragraph();
            }
        }

        return $answers;
    }
}
