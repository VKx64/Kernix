<?php

namespace App\Providers;

use App\Models\TaskNote;
use App\Observers\TaskNoteWhatsAppObserver;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Directed task messages are what WhatsApp delivers, so the model that
        // carries them is watched once here rather than in every workflow that
        // writes one.
        TaskNote::observe(TaskNoteWhatsAppObserver::class);

        // The rest of the app throttles inline (`throttle:N,1`), but a public
        // form submission needs a composite key — slug + ip — which the
        // inline form cannot express. Keying on ip alone would let one
        // abuser behind a shared NAT lock out an entire form's honest
        // traffic; keying on slug alone would let an attacker who found one
        // slug rate-limit every other form in every workspace.
        RateLimiter::for('public-form-submit', function (Request $request) {
            $key = mb_strtolower((string) $request->route('slug')).'|'.$request->ip();

            return [
                Limit::perMinute(5)->by($key),
                Limit::perDay(20)->by($key),
            ];
        });
    }
}
