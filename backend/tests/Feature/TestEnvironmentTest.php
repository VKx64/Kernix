<?php

namespace Tests\Feature;

use Tests\TestCase;

class TestEnvironmentTest extends TestCase
{
    public function test_the_suite_is_isolated_from_the_compose_database(): void
    {
        $this->assertSame('testing', app()->environment());
        $this->assertSame('sqlite', config('database.default'));
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));
        $this->assertSame('array', config('session.driver'));
    }
}
