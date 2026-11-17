"""Generator of the golden corpus's INPUTS: assets, letterheads and fixtures.

Run from `letterhead-api/engine/tests/golden/`:   python3 -I gen.py

It rewrites `assets/`, `letterheads/` and `fixtures/` (and nothing else). It is a convenience for the
fixtures that are too large to write by hand (the offer, the page-break corpus); the JSON it writes is what
is committed and what the tests read. The goldens in `layout-1/` are NOT touched: they are recorded from the
engine (see README.md). Changing an input changes the output of every layout that renders it, so after a run
`git diff` must show only what you meant to change, and a layout that is already pinned keeps its goldens
(see the ADR: a changed input is a NEW fixture, not an edit of an old one).

Standard library only, deterministic (no clock, no randomness): two runs write the same bytes.

Derived from the Typst spike's `fixtures/gen.py` (specs/20261116-letterhead-service/spike.md), ported to the
content model v1 and the LetterheadConfig v1 of the engine.
"""
import base64
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))

LOGO_ID = "11111111-1111-4111-8111-111111111111"
BAND_ID = "22222222-2222-4222-8222-222222222222"
BACKGROUND_ID = "33333333-3333-4333-8333-333333333333"
SMALL_LOGO_ID = "44444444-4444-4444-8444-444444444444"


# ─── assets ──────────────────────────────────────────────────────────────────────────────────────────────

def png(width, height, pixel):
    """A deterministic 8-bit RGB PNG; `pixel(x, y)` gives (r, g, b)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def logo_pixel(x, y):
    # A red block with a lighter stripe and a dark square: not symmetric, so a mirrored or shifted logo shows.
    if 8 <= x < 24 and 8 <= y < 32:
        return (31, 36, 48)
    if y % 10 < 3:
        return (240, 90, 120)
    return (229, 3, 57)


def small_logo_pixel(x, y):
    return (31, 36, 48) if (x // 5 + y // 5) % 2 == 0 else (89, 92, 105)


def background_pixel(x, y):
    # A pale diagonal pattern across the whole page: a watermark-like background (AC-7.7).
    d = (x + y) % 16
    return (245, 246, 250) if d < 8 else (236, 239, 247)


BAND_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297">'
    b'<rect x="0" y="0" width="6" height="297" fill="#e50339"/>'
    b'<circle cx="200" cy="287" r="18" fill="#e50339" fill-opacity="0.08"/></svg>'
)

ASSETS = {
    f"{LOGO_ID}.png": png(100, 40, logo_pixel),
    f"{SMALL_LOGO_ID}.png": png(40, 40, small_logo_pixel),
    f"{BACKGROUND_ID}.png": png(60, 85, background_pixel),
    f"{BAND_ID}.svg": BAND_SVG,
}

LOGO_B64 = base64.b64encode(ASSETS[f"{LOGO_ID}.png"]).decode()


# ─── letterheads (LetterheadConfig v1) ───────────────────────────────────────────────────────────────────

def text(it, en=None):
    return {"it": it, "en": it if en is None else en}


def line(it, en=None, size=8.0, bold=False, color="595c69"):
    return {"text": text(it, en), "size": size, "bold": bold, "color": color}


def frame(valign="top", rule=None, left=None, center=None, right=None):
    return {
        "valign": valign,
        "rule": rule or {"show": False, "thicknessPt": 0.5, "color": "e50339"},
        "left": left or [],
        "center": center or [],
        "right": right or [],
    }


def rule(show, thickness, color):
    return {"show": show, "thicknessPt": thickness, "color": color}


def logo(asset, position, height_mm):
    return {"asset": asset, "position": position, "heightMm": height_mm}


def variant(header, footer, logo_=None, background=None):
    return {"header": header, "footer": footer, "logo": logo_, "background": background}


LOOK = {
    "headings": [
        {"size": 15, "bold": True, "color": "e50339"},
        {"size": 12, "bold": True, "color": "1f2430"},
        {"size": 10.5, "bold": True, "color": "595c69"},
    ],
    "body": {"size": 10.5, "lineSpacing": 1.2},
    "table": {"headerFill": "f1f1f4", "borders": True, "borderColor": "c9cad1"},
    "bulletMarker": "bullet",
}

FONTS = {"body": "Noto Serif", "heading": "Ubuntu", "frame": "Ubuntu"}

# The brand footer of the spike: four lines (legal name red bold 10 pt, address, contacts, fiscal line), the page
# number on the last line at the right.
BRAND_FOOTER = frame(
    valign="bottom",
    rule=rule(True, 0.5, "e50339"),
    left=[
        line("{legal_name}", size=10, bold=True, color="e50339"),
        line("{address}"),
        line("{contacts}"),
        line("[CF/P.IVA {vat}]   [IBAN {iban}]", "[VAT {vat}]   [IBAN {iban}]", size=7.5),
    ],
    right=[line("{page} / {pages}")],
)

OFFER_HEADER = frame(
    rule=rule(True, 0.3, "c9cad1"),
    right=[line("Offerta – pagina {page} di {pages}", "Offer – page {page} of {pages}")],
)

SMALL_FOOTER = frame(
    valign="bottom",
    left=[line("{legal_name}", size=7.5)],
    right=[line("{page} / {pages}", size=7.5)],
)

BRAND_MARGINS = {"top": 32, "bottom": 34, "left": 25.4, "right": 25.4}


def config(margins, variants):
    return {"margins": margins, "fonts": FONTS, "look": LOOK, "variants": variants}


def brand():
    """The reference letterhead (spike): a logo and the full footer on the first page, a header with the page
    number and a small logo on the middle ones, the full footer again on the last, a band behind the first."""
    return config(
        BRAND_MARGINS,
        {
            "default": variant(OFFER_HEADER, SMALL_FOOTER, logo(SMALL_LOGO_ID, "left", 7)),
            "first": variant(frame(), BRAND_FOOTER, logo(LOGO_ID, "left", 12.7), BAND_ID),
            "last": variant(OFFER_HEADER, BRAND_FOOTER, logo(SMALL_LOGO_ID, "left", 7)),
        },
    )


def brand_plain():
    """Variants off: the brand's default variant alone, with the same margins."""
    return config(
        BRAND_MARGINS,
        {"default": variant(OFFER_HEADER, SMALL_FOOTER, logo(SMALL_LOGO_ID, "left", 7))},
    )


