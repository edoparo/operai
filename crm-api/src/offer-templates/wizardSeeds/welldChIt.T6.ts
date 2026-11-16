/**
 * "Servizi a canone" (mockup template T6), converted to the offer wizard's template grammar
 * (specs/20261115-crm-offer-wizard T22; plan DD-1, DD-3, DD-5, DD-13, DD-26). Italian text of entity welld_ch.
 *
 * Differences from the mockup's text, all listed in AC-9.6: no page-1 header, acceptance block or
 * "Allegati:" line (the CRM draws them), unnumbered headings and annex headings in the CRM's style, no
 * page breaks or width hints. The canone, the extra users and the licences are `yearly` lines, the
 * activation a `one_off` line, and "TOTALE primo periodo" a `@@total` row (DD-13).
 */
export const T6_TEXT = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope

**Servizio:** **[SERVIZIO]**, come descritto nel par. 2, inclusi aggiornamenti e documentazione.

**Canone:** corrispettivo fisso e ricorrente dovuto per la disponibilità del Servizio.

**Utente:** persona autorizzata dal Cliente a utilizzare il Servizio.

**Dati del Cliente:** tutti i dati caricati o generati nel Servizio dal Cliente e dai suoi Utenti.

## OGGETTO DELLA FORNITURA

Oggetto della fornitura è la messa a disposizione del Servizio{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}. Il Servizio comprende:

- **[COMPONENTE]**

{{?DIMENSIONAMENTO::Dimensionamento: **[DIMENSIONAMENTO]**.}}

{{licenza_uso::Il Fornitore concede al Cliente una licenza non esclusiva, non trasferibile e revocabile per accedere e utilizzare il Servizio per i propri scopi aziendali interni, per la durata del presente contratto.}}

{{rivendita::La fornitura comprende le seguenti licenze di terzi, intestate al Cliente e soggette alle condizioni del relativo produttore: **[PRODOTTO]**{{?N_LICENZE::, **[N_LICENZE]** licenze}}{{?PERIODO_LICENZE::, periodo **[PERIODO_LICENZE]**}}.}}

## ATTIVAZIONE E LIVELLI DI SERVIZIO

{{?TEMPO_ATTIVAZIONE::Il Servizio è attivato entro **[TEMPO_ATTIVAZIONE]** dalla sottoscrizione del presente contratto.}}

Il supporto è gestito tramite il sistema di ticketing fornito ed è attivo dal lunedì al venerdì, 09:00–18:00, nei giorni lavorativi secondo il calendario ufficiale della Repubblica e Cantone Ticino.

{{?UPTIME::È garantita una disponibilità minima del Servizio del **[UPTIME]**% sul periodo di validità del presente contratto.}}

Gli interventi di manutenzione ordinaria che comportano un disservizio sono segnalati con almeno 24 ore di anticipo tramite posta elettronica.

Il Servizio non prevede penali. I tempi di risoluzione non rientrano nei livelli di servizio.

## CONDIZIONI DI FORNITURA
@@step conditions

Il Servizio è fornito a Canone. La fornitura non prevede trasferte ed esclude quanto non esplicitamente dichiarato nel par. 2.

### Obblighi del Cliente

Il Cliente si impegna a:

- garantire che i propri Utenti rispettino il presente contratto;
- non condividere gli accessi, non effettuare reverse engineering e non rivendere il Servizio;
- mantenere sicure le credenziali di accesso;
- rispettare le leggi applicabili nell'utilizzo del Servizio.

### Infrastruttura e dati

Il Servizio è erogato su infrastruttura gestita dal Fornitore{{?PROVIDER_CLOUD:: presso **[PROVIDER_CLOUD]**}}. I Dati del Cliente restano di proprietà del Cliente.

@@OPT_START ?PRODOTTI_DI_TERZI
### Licenze di terzi a carico del Cliente

{{?PRODOTTI_DI_TERZI::Le licenze dei seguenti prodotti di terzi, necessarie al funzionamento del Servizio, sono a carico del Cliente: **[PRODOTTI_DI_TERZI]**.}}
@@OPT_END

## RISORSE

Le risorse tecniche allocate dal Fornitore hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura.

## COSTI
@@step costs
@@costs position unit
@@line canone yearly | Canone del Servizio, **[PERIODICITÀ]** | unit=? | qty=?
@@OPT_START utenze
@@line utenze yearly | Utenza aggiuntiva, **[PERIODICITÀ]** | unit=? | qty=?
@@OPT_END
@@OPT_START rivendita
@@line licenze yearly | Licenze **[PRODOTTO]**{{?PERIODO_LICENZE::, periodo **[PERIODO_LICENZE]**}} | unit=? | qty=?
@@OPT_END
@@OPT_START attivazione
@@line attivazione one_off | Attivazione del Servizio, una tantum | unit=? | qty=1
@@OPT_END
@@total **TOTALE primo periodo**
@@end

