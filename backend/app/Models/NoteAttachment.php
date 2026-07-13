<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class NoteAttachment extends DomainModel
{
    use SoftDeletes;

    public const UPDATED_AT = null;
}
