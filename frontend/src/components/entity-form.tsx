import { useMemo, type ReactNode } from 'react'
import { useForm, type DefaultValues } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { FormPayload, FormValue } from '@/types/api'

export interface FormOption {
  label: string
  value: string | number
}

export interface FormFieldSpec {
  name: string
  label: string
  type?: 'text' | 'email' | 'password' | 'url' | 'tel' | 'date' | 'number' | 'textarea' | 'select' | 'checkbox'
  placeholder?: string
  required?: boolean
  options?: FormOption[]
  /** Offered in a dropdown but not enforced — the field stays free text. */
  suggestions?: FormOption[]
  help?: string
  min?: number
  step?: number
  wide?: boolean
  disabled?: boolean
  clearOnChange?: string[]
}

type FormShape = Record<string, FormValue>

/**
 * Builds the zod schema from the field specs so a page declares its form once
 * and gets validation, field-level messages, and the shadcn Form markup from
 * the same description.
 */
function schemaFor(fields: FormFieldSpec[]) {
  return z.object(
    Object.fromEntries(fields.map((field) => {
      if (field.type === 'checkbox') return [field.name, z.boolean()]

      if (field.type === 'number') {
        const number = z.union([z.number(), z.literal('')])
        return [
          field.name,
          field.required
            ? number.refine((value) => value !== '' && !Number.isNaN(value), { message: `${field.label} is required.` })
            : number,
        ]
      }

      const text = z.string()
      return [
        field.name,
        field.required ? text.trim().min(1, { message: `${field.label} is required.` }) : text,
      ]
    })),
  )
}

export function EntityForm({
  fields,
  initialValues,
  submitLabel = 'Save',
  busy,
  submitDisabled,
  error,
  onSubmit,
  onValuesChange,
  onCancel,
  extra,
}: {
  fields: FormFieldSpec[]
  initialValues?: FormPayload
  submitLabel?: string
  busy?: boolean
  submitDisabled?: boolean
  error?: string
  onSubmit: (values: FormPayload) => void | Promise<void>
  onValuesChange?: (values: FormPayload) => void
  onCancel?: () => void
  extra?: ReactNode
}) {
  const schema = useMemo(() => schemaFor(fields), [fields])
  const defaults = useMemo(
    () => Object.fromEntries(fields.map((field) => [
      field.name,
      initialValues?.[field.name] ?? (field.type === 'checkbox' ? false : ''),
    ])) as FormShape,
    [fields, initialValues],
  )

  const form = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults as DefaultValues<FormShape>,
    values: defaults,
  })

  const handleChange = (name: string, value: FormValue, clear?: string[]) => {
    form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    clear?.forEach((other) => form.setValue(other, '', { shouldDirty: true }))
    onValuesChange?.({ ...form.getValues(), [name]: value, ...Object.fromEntries((clear ?? []).map((other) => [other, ''])) })
  }

  return (
    <Form {...form}>
      <form className="space-y-5" onSubmit={form.handleSubmit((values) => onSubmit(values))} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((spec) => (
            <FormField
              key={spec.name}
              control={form.control}
              name={spec.name}
              render={({ field }) => (
                <FormItem
                  className={cn(
                    (spec.wide || spec.type === 'textarea') && 'sm:col-span-2',
                    spec.type === 'checkbox' && 'sm:col-span-2 flex flex-row items-center gap-2 space-y-0',
                  )}
                >
                  {spec.type === 'checkbox' ? (
                    <>
                      <FormControl>
                        <Checkbox
                          checked={Boolean(field.value)}
                          disabled={spec.disabled}
                          onCheckedChange={(checked) => handleChange(spec.name, checked === true, spec.clearOnChange)}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">{spec.label}</FormLabel>
                    </>
                  ) : (
                    <>
                      <FormLabel>
                        {spec.label}
                        {spec.required && <span aria-hidden="true" className="text-destructive"> *</span>}
                      </FormLabel>
                      <FormControl>
                        {spec.type === 'textarea' ? (
                          <Textarea
                            {...field}
                            value={String(field.value ?? '')}
                            disabled={spec.disabled}
                            placeholder={spec.placeholder}
                            onChange={(event) => handleChange(spec.name, event.target.value, spec.clearOnChange)}
                          />
                        ) : spec.type === 'select' ? (
                          <Select
                            value={String(field.value ?? '')}
                            disabled={spec.disabled}
                            onValueChange={(value) => handleChange(spec.name, value, spec.clearOnChange)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select…" />
                            </SelectTrigger>
                            <SelectContent>
                              {spec.options?.map((option) => (
                                <SelectItem key={option.value} value={String(option.value)}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            {...field}
                            type={spec.type ?? 'text'}
                            value={String(field.value ?? '')}
                            disabled={spec.disabled}
                            placeholder={spec.placeholder}
                            min={spec.min}
                            step={spec.step}
                            list={spec.suggestions?.length ? `${spec.name}-suggestions` : undefined}
                            onChange={(event) => handleChange(
                              spec.name,
                              spec.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value,
                              spec.clearOnChange,
                            )}
                          />
                        )}
                      </FormControl>
                      {spec.suggestions?.length ? (
                        <datalist id={`${spec.name}-suggestions`}>
                          {spec.suggestions.map((option) => (
                            <option key={option.value} value={String(option.value)}>{option.label}</option>
                          ))}
                        </datalist>
                      ) : null}
                      {spec.help && <FormDescription>{spec.help}</FormDescription>}
                      <FormMessage />
                    </>
                  )}
                </FormItem>
              )}
            />
          ))}
        </div>

        {extra}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy || submitDisabled}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
