/**
 * Refused values (design § Copy keys "Problems"): the summary of a refused save, the sentence for each reason
 * of the service's closed list (plan G3 and its amendment of 2026-11-17), and the fallback. The sentence is
 * looked up by `reason`, never by the service's wording; the three shape reasons (`wrong_type`,
 * `missing_member`, `unknown_member`) and any reason this build does not know use `refused`, so the form never
 * shows a code. The words for where a value is (the setting's name) are in `where.ts`.
 */
const en = {
  refused: 'This value was refused.',
  summaryTitle: (n: number) =>
    n === 1 ? 'Nothing was saved: 1 value was refused' : `Nothing was saved: ${n} values were refused`,
  summaryHint: 'Fix them and save again.',
  previewCount: (n: number) => (n === 1 ? '1 value is refused' : `${n} values are refused`),
  previewTitle: 'The preview shows the last valid form',
  previewBody: 'Some values in the form are refused, so the preview was not updated. They are marked in the form.',
  language: { it: 'Italian', en: 'English' },
  side: { top: 'top', bottom: 'bottom' },
  reason: {
    out_of_range: (min: number, max: number, unit: string) =>
      `Use a number between ${min} and ${max}${unit === '' ? '' : ` ${unit}`}.`,
    not_a_number: 'Enter a number.',
    bad_colour: 'Use six hexadecimal digits, for example e50339.',
    unknown_font: 'Choose one of the listed fonts.',
    unknown_placeholder: (name: string | null) =>
      `${name === null ? 'Uses a name that' : `Uses {${name}}, which`} is not a placeholder. The placeholders are listed in the help above.`,
    unbalanced_brace: 'A brace is not closed. Write {{ or }} to print a brace.',
    unbalanced_bracket: 'A square bracket has no partner. Write [[ or ]] to print a square bracket.',
    segment_no_placeholder: 'A segment in square brackets must contain a placeholder. Write [[ to print a bracket.',
    segment_nested: 'A segment in square brackets cannot contain another one.',
    too_many_lines: (max: number) => `A zone holds up to ${max} lines.`,
    language_missing: (language: string) => `Filled in one language but empty in ${language}. Fill in both.`,
    body_too_small: (width: number, height: number) =>
      `The body area would be smaller than ${width} × ${height} mm. Reduce the margins.`,
    frame_overflow: (side: string, characters: number) =>
      `It does not fit the ${side} margin, checked with every placeholder replaced by ${characters} characters. Raise the ${side} margin, shorten the text or use fewer lines.`,
    asset_unknown: 'This image is no longer available. Upload it again.',
  },
}

const it: typeof en = {
  refused: 'Questo valore è stato rifiutato.',
  summaryTitle: (n: number) =>
    n === 1 ? 'Non è stato salvato nulla: 1 valore rifiutato' : `Non è stato salvato nulla: ${n} valori rifiutati`,
  summaryHint: 'Correggili e salva di nuovo.',
  previewCount: (n: number) => (n === 1 ? '1 valore rifiutato' : `${n} valori rifiutati`),
  previewTitle: 'L’anteprima mostra l’ultimo modulo valido',
  previewBody:
    'Alcuni valori del modulo sono rifiutati, quindi l’anteprima non è stata aggiornata. Sono segnalati nel modulo.',
  language: { it: 'italiano', en: 'inglese' },
  side: { top: 'superiore', bottom: 'inferiore' },
  reason: {
    out_of_range: (min: number, max: number, unit: string) =>
      `Usa un numero tra ${min} e ${max}${unit === '' ? '' : ` ${unit}`}.`,
    not_a_number: 'Inserisci un numero.',
    bad_colour: 'Usa sei cifre esadecimali, per esempio e50339.',
    unknown_font: 'Scegli uno dei caratteri elencati.',
    unknown_placeholder: (name: string | null) =>
      `${name === null ? 'Usa un nome che' : `Usa {${name}}, che`} non è un segnaposto. I segnaposto sono elencati nell’aiuto qui sopra.`,
    unbalanced_brace: 'Una parentesi graffa non è chiusa. Scrivi {{ o }} per stamparla.',
    unbalanced_bracket: 'Una parentesi quadra non ha la sua coppia. Scrivi [[ o ]] per stamparla.',
    segment_no_placeholder:
      'Un segmento tra parentesi quadre deve contenere un segnaposto. Scrivi [[ per stampare una parentesi quadra.',
    segment_nested: 'Un segmento tra parentesi quadre non può contenerne un altro.',
    too_many_lines: (max: number) => `Una zona contiene al massimo ${max} righe.`,
    language_missing: (language: string) => `Compilato in una lingua ma vuoto in ${language}. Compila entrambe.`,
    body_too_small: (width: number, height: number) =>
      `L’area del testo sarebbe inferiore a ${width} × ${height} mm. Riduci i margini.`,
    frame_overflow: (side: string, characters: number) =>
      `Non sta nel margine ${side}, controllato con ogni segnaposto sostituito da ${characters} caratteri. Aumenta il margine ${side}, accorcia il testo o usa meno righe.`,
    asset_unknown: 'Questa immagine non è più disponibile. Caricala di nuovo.',
  },
}

export const problem = { en, it }
