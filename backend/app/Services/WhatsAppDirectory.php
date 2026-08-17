<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Contact;
use App\Models\Project;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Support\CurrentWorkspace;

/**
 * Who a WhatsApp number belongs to, and which number to reach somebody on.
 *
 * There is one linked account for the whole workspace, so identity cannot come
 * from an enrolment step — it comes from the numbers already recorded against
 * people and contacts. Matching is on the last nine digits, because the same
 * phone is written half a dozen ways in practice (`09171234567`,
 * `+63 917 123 4567`, `639171234567`) and none of those spellings is wrong.
 *
 * Phone-number identity is weaker than a session cookie: it trusts whoever holds
 * the SIM. That is why the command surface a resolved staff number gets is
 * deliberately narrow, why a client can only cause work to be *proposed and
 * assigned* rather than change anything, and why a number that matches nothing
 * is ignored in silence.
 */
class WhatsAppDirectory
{
    /** How many trailing digits have to agree for two spellings to be one number. */
    private const MATCH_DIGITS = 9;

    /**
     * Find or create the chat row for an inbound message, resolving who it is.
     *
     * @param  string  $chatJid  the conversation: a person's number, or a group id
     * @param  string|null  $senderJid  in a group, the individual who spoke
     * @param  User|null  $sender  the speaker, when their number is one of ours
     */
    public function resolve(string $chatJid, ?string $senderJid = null, ?string $pushName = null, ?User $sender = null): WhatsAppChat
    {
        $isGroup = str_ends_with($chatJid, '@g.us');
        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->firstOrNew(['jid' => $chatJid]);

        if (! $chat->exists) {
            $chat->kind = $isGroup ? WhatsAppChat::GROUP : WhatsAppChat::DIRECT;
            $chat->audience = WhatsAppChat::UNKNOWN;
            $chat->intake_enabled = true;
            $chat->muted = false;
        }

        if (filled($pushName) && blank($chat->subject)) {
            $chat->subject = mb_substr($pushName, 0, 191);
        }

        // A group is a room, not a person: it keeps `unknown` until an operator
        // says what it is. A one-to-one chat is resolved from the number.
        if ($isGroup) {
            // A room full of strangers belongs to no tenant, but the moment one
            // of the studio's own people speaks in it, it is theirs — otherwise
            // the row would be stamped with whichever workspace happens to have
            // the lowest id.
            if ($sender && ! $chat->project_id) {
                $chat->workspace_id = CurrentWorkspace::forUser($sender);
            }
        } else {
            $this->attachIdentity($chat, $chatJid);
        }

        $chat->last_inbound_at = now();
        $chat->save();

        return $chat->refresh();
    }

    /**
     * Who spoke, when the speaker is a Kernix account. Used for group messages,
     * where the chat is a room and the speaker is one number inside it.
     */
    public function userForJid(?string $jid): ?User
    {
        if (blank($jid) || str_ends_with((string) $jid, '@g.us')) {
            return null;
        }

        return $this->matchUser($this->digits((string) $jid));
    }

    /** The client contact behind a number, if any. */
    public function contactForJid(?string $jid): ?Contact
    {
        if (blank($jid) || str_ends_with((string) $jid, '@g.us')) {
            return null;
        }

        return $this->matchContact($this->digits((string) $jid));
    }

    /** The chat row to deliver to for one person, created if this is the first time. */
    public function chatForUser(User $user): ?WhatsAppChat
    {
        $jid = $this->jidForPhone($user->phone_1 ?: $user->phone_2);
        if (! $jid) {
            return null;
        }

        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->firstOrNew(['jid' => $jid]);
        $chat->fill([
            'kind' => WhatsAppChat::DIRECT,
            'audience' => WhatsAppChat::STAFF,
            'user_id' => $user->id,
            'workspace_id' => $chat->workspace_id ?: CurrentWorkspace::forUser($user),
            'subject' => $chat->subject ?: trim($user->first_name.' '.$user->last_name),
        ])->save();

        return $chat->refresh();
    }

    /** The chat row to deliver to for a client contact. */
    public function chatForContact(Contact $contact): ?WhatsAppChat
    {
        $jid = $this->jidForPhone($contact->phone_1 ?: $contact->phone_2);
        if (! $jid) {
            return null;
        }

        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->firstOrNew(['jid' => $jid]);
        $chat->fill([
            'kind' => WhatsAppChat::DIRECT,
            'audience' => WhatsAppChat::CLIENT,
            'contact_id' => $contact->id,
            'client_id' => $contact->client_id,
            'workspace_id' => $chat->workspace_id ?: $contact->workspace_id,
            'subject' => $chat->subject ?: trim($contact->first_name.' '.$contact->last_name),
        ])->save();

        return $chat->refresh();
    }

    /**
     * `09171234567`, `+63 917 123 4567`, and `639171234567` are one number. The
     * country code fills in a local spelling; it is configurable because the
     * default suits this deployment rather than every deployment.
     */
    public function jidForPhone(?string $phone): ?string
    {
        $digits = $this->normalize($phone);

        return $digits === null ? null : $digits.'@s.whatsapp.net';
    }