def brand_background():
    """Variants off, and a background image on every page (AC-7.7)."""
    return config(
        BRAND_MARGINS,
        {"default": variant(OFFER_HEADER, SMALL_FOOTER, logo(SMALL_LOGO_ID, "left", 7), BACKGROUND_ID)},
    )


def bare():
    """Nothing in the margins: whatever a page draws is the body, so that frame-level checks (nothing outside
    the margins, no empty page) need no knowledge of a header or a footer."""
    return config(
        {"top": 30, "bottom": 28, "left": 24, "right": 22},
        {"default": variant(frame(), frame())},
    )


def overflow_footer():
    """A footer whose four lines do not fit a 12 mm bottom margin (AC-5.3)."""
    c = brand_plain()
    c["margins"] = {"top": 32, "bottom": 12, "left": 25.4, "right": 25.4}
    c["variants"]["default"]["footer"] = BRAND_FOOTER
    return c


def overflow_header():
    c = brand_plain()
    c["margins"] = {"top": 10, "bottom": 34, "left": 25.4, "right": 25.4}
    c["variants"]["default"]["logo"] = None
    return c


LETTERHEADS = {
    "brand": brand(),
    "brand-plain": brand_plain(),
    "brand-background": brand_background(),
    "bare": bare(),
    "overflow-footer": overflow_footer(),
    "overflow-header": overflow_header(),
}


# ─── content ─────────────────────────────────────────────────────────────────────────────────────────────