**Note:**

- I costi si intendono IVA esclusa.
- Il Canone include il mantenimento e gli aggiornamenti del Servizio.
- Moduli aggiuntivi, integrazioni e consulenze sono quotati e fatturati separatamente.

## DURATA, RINNOVO E DISDETTA

La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari.

Il contratto ha durata di **[DURATA_MESI]** mesi dalla data di attivazione del Servizio.

{{rinnovo_tacito::Alla scadenza il contratto si rinnova tacitamente per un periodo equivalente, salvo disdetta scritta di una delle Parti con preavviso di 3 mesi rispetto alla scadenza.}}

{{no_rinnovo::Non sono previsti rinnovi automatici: il rinnovo è concordato per iscritto tra le Parti.}}

Ciascuna Parte può risolvere il contratto in caso di violazione sostanziale dell'altra Parte non sanata entro 30 giorni dalla notifica scritta. Alla cessazione del contratto l'accesso al Servizio termina e il Fornitore restituisce o elimina i Dati del Cliente entro 30 giorni, salvo obblighi di legge di conservazione.

## FATTURAZIONE

Il Canone è fatturato in via anticipata, con cadenza **[CADENZA_FATTURAZIONE]**, dalla data di attivazione del Servizio.

Le fatture sono pagabili a 30 giorni data fattura.

## CONDIZIONI GENERALI
@@step annexes

In aggiunta a quanto sopra specificato, valgono le seguenti Condizioni Generali di fornitura.

### Limitazione di responsabilità

Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite. Le responsabilità del Fornitore e delle sue risorse sono limitate all'esecuzione della fornitura in oggetto, che viene portata avanti a regola d'arte e in conformità con le specifiche concordate con il Cliente. Salvo nei casi di dolo o colpa grave, la responsabilità complessiva del Fornitore ai sensi del presente contratto non supera l'importo dei Canoni pagati dal Cliente nei 12 mesi precedenti l'evento.

### Legislazione del lavoro

Il personale del Fornitore opera nel pieno rispetto della legislazione del lavoro. Qualora il Cliente necessitasse di documentazione in merito, sarà cura del Fornitore presentarla.

### Riservatezza e proprietà

Il Fornitore si impegna a mantenere la massima riservatezza per quanto concerne l'uso di documenti, disegni e informazioni di cui verrà a conoscenza per effetto del contratto di fornitura.

Tutti i diritti di proprietà intellettuale sul Servizio rimangono di esclusiva proprietà del Fornitore. Il Cliente mantiene la piena proprietà dei Dati del Cliente.

Il Fornitore garantisce che quanto fornito in esecuzione del presente accordo non viola diritti di proprietà intellettuale o industriale di terzi.

### Privacy e trattamento dei dati personali

Il Cliente e il Fornitore si fanno entrambi garanti del rispetto delle norme vigenti sulla Privacy. Il Cliente è autorizzato a comunicare a terzi i dati del Fornitore per operazioni legate alla fornitura in oggetto. All'accettazione del presente contratto il Cliente accetta egualmente la politica sulla Privacy di [EMITTENTE], la cui documentazione integrale viene fornita su richiesta o allegata.

