import { useId } from 'react'
import { Card } from '@operai/ui'
import { useFieldError, useForm } from '../lib/formStateContext'
import { pointer as pointerOf } from '../lib/formState'
import { ZONES } from '../lib/formStateTypes'
import type { FormFrame, FormVariant, FrameName, LogoPosition, VariantName } from '../lib/formStateTypes'
import type { Entity } from '../lib/types'
import { strings } from '../strings'
import { AssetField } from './AssetField'
import { CheckboxField } from './CheckboxField'
import { BoolField, ColourField, NumberField, RadioField } from './VariantCardFields'
import { ZoneEditor } from './ZoneEditor'

export interface VariantCardProps {
  /** The entity whose letterhead this is: where a logo or a background is uploaded to. */
  entity: Entity
  name: VariantName
  /** The variant's settings; `null` for a first or last page that is switched off. */
  variant: FormVariant | null
}

/**
 * VariantCard — one kind of page: the default page, the first page or the last page (AC-5.4, 5.5; design
 * S1, F6). The default card is always open. The first and last cards start with a checkbox "Use a
 * different first / last page": off, the card shows only that and says its settings are kept; on, the
 * full header, footer and logo controls appear. Stacked cards, never tabs, so a refused value is always in
 * the page (design D-1).
 *
 * The Logo and Background image sections each hold an `AssetField` (T23): the file is uploaded as soon as it
 * is chosen and the form then holds the asset's id. A logo that exists also shows its position and height,
 * which are absent while there is none; a background has no setting besides its file.
 */
export function VariantCard({ entity, name, variant }: VariantCardProps) {
  const { dispatch, announce } = useForm()
  const title = strings.form.variant[name]
  const optional = name !== 'default'

  const toggle = (on: boolean) => {
    if (name === 'default') return
    dispatch({ type: 'variantToggled', variant: name, on })
    announce(on ? strings.form.variant.shown(title) : strings.form.variant.hidden(title))
  }

  return (
    <Card title={title} headingLevel={3} data-testid={`variant-${name}`}>
      {optional && (
        <CheckboxField
          label={name === 'first' ? strings.form.variant.useFirst : strings.form.variant.useLast}
          hint={name === 'first' ? strings.form.variant.firstHint : strings.form.variant.lastHint}
          checked={variant !== null}
          onChange={toggle}
          data-pointer={pointerOf('variants', name)}
        />
      )}
      {variant === null ? (
        <p className="text-sm text-soft">{strings.form.variant.off}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <FrameSection variantName={name} frameName="header" frame={variant.header} />
          <FrameSection variantName={name} frameName="footer" frame={variant.footer} />
          <LogoSection entity={entity} variantName={name} logo={variant.logo} />
          <BackgroundSection entity={entity} variantName={name} background={variant.background} />
        </div>
      )}
    </Card>
  )
}

function FrameSection({
  variantName,
  frameName,
  frame,
}: {
  variantName: VariantName
  frameName: FrameName
  frame: FormFrame
}) {
  // A `group`, not a `section`: three cards hold a Header and a Footer each, and landmarks must have distinct names.
  const headingId = useId()
  const errorId = `${headingId}-error`
  const at = pointerOf('variants', variantName, frameName)
  // A refusal of the frame as a whole (it does not fit its margin) sits under the heading and describes the first control.
  const frameError = useFieldError(at)
  const variantLabel = strings.form.variant[variantName]
  const frameLabel = strings.form.frame[frameName]
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3" data-frame={at}>
      <h4 id={headingId} className="text-sm font-semibold text-text">
        {frameLabel}
      </h4>
      <p className="field-hint">{strings.form.frame.placeholdersHint}</p>
      {frameError && (
        <p id={errorId} className="field-error">
          {frameError}
        </p>
      )}
      <RadioField
        label={strings.form.frame.valign}
        hint={strings.form.frame.valignHint}
        pointer={`${at}/valign`}
        value={frame.valign}
        describedBy={frameError ? errorId : undefined}
        options={[
          { value: 'top', label: strings.form.frame.top },
          { value: 'bottom', label: strings.form.frame.bottom },
        ]}
      />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <BoolField
          label={frameName === 'header' ? strings.form.rule.showHeader : strings.form.rule.showFooter}
          pointer={`${at}/rule/show`}
          checked={frame.rule.show}
          className="pb-2"
        />
        {frame.rule.show && (
          <>
            <NumberField
              className="w-28"
              label={strings.form.rule.thickness}
              pointer={`${at}/rule/thicknessPt`}
              value={frame.rule.thicknessPt}
            />
            <ColourField label={strings.form.rule.colour} pointer={`${at}/rule/color`} value={frame.rule.color} />
          </>
        )}
      </div>
      {ZONES.map((zone) => (
        <ZoneEditor
          key={zone}
          pointer={`${at}/${zone}`}
          zoneLabel={strings.form.zone[zone]}
          variantLabel={variantLabel}
          frameLabel={frameLabel}
          lines={frame[zone]}
        />
      ))}
    </div>
  )
}

