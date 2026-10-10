import { useState, type ReactNode } from 'react'
import { useSettings } from '../core/settings'
import { getThemePref, setThemePref, type ThemePref } from '../core/theme'
import type { Difficulty } from '../core/types'

interface SliderFieldProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}

function SliderField({ id, label, value, onChange }: SliderFieldProps): ReactNode {
  const pct = Math.round(value * 100)
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <span className="value">{pct}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </div>
  )
}

interface ToggleFieldProps {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleField({ label, hint, checked, onChange }: ToggleFieldProps): ReactNode {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-labels">
          <span>{label}</span>
          <span className="muted field-hint">{hint}</span>
        </span>
        <button
          type="button"
          className="switch"
          aria-pressed={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
        />
      </div>
    </div>
  )
}

interface SegFieldProps<T extends string> {
  label: string
  hint: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

function SegField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: SegFieldProps<T>): ReactNode {
  const groupId = `seg-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-labels">
          <span id={`${groupId}-label`}>{label}</span>
          <span className="muted field-hint">{hint}</span>
        </span>
        <div className="seg" role="group" aria-labelledby={`${groupId}-label`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const DIFFICULTIES: readonly { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
]

const THEMES: readonly { value: ThemePref; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

export function SettingsPage(): ReactNode {
  const { settings, update, reset } = useSettings()
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref())

  const onReset = (): void => {
    reset()
    setTheme(setThemePref('system'))
  }

  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <p className="muted">Sound, gameplay and controls — saved on this device.</p>

      <section aria-labelledby="settings-sound">
        <h2 className="section-title" id="settings-sound">
          Sound
        </h2>
        <SliderField
          id="volume-master"
          label="Master volume"
          value={settings.masterVolume}
          onChange={(value) => update({ masterVolume: value })}
        />
        <SliderField
          id="volume-music"
          label="Music volume"
          value={settings.musicVolume}
          onChange={(value) => update({ musicVolume: value })}
        />
        <SliderField
          id="volume-sfx"
          label="Effects volume"
          value={settings.sfxVolume}
          onChange={(value) => update({ sfxVolume: value })}
        />
      </section>

      <section aria-labelledby="settings-gameplay">
        <h2 className="section-title" id="settings-gameplay">
          Gameplay
        </h2>
        <SegField
          label="Difficulty"
          hint="Speeds up Snake and Pong, tightens Breakout, raises 2048 four-spawns."
          value={settings.difficulty}
          options={DIFFICULTIES}
          onChange={(value) => update({ difficulty: value })}
        />
        <ToggleField
          label="Wrap walls"
          hint="Snake passes through the edges instead of crashing."
          checked={settings.wrapWalls}
          onChange={(checked) => update({ wrapWalls: checked })}
        />
        <ToggleField
          label="Reduced motion"
          hint="Skips flashes, pulses and intro animations."
          checked={settings.reducedMotion}
          onChange={(checked) => update({ reducedMotion: checked })}
        />
      </section>

      <section aria-labelledby="settings-controls">
        <h2 className="section-title" id="settings-controls">
          Controls
        </h2>
        <ToggleField
          label="Show controls legend"
          hint="Keyboard hints under the game screen."
          checked={settings.showControls}
          onChange={(checked) => update({ showControls: checked })}
        />
        <ToggleField
          label="Left-handed touch"
          hint="Mirrors the on-screen d-pad to the right side."
          checked={settings.leftHanded}
          onChange={(checked) => update({ leftHanded: checked })}
        />
      </section>

      <section aria-labelledby="settings-appearance">
        <h2 className="section-title" id="settings-appearance">
          Appearance
        </h2>
        <SegField
          label="Theme"
          hint="System follows your device’s light or dark mode."
          value={theme}
          options={THEMES}
          onChange={(value) => setTheme(setThemePref(value))}
        />
      </section>

      <div className="settings-actions">
        <button type="button" className="btn ghost" onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
