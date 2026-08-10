import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { publicApi, PublicApiError } from '@/lib/publicApi'
import { cn } from '@/lib/utils'
import type { PublicForm, PublicFormField, PublicFormSubmissionResult } from '@/types/api'

/**
 * `max_files` / `max_file_bytes` / `accepted_types` on the form are the
 * ceiling applied to EACH `file` field independently, not a submission-wide
 * total — see `PublicFormController::fileCapFor`. A field's own `max`, when
 * present, tightens that ceiling further for that one field only.
 */
function fileCapFor(field: PublicFormField, form: PublicForm): number {
  const base = typeof form.max_files === 'number' && form.max_files > 0 ? form.max_files : Infinity
  const configured = typeof field.max === 'number' ? field.max : typeof field.max === 'string' ? Number(field.max) : NaN
  const fieldCap = Number.isFinite(configured) && configured > 0 ? configured : base
  return Math.min(fieldCap, base)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

/**
 * Client-side mirror of the server's cap so a client gets an immediate
 * inline message instead of waiting through a whole upload only to get a
 * 422 back. The server-side check remains the real gate.
 */
function validateFileSelection(field: PublicFormField, form: PublicForm, selected: File[]): string | null {
  if (selected.length === 0) return null

  const cap = fileCapFor(field, form)
  if (selected.length > cap) {
    return `No more than ${cap} file${cap === 1 ? '' : 's'} may be attached here.`
  }

  const maxBytes = form.max_file_bytes
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const tooBig = selected.find((file) => file.size > maxBytes)
    if (tooBig) return `Each file must be smaller than ${formatBytes(maxBytes)}.`
  }

  const acceptedTypes = form.accepted_types
  if (acceptedTypes && acceptedTypes.length > 0) {
    const rejected = selected.find((file) => !acceptedTypes.includes(file.type))
    if (rejected) return 'That file type is not accepted.'
  }

  return null
}

/**
 * Client-side mirror of the server's AGGREGATE cap — `max_submission_files` /
 * `max_submission_bytes` — which totals files across every `file` field
 * combined, for the whole submission. This is a different rule from
 * `validateFileSelection` above: a selection can pass every per-field check
 * and still fail here because it was spread across several fields. The
 * message must say so explicitly, or a submitter who followed every
 * per-field hint will just see the page "not working".
 */
function validateSubmissionAggregate(form: PublicForm, filesByField: Record<string, File[]>): string | null {
  const maxFiles = form.max_submission_files
  const maxBytes = form.max_submission_bytes
  const hasFileCap = typeof maxFiles === 'number' && maxFiles > 0
  const hasByteCap = typeof maxBytes === 'number' && maxBytes > 0
  if (!hasFileCap && !hasByteCap) return null

  let totalCount = 0
  let totalBytes = 0
  for (const items of Object.values(filesByField)) {
    for (const file of items) {
      totalCount += 1
      totalBytes += file.size
    }
  }

  if (hasFileCap && totalCount > maxFiles) {
    return `This submission has ${totalCount} files attached across all fields combined — this form allows at most ${maxFiles} files total per submission, not per field.`
  }
  if (hasByteCap && totalBytes > maxBytes) {
    return `This submission totals ${formatBytes(totalBytes)} across all fields combined — this form allows at most ${formatBytes(maxBytes)} total per submission, not per field.`
  }

  return null
}

/**
 * Screen C — `/f/:slug`, outside the authenticated app entirely. No nav, no
 * login, no route back in: a client reaching this page has no account and
 * this page must never behave as though they do.
 *
 * Deliberately denser-reading than the rest of the product (§09): larger
 * inputs, larger type, wider gaps. That is not a mistake to "fix" toward app
 * density — a client filling this in once should not need to squint.
 */