/**
 * A logo that is chosen for the first time starts at the left, 15 mm high (a starting value the person
 * changes; the service holds the range, AC-7.4). It is placed inside the range the catalog gives, so the
 * first save is not refused for a value the person never typed.
 */
const FIRST_LOGO_POSITION: LogoPosition = 'left'
const FIRST_LOGO_HEIGHT_MM = 15

function LogoSection({
  entity,
  variantName,
  logo,
}: {
  entity: Entity
  variantName: VariantName
  logo: FormVariant['logo']
}) {
  const headingId = useId()
  const { catalog, dispatch, problemsAt, describeProblem } = useForm()
  const at = pointerOf('variants', variantName, 'logo')
  const { min, max } = catalog.bounds.logoHeightMm
  // A header that does not fit its margin is refused as a whole, under the Header heading far above; with a logo,
  // the logo's height is the likely cause, so the same sentence is shown under it too.
  const headerOverflow = problemsAt(pointerOf('variants', variantName, 'header')).find(
    (problem) => problem.reason === 'header_overflow',
  )
  const tooTall = logo === null || headerOverflow === undefined ? undefined : describeProblem(headerOverflow)
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="text-sm font-semibold text-text">
        {strings.form.logo.title}
      </h4>
      <AssetField
        entity={entity}
        kind="logo"
        assetId={logo?.asset ?? null}
        pointer={`${at}/asset`}
        label={strings.form.logo.file}
        hint={strings.asset.accept}
        removeLabel={strings.form.logo.remove}
        what={strings.form.logo.title}
        onUploaded={(uploaded) =>
          // Read when the answer comes: the logo may have been removed, or replaced, while the file was on its way.
          dispatch(
            logo === null
              ? {
                  type: 'set',
                  pointer: at,
                  value: {
                    asset: uploaded.id,
                    position: FIRST_LOGO_POSITION,
                    heightMm: Math.min(Math.max(FIRST_LOGO_HEIGHT_MM, min), max),
                  },
                }
              : { type: 'set', pointer: `${at}/asset`, value: uploaded.id },
          )
        }
        onRemove={() => dispatch({ type: 'set', pointer: at, value: null })}
      />
      {logo !== null && (
        <>
          <RadioField
            label={strings.form.logo.position}
            pointer={`${at}/position`}
            value={logo.position}
            options={[
              { value: 'left', label: strings.form.logo.left },
              { value: 'center', label: strings.form.logo.center },
              { value: 'right', label: strings.form.logo.right },
            ]}
          />
          <NumberField
            className="w-40"
            label={strings.form.logo.height}
            hint={strings.form.logo.heightHint(min, max)}
            pointer={`${at}/heightMm`}
            value={logo.heightMm}
            alsoError={tooTall}
          />
        </>
      )}
    </div>
  )
}

function BackgroundSection({
  entity,
  variantName,
  background,
}: {
  entity: Entity
  variantName: VariantName
  background: string | null
}) {
  const headingId = useId()
  const { dispatch } = useForm()
  const at = pointerOf('variants', variantName, 'background')
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="text-sm font-semibold text-text">
        {strings.form.background.title}
      </h4>
      <AssetField
        entity={entity}
        kind="background"
        assetId={background}
        pointer={at}
        label={strings.form.background.file}
        hint={`${strings.asset.accept} ${strings.form.background.hint}`}
        removeLabel={strings.form.background.remove}
        what={strings.form.background.title}
        onUploaded={(uploaded) => dispatch({ type: 'set', pointer: at, value: uploaded.id })}
        onRemove={() => dispatch({ type: 'set', pointer: at, value: null })}
      />
    </div>
  )
}
