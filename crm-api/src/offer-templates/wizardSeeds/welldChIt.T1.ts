/**
 * "Progetto a corpo" (mockup T1, code `T1`) in the offer markup of specs/20261115-crm-offer-wizard § Template text, converted from
 * the mockup of 2026-11-14: the header and signature the CRM draws are gone (DD-1), headings carry no number and the
 * mockup's layout markers are gone (DD-5), a literal CHF is `[VALUTA]` (DD-12), the cost table is `@@costs` (DD-13)
 * and the declarations at the end hold the mockup's labels, hints, examples and defaults verbatim. The text has no
 * backslash, backtick or template placeholder, so a plain template literal holds it as it is (a tagged one would not:
 * Bun turns non-ASCII characters of a raw string into escapes).
 */
export const welldChItT1Text = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope
**A corpo:** attività svolta dal Fornitore presso la propria sede o luogo da esso gestito e fatturata sulla base del rilascio di un prodotto o servizio.

**A regia:** attività svolta dal Fornitore su richiesta scritta del Cliente e fatturata sulla base del tempo effettivamente impiegato.

**Collaudo:** verifica, da parte del Cliente, che quanto consegnato corrisponda a quanto descritto nel par. 2{{allegato_a:: e nell'Allegato A}}.

**Change Request:** richiesta di nuove funzionalità o di modifica dei requisiti rispetto a quanto descritto nel par. 2{{allegato_a:: e nell'Allegato A}}.

## OGGETTO DELLA FORNITURA
Oggetto della fornitura è **[OGGETTO_A_CORPO]**{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}.{{?FUNZIONALITÀ_O_DELIVERABLE:: La fornitura comprende:}}

- {{?FUNZIONALITÀ_O_DELIVERABLE::**[FUNZIONALITÀ_O_DELIVERABLE]**}}

{{allegato_a::Il perimetro funzionale{{?VOCE_DI_STIMA:: e le stime}} {{?VOCE_DI_STIMA::sono dettagliati}}{{!VOCE_DI_STIMA::è dettagliato}} nell'**Allegato A**, parte integrante del presente contratto.}}

{{?FUNZIONALITÀ_RINVIATE::Le seguenti funzionalità non sono comprese nella presente fornitura e potranno essere sviluppate in una fase successiva, con stima dedicata: **[FUNZIONALITÀ_RINVIATE]**.}}

## ATTIVITÀ E TEMPISTICHE
{{?ATTIVITÀ::Per la realizzazione di quanto in oggetto il Fornitore condurrà le seguenti attività:}}

- {{?ATTIVITÀ::**[ATTIVITÀ]**}}

Durata prevista: **[DURATA]** dall'inizio dei lavori. Tale stima è soggetta a variazioni in corso d'opera, fermo restando che al Cliente è garantita evidenza periodica dello stato di avanzamento dei lavori.

## CONDIZIONI DI FORNITURA
@@step conditions
La fornitura è da intendersi a corpo. Le attività si svolgeranno di norma presso la sede del Fornitore e, per le attività di coordinamento, presso la sede indicata dal Cliente.

Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente.

La fornitura esclude quanto non esplicitamente dichiarato nel par. 2{{allegato_a:: e nell'Allegato A}}.

### Trasferte

I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso unitamente ai giustificativi di spesa.

### Collaudo e accettazione

Il Fornitore rende disponibile quanto realizzato in un ambiente di prova. Il Cliente lo verifica entro 10 giorni lavorativi e segnala le eventuali anomalie in un'unica lista, distinguendo tra:

- **non conformità**: quanto previsto dal par. 2{{allegato_a:: e dall'Allegato A}} che manca o non funziona;
- **nuove richieste**: quanto non previsto, gestito come Change Request (par. 4.3).

Il Fornitore corregge le non conformità e ripresenta la consegna. A verifica conclusa le Parti sottoscrivono il verbale di collaudo, anche per posta elettronica: è il momento dell'accettazione. In assenza di riscontro del Cliente entro 10 giorni lavorativi dalla messa a disposizione, la consegna si intende accettata.

{{collaudo_fasi::Nei progetti articolati in più fasi il collaudo avviene al termine di ciascuna fase.}}

### Change Request

Le richieste che escono dal perimetro descritto nel par. 2{{allegato_a:: e nell'Allegato A}} sono segnalate dal Fornitore prima di procedere. Il Cliente può scegliere tra:

a. richiedere una stima e una quotazione separata;
b. riconoscere per iscritto i tempi di intervento preventivati, alla tariffa a regia di 140.- [VALUTA]/ora oltre IVA.

In assenza di approvazione scritta la richiesta resta sospesa.

### Collaborazione del Cliente

Il rispetto delle tempistiche del par. 3 presuppone che il Cliente:

- designi un referente unico con potere di approvazione;
- fornisca i materiali, i dati e gli accessi necessari{{?MATERIALI_DATI_ACCESSI::: **[MATERIALI_DATI_ACCESSI]**}};
- dia riscontro alle consegne intermedie entro 5 giorni lavorativi.

I ritardi dovuti al mancato rispetto di questi punti si riflettono sulle tempistiche del par. 3.

### Infrastruttura

I costi dell'infrastruttura di produzione (hosting, domini, certificati, servizi di terzi) sono a carico del Cliente e non sono inclusi nei costi del par. 6.{{preprod:: Il Fornitore mette a disposizione un ambiente di pre-produzione per la durata dello sviluppo.}}

{{ai::### Sistemi di Intelligenza Artificiale}}

{{ai::I costi di utilizzo dei sistemi di Intelligenza Artificiale di terzi impiegati dalla soluzione (modelli, token, servizi cloud dedicati) sono a carico del Cliente e non sono inclusi nei costi del par. 6.}}

## RISORSE, GARANZIA, MANUTENZIONE
### Risorse

Le risorse tecniche allocate dal Fornitore hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura.

### Garanzia

Quanto sviluppato con la presente fornitura è rilasciato con un periodo di garanzia di 6 mesi dalla data di primo rilascio in produzione. La garanzia copre la risoluzione di difetti (bug) applicativi rispetto a quanto collaudato e non prevede uno specifico Service Level Agreement.

Gli interventi successivi alla messa in produzione, richiesti per iscritto dal Cliente e fuori dal perimetro di garanzia o da uno specifico contratto di manutenzione, sono fatturati alla tariffa a regia di 140.- [VALUTA]/ora oltre IVA oppure sono oggetto di nuova offerta.

### Manutenzione

La manutenzione successiva alla messa in produzione è regolata da un contratto separato (Service Level Agreement).

## COSTI
@@step costs
@@costs position unit
@@line oggetto one_off | **[OGGETTO_A_CORPO]**, secondo quanto al par. 2, a corpo | unit=deal | qty=1
@@OPT_START voce2
@@line voce2 one_off | **[SECONDA_VOCE]**, a corpo | unit=? | qty=1
@@OPT_END
@@OPT_START sconto
@@line sconto discount | Scontistica accordata | unit=?
@@OPT_END
@@total **TOTALE**
@@OPT_START voce_scelta
@@line scelta option | **[VOCE_A_SCELTA_DEL_CLIENTE]** (barrare se desiderata) | unit=? | qty=1
@@OPT_END
@@end

**Note:**

- I costi si intendono IVA esclusa.
- {{voce_scelta::Le voci contrassegnate con □ non sono comprese nel totale.}}

## VALIDITÀ DELL'OFFERTA
La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari.

## FATTURAZIONE
La fatturazione avviene in base al seguente piano:

- **[ACCONTO]**% acconto a inizio lavori;
- {{rate::**[RATE]**% in **[N_RATE]** rate mensili dalla fine del mese di inizio lavori;}}
- **[SALDO]**% alla consegna, previo collaudo.

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

@@OPT_START allegato_a
@@annex A Perimetro funzionale{{?VOCE_DI_STIMA:: e stime}}
@@subtitle [RIF]

Il presente allegato integra il par. 2 del contratto di fornitura Rif. **[RIF]**. Per il contenuto della fornitura e la sua accettazione fa fede il presente allegato; per tutto il resto fa fede il contratto.

## Che cosa viene consegnato
| Funzionalità o deliverable | Descrizione | Criterio di accettazione |
|---|---|---|
| **[FUNZIONALITÀ]** | **[DESCRIZIONE]** | **[CRITERIO]** |

@@OPT_START ?VOCE_DI_STIMA
## Stime
| Attività | Profilo | Giorni/uomo |
|---|---|---|
| **[VOCE_DI_STIMA]** | **[PROFILO_RISORSA]** | **[GG]** |
| **Totale** | | **[TOTALE_GG]** |
@@OPT_END

## Requisiti tecnici
- {{?PIATTAFORME_SUPPORTATE::Piattaforme, browser e dispositivi supportati: **[PIATTAFORME_SUPPORTATE]**}}
- {{?INTEGRAZIONI::Integrazioni con sistemi di terzi: **[INTEGRAZIONI]**}}
- {{?AMBIENTI::Ambienti: **[AMBIENTI]**}}

## Non incluso
- {{?ESCLUSIONE::**[ESCLUSIONE]**}}

@@OPT_START ?RESPONSABILITÀ_FORNITORE,RESPONSABILITÀ_CLIENTE
## Responsabilità
| A carico del Fornitore | A carico del Cliente |
|---|---|
| {{?RESPONSABILITÀ_FORNITORE::**[RESPONSABILITÀ_FORNITORE]**}}{{!RESPONSABILITÀ_FORNITORE::—}} | {{?RESPONSABILITÀ_CLIENTE::**[RESPONSABILITÀ_CLIENTE]**}}{{!RESPONSABILITÀ_CLIENTE::—}} |
@@OPT_END
@@OPT_END

@@field CLIENTE
source: client

@@field EMITTENTE
source: issuer

@@field OGGETTO_A_CORPO
label: Oggetto a corpo
hint: Completa la frase «Oggetto della fornitura è …». Compare anche nella tabella costi.
example: es. la progettazione e lo sviluppo dell'app …

@@field DESCRIZIONE_IN_UNA_FRASE
label: Descrizione in una frase
kind: longtext

@@field FUNZIONALITÀ_RINVIATE
label: Funzionalità rinviate
hint: Ciò che resta fuori e potrà essere sviluppato in una fase successiva.
kind: longtext

@@field DURATA
label: Durata prevista
example: es. 4 mesi

@@field VALUTA
source: currency

@@field MATERIALI_DATI_ACCESSI
label: Materiali, dati e accessi necessari
hint: Se vuoto, resta l'impegno generico a fornire quanto necessario.
kind: longtext

@@field SECONDA_VOCE
label: Seconda voce
example: es. Fase 2 – integrazioni

@@field VOCE_A_SCELTA_DEL_CLIENTE
label: Voce a scelta
example: es. Modulo reportistica

@@field VALIDITA_GIORNI
label: Validità dell'offerta (giorni)
kind: number
source: validityDays

@@field ACCONTO
label: Acconto (%)
kind: percentage
default: 50

@@field RATE
label: Quota in rate (%)
kind: percentage

@@field N_RATE
label: Numero di rate
kind: number

@@field SALDO
label: Saldo (%)
kind: percentage
compute: 100 - ACCONTO - RATE

@@field RIF
source: reference

@@field DESCRIZIONE
label: Descrizione

@@field CRITERIO
label: Criterio di accettazione

@@field PROFILO_RISORSA
label: Profilo

@@field GG
label: Giorni/uomo
kind: number

@@field TOTALE_GG
label: Totale giorni/uomo
kind: number
compute: sum(GG)

@@field PIATTAFORME_SUPPORTATE
label: Piattaforme, browser e dispositivi

@@field INTEGRAZIONI
label: Integrazioni con sistemi di terzi

@@field AMBIENTI
label: Ambienti

@@field RESPONSABILITÀ_FORNITORE
label: A carico del Fornitore
kind: longtext

@@field RESPONSABILITÀ_CLIENTE
label: A carico del Cliente
kind: longtext

@@list FUNZIONALITÀ_O_DELIVERABLE
label: Funzionalità o deliverable

@@list ATTIVITÀ
label: Attività

@@list ESCLUSIONE
label: Esclusioni

@@table FUNZIONALITÀ
label: Funzionalità o deliverable
columns: FUNZIONALITÀ, DESCRIZIONE, CRITERIO

@@table VOCE_DI_STIMA
label: Attività
columns: VOCE_DI_STIMA, PROFILO_RISORSA, GG
step: annexes

@@block allegato_a
label: Allegato A
explain: Perimetro funzionale e stime in allegato.

@@block collaudo_fasi
label: Collaudo per fase
explain: Progetto in più fasi: il collaudo avviene al termine di ciascuna.

@@block preprod
label: Ambiente di pre-produzione
explain: WellD mette a disposizione un ambiente di pre-produzione durante lo sviluppo.

@@block ai
label: Sistemi di Intelligenza Artificiale
explain: La soluzione usa modelli o servizi AI di terzi: i costi d'uso sono a carico del Cliente.

@@block voce2
label: Seconda voce di costo
explain: Una seconda voce o fase a corpo nella tabella costi.

@@block sconto
label: Scontistica accordata
explain: Aggiunge la riga di sconto, come importo.

@@block voce_scelta
label: Voce a scelta del Cliente
explain: Voce che il Cliente può barrare; non entra nel totale.

@@block rate
label: Rate mensili
explain: Una parte dell'importo in rate mensili, tra acconto e saldo.
`;
