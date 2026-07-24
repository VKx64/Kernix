<?php

namespace App\Services;

use RuntimeException;

class OpenRouterException extends RuntimeException
{
    public function __construct(string $message, public readonly ?int $statusCode = null)
    {
        parent::__construct($message);
    }
}