export function PublicFormPage() {
  const { slug } = useParams()
  const [form, setForm] = useState<PublicForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<{ id: string; message: string } | null>(null)
  const [submissionFileError, setSubmissionFileError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PublicFormSubmissionResult | null>(null)
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex,nofollow'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  useEffect(() => {
    if (!slug) return
    let active = true
    setLoading(true); setLoadError('')
    publicApi.get<PublicForm>(`/api/public/forms/${slug}`)
      .then((data) => { if (active) { setForm(data); document.title = data.title } })
      .catch((reason: unknown) => {
        if (!active) return
        setLoadError(reason instanceof PublicApiError && reason.status === 404
          ? 'This form does not exist, or the link has been rotated.'
          : 'This form could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form || !slug) return
    setSubmitError(''); setFieldError(null); setSubmissionFileError('')

    if (form.require_email && !email.trim()) {
      setFieldError({ id: '__email', message: 'An email address is required on this form.' })
      fieldRefs.current.__email?.focus()
      return
    }

    for (const field of form.fields) {
      if (!field.required) continue
      const hasFiles = field.type === 'file' && (files[field.id]?.length ?? 0) > 0
      const hasValue = (values[field.id] ?? '').trim() !== ''
      if (!hasFiles && !hasValue) {
        setFieldError({ id: field.id, message: 'This field is required.' })
        fieldRefs.current[field.id]?.focus()
        return
      }
    }

    // Re-check every file field's cap right before anything is sent — the
    // per-field limit is also enforced at selection time, but this is the
    // gate that actually blocks the request.
    for (const field of form.fields) {
      if (field.type !== 'file') continue
      const error = validateFileSelection(field, form, files[field.id] ?? [])
      if (error) {
        setFieldError({ id: field.id, message: error })
        fieldRefs.current[field.id]?.focus()
        return
      }
    }

    // Hard gate on the whole-submission aggregate — checked last, after
    // every per-field cap has already passed, because a selection can be
    // valid field-by-field and still be too much combined.
    const aggregateError = validateSubmissionAggregate(form, files)
    if (aggregateError) {
      setSubmissionFileError(aggregateError)
      return
    }

    setSubmitting(true)
    try {
      // Each `file` field keeps its own key on the wire —
      // `files[<fieldId>][]` — because the backend can define more than one
      // file field and rejects an unkeyed, flat `files[]` bucket outright.
      const fileFields = form.fields.filter((field) => field.type === 'file' && (files[field.id]?.length ?? 0) > 0)
      let response: PublicFormSubmissionResult
      if (fileFields.length) {
        const body = new FormData()
        if (email.trim()) body.append('from_email', email.trim())
        for (const field of form.fields) {
          if (field.type === 'file') continue
          if (values[field.id] != null && values[field.id] !== '') body.append(`answers[${field.id}]`, values[field.id])
        }
        for (const field of fileFields) {
          for (const file of files[field.id] ?? []) body.append(`files[${field.id}][]`, file)
        }
        response = await publicApi.post<PublicFormSubmissionResult>(`/api/public/forms/${slug}/submissions`, body)
      } else {
        const answers: Record<string, string> = {}
        for (const field of form.fields) {
          if (values[field.id] != null && values[field.id] !== '') answers[field.id] = values[field.id]
        }
        response = await publicApi.post<PublicFormSubmissionResult>(`/api/public/forms/${slug}/submissions`, {
          from_email: email.trim() || undefined,
          answers,
        })
      }
      setResult(response)
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'That did not go through. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh bg-bg px-5 py-14">
      <div className="mx-auto flex w-full max-w-[620px] flex-col gap-7">
        {loading && (
          <div className="flex flex-col gap-4">
            <div className="h-7 w-2/3 animate-pulse rounded bg-soft" />
            <div className="h-4 w-full animate-pulse rounded bg-soft" />
            <div className="h-[42px] w-full animate-pulse rounded-[10px] bg-soft" />
          </div>
        )}

        {loadError && !loading && (
          <p className="text-[14px] text-t3">{loadError}</p>
        )}

        {form && !loading && (
          result ? (
            <ConfirmationView form={form} result={result} values={values} />
          ) : (
            <>
              <header className="flex flex-col gap-2">
                {form.header_line && <span className="text-[13px] font-medium text-t4">{form.header_line}</span>}
                <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-title-strong">{form.title}</h1>
                {form.blurb && <p className="text-[14.5px] leading-[1.6] text-t3">{form.blurb}</p>}
              </header>

              {form.closed ? (
                <p className="text-[14px] text-t3">{form.closed_message || "This form isn't accepting submissions right now."}</p>
              ) : (
                <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-[18px]" noValidate>
                  {form.require_email && (
                    <PublicField label="Your email" required error={fieldError?.id === '__email' ? fieldError.message : undefined}>
                      <input
                        ref={(node) => { fieldRefs.current.__email = node }}
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        aria-invalid={fieldError?.id === '__email'}
                        className={cn(
                          'h-[42px] w-full rounded-[10px] border bg-[#131316] px-3.5 text-[14px] text-[#ececee] outline-none placeholder:text-t5',
                          fieldError?.id === '__email' ? 'border-[1.5px] border-danger' : 'border-line-strong focus-visible:border-brand',
                        )}
                      />
                    </PublicField>
                  )}

                  {form.fields.map((field) => (
                    <PublicField key={field.id} label={field.label} help={field.help} required={field.required} error={fieldError?.id === field.id ? fieldError.message : undefined}>
                      <FieldInput
                        field={field}
                        value={values[field.id] ?? ''}
                        invalid={fieldError?.id === field.id}
                        onChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
                        onFiles={(next) => {
                          const merged = { ...files, [field.id]: next }
                          setFiles(merged)
                          const error = validateFileSelection(field, form, next)
                          setFieldError(error ? { id: field.id, message: error } : null)
                          setSubmissionFileError(validateSubmissionAggregate(form, merged) ?? '')
                        }}
                        registerRef={(node) => { fieldRefs.current[field.id] = node }}
                      />
                    </PublicField>
                  ))}

                  {submissionFileError && <p role="alert" className="text-[13px] text-danger">{submissionFileError}</p>}
                  {submitError && <p role="alert" className="text-[13px] text-danger">{submitError}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-10 w-fit items-center justify-center rounded-[10px] bg-[#ececee] px-[18px] text-[13.5px] font-semibold text-[#0b0b0c] outline-none transition-opacity disabled:opacity-60"
                  >
                    {submitting ? 'Sending…' : 'Submit'}
                  </button>
                </form>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}

function PublicField({ label, help, required, error, children }: {
  label: string
  help?: string | null
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-[550] text-[#ececee]">
        {label}
        {required && <span className="ml-1 text-[#f2585b]">*</span>}
      </span>
      {help && <span className="text-[12.5px] text-t4">{help}</span>}
      {children}
      {error && <span className="text-[12.5px] text-[#f2585b]">{error}</span>}
    </label>
  )
}

function FieldInput({ field, value, invalid, onChange, onFiles, registerRef }: {
  field: PublicFormField
  value: string
  invalid: boolean
  onChange: (value: string) => void
  onFiles: (files: File[]) => void
  registerRef: (node: HTMLElement | null) => void
}) {
  const baseClass = cn(
    'w-full min-h-[42px] rounded-[10px] border bg-[#131316] px-3.5 py-2 text-[14px] text-[#ececee] outline-none placeholder:text-t5',
    invalid ? 'border-[1.5px] border-danger' : 'border-line-strong focus-visible:border-brand',
  )

  if (field.type === 'long_text' || field.type === 'steps') {
    return (
      <textarea
        ref={(node) => registerRef(node)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        rows={4}
        placeholder={field.type === 'steps' ? 'One step per line' : undefined}
        className={cn(baseClass, 'resize-y')}
      />
    )
  }
  if (field.type === 'severity' || field.type === 'select') {
    return (
      <select ref={(node) => registerRef(node)} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid} className={baseClass}>
        <option value="">Choose one</option>
        {field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    )
  }
  if (field.type === 'date') {
    return <input ref={(node) => registerRef(node)} type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid} className={baseClass} />
  }
  if (field.type === 'email') {
    return <input ref={(node) => registerRef(node)} type="email" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid} className={baseClass} />
  }
  if (field.type === 'file') {
    return (
      <input
        ref={(node) => registerRef(node)}
        type="file"
        multiple
        onChange={(event) => onFiles(event.target.files ? Array.from(event.target.files) : [])}
        aria-invalid={invalid}
        className={cn(baseClass, 'flex items-center py-2 file:mr-3 file:rounded-md file:border-0 file:bg-fill file:px-2.5 file:py-1.5 file:text-[12.5px] file:text-t1')}
      />
    )
  }
  return <input ref={(node) => registerRef(node)} type="text" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid} className={baseClass} />
}

/**
 * Replaces the form in place — no redirect, no auto-reset — and promises
 * nothing about email, because nothing sends one in v1.
 */
function ConfirmationView({ form, result, values }: { form: PublicForm; result: PublicFormSubmissionResult; values: Record<string, string> }) {
  const answered = form.fields.filter((field) => (values[field.id] ?? '').trim() !== '')
  return (
    <div className="flex flex-col gap-5 rounded-[14px] border border-line-strong bg-surface p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-title-strong">Thanks — we've got it</h1>
        <p className="text-[14px] leading-[1.6] text-t3">
          Your submission to <strong className="text-t1">{form.title}</strong> was received{result.email_on_file ? ' and your email is on file with it' : ''}. Keep the reference below if you need to follow up.
        </p>
      </div>
      <div className="flex flex-col gap-1 rounded-[10px] bg-[#131316] px-3.5 py-3">
        <span className="text-[12px] text-t4">Reference</span>
        <span className="font-mono text-[15px] text-t1">{result.reference}</span>
      </div>
      {answered.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[12px] font-[550] uppercase tracking-[.08em] text-t4">What we sent</span>
          {answered.map((field) => (
            <div key={field.id} className="flex flex-col gap-0.5">
              <span className="text-[12.5px] text-t4">{field.label}</span>
              <span className="text-[14px] whitespace-pre-wrap text-t1">
                {field.type === 'severity' || field.type === 'select'
                  ? field.choices?.find((choice) => choice.value === values[field.id])?.label ?? values[field.id]
                  : values[field.id]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