ENTITY = {
    "legalName": "WellD Italia S.r.l. (SAMPLE)",
    "addressLines": ["Via Esempio 1", "I-16100 Genova (Italia)"],
    "vat": "IT00000000000",
    "iban": "",  # blank: the [IBAN {iban}] segment disappears whole (AC-6.6)
    "contacts": "www.example.com — info@example.com",
}


def run(text_, bold=False, italic=False, underline=False):
    r = {"text": text_}
    if bold:
        r["bold"] = True
    if italic:
        r["italic"] = True
    if underline:
        r["underline"] = True
    return r


def P(*runs, style=None):
    block = {"type": "paragraph", "runs": [r if isinstance(r, dict) else {"text": r} for r in runs]}
    if style:
        block["style"] = style
    return block


def H(level, text_):
    return {"type": "heading", "level": level, "text": text_}


def LI(items, ordered=False):
    block = {"type": "list", "items": [{"runs": [{"text": i}]} for i in items]}
    if ordered:
        block["ordered"] = True
    return block


def C(text_, bold=False):
    """A table cell holding one paragraph."""
    return [{"type": "paragraph", "runs": [run(text_, bold=bold)]}]


def table(columns, header, rows, align=None):
    t = {"type": "table", "columns": columns, "rows": rows}
    if header is not None:
        t["header"] = header
    if align:
        t["align"] = align
    return t


PAGE_BREAK = {"type": "pageBreak"}


def request(blocks, language="it", entity=ENTITY):
    return {
        "contentVersion": 1,
        "entity": "welld_it",
        "language": language,
        "entityData": entity,
        "blocks": blocks,
    }


GENERAL = [
    ("Limitazione di responsabilità", "Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite. Le responsabilità del Fornitore e delle sue risorse sono limitate all’esecuzione della fornitura in oggetto, che viene portata avanti a regola d’arte e in conformità con le specifiche concordate con il Cliente."),
    ("Legislazione del lavoro", "Il personale del Fornitore opera nel pieno rispetto della legislazione del lavoro. Qualora il Cliente necessitasse di documentazione in merito, sarà cura del Fornitore presentarla."),
    ("Riservatezza e proprietà", "Il Fornitore si impegna a mantenere la massima riservatezza per quanto concerne l’uso di documenti, disegni e informazioni di cui verrà a conoscenza per effetto del contratto di fornitura. Il Fornitore garantisce che quanto fornito in esecuzione del presente accordo non viola diritti di proprietà intellettuale/industriale di terzi."),
    ("Privacy e trattamento dei dati personali", "Il Cliente e il Fornitore si fanno entrambi garanti del rispetto delle norme vigenti sulla Privacy. Il Cliente è autorizzato a comunicare a terzi i dati del Fornitore per operazioni legate alla fornitura in oggetto."),
    ("Foro competente", "Per qualsiasi controversia che dovesse sorgere in relazione al presente contratto di fornitura, il foro competente è quello di Lugano (Svizzera)."),
    ("Clausola di inefficacia", "Nell’eventualità in cui una qualsiasi clausola del presente contratto dovesse in seguito risultare inefficace per un qualsiasi motivo giuridico, ciò non inficerà la validità delle restanti clausole. In luogo della norma inefficace si considererà come voluta e dichiarata quella regolamentazione giuridicamente valida che maggiormente si avvicinerà al senso e allo scopo della clausola inefficace e del contratto nel suo insieme, tenendo in considerazione la buona fede, l’usanza commerciale nonché gli usi ed i costumi del settore."),
]


