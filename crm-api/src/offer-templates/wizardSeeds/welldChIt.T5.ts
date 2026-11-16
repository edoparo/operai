/**
 * "Consulenza e assessment" (mockup template T5), converted to the offer wizard's template grammar
 * (specs/20261115-crm-offer-wizard T21; plan DD-1, DD-5, DD-12, DD-13, DD-24, DD-26). Italian text of entity welld_ch.
 *
 * Differences from the mockup's text, all listed in AC-9.6: no page-1 header, acceptance block or
 * "Allegati:" line (the CRM draws them), unnumbered headings, and the literal "CHF" next to an amount is
 * the deal's currency (`[VALUTA]`). The mockup's free "Allegati" field is gone: the deal's PDF files are
 * picked in the Annexes step (DD-24).
 */
export const T5_TEXT = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope

**A corpo:** attività svolta dal Fornitore presso la propria sede o da remoto, finalizzata alla produzione e consegna di un deliverable concordato con il Cliente e fatturata sulla base del rilascio di tale deliverable.

**A regia:** attività svolta dal Fornitore su richiesta scritta del Cliente e fatturata sulla base del tempo effettivamente impiegato.

**Deliverable:** il documento o l'insieme di documenti indicati nel par. 2, risultato della fornitura.

## OGGETTO DELLA FORNITURA