{{dpa::Il Fornitore agisce come Responsabile del trattamento dei dati personali e il Cliente come Titolare. Il trattamento è disciplinato dall'**Allegato DPA**, parte integrante del presente contratto.}}

### Foro competente

Per qualsiasi controversia che dovesse sorgere in relazione al presente contratto di fornitura, il foro competente è quello di Lugano (Svizzera).

### Clausola di inefficacia

Nell'eventualità in cui una qualsiasi clausola del presente contratto dovesse in seguito risultare inefficace per un qualsiasi motivo giuridico, ciò non inficerà la validità delle restanti clausole. In luogo della norma inefficace si considererà come voluta e dichiarata quella regolamentazione giuridicamente valida che maggiormente si avvicinerà al senso e allo scopo della clausola inefficace e del contratto nel suo insieme, tenendo in considerazione la buona fede, l'usanza commerciale nonché gli usi e i costumi del settore. Eventuali lacune contrattuali saranno trattate analogamente.

@@OPT_START dpa
@@annex DPA Accordo sul trattamento dei dati
@@subtitle [SERVIZIO]

Il presente allegato costituisce parte integrante del contratto di fornitura Rif. **[RIF]**.

## Ruoli

- Titolare del trattamento: il Cliente.
- Responsabile del trattamento: il Fornitore.

## Scopo e ambito di applicazione

Il Fornitore tratta i dati personali esclusivamente allo scopo di fornire al Cliente il Servizio e il relativo supporto. Il trattamento non eccede la finalità necessaria all'adempimento degli obblighi contrattuali.

## Categorie di dati e interessati

- Interessati: **[CATEGORIE_DI_INTERESSATI]**
- Tipi di dati: **[TIPI_DI_DATI]**

## Obblighi del Fornitore

Il Fornitore si impegna a:

- trattare i Dati del Cliente solo in base alle istruzioni documentate del Cliente;
- adottare misure tecniche e organizzative appropriate per garantire la sicurezza e la riservatezza dei dati;
- garantire che tutto il personale con accesso ai Dati del Cliente sia vincolato da obblighi di riservatezza;
- assistere il Cliente nel rispondere alle richieste degli interessati e nell'adempimento degli obblighi di legge;
- informare il Cliente senza indebito ritardo in caso di violazione dei dati, indicandone natura, portata e misure di mitigazione adottate;
- eliminare o restituire tutti i Dati del Cliente entro 30 giorni dalla cessazione del contratto, salvo obblighi di legge di conservazione.

## Sub-responsabili del trattamento

Il Fornitore può avvalersi di sub-responsabili per l'hosting, l'archiviazione e il supporto operativo. L'elenco aggiornato è messo a disposizione del Cliente su richiesta. Il Fornitore garantisce che i sub-responsabili siano vincolati da obblighi di protezione dei dati equivalenti a quelli del presente allegato.

## Trasferimenti all'estero

Se i dati personali sono trasferiti al di fuori della Svizzera o dello Spazio Economico Europeo, il Fornitore garantisce che siano in atto adeguate misure di salvaguardia, ad esempio clausole contrattuali standard o protezioni equivalenti riconosciute dall'Incaricato federale della protezione dei dati e della trasparenza (IFPDT) e dalla Commissione europea.

## Diritto di verifica

Il Cliente può, non più di una volta all'anno, richiedere documentazione o condurre a proprie spese una verifica della conformità al presente allegato, con un preavviso ragionevole e nel rispetto degli obblighi di riservatezza.

## Legge applicabile

Il presente allegato è regolato dal diritto svizzero, in particolare dalla Legge federale sulla protezione dei dati (LPD). Per le controversie è competente il foro di Lugano (Svizzera).
@@OPT_END

@@field CLIENTE
source: client

@@field EMITTENTE
source: issuer

@@field RIF
source: reference

@@field VALIDITA_GIORNI
label: Validità dell'offerta (giorni)
kind: number
source: validityDays

@@field SERVIZIO
label: Servizio
example: Nome del servizio o prodotto

@@field DESCRIZIONE_IN_UNA_FRASE
label: Descrizione in una frase
kind: longtext

@@field DIMENSIONAMENTO
label: Dimensionamento
example: utenti, ambienti, volumi

@@field PRODOTTO
label: Prodotto di terzi

@@field N_LICENZE
label: Numero di licenze
kind: number

@@field PERIODO_LICENZE
label: Periodo delle licenze
example: es. 1.1.2027 – 31.12.2027

@@field TEMPO_ATTIVAZIONE
label: Tempo di attivazione
example: es. 10 giorni lavorativi

@@field UPTIME
label: Disponibilità minima garantita (%)
kind: percentage

@@field PROVIDER_CLOUD
label: Provider cloud

@@field PRODOTTI_DI_TERZI
label: Licenze di terzi a carico del Cliente
example: prodotti necessari al Servizio, pagati dal Cliente

@@field PERIODICITÀ
label: Periodicità del canone
options: mensile | annuale

@@field DURATA_MESI
label: Durata (mesi)
kind: number
default: 12

@@field CADENZA_FATTURAZIONE
label: Cadenza di fatturazione
options: annuale | semestrale | trimestrale | mensile

@@field CATEGORIE_DI_INTERESSATI
label: Categorie di interessati
example: es. dipendenti e utenti finali del Cliente

@@field TIPI_DI_DATI
label: Tipi di dati
example: es. dati identificativi e di utilizzo

@@list COMPONENTE
label: Componenti

@@block licenza_uso
label: Licenza d'uso del Servizio
explain: Prodotto WellD in SaaS: licenza non esclusiva per la durata del contratto.
default: on

@@block rivendita
label: Rivendita di licenze di terzi
explain: Licenze di un produttore terzo, intestate al Cliente.

@@block utenze
label: Utenze aggiuntive
explain: Riga di costo per le utenze oltre quelle incluse.

@@block attivazione
label: Attivazione del servizio
explain: Voce una tantum di attivazione del Servizio.

@@block dpa
label: Allegato DPA
explain: Accordo sul trattamento dei dati personali (WellD responsabile, Cliente titolare).

@@block rinnovo_tacito
label: Rinnovo tacito
explain: Si rinnova per un periodo equivalente, salvo disdetta con 3 mesi di preavviso.

@@block no_rinnovo
label: Nessun rinnovo automatico
explain: Il rinnovo si concorda per iscritto.

@@choice rinnovo
label: Rinnovo
options: rinnovo_tacito | no_rinnovo
default: rinnovo_tacito
`;