def offer_blocks():
    """A real offer (crm-api defaultTemplates.ts, Italian, client details removed): nine sections, a cost table
    with a header row and a total, bold/italic/underline runs, ordered and bulleted lists, an image, a page
    break."""
    rows = [
        ["Analisi e design", "Workshop, user journey, architettura", "12", "16 800.00"],
        ["Sviluppo backend", "API, integrazioni, persistenza", "38", "53 200.00"],
        ["Sviluppo frontend", "Interfaccia web responsive", "30", "42 000.00"],
        ["Test e collaudo", "Test automatici, UAT con il Cliente", "10", "14 000.00"],
        ["Rilascio", "Messa in produzione e handover", "4", "5 600.00"],
    ]
    blocks = [
        P("Genova, 16 novembre 2026", style="right"),
        P("Spett.le\nCliente di esempio SA\nVia Campione 3\n6900 Lugano"),
        P("OFFERTA N. 2026-0142 – PIATTAFORMA DI GESTIONE ORDINI", style="title"),
        P("Con riferimento alle discussioni intercorse, abbiamo piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto."),
        P("Il presente contratto viene stipulato tra ", run("WellD Italia S.r.l.", bold=True), ", di seguito denominata ‘Fornitore’ e ", run("Cliente di esempio SA", bold=True), ", di seguito denominato ‘Cliente’."),
        H(1, "1. Definizioni"),
        P(run("A corpo:", bold=True), " attività svolta dal Fornitore presso la propria sede o luogo da esso gestito e fatturata sulla base del rilascio di un prodotto/servizio."),
        P(run("A servizio:", bold=True), " attività svolta dal Fornitore presso la sede propria o del Cliente, su richiesta del Cliente stesso e fatturata sulla base di uno statino di esecuzione dei lavori."),
        H(1, "2. Oggetto della fornitura"),
        P("Oggetto della fornitura è la progettazione e lo sviluppo di una piattaforma web per la gestione degli ordini, comprensiva delle integrazioni con i sistemi esistenti del Cliente."),
        LI(["Analisi dei requisiti e design dell’esperienza utente", "Sviluppo del backend e delle integrazioni", "Sviluppo dell’interfaccia web", "Test, collaudo e messa in produzione"]),
        H(1, "3. Service Level Agreement"),
        P("L’attività di manutenzione applicativa viene offerta sulla base di uno SLA (Service Level Agreement) di intervento per segnalazioni relative all’applicativo."),
        P(run("Lo SLA include:", bold=True)),
        LI(["La disponibilità di personale qualificato alla presa in carico e all’analisi dei ticket secondo le tempistiche riportate.", "Il tempo effettivo impiegato nella risoluzione delle segnalazioni, fino ad un massimo di 25 ore lavorative annue."], ordered=True),
        P(run("Lo SLA esclude:", bold=True)),
        LI(["Segnalazioni che non vengano comunicate tramite il sistema di ticketing fornito.", "Richieste che si configurassero come importanti cambiamenti rispetto ai requisiti iniziali (Change Request) nel sistema manutenuto (es. aggiunta di nuove funzionalità, sezioni, requisiti nuovi).", "Attività di affiancamento e handover in caso di terminazione del servizio."], ordered=True),
        H(2, "Altre condizioni di SLA"),
        P("Una giornata lavorativa include il tempo tra le ore 9.00 e le ore 18.00 CET. Le giornate lavorative sono quelle previste dal Calendario Ufficiale della Repubblica e Cantone Ticino. Lo SLA non prevede penali o tempi di risoluzione prefissati, essendo questi strettamente dipendenti dal tipo di segnalazione sollevata."),
        H(1, "4. Modalità di fornitura"),
        P("La fornitura è da intendersi a corpo."),
        P("Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente, così come i costi dell’infrastruttura di produzione."),
        H(2, "Trasferte"),
        P("I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso al Cliente unitamente ai giustificativi di spesa."),
        H(1, "5. Risorse e garanzia"),
        P("Le risorse tecniche allocate dal Fornitore allo sviluppo della fornitura hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura."),
        P("Se l’oggetto prevede la realizzazione di software, questo viene rilasciato con un periodo di ", run("12 mesi di garanzia dalla data di primo rilascio in produzione", underline=True), ". La garanzia copre la risoluzione di difetti (bug) applicativi e non prevede uno specifico ", run("Service Level Agreement", italic=True), "."),
        H(1, "6. Costi"),
        table(
            [3, 5, 1.2, 2],
            [C("Attività", True), C("Descrizione", True), C("GG", True), C("CHF", True)],
            [[C(a), C(b), C(c), C(d)] for a, b, c, d in rows] + [[C("Totale", True), C(""), C("94", True), C("131 600.00", True)]],
            align=["left", "left", "right", "right"],
        ),
        P(run("Note:", bold=True)),
        LI(["I costi si intendono IVA esclusa.", "La fatturazione avviene al raggiungimento delle milestone concordate."]),
        H(1, "7. Rinnovi e disdette"),
        P("Non sono previsti rinnovi o disdette."),
        H(1, "8. Validità dell’offerta"),
        P("La presente offerta è valida per 30 giorni solari."),
        {"type": "image", "data": LOGO_B64, "widthRatio": 0.25},
        PAGE_BREAK,
        H(1, "9. Condizioni generali"),
        P("In aggiunta a quanto sopra specificato, valgono le seguenti Condizioni Generali di fornitura."),
    ]
    for heading, body in GENERAL:
        blocks += [H(2, heading), P(body)]
    blocks += [P(""), P("Per accettazione", style="right"), P("______________________________", style="right")]
    return blocks


