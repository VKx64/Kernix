<?php

namespace Database\Factories;

use App\Models\Client;
use App\Models\Project;
use App\Models\ProjectForm;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class ProjectFormFactory extends Factory
{
    protected $model = ProjectForm::class;

    public function definition(): array
    {
        return [
            'project_id' => fn () => $this->project()->id,
            'title' => fake()->words(3, true),
            'blurb' => fake()->sentence(),
            'header_line' => null,
            'icon' => null,
            'slug' => Str::random(32),
            'state' => 'live',
            'fields' => [
                [
                    'id' => 'fl1', 'type' => 'short_text', 'label' => 'What happened?',
                    'help' => null, 'required' => true, 'choices' => [],
                    'maps' => 'title', 'min' => null, 'max' => null,
                ],
                [
                    'id' => 'fl2', 'type' => 'long_text', 'label' => 'Any details?',
                    'help' => null, 'required' => false, 'choices' => [],
                    'maps' => 'description', 'min' => null, 'max' => null,
                ],
            ],
            'next_field_seq' => 3,
            'require_email' => true,
            'auto_convert' => false,
            'notify' => true,
            'task_type_key' => null,
            'closes_on' => null,
            'created_by' => null,
        ];
    }

    private function project(): Project
    {
        $client = Client::query()->create(['name' => fake()->company()]);

        return Project::query()->create([
            'client_id' => $client->id,
            'name' => fake()->words(2, true),
        ]);
    }
}
