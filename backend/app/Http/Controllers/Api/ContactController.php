<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Contact;
use App\Support\SingleClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ContactController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'contacts.view');
        $query = $this->archived(Contact::with('client'), $request);
        if (SingleClient::enabled()) {
            $query->where('client_id', SingleClient::id() ?? 0);
        } elseif ($request->filled('client_id')) {
            $query->where('client_id', $request->integer('client_id'));
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($q) => $q->where('first_name', 'like', "%$search%")->orWhere('last_name', 'like', "%$search%")->orWhere('email', 'like', "%$search%"));
        }

        $page = $query->orderBy('last_name')->orderBy('first_name')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Contact $contact) => $this->present($contact));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'contacts.create');
        $data = $this->withForcedClient($this->validated($request));
        $data['last_name'] = (string) ($data['last_name'] ?? '');
        $contact = Contact::create($data + ['created_by' => $request->user()->id]);
        $this->audit($request, 'contact.create', $contact, $contact->toArray());

        return $this->data($this->present($contact), 201);
    }

    public function show(Request $request, Contact $contact): JsonResponse
    {
        $this->permission($request, 'contacts.view');
        $this->withinClient($contact->client_id);

        return $this->data($this->present($contact));
    }

    public function update(Request $request, Contact $contact): JsonResponse
    {
        $this->permission($request, 'contacts.edit');
        $this->withinClient($contact->client_id);
        $before = $contact->getAttributes();
        $data = $this->withForcedClient($this->validated($request, true));
        if (array_key_exists('last_name', $data)) {
            $data['last_name'] = (string) ($data['last_name'] ?? '');
        }
        $contact->update($data);
        $this->audit($request, 'contact.update', $contact, ['before' => $before, 'after' => $contact->getAttributes()]);

        return $this->data($this->present($contact->fresh()));
    }

    public function archive(Request $request, Contact $contact): JsonResponse
    {
        $this->permission($request, 'contacts.archive');
        $this->withinClient($contact->client_id);
        $contact->update(['archived_at' => now()]);
        $this->audit($request, 'contact.archive', $contact);

        return $this->data($contact);
    }

    public function restore(Request $request, int $contact): JsonResponse
    {
        $this->permission($request, 'contacts.archive');
        $model = Contact::findOrFail($contact);
        $this->withinClient($model->client_id);
        $clientIsActive = Client::query()
            ->whereKey($model->client_id)
            ->whereNull('archived_at')
            ->exists();
        abort_unless($clientIsActive, 409, 'Restore the parent client before restoring this contact.');
        $model->update(['archived_at' => null]);
        $this->audit($request, 'contact.restore', $model);

        return $this->data($model);
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'client_id' => [Rule::excludeIf(SingleClient::enabled()), $partial ? 'sometimes' : 'required', 'integer', Rule::exists('clients', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'first_name' => [$partial ? 'sometimes' : 'required', 'string', 'max:128'], 'last_name' => ['sometimes', 'nullable', 'string', 'max:128'],
            'title' => ['sometimes', 'nullable', 'string', 'max:191'], 'email' => ['sometimes', 'nullable', 'email', 'max:191'],
            'phone_1' => ['sometimes', 'nullable', 'string', 'max:64'], 'phone_2' => ['sometimes', 'nullable', 'string', 'max:64'],
            'notes' => ['sometimes', 'nullable', 'string'], 'status' => ['sometimes', 'in:active,inactive'],
        ]);
    }

    private function present(Contact $contact): Contact
    {
        $contact->load('client');
        $contact->setRelation('client', $this->summaryRelation($this->clientSummary($contact->client)));

        return $contact;
    }

    private function withForcedClient(array $data): array
    {
        if (SingleClient::enabled()) {
            abort_unless(SingleClient::id(), 409, 'Select a client in single-client settings.');
            $data['client_id'] = SingleClient::id();
        }

        return $data;
    }

    private function withinClient(int $id): void
    {
        if (SingleClient::enabled()) {
            abort_unless($id === SingleClient::id(), 404);
        }
    }
}