def every_block():
    """Each block type, once, in order (AC-1.5). The headings carry the markers B1..B9 that the test looks for."""
    return [
        H(1, "B1 Heading one"),
        H(2, "B2 Heading two"),
        H(3, "B3 Heading three"),
        P("B4 Paragraph with ", run("bold", bold=True), ", ", run("italic", italic=True), " and ", run("underline", underline=True), " runs."),
        LI(["B5 first bullet", "B5 second bullet"]),
        LI(["B6 first step", "B6 second step"], ordered=True),
        table(
            [2, 3, 1],
            [C("B7 Name", True), C("B7 Note", True), C("B7 Qty", True)],
            [[C("B7 alpha"), C("B7 first row"), C("1")], [C("B7 beta"), C("B7 second row"), C("2")]],
            align=["left", "left", "right"],
        ),
        {"type": "image", "data": LOGO_B64, "widthRatio": 0.3},
        P("B8 before the break"),
        PAGE_BREAK,
        P("B9 after the break"),
    ]


LOREM = (
    "Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite e si impegna a mantenere "
    "la massima riservatezza per quanto concerne l’uso di documenti, disegni e informazioni di cui verrà a "
    "conoscenza per effetto del contratto. "
)


def breaks():
    """The page-break rules of AC-1.6: paragraphs of every length, lists, headings that land near the bottom of
    a page, tables with rows from one line to taller than a page, repeated page breaks, a leading and a
    trailing page break, and words wider than their line or cell (amendment A4). `bare` has nothing in the
    margins, so any ink outside the body, and any empty page, is the layout's fault."""
    blocks = [PAGE_BREAK]  # a leading page break must not make an empty first page
    for k in range(1, 25):
        blocks += [H(2 if k % 3 else 1, f"Sezione {k}"), P(f"P{k:02d} " + (LOREM * ((k % 7) + 1)).strip())]
        if k % 5 == 0:
            blocks.append(LI([f"L{k:02d}.{i} " + LOREM * ((k % 4) + 1) for i in (1, 2, 3)]))
        if k % 8 == 0:
            blocks.append(
                table(
                    [1, 4],
                    [C("Voce", True), C("Testo", True)],
                    [[C(f"T{k:02d}r{j:02d}"), C(LOREM * (j % 3 + 1))] for j in range(16)]
                    + [[C(f"T{k:02d}tall"), C(LOREM * 25)], [C(f"T{k:02d}huge"), C(LOREM * 70)]],
                )
            )
        if k % 11 == 0:
            blocks += [PAGE_BREAK, PAGE_BREAK]
    # A long run of paragraphs of four to nine lines: a page ends inside one of them again and again, which is
    # where a widow or an orphan would show.
    blocks.append(H(1, "Flusso"))
    for i in range(40):
        blocks.append(P(f"F{i:02d} " + (LOREM * (2 + i % 3)).strip()))
    blocks += [
        H(1, "Parole lunghe"),
        P("W01 " + "x" * 300),
        P("W02 https://example.com/" + "percorso-molto-lungo/" * 12 + "fine"),
        table(
            [1, 1, 3],
            [C("Campo", True), C("Valore", True), C("Nota", True)],
            [[C("W03 IBAN"), C("CH9300762011623852957CH9300762011623852957CH9300762011623852957"), C("W03 breve")]],
        ),
        H(2, "W04 " + "y" * 120),
        P("Fine."),
        PAGE_BREAK,  # a trailing page break must not make an empty last page
    ]
    return blocks


