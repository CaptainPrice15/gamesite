import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { useProfile } from '../lib/auth'
import { load, save } from '../core/storage'
import '../styles/online.css'

const PROMPT_KEY = 'namePrompted'
const NAME_PATTERN = /^[A-Za-z0-9 _-]{3,20}$/
const GENERATED_PATTERN = /^Player[0-9a-f]{4}$/

function wasPrompted(): boolean {
  return load<boolean>(PROMPT_KEY, false) === true
}

function markPrompted(): void {
  save(PROMPT_KEY, true)
}

function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normaliseName(raw)
  if (name.length < 3) return { ok: false, error: 'Use at least 3 characters.' }
  if (name.length > 20) return { ok: false, error: 'Use at most 20 characters.' }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Only letters, digits, spaces, underscores and dashes.' }
  }
  return { ok: true, name }
}

interface NameFormProps {
  title: string
  initial: string
  showSkip: boolean
  onClose: () => void
}

function NameForm({ title, initial, showSkip, onClose }: NameFormProps): ReactNode {
  const { updateDisplayName } = useProfile()
  const [value, setValue] = useState(initial)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (): Promise<void> => {
    const check = validateName(value)
    if (!check.ok) {
      setMessage(check.error)
      return
    }
    setSaving(true)
    const failure = await updateDisplayName(check.name)
    setSaving(false)
    if (failure !== null) {
      setMessage('Could not save your name — try again.')
      return
    }
    markPrompted()
    onClose()
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="name-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="field">
          <div className="field-head">
            <label htmlFor="display-name">Display name</label>
            <span className="value">{normaliseName(value).length} / 20</span>
          </div>
          <input
            id="display-name"
            className="name-input"
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setMessage(null)
            }}
            placeholder="PixelFox"
            minLength={3}
            maxLength={20}
            autoComplete="nickname"
            spellCheck={false}
            autoFocus
          />
          <p className="name-hint muted">3–20 characters — letters, digits, spaces, _ and -</p>
          {message !== null && (
            <p className="name-error" role="alert">
              {message}
            </p>
          )}
        </div>
        <div className="name-actions">
          {showSkip && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                markPrompted()
                onClose()
              }}
            >
              Skip
            </button>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function ProfileGate(): ReactNode {
  const { ready, session, profile, error, refresh, signInAnonymously } = useProfile()
  const [dismissed, setDismissed] = useState(false)

  const needsName =
    ready &&
    session !== null &&
    profile !== null &&
    !wasPrompted() &&
    GENERATED_PATTERN.test(profile.display_name)
  const showNotice = ready && error !== null && (session === null || profile === null)

  return (
    <>
      {needsName && !dismissed && profile !== null && (
        <NameForm
          title="Choose your display name"
          initial={profile.display_name}
          showSkip
          onClose={() => setDismissed(true)}
        />
      )}
      {showNotice && (
        <div className="gate-note" role="status">
          <span>Connection problem — online features are paused.</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void (session === null ? signInAnonymously() : refresh())}
          >
            Retry
          </button>
        </div>
      )}
    </>
  )
}

export function EditNameButton(): ReactNode {
  const { ready, session, profile } = useProfile()
  const [open, setOpen] = useState(false)

  if (!ready || session === null || profile === null) return null

  return (
    <>
      <button
        type="button"
        className="name-btn"
        onClick={() => setOpen(true)}
        title="Edit display name"
        aria-label={`Edit display name, currently ${profile.display_name}`}
      >
        {profile.display_name}
      </button>
      {open && (
        <NameForm
          title="Edit display name"
          initial={profile.display_name}
          showSkip={false}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
