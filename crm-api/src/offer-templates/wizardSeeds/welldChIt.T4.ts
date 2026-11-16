/**
 * "Formazione" (mockup template T4), converted to the offer wizard's template grammar
 * (specs/20261115-crm-offer-wizard T21; plan DD-1, DD-5, DD-12, DD-13, DD-26). Italian text of entity welld_ch.
 *
 * Differences from the mockup's text, all listed in AC-9.6: no page-1 header, acceptance block or
 * "Allegati:" line (the CRM draws them), unnumbered headings, no width hints or page breaks, and the
 * literal "CHF" next to an amount is the deal's currency (`[VALUTA]`). The mockup's repeated `_1 _2 _3`
 * placeholders are one list or table each; its detection heuristics are explicit declarations. The additional
 * participant price's label drops the mockup's "(CHF)" and the AI budget's example "es. 25 EUR" is "es. 25": no label, hint or example
 * names a currency (AC-9.6, SA-6).
 */
export const T4_TEXT = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope

**A corpo:** attività svolta dal Fornitore presso la propria sede o luogo concordato e fatturata sulla base dell'erogazione di una prestazione professionale.

**Edizione:** un ciclo completo del corso, erogato a un gruppo di partecipanti.

## OGGETTO DELLA FORNITURA

Oggetto della fornitura è il corso di formazione **[TITOLO_CORSO]**{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}. Il corso ha le seguenti caratteristiche:

| Caratteristica | Valore |
|---|---|
| **Durata** | **[GIORNATE]** giornate{{?ORE::, **[ORE]** ore complessive}} |
| {{?ARTICOLAZIONE::**Articolazione**}} | {{?ARTICOLAZIONE::**[ARTICOLAZIONE]**}} |
| **Modalità** | **[MODALITÀ]** |
| **Partecipanti** | fino a **[MAX_PARTECIPANTI]**, designati dal Cliente |
| {{?N_ISTRUTTORI::**Istruttori**}} | {{?N_ISTRUTTORI::**[N_ISTRUTTORI]**}} |
| {{?LINGUA::**Lingua**}} | {{?LINGUA::**[LINGUA]**}} |
| {{?ORARIO::**Orario**}} | {{?ORARIO::**[ORARIO]**}} |