INJECTION = [
    "#set page(width: 1cm)", '#read("/etc/hostname")', "$x^2$", "*a*", "_a_", "`raw` ```rust fn x(){}```", "@label",
    "<label>", "\\", "{page}", '#import "/main.typ": *', '#image("/etc/passwd")', '#plugin("/x.wasm")', "]#panic(\"x\")[",
    '#{ panic("x") }', "//comment", "/* c */", '#eval("1+1")', '#json("/data.json")', "{legal_name} [x] {{y}} [[z]]",
]


def inject():
    """The AC-2.1 set in every place a person's text can go: heading, paragraph runs (plain, bold, italic), list
    item, table header and cell. `{page}` and `{legal_name}` in a body are printed as typed (AC-2.4)."""
    blocks = [H(1, "Injection set")]
    for s in INJECTION:
        blocks += [
            H(2, s),
            P(s, run(s, bold=True), run(s, italic=True)),
            LI([s]),
            table([1, 1], [C(s, True), C(s)], [[C(s), C(s)]]),
        ]
    return blocks


def glyphs():
    return [
        P("Coverage: àèéìòù ÀÈÉÌÒÙ äöüß ÄÖÜ çœæ ÇŒÆ ëïÿ « » € CHF l’offerta d’uso ‘’ “” – —"),
        P("Outside the fonts: 漢字 😀 ⨌ ᚠ"),
    ]


def clusters_and_stretches():
    """The three defects T38 fixed, in every place they can occur (AC-1.6, AC-2.1, AC-5.1): a combining mark
    after a letter (which Typst draws as two items that both carry the cluster), a stretch that Unicode forbids
    breaking and that is wider than its line, and a table header row as tall as a page or taller (50 lines: a
    little more than a page; 130 lines: three pages). The marks are ones that pdfium reads back in order and
    without a space of its own (it reads U+0361 and U+0315 out of order, and puts a space after some marks):
    AC-1.3 compares with pdfium's text, so a text with those marks is checked by `marks_in_the_pdf` instead."""
    marks = "Marks: a\u0312z b\u0343c d\u0334e e\u0301 o\u0308 n\u0303 a\u0346 \u00e9\u0346"
    stretch = "]" * 80
    close = ") " * 90
    header = lambda n, tag: f"{tag} first\n" + "".join(f"{tag}-{i:03d}\n" for i in range(n)) + f"{tag} last"
    return [
        H(1, "Marks"),
        P(marks),
        P(run("bold a\u0312z", bold=True), " plain a\u0343z ", run("italic a\u0334z", italic=True), " underlined ", run("a\u0346z", underline=True)),
        LI(["item a\u0312z", "item a\u0334z"]),
        table([1, 1], [C("head a\u0312z", True), C("head b\u0343z", True)], [[C("cell a\u0312z"), C("cell \u00e9\u0346z")]]),
        P("Between two: pre\u00adfix and suffix"),
        H(1, "Stretches"),
        P(f"{stretch} {stretch} {stretch}"),
        P(f"Before {close.strip()} after"),
        P("Slashes / / / " + "/ " * 150),
        P("Marks ! ! ! " + "! " * 150 + "end"),
        P("Open ( ( ( " + "( " * 150 + "end"),
        LI([f"{stretch} {stretch} {stretch}", "item " + close.strip()]),
        H(2, f"{stretch} {stretch} {stretch}"),
        table(
            [1, 1],
            [C("Campo", True), C(f"{stretch} {stretch}", True)],
            [[C(f"{stretch} {stretch} {stretch}"), C(close.strip())]],
        ),
        P(run(f"{stretch} {stretch}", bold=True), run(f" {stretch} {stretch}", italic=True)),
        PAGE_BREAK,
        H(1, "Header rows"),
        table([1], [C(header(50, "H50"), True)], [[C("row one")], [C("row two")]]),
        P("After the table of 50."),
        PAGE_BREAK,
        table([1, 1], [C(header(130, "H130"), True), C("side", True)], [[C("row one"), C("a")], [C("row two"), C("b")]]),
        P("After the table of 130."),
        PAGE_BREAK,
        table([1], [C(header(40, "H40"), True)], [[C("row one")], [C(LOREM * 10)], [C("row three")]]),
        P("After the table of 40."),
    ]


