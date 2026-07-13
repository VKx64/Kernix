<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class EmailAttachment extends DomainModel
{
    use SoftDeletes;

    public const UPDATED_AT = null;
}