{{allegato_a::Il programma del corso è riportato nell'**Allegato A**, parte integrante del presente contratto.}} I contenuti dei moduli possono variare in accordo con il Cliente.

{{?PREREQUISITI::Prerequisiti per i partecipanti: **[PREREQUISITI]**.}}

## ATTIVITÀ E TEMPISTICHE

Il calendario delle giornate è concordato con il Cliente.

{{conferma::Il Cliente conferma il numero dei partecipanti almeno **[GIORNI_CONFERMA]** giorni lavorativi prima dell'avvio del corso.}}

## CONDIZIONI DI FORNITURA
@@step conditions

La fornitura è da intendersi a corpo. Il corso si svolge presso la sede del Fornitore o presso la sede indicata dal Cliente, previo accordo tra le Parti.

Il prezzo comprende:

- la docenza a cura degli istruttori del Fornitore per l'intera durata del corso;
- {{attestato::l'attestato di partecipazione per ciascun partecipante;}}
- il materiale didattico e le esercitazioni pratiche.

Il prezzo non comprende:

- la sede, l'aula e le attrezzature, quando il corso si svolge presso il Cliente;
- le postazioni di lavoro dei partecipanti;
- le licenze di software specifici o di strumenti di terzi;
- il vitto e le spese dei partecipanti.

La fornitura esclude quanto non esplicitamente dichiarato.

### Trasferte

I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso unitamente ai giustificativi di spesa.

@@OPT_START cancellazione
### Rinvio e cancellazione

Il Cliente può rinviare il corso senza costi fino a 15 giorni lavorativi prima dell'avvio. In caso di cancellazione oltre tale termine è dovuto il 50% dell'importo del par. 6; a corso avviato è dovuto il 100%.
@@OPT_END

@@OPT_START ai_corso
### Ambiente di Intelligenza Artificiale del corso

Per le esercitazioni il Fornitore mette a disposizione un ambiente di Intelligenza Artificiale gestito{{?BUDGET_AI::, con un budget d'uso di **[BUDGET_AI]** per partecipante}}. L'ambiente è destinato al solo codice del corso: i partecipanti non vi inseriscono codice o dati proprietari del Cliente. Le richieste sono tracciate e attribuite al singolo partecipante.
@@OPT_END

## RISORSE

Il corso è tenuto da istruttori del Fornitore, con competenze e qualifiche adeguate ai contenuti. Gli istruttori possono variare nel corso della fornitura.

## COSTI
@@step costs
@@costs position unit
@@line corso one_off | **[TITOLO_CORSO]**, **[UNITÀ_DI_PREZZO]** | unit=? | qty=?
@@OPT_START sconto
@@line sconto discount | Scontistica accordata | unit=?
@@OPT_END
@@total **TOTALE**
@@end

**Note:**

- I costi si intendono IVA esclusa.
- {{nota_corpo::Il prezzo a corpo è fisso fino al numero massimo di partecipanti indicato al par. 2, indipendentemente dal numero effettivo di iscritti.{{?PREZZO_PARTECIPANTE_AGGIUNTIVO:: Ogni partecipante oltre il massimo è fatturato **[PREZZO_PARTECIPANTE_AGGIUNTIVO]**.- [VALUTA].}}}}
- {{nota_partecipante::Il prezzo per partecipante è fatturato sul numero di partecipanti confermati{{?MIN_PARTECIPANTI::, con un minimo di **[MIN_PARTECIPANTI]**}}.}}

## VALIDITÀ DELL'OFFERTA

La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari. Non sono previsti rinnovi o disdette.

## FATTURAZIONE

La fatturazione avviene in base al seguente piano:

- **[ACCONTO]**% alla conferma d'ordine;
- **[SALDO]**% al termine del corso.

Le fatture sono pagabili a 30 giorni data fattura.

## CONDIZIONI GENERALI
@@step annexes

In aggiunta a quanto sopra specificato, valgono le seguenti Condizioni Generali di fornitura.

### Limitazione di responsabilità

Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite. Le responsabilità del Fornitore e delle sue risorse sono limitate all'esecuzione della fornitura in oggetto, che viene portata avanti a regola d'arte e in conformità con le specifiche concordate con il Cliente.

### Legislazione del lavoro

Il personale del Fornitore opera nel pieno rispetto della legislazione del lavoro. Qualora il Cliente necessitasse di documentazione in merito, sarà cura del Fornitore presentarla.

### Riservatezza e proprietà

Il Fornitore si impegna a mantenere la massima riservatezza per quanto concerne l'uso di documenti, disegni e informazioni di cui verrà a conoscenza per effetto del contratto di fornitura.

Il materiale didattico e gli strumenti forniti durante il corso restano di proprietà del Fornitore. Il Cliente e i partecipanti possono utilizzarli per uso interno.

Il Fornitore garantisce che quanto fornito in esecuzione del presente accordo non viola diritti di proprietà intellettuale o industriale di terzi.

### Privacy e trattamento dei dati personali

Il Cliente e il Fornitore si fanno entrambi garanti del rispetto delle norme vigenti sulla Privacy. Il Cliente è autorizzato a comunicare a terzi i dati del Fornitore per operazioni legate alla fornitura in oggetto. All'accettazione del presente contratto il Cliente accetta egualmente la politica sulla Privacy di [EMITTENTE], la cui documentazione integrale viene fornita su richiesta o allegata.

### Foro competente

Per qualsiasi controversia che dovesse sorgere in relazione al presente contratto di fornitura, il foro competente è quello di Lugano (Svizzera).

### Clausola di inefficacia

Nell'eventualità in cui una qualsiasi clausola del presente contratto dovesse in seguito risultare inefficace per un qualsiasi motivo giuridico, ciò non inficerà la validità delle restanti clausole. In luogo della norma inefficace si considererà come voluta e dichiarata quella regolamentazione giuridicamente valida che maggiormente si avvicinerà al senso e allo scopo della clausola inefficace e del contratto nel suo insieme, tenendo in considerazione la buona fede, l'usanza commerciale nonché gli usi e i costumi del settore. Eventuali lacune contrattuali saranno trattate analogamente.

@@OPT_START allegato_a
@@annex A Programma del corso
@@subtitle [TITOLO_CORSO]

## Obiettivi

{{?OBIETTIVO::Al termine del corso i partecipanti sono in grado di:}}

- {{?OBIETTIVO::**[OBIETTIVO]**}}

## Destinatari e prerequisiti

- {{?DESTINATARI::Destinatari: **[DESTINATARI]**}}
- {{?PREREQUISITI::Prerequisiti: **[PREREQUISITI]**}}

## Programma

| Modulo | Contenuti | Durata |
|---|---|---|
| **[MODULO]** | **[CONTENUTI]** | **[ORE_MODULO]** |

## Materiali

- {{?MATERIALE::**[MATERIALE]**}}
@@OPT_END

@@field CLIENTE
source: client

@@field EMITTENTE
source: issuer

@@field VALUTA
source: currency

@@field VALIDITA_GIORNI
label: Validità dell'offerta (giorni)
kind: number
source: validityDays

@@field TITOLO_CORSO
label: Titolo del corso

@@field DESCRIZIONE_IN_UNA_FRASE
label: Descrizione in una frase
kind: longtext

@@field GIORNATE
label: Giornate
kind: number

@@field ORE
label: Ore complessive
kind: number

@@field ARTICOLAZIONE
label: Articolazione
example: es. 3 blocchi da 2 giornate

@@field MODALITÀ
label: Modalità
options: in presenza | da remoto | in presenza o da remoto

@@field MAX_PARTECIPANTI
label: Partecipanti (massimo)
kind: number

@@field N_ISTRUTTORI
label: Istruttori
kind: number

@@field LINGUA
label: Lingua
default: italiano

@@field ORARIO
label: Orario
default: 09:00–18:00

@@field PREREQUISITI
label: Prerequisiti dei partecipanti

@@field GIORNI_CONFERMA
label: Conferma entro (giorni lavorativi)
kind: number
default: 10

@@field BUDGET_AI
label: Budget AI per partecipante
example: es. 25

@@field UNITÀ_DI_PREZZO
label: Unità di prezzo
options: a corpo | per partecipante
default: a corpo

@@field PREZZO_PARTECIPANTE_AGGIUNTIVO
label: Prezzo per partecipante aggiuntivo
kind: number

@@field MIN_PARTECIPANTI
label: Minimo partecipanti
kind: number

@@field ACCONTO
label: Acconto (%)
kind: percentage
default: 50

@@field SALDO
label: Saldo (%)
kind: percentage
compute: 100 - ACCONTO

@@field DESTINATARI
label: Destinatari

@@field CONTENUTI
label: Contenuti

@@field ORE_MODULO
label: Ore complessive
kind: number

@@list OBIETTIVO
label: Obiettivi

@@list MATERIALE
label: Materiali

@@table MODULO
label: Modulo
columns: MODULO, CONTENUTI, ORE_MODULO

@@block allegato_a
label: Allegato A
explain: Programma del corso in allegato.
default: on

@@block conferma
label: Conferma dei partecipanti
explain: Il Cliente conferma il numero dei partecipanti entro un termine.

@@block attestato
label: Attestato di partecipazione
explain: Compreso nel prezzo.
default: on

@@block cancellazione
label: Rinvio e cancellazione
explain: Rinvio gratuito fino a 15 giorni lavorativi prima; poi 50%, a corso avviato 100%.
default: on

@@block ai_corso
label: Ambiente AI del corso
explain: WellD mette a disposizione un ambiente AI gestito, con budget per partecipante.

@@block sconto
label: Scontistica accordata
explain: Aggiunge la riga di sconto, come importo.

@@block nota_corpo
label: Prezzo a corpo
explain: Importo fisso fino al numero massimo di partecipanti.
fills: UNITÀ_DI_PREZZO = a corpo

@@block nota_partecipante
label: Prezzo per partecipante
explain: Fatturato sui partecipanti confermati, con un minimo.
fills: UNITÀ_DI_PREZZO = per partecipante

@@choice prezzo
label: Modello di prezzo
options: nota_corpo | nota_partecipante
default: nota_corpo
`;