def one_page():
    return [H(1, "Una pagina"), P("Un documento di una sola pagina usa la variante della prima pagina, mai quella dell’ultima.")]


INJECT_ENTITY = dict(
    ENTITY,
    legalName="#set page(width: 1cm) $x$ *a* {page}",
    vat='#read("/etc/hostname")',
    contacts="@label <label> \\ `x`",
)

FIXTURES = {
    "offer-it": ("The offer in Italian on the brand letterhead: first, middle and last pages differ (AC-5.4, AC-5.5).", "brand", request(offer_blocks())),
    "offer-en": ("The same offer in English: the frame texts change, the page breaks do not (AC-5.8).", "brand", request(offer_blocks(), "en")),
    "offer-it-novariants": ("The offer with the variants off: the default variant on every page (AC-5.5).", "brand-plain", request(offer_blocks())),
    "offer-it-background": ("The offer with a background image on every page: the same page breaks (AC-7.7).", "brand-background", request(offer_blocks())),
    "every-block": ("Each block type once, in order (AC-1.5).", "brand", request(every_block())),
    "one-page": ("A document of one page uses the first-page variant, never the last-page one (AC-5.5).", "brand", request(one_page())),
    "breaks": ("The page-break rules of AC-1.6 on a letterhead with nothing in the margins.", "bare", request(breaks())),
    "inject": ("The injection set of AC-2.1 in every position, and in the entity data (AC-2.4).", "brand", request(inject(), entity=INJECT_ENTITY)),
    "clusters-stretches": ("Combining marks, stretches that Unicode forbids breaking, and table headers as tall as a page (AC-1.6, AC-2.1, AC-5.1).", "bare", request(clusters_and_stretches())),
    "glyphs": ("Characters inside and outside the bundled fonts (AC-7.5, AC-7.6).", "brand", request(glyphs())),
    "overflow-footer": ("A footer taller than its margin is refused, never drawn over the body (AC-5.3).", "overflow-footer", request(one_page())),
    "overflow-header": ("A header taller than its margin is refused (AC-5.3).", "overflow-header", request(one_page())),
}


# ─── write ───────────────────────────────────────────────────────────────────────────────────────────────

def write_json(path, value):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, ensure_ascii=False, indent=1)
        f.write("\n")


def main():
    for sub in ("assets", "letterheads", "fixtures"):
        os.makedirs(os.path.join(HERE, sub), exist_ok=True)
    for name, data in ASSETS.items():
        with open(os.path.join(HERE, "assets", name), "wb") as f:
            f.write(data)
    for name, value in LETTERHEADS.items():
        write_json(os.path.join(HERE, "letterheads", f"{name}.json"), value)
    for name, (description, letterhead, req) in FIXTURES.items():
        write_json(
            os.path.join(HERE, "fixtures", f"{name}.json"),
            {"description": description, "letterhead": letterhead, "request": req},
        )
    print(f"wrote {len(ASSETS)} assets, {len(LETTERHEADS)} letterheads, {len(FIXTURES)} fixtures")


if __name__ == "__main__":
    main()