Oggetto della fornitura è **[OGGETTO_CONSULENZA]**{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}.{{?CONTENUTO:: L'attività comprende:}}

- {{?CONTENUTO::**[CONTENUTO]**}}

Il risultato della fornitura è il seguente Deliverable: **[DELIVERABLE]**.

## ATTIVITÀ E TEMPISTICHE

{{?ATTIVITÀ::La fornitura è articolata nelle seguenti attività:}}

- {{?ATTIVITÀ::**[ATTIVITÀ]**}}

{{?GG::Effort complessivo: **[GG]** giorni/uomo. }}La fornitura sarà completata entro **[DURATA]** dall'avvio. Tale stima è soggetta a variazioni in corso d'opera, fermo restando che al Cliente è garantita evidenza periodica dello stato di avanzamento dei lavori.

## CONDIZIONI DI FORNITURA
@@step conditions

La fornitura è da intendersi a corpo. Le attività si svolgeranno di norma presso la sede del Fornitore o da remoto e, per i momenti di confronto e allineamento, presso la sede indicata dal Cliente.

Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente.

La fornitura esclude quanto non esplicitamente dichiarato nel par. 2.

### Trasferte

I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso unitamente ai giustificativi di spesa.

### Collaborazione del Cliente

Il rispetto delle tempistiche del par. 3 presuppone che il Cliente:

- designi un referente unico con potere di approvazione;
- garantisca la disponibilità delle persone coinvolte per gli incontri e le validazioni;
- fornisca la documentazione, i dati e gli accessi necessari{{?MATERIALI_DATI_ACCESSI::: **[MATERIALI_DATI_ACCESSI]**}};
- dia riscontro alle bozze entro 5 giorni lavorativi.

I ritardi dovuti al mancato rispetto di questi punti si riflettono sulle tempistiche del par. 3.

### Accettazione

Alla consegna il Cliente verifica il Deliverable entro 10 giorni lavorativi e segnala per iscritto le eventuali osservazioni rispetto a quanto previsto dal par. 2. Il Fornitore le recepisce senza costi aggiuntivi. In assenza di riscontro entro tale termine, il Deliverable si intende accettato.

## RISORSE, GARANZIA

### Risorse

Le risorse tecniche allocate dal Fornitore hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura.

### Garanzia e attività successive

Il Deliverable non prevede un periodo di garanzia, trattandosi di un'attività consulenziale e non dello sviluppo di software eseguibile.

Eventuali approfondimenti, estensioni dell'analisi o attività di supporto successive alla consegna sono oggetto di nuova offerta oppure sono fatturati alla tariffa a regia di 140.- [VALUTA]/ora oltre IVA.

## COSTI
@@step costs
@@costs position unit
@@line consulenza one_off | **[OGGETTO_CONSULENZA]**, a corpo | unit=? | qty=1
@@OPT_START sconto
@@line sconto discount | Scontistica accordata | unit=?
@@OPT_END
@@total **TOTALE**
@@end

**Note:**

- I costi si intendono IVA esclusa.
- {{scalato::Qualora, a valle della presente fornitura, il Cliente affidi al Fornitore **[FORNITURA_SUCCESSIVA]**{{?TERMINE:: entro **[TERMINE]**}}, l'importo del par. 6 già corrisposto è integralmente scontato dal prezzo di tale fornitura.}}

## VALIDITÀ DELL'OFFERTA

La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari.

## FATTURAZIONE

La fatturazione avviene in base al seguente piano:

- **[ACCONTO]**% acconto a inizio lavori;
- **[SALDO]**% alla consegna del Deliverable.

Le fatture di acconto sono pagabili a vista, le restanti a 30 giorni data fattura.

## CONDIZIONI GENERALI
@@step annexes

In aggiunta a quanto sopra specificato, valgono le seguenti Condizioni Generali di fornitura.

### Limitazione di responsabilità

Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite. Le responsabilità del Fornitore e delle sue risorse sono limitate all'esecuzione della fornitura in oggetto, che viene portata avanti a regola d'arte e in conformità con le specifiche concordate con il Cliente.

### Legislazione del lavoro

Il personale del Fornitore opera nel pieno rispetto della legislazione del lavoro. Qualora il Cliente necessitasse di documentazione in merito, sarà cura del Fornitore presentarla.

### Riservatezza e proprietà

Il Fornitore si impegna a mantenere la massima riservatezza per quanto concerne l'uso di documenti, disegni e informazioni di cui verrà a conoscenza per effetto del contratto di fornitura.

I diritti di proprietà, inclusi i diritti di proprietà intellettuale, siano essi registrabili o meno, di tutto quello che verrà sviluppato secondo il presente contratto apparterranno al Cliente.

Il Fornitore garantisce che quanto fornito in esecuzione del presente accordo non viola diritti di proprietà intellettuale o industriale di terzi.

### Privacy e trattamento dei dati personali

Il Cliente e il Fornitore si fanno entrambi garanti del rispetto delle norme vigenti sulla Privacy. Il Cliente è autorizzato a comunicare a terzi i dati del Fornitore per operazioni legate alla fornitura in oggetto. All'accettazione del presente contratto il Cliente accetta egualmente la politica sulla Privacy di [EMITTENTE], la cui documentazione integrale viene fornita su richiesta o allegata.

### Foro competente

Per qualsiasi controversia che dovesse sorgere in relazione al presente contratto di fornitura, il foro competente è quello di Lugano (Svizzera).

### Clausola di inefficacia

Nell'eventualità in cui una qualsiasi clausola del presente contratto dovesse in seguito risultare inefficace per un qualsiasi motivo giuridico, ciò non inficerà la validità delle restanti clausole. In luogo della norma inefficace si considererà come voluta e dichiarata quella regolamentazione giuridicamente valida che maggiormente si avvicinerà al senso e allo scopo della clausola inefficace e del contratto nel suo insieme, tenendo in considerazione la buona fede, l'usanza commerciale nonché gli usi e i costumi del settore. Eventuali lacune contrattuali saranno trattate analogamente.

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

@@field OGGETTO_CONSULENZA
label: Oggetto della consulenza
example: es. l'assessment tecnico-funzionale di …

@@field DESCRIZIONE_IN_UNA_FRASE
label: Descrizione in una frase
kind: longtext

@@field DELIVERABLE
label: Deliverable
example: es. documento di requisiti e solution design

@@field GG
label: Giorni/uomo
kind: number

@@field DURATA
label: Durata prevista
example: es. 4 mesi

@@field MATERIALI_DATI_ACCESSI
label: Materiali, dati e accessi necessari
kind: longtext
hint: Se vuoto, resta l'impegno generico a fornire quanto necessario.

@@field FORNITURA_SUCCESSIVA
label: Fornitura successiva
example: es. lo sviluppo dell'MVP

@@field TERMINE
label: Entro
example: es. 6 mesi dalla consegna

@@field ACCONTO
label: Acconto (%)
kind: percentage
default: 50

@@field SALDO
label: Saldo (%)
kind: percentage
compute: 100 - ACCONTO

@@list CONTENUTO
label: Contenuti dell'attività

@@list ATTIVITÀ
label: Attività

@@block sconto
label: Scontistica accordata
explain: Aggiunge la riga di sconto, come importo.

@@block scalato
label: Importo scalato dalla fornitura successiva
explain: Se il Cliente affida lo sviluppo, l'importo già pagato viene scontato.
`;
