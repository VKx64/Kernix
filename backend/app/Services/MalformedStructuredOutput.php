<?php

namespace App\Services;

/**
 * The model answered, but not in the shape the caller asked for.
 *
 * Separate from `OpenRouterException` because the two need different handling:
 * an unreachable provider is worth reporting and giving up on, while a reply in
 * the wrong shape is worth one more attempt with the schema stated in the
 * prompt as well as in `response_format`.
 */
class MalformedStructuredOutput extends OpenRouterException {}
