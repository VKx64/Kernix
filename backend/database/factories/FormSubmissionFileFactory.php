<?php

namespace Database\Factories;

use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class FormSubmissionFileFactory extends Factory
{
    protected $model = FormSubmissionFile::class;

    public function definition(): array
    {
        return [
            'form_submission_id' => fn () => FormSubmission::factory()->create()->id,
            'original_name' => 'screenshot.png',
            'file_name' => Str::ulid()->toBase32().'.png',
            'storage_path' => fn (array $attributes) => 'form-submissions/'.($attributes['form_submission_id'] ?? '0').'/'.Str::random(12).'.png',
            'mime_type' => 'image/png',
            'file_size' => 2048,
            'storage_driver' => 'local',
        ];
    }
}