    public function normalize(?string $phone): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $phone) ?? '';
        if (mb_strlen($digits) < self::MATCH_DIGITS) {
            return null;
        }

        $country = (string) config('services.whatsapp.country_code', '63');

        // A local spelling: one leading zero standing in for the country code.
        if (str_starts_with($digits, '0')) {
            $digits = $country.ltrim($digits, '0');
        } elseif (mb_strlen($digits) <= 10 && ! str_starts_with($digits, $country)) {
            $digits = $country.$digits;
        }

        return $digits;
    }

    /** The project work from this chat belongs to, if it can be told. */
    public function projectFor(WhatsAppChat $chat): ?Project
    {
        if ($chat->project_id) {
            return Project::query()->withoutGlobalScope('workspace')->find($chat->project_id);
        }

        if (! $chat->client_id) {
            return null;
        }

        // One live project for the client is unambiguous; several are not, and
        // guessing would file a bug against the wrong job.
        $projects = Project::query()
            ->withoutGlobalScope('workspace')
            ->where('client_id', $chat->client_id)
            ->whereNull('archived_at')
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->limit(2)
            ->get();

        if ($projects->count() === 1) {
            return $projects->first();
        }

        return $projects->firstWhere('is_default', true);
    }

    private function attachIdentity(WhatsAppChat $chat, string $jid): void
    {
        $digits = $this->digits($jid);

        if ($user = $this->matchUser($digits)) {
            $chat->audience = WhatsAppChat::STAFF;
            $chat->user_id = $user->id;
            $chat->workspace_id = $chat->workspace_id ?: CurrentWorkspace::forUser($user);
            $chat->subject = $chat->subject ?: trim($user->first_name.' '.$user->last_name);

            return;
        }

        if ($contact = $this->matchContact($digits)) {
            $chat->audience = WhatsAppChat::CLIENT;
            $chat->contact_id = $contact->id;
            $chat->client_id = $contact->client_id;
            $chat->workspace_id = $chat->workspace_id ?: $contact->workspace_id;
            $chat->subject = $chat->subject ?: trim($contact->first_name.' '.$contact->last_name);

            return;
        }

        if ($client = $this->matchClient($digits)) {
            $chat->audience = WhatsAppChat::CLIENT;
            $chat->client_id = $client->id;
            $chat->subject = $chat->subject ?: $client->name;

            return;
        }

        // Left as it was. An operator can still say who this is, and until then
        // the chat is logged and never acted on.
    }

    private function matchUser(string $digits): ?User
    {
        if ($digits === '') {
            return null;
        }

        // Matched on a narrow select, then re-read whole: a partially hydrated
        // account looks inactive and carries no role, and this model goes on to be
        // the actor every permission check is made against.
        $id = User::query()
            ->withoutGlobalScope('workspace')
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->where(fn ($query) => $query->whereNotNull('phone_1')->orWhereNotNull('phone_2'))
            ->get(['id', 'phone_1', 'phone_2'])
            ->first(fn (User $user) => $this->sameNumber($digits, $user->phone_1) || $this->sameNumber($digits, $user->phone_2))
            ?->id;

        return $id ? User::query()->withoutGlobalScope('workspace')->find($id) : null;
    }

    private function matchContact(string $digits): ?Contact
    {
        if ($digits === '') {
            return null;
        }

        $id = Contact::query()
            ->withoutGlobalScope('workspace')
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->where(fn ($query) => $query->whereNotNull('phone_1')->orWhereNotNull('phone_2'))
            ->get(['id', 'phone_1', 'phone_2'])
            ->first(fn (Contact $contact) => $this->sameNumber($digits, $contact->phone_1) || $this->sameNumber($digits, $contact->phone_2))
            ?->id;

        return $id ? Contact::query()->withoutGlobalScope('workspace')->find($id) : null;
    }

    private function matchClient(string $digits): ?Client
    {
        if ($digits === '') {
            return null;
        }

        $id = Client::query()
            ->whereNull('archived_at')
            ->whereNotNull('phone')
            ->get(['id', 'phone'])
            ->first(fn (Client $client) => $this->sameNumber($digits, $client->phone))
            ?->id;

        return $id ? Client::query()->find($id) : null;
    }

    private function sameNumber(string $digits, ?string $candidate): bool
    {
        $other = preg_replace('/\D+/', '', (string) $candidate) ?? '';
        if (mb_strlen($other) < self::MATCH_DIGITS || mb_strlen($digits) < self::MATCH_DIGITS) {
            return false;
        }

        return mb_substr($digits, -self::MATCH_DIGITS) === mb_substr($other, -self::MATCH_DIGITS);
    }

    /**
     * The number inside a jid. WhatsApp appends a device index to the account's
     * own jid — `639171234567:27@s.whatsapp.net` — and leaving that in would turn
     * a phone number into a longer one that matches nobody.
     */
    private function digits(string $jid): string
    {
        $user = explode(':', explode('@', $jid)[0] ?? '')[0] ?? '';

        return preg_replace('/\D+/', '', $user) ?? '';
    }
}
