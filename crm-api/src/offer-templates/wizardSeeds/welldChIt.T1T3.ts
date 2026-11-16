/**
 * "Progetto a corpo con SLA" (mockup T13, code `T1+T3`) in the offer markup of specs/20261115-crm-offer-wizard § Template text, converted from
 * the mockup of 2026-11-14: the header and signature the CRM draws are gone (DD-1), headings carry no number and the
 * mockup's layout markers are gone (DD-5), a literal CHF is `[VALUTA]` (DD-12), the cost table is `@@costs` (DD-13)
 * and the declarations at the end hold the mockup's labels, hints, examples and defaults verbatim. The text has no
 * backslash, backtick or template placeholder, so a plain template literal holds it as it is (a tagged one would not:
 * Bun turns non-ASCII characters of a raw string into escapes).
 */
export const welldChItT1T3Text = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope
**A corpo:** attività svolta dal Fornitore presso la propria sede o luogo da esso gestito e fatturata sulla base del rilascio di un prodotto o servizio.

**A regia:** attività svolta dal Fornitore su richiesta scritta del Cliente e fatturata sulla base del tempo effettivamente impiegato.

**Collaudo:** verifica, da parte del Cliente, che quanto consegnato corrisponda a quanto descritto nel par. 2.1{{allegato_a:: e nell'Allegato A}}.

**Change Request:** richiesta di nuove funzionalità o di modifica dei requisiti rispetto a quanto descritto nel par. 2.1{{allegato_a:: e nell'Allegato A}}.

**Canone:** corrispettivo fisso e ricorrente dovuto per la disponibilità del servizio di manutenzione e supporto, indipendentemente dal numero di segnalazioni.

**Pacchetto ore:** monte ore prepagato destinato agli interventi di manutenzione correttiva, valido per un periodo contrattuale di 12 mesi. Le ore non utilizzate entro la scadenza del periodo si esauriscono comunque.

**Allegato SLA:** il documento «Allegato SLA — Service Level Agreement», parte integrante del presente contratto.

## OGGETTO DELLA FORNITURA
### Progetto

Oggetto della fornitura è **[OGGETTO_A_CORPO]**{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}.{{?FUNZIONALITÀ_O_DELIVERABLE:: La fornitura comprende:}}

- {{?FUNZIONALITÀ_O_DELIVERABLE::**[FUNZIONALITÀ_O_DELIVERABLE]**}}

{{allegato_a::Il perimetro funzionale{{?VOCE_DI_STIMA:: e le stime}} {{?VOCE_DI_STIMA::sono dettagliati}}{{!VOCE_DI_STIMA::è dettagliato}} nell'**Allegato A**, parte integrante del presente contratto.}}

### Manutenzione e supporto

A partire dalla data di avvio del servizio (par. 3), il Fornitore eroga il servizio di manutenzione e supporto della piattaforma **[PIATTAFORMA]**, di seguito «Piattaforma», secondo il profilo **[PROFILO]** descritto nell'**Allegato SLA**, con un Pacchetto ore annuale di **[ORE]** ore per gli interventi di manutenzione correttiva.

## ATTIVITÀ E TEMPISTICHE
{{?ATTIVITÀ::Per la realizzazione del progetto il Fornitore condurrà le seguenti attività:}}

- {{?ATTIVITÀ::**[ATTIVITÀ]**}}

Durata prevista: **[DURATA]** dall'inizio dei lavori. Tale stima è soggetta a variazioni in corso d'opera, fermo restando che al Cliente è garantita evidenza periodica dello stato di avanzamento dei lavori.

La data di avvio del servizio di manutenzione e supporto è **[DATA_AVVIO_SERVIZIO]**.

## CONDIZIONI DI FORNITURA
@@step conditions
Il progetto (par. 2.1) è fornito a corpo. Il servizio di manutenzione e supporto (par. 2.2) è fornito a Canone, con Pacchetto ore prepagato. Le attività si svolgeranno di norma presso la sede del Fornitore e, per le attività di coordinamento, presso la sede indicata dal Cliente.

Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente.

La fornitura esclude quanto non esplicitamente dichiarato nel par. 2 e negli allegati.

### Trasferte

I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso unitamente ai giustificativi di spesa.

### Collaudo e accettazione

Il Fornitore rende disponibile quanto realizzato in un ambiente di prova. Il Cliente lo verifica entro 10 giorni lavorativi e segnala le eventuali anomalie in un'unica lista, distinguendo tra:

- **non conformità**: quanto previsto dal par. 2.1{{allegato_a:: e dall'Allegato A}} che manca o non funziona;
- **nuove richieste**: quanto non previsto, gestito come Change Request (par. 4.3).

Il Fornitore corregge le non conformità e ripresenta la consegna. A verifica conclusa le Parti sottoscrivono il verbale di collaudo, anche per posta elettronica: è il momento dell'accettazione. In assenza di riscontro del Cliente entro 10 giorni lavorativi dalla messa a disposizione, la consegna si intende accettata.

### Change Request

Le richieste che escono dal perimetro descritto nel par. 2.1{{allegato_a:: e nell'Allegato A}} sono segnalate dal Fornitore prima di procedere. Il Cliente può scegliere tra:

a. richiedere una stima e una quotazione separata;
b. riconoscere per iscritto i tempi di intervento preventivati, alla tariffa a regia di 140.- [VALUTA]/ora oltre IVA.

In assenza di approvazione scritta la richiesta resta sospesa. Le stesse condizioni si applicano alle Change Request richieste dopo la data di avvio del servizio, che non consumano il Pacchetto ore.

### Collaborazione del Cliente

Il rispetto delle tempistiche del par. 3 presuppone che il Cliente:

- designi un referente unico con potere di approvazione;
- fornisca i materiali, i dati e gli accessi necessari{{?MATERIALI_DATI_ACCESSI::: **[MATERIALI_DATI_ACCESSI]**}};
- dia riscontro alle consegne intermedie entro 5 giorni lavorativi.

I ritardi dovuti al mancato rispetto di questi punti si riflettono sulle tempistiche del par. 3.

### Infrastruttura

L'infrastruttura di produzione della Piattaforma è **[INFRASTRUTTURA]**. Responsabilità e condizioni sono definite nella sezione 12 dell'Allegato SLA. I costi dell'infrastruttura di produzione (hosting, domini, certificati, servizi di terzi) non sono inclusi nei costi del par. 6, salvo dove espressamente indicato.

{{ai::### Sistemi di Intelligenza Artificiale}}

{{ai::I costi di utilizzo dei sistemi di Intelligenza Artificiale di terzi impiegati dalla soluzione (modelli, token, servizi cloud dedicati) sono a carico del Cliente e non sono inclusi nei costi del par. 6.}}

## RISORSE, GARANZIA, MANUTENZIONE
### Risorse

Le risorse tecniche allocate dal Fornitore hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura.

### Garanzia

Quanto sviluppato con la presente fornitura è rilasciato con un periodo di garanzia di 6 mesi dalla data di primo rilascio in produzione. La garanzia copre la risoluzione di difetti (bug) applicativi rispetto a quanto collaudato.

Durante il periodo di garanzia la correzione di tali difetti non comporta costi per il Cliente e non consuma il Pacchetto ore. Le segnalazioni sono gestite attraverso i canali e con i tempi di presa in carico del servizio di manutenzione e supporto (par. 5.3).

### Manutenzione e Service Level Agreement

Dalla data di avvio del servizio la Piattaforma è coperta dal servizio di manutenzione e supporto, secondo il profilo **[PROFILO]** dell'Allegato SLA, che ne definisce perimetro, livelli di servizio, processi ed esclusioni. Di seguito gli elementi principali.

Il Canone include:

a. la disponibilità di personale qualificato alla presa in carico e all'analisi delle segnalazioni, secondo le tempistiche riportate di seguito;
b. il sistema di ticketing e i canali di supporto;
c. la manutenzione adattiva prevista dal profilo.

Il Pacchetto ore include:

a. il tempo effettivo impiegato nell'analisi e nella risoluzione delle segnalazioni di manutenzione correttiva, fino a un massimo di **[ORE]** ore lavorative annue.

Sono esclusi dal Canone e dal Pacchetto ore:

a. le segnalazioni non comunicate tramite i canali indicati nella sezione 7 dell'Allegato SLA;
b. le Change Request (par. 4.3);
c. le attività di formazione, affiancamento e handover;
d. quanto indicato nella sezione 11 dell'Allegato SLA.

Le segnalazioni sono classificate per severità secondo la sezione 5.1 dell'Allegato SLA. Per il profilo **[PROFILO]** i tempi di presa in carico sono i seguenti:

| Severità | Descrizione | Presa in carico |
|---|---|---|
| **S1 — Critica** | Piattaforma non disponibile o funzionalità core inutilizzabile | **[TEMPO_S1]** |
| **S2 — Alta** | Funzionalità importante degradata o non disponibile | **[TEMPO_S2]** |
| **S3 — Media** | Funzionalità secondaria non disponibile o comportamento anomalo | **[TEMPO_S3]** |
| **S4 — Bassa** | Difetto cosmetico, richiesta di chiarimento o miglioramento minore | **[TEMPO_S4]** |

Il servizio è attivo **[COPERTURA_ORARIA]**, fuso orario CET/CEST, nei giorni lavorativi secondo il calendario ufficiale della Repubblica e Cantone Ticino.

La presa in carico è la conferma che la segnalazione è stata letta, classificata e assegnata a una risorsa tecnica: non equivale alla risoluzione. Il servizio non prevede penali. Gli eventuali tempi di risoluzione indicati nell'Allegato SLA sono obiettivi e non impegni vincolanti.

Gli interventi richiesti per iscritto dal Cliente e non compresi nella garanzia, nel Canone o nel Pacchetto ore sono fatturati alla tariffa a regia del par. 4.3 oppure sono oggetto di nuova offerta.

## COSTI
@@step costs
@@costs position unit
@@line oggetto one_off | **[OGGETTO_A_CORPO]**, secondo quanto al par. 2.1, a corpo | unit=deal | qty=1
@@total **TOTALE progetto, una tantum**
@@line canone yearly | Canone SLA, profilo **[PROFILO]**, annuale | unit=? | qty=1
@@line pacchetto yearly | Pacchetto ore annuale | unit=150 | qty=[ORE]
@@total **TOTALE manutenzione e supporto, annuo**
@@end

**Note:**

- I costi si intendono IVA esclusa.
- Le voci 2 e 3 decorrono dalla data di avvio del servizio, sono ricorrenti e si rinnovano secondo il par. 7.
- Le ore di manutenzione correttiva eccedenti il Pacchetto ore sono fatturate a consuntivo alla tariffa di 150.- [VALUTA]/ora.
- Il Pacchetto ore si esaurisce in ogni caso al termine del periodo contrattuale di 12 mesi, anche se le ore non sono state utilizzate (par. 7).

## DURATA, RINNOVO E DISDETTA
La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari.

Il servizio di manutenzione e supporto ha durata di 12 mesi a partire dalla data di avvio del servizio. Alla scadenza si rinnova tacitamente per periodi successivi di 12 mesi, alle condizioni economiche delle voci 2 e 3 del par. 6, salvo disdetta scritta di una delle Parti con preavviso di 3 mesi rispetto alla scadenza. La disdetta non incide sul progetto né sulla garanzia del par. 5.2.

Il Pacchetto ore vale per il periodo contrattuale di 12 mesi. Le ore non utilizzate entro la scadenza del periodo si esauriscono comunque: non sono rimborsabili né trasferibili al periodo successivo. A ogni rinnovo decorre un nuovo Pacchetto ore.

## FATTURAZIONE
La fatturazione avviene in base al seguente piano.

Progetto:

- **[ACCONTO]**% acconto a inizio lavori;
- **[SALDO]**% alla consegna, previo collaudo.

Manutenzione e supporto:

- Canone e Pacchetto ore: in via anticipata, con cadenza **[CADENZA_FATTURAZIONE]**, dalla data di avvio del servizio e a ogni rinnovo;
- ore eccedenti il Pacchetto ore e interventi a regia: mensilmente, a consuntivo.

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
@@subtitle [PIATTAFORMA]

Il presente allegato integra il par. 2.1 del contratto di fornitura Rif. **[RIF]**. Per il contenuto della fornitura e la sua accettazione fa fede il presente allegato; per tutto il resto fa fede il contratto.

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
@@annex SLA Service Level Agreement
@@subtitle Supporto e manutenzione — [PIATTAFORMA]

Il presente allegato descrive il Service Level Agreement (SLA) con cui [EMITTENTE] eroga il servizio di manutenzione e supporto della piattaforma **[PIATTAFORMA]**. Costituisce parte integrante del contratto di fornitura Rif. **[RIF]**.

## Parametri del servizio
La tabella seguente raccoglie i valori specifici del presente accordo. In caso di discrepanza tra la tabella e il corpo dell'allegato, prevale la tabella.

| Parametro | Valore | Riferimento |
|---|---|---|
| **Cliente** | [CLIENTE] — [INDIRIZZO_CLIENTE] | — |
| **Fornitore** | [EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}} | — |
| **Piattaforma oggetto del servizio** | [PIATTAFORMA] | Sez. 2 |
| **Data di avvio del servizio** | [DATA_AVVIO_SERVIZIO] | Sez. 14 |
| **Profilo di servizio** | [PROFILO] | Sez. 4 |
| **Opzioni attive** | {{?OPZIONI::[OPZIONI]}}{{!OPZIONI::nessuna}} | Sez. 4.2 |
| **Pacchetto ore annuale** | [ORE] ore | Sez. 13 |
| **Infrastruttura di produzione** | [INFRASTRUTTURA] | Sez. 12 |
| **Referente del Cliente** | {{?REFERENTE_CLIENTE::[REFERENTE_CLIENTE]{{?EMAIL_REFERENTE_CLIENTE:: — }}}}{{?EMAIL_REFERENTE_CLIENTE::[EMAIL_REFERENTE_CLIENTE]}}{{!REFERENTE_CLIENTE,EMAIL_REFERENTE_CLIENTE::da comunicare all'avvio del servizio}} | Sez. 9 |
| **Referente WellD** | {{?REFERENTE_WELLD::[REFERENTE_WELLD]{{?EMAIL_REFERENTE_WELLD:: — }}}}{{?EMAIL_REFERENTE_WELLD::[EMAIL_REFERENTE_WELLD]}}{{!REFERENTE_WELLD,EMAIL_REFERENTE_WELLD::da comunicare all'avvio del servizio}} | Sez. 7 |
| **Lingua del supporto** | Italiano (inglese su richiesta) | Sez. 7 |
| **Durata iniziale** | 12 mesi dalla data di avvio del servizio | Sez. 14 |
| **Condizioni economiche** | Contratto di fornitura Rif. [RIF], par. 6 | — |

## Oggetto e perimetro
### Oggetto

Il presente allegato definisce i livelli di servizio (SLA) con cui [EMITTENTE] («WellD») eroga il servizio di manutenzione e supporto della piattaforma **[PIATTAFORMA]** (la «Piattaforma») a favore di **[CLIENTE]** (il «Cliente»), a partire dalla data di avvio del servizio indicata nella sezione 1.

Il servizio comprende la manutenzione correttiva, la manutenzione adattiva e il supporto operativo secondo il profilo di servizio selezionato (sezione 4). La manutenzione evolutiva è regolata dal processo di Change Request (sezione 6.2) ed è esclusa dai livelli di servizio qui definiti.

### Perimetro incluso

Il perimetro del servizio comprende {{?COMPONENTE::i seguenti componenti software della Piattaforma}}{{!COMPONENTE::tutti i componenti software della Piattaforma}}, nello stato funzionale rilasciato alla data di avvio del servizio{{?COMPONENTE:::}}{{!COMPONENTE::.}}

- {{?COMPONENTE::**[COMPONENTE]**}}

### Perimetro escluso

Sono escluse dal servizio le attività e i componenti indicati nella sezione 11, nonché le evoluzioni funzionali successive alla data di avvio del servizio, che seguono il processo di Change Request.

## Definizioni
Ai fini del presente allegato i termini seguenti hanno il significato indicato.

| Termine | Definizione |
|---|---|
| **Incident** | Qualsiasi evento che causa, o può causare, un'interruzione o una riduzione della qualità del servizio erogato dalla Piattaforma rispetto al comportamento atteso. |
| **Severità** | Classificazione dell'incident in base all'impatto sul servizio e sugli utenti (S1–S4), secondo la sezione 5.1. |
| **Presa in carico** | Conferma, registrata nel sistema di ticketing, che il ticket è stato letto, classificato e assegnato a una risorsa tecnica. Non equivale alla risoluzione. |
| **Risoluzione** | Ripristino del comportamento atteso della Piattaforma mediante correzione definitiva o, in via temporanea, mediante workaround. |
| **Workaround** | Soluzione temporanea che riduce o elimina l'impatto di un incident in attesa della correzione definitiva. |
| **Change Request (CR)** | Richiesta di nuova funzionalità, modifica di requisiti esistenti o estensione del perimetro funzionale rispetto a quanto rilasciato alla data di avvio del servizio. |
| **Giorno lavorativo** | Dal lunedì al venerdì, esclusi i giorni festivi ufficiali della Repubblica e Cantone Ticino. |
| **Ora lavorativa** | Ora compresa nella finestra di copertura del profilo di servizio selezionato (sezione 4), in un giorno lavorativo, fuso orario CET/CEST. |
| **Finestra di manutenzione** | Periodo concordato con il Cliente durante il quale la Piattaforma può risultare non disponibile per interventi programmati. |
| **Referente** | Persona designata da ciascuna Parte come punto di contatto unico per gli aspetti operativi del servizio. |
| **Pacchetto ore** | Monte ore prepagato destinato agli interventi di manutenzione correttiva, valido per un periodo contrattuale di 12 mesi; le ore non utilizzate entro la scadenza del periodo si esauriscono comunque (sezione 13). |

## Profili di servizio
### Panoramica dei profili

WellD propone tre profili di servizio. Il profilo applicabile al presente accordo è indicato nella sezione 1. Le caratteristiche di ciascun profilo sono riepilogate nella tabella seguente; i tempi di intervento per severità sono dettagliati nella sezione 5.2.

| Caratteristica | Base | Standard | Premium |
|---|---|---|---|
| **Copertura oraria** | Lun–Ven 09:00–18:00 | Lun–Ven 09:00–18:00 | Lun–Ven 08:00–20:00 |
| **Presa in carico S1** | 1 giorno lavorativo | 6 ore lavorative | 2 ore lavorative |
| **Aggiornamenti su S1** | Al cambio di stato | Giornalieri | Ogni 4 ore lavorative |
| **Target di risoluzione S2–S3** | Nessun target | Sì (sez. 5.2) | Sì, ridotti (sez. 5.2) |
| **Referente WellD** | Team di supporto | Referente dedicato | Referente dedicato e sostituto |
| **Monitoraggio proattivo** | — | Sì | Sì, con alerting |
| **Manutenzione adattiva** | Solo patch di sicurezza critiche | Patch di sicurezza e 1 major release/anno | Patch di sicurezza e 2 major release/anno |
| **Preavviso manutenzione programmata** | 5 giorni lavorativi | 5 giorni lavorativi | 10 giorni lavorativi |
| **Report di servizio** | — | — | Mensile |

### Opzioni aggiuntive

Le seguenti opzioni possono essere attivate su qualsiasi profilo e sono quotate separatamente nel contratto di fornitura:

- **Reperibilità S1 nei weekend e festivi** (09:00–18:00): canale di contatto dedicato per incident di severità S1; presa in carico entro 4 ore dalla segnalazione; interventi fatturati a consumo con maggiorazione.
- **Copertura oraria estesa** su giorni lavorativi, oltre la finestra del profilo.
- **Pacchetto ore integrativo**, attivabile in corso d'anno in caso di esaurimento anticipato del pacchetto (sezione 13); scade insieme al periodo contrattuale in corso.

## Manutenzione correttiva
### Classificazione delle severità

Le segnalazioni sono classificate in base all'impatto sul servizio e al numero di utenti interessati. La classificazione determina i tempi di presa in carico garantiti.

| Severità | Descrizione | Esempi |
|---|---|---|
| **S1 — Critica** | Piattaforma non disponibile o funzionalità core inutilizzabile. Tutti o la maggioranza degli utenti sono impattati. | Piattaforma non raggiungibile; login impossibile per tutti gli utenti; perdita o corruzione di dati. |
| **S2 — Alta** | Funzionalità importante degradata o non disponibile. Un gruppo significativo di utenti è impattato, ma la Piattaforma resta operativa. | Un modulo specifico non funziona; errori nell'invio delle notifiche; degrado grave delle performance. |
| **S3 — Media** | Funzionalità secondaria non disponibile o comportamento anomalo. Impatto limitato a singoli utenti o a funzioni non bloccanti. | Errore di visualizzazione su un browser specifico; formattazione errata in un report; anomalia in una funzione non critica. |
| **S4 — Bassa** | Difetto cosmetico, richiesta di chiarimento o miglioramento minore. Nessun impatto operativo. | Refuso in un testo; suggerimento di miglioramento dell'interfaccia; richiesta di documentazione. |

La severità è proposta dal segnalante all'apertura del ticket e può essere riclassificata da WellD in accordo con il Referente del Cliente. In caso di disaccordo prevale, in via provvisoria, la classificazione più alta fino al chiarimento tra i Referenti.

### Tempi di presa in carico e risoluzione

Con **presa in carico** si intende la conferma, all'interno del sistema di ticketing, che il ticket è stato letto, analizzato e assegnato a una risorsa tecnica. La presa in carico non equivale alla risoluzione. I tempi sono espressi in ore o giorni lavorativi secondo la copertura del profilo selezionato.

**Profilo Base**

| Severità | Presa in carico | Risoluzione | Aggiornamenti al Cliente |
|---|---|---|---|
| **S1 — Critica** | 1 giorno lavorativo | Best effort | Al cambio di stato |
| **S2 — Alta** | 2 giorni lavorativi | Best effort | Al cambio di stato |
| **S3 — Media** | 5 giorni lavorativi | Best effort | Al cambio di stato |
| **S4 — Bassa** | 10 giorni lavorativi | Inserita nel backlog | Al cambio di stato |

**Profilo Standard**

| Severità | Presa in carico | Risoluzione | Aggiornamenti al Cliente |
|---|---|---|---|
| **S1 — Critica** | 6 ore lavorative | Best effort | Almeno giornalieri |
| **S2 — Alta** | 1 giorno lavorativo | 3 giorni lavorativi (target) | Almeno giornalieri |
| **S3 — Media** | 2 giorni lavorativi | 10 giorni lavorativi (target) | Al cambio di stato |
| **S4 — Bassa** | 5 giorni lavorativi | Pianificata nel prossimo rilascio | Al cambio di stato |

**Profilo Premium**

| Severità | Presa in carico | Risoluzione | Aggiornamenti al Cliente |
|---|---|---|---|
| **S1 — Critica** | 2 ore lavorative | Best effort | Ogni 4 ore lavorative |
| **S2 — Alta** | 4 ore lavorative | 2 giorni lavorativi (target) | Almeno giornalieri |
| **S3 — Media** | 1 giorno lavorativo | 5 giorni lavorativi (target) | Al cambio di stato |
| **S4 — Bassa** | 3 giorni lavorativi | Pianificata nel prossimo rilascio | Al cambio di stato |

**Note**

- I giorni e le ore lavorative si intendono secondo la finestra di copertura del profilo selezionato (sezione 4), esclusi i giorni festivi ufficiali della Repubblica e Cantone Ticino.
- Per gli incident di severità S1 WellD attiva immediatamente le risorse necessarie e persegue in via prioritaria il ripristino del servizio, anche mediante workaround. La correzione definitiva è erogata nel più breve tempo tecnicamente possibile (best effort), con gli aggiornamenti previsti dal profilo.
- I tempi di risoluzione indicati come "target" sono obiettivi indicativi e dipendono dalla complessità della segnalazione. Se il target non è raggiungibile, WellD comunica al Referente del Cliente una stima aggiornata e, ove possibile, un workaround.
- Il tempo di presa in carico è tracciato automaticamente dal sistema di ticketing.
- Le segnalazioni ricevute fuori dalla finestra di copertura sono prese in carico a partire dalla prima ora lavorativa utile.
- I tempi si sospendono quando WellD è in attesa di informazioni, accessi o verifiche da parte del Cliente (sezione 9).

### Processo di gestione degli incident

Il flusso di gestione degli incident segue le fasi seguenti:

- **Segnalazione:** un utente autorizzato dal Cliente apre un ticket nel sistema di ticketing, indicando una descrizione del problema, la severità percepita e, se possibile, i passi per riprodurre l'anomalia.
- **Presa in carico:** WellD conferma la ricezione, verifica la classificazione di severità e assegna il ticket a una risorsa tecnica. Il timestamp di presa in carico è registrato automaticamente.
- **Diagnosi:** il team tecnico analizza il problema, identifica la causa e valuta le opzioni di risoluzione. Se necessario, applica un workaround temporaneo per ridurre l'impatto.
- **Risoluzione:** la correzione è sviluppata, testata e rilasciata in produzione secondo il processo descritto nella sezione 10. Il ticket è aggiornato con la descrizione della soluzione.
- **Verifica:** il Cliente conferma la risoluzione. In assenza di riscontro entro 5 giorni lavorativi, il ticket si considera risolto.
- **Chiusura:** il ticket è chiuso e archiviato nel sistema; il tempo impiegato è contabilizzato sul pacchetto ore (sezione 13).

## Manutenzione adattiva ed evolutiva
### Manutenzione adattiva

La manutenzione adattiva comprende gli interventi necessari a mantenere la Piattaforma compatibile e aggiornata rispetto all'evoluzione dell'ambiente tecnologico. Secondo il profilo selezionato (sezione 4), il servizio include:

- Applicazione delle patch di sicurezza per vulnerabilità note (CVE) nelle componenti utilizzate; le patch critiche sono applicate in via prioritaria su tutti i profili.
- Aggiornamenti periodici delle dipendenze software (framework, librerie, runtime), consolidati nelle major release previste dal profilo.
- Adeguamento alla compatibilità con le versioni correnti dei browser supportati.
- Aggiornamenti dell'infrastruttura (sistema operativo, database engine, runtime), quando l'infrastruttura è gestita da WellD.

Gli aggiornamenti ordinari sono programmati e comunicati al Referente del Cliente con il preavviso previsto dal profilo. Le finestre di manutenzione che comportano indisponibilità della Piattaforma sono concordate con il Cliente e, di norma, pianificate fuori dagli orari di punta.

### Manutenzione evolutiva e Change Request

La manutenzione evolutiva riguarda lo sviluppo di nuove funzionalità, la modifica di requisiti esistenti o l'estensione del perimetro funzionale rispetto a quanto rilasciato alla data di avvio del servizio. Queste attività **non rientrano nei livelli di servizio** del presente allegato e seguono il processo di Change Request:

- **Richiesta:** il Cliente invia una Change Request tramite il sistema di ticketing o via email al Referente WellD.
- **Analisi:** WellD analizza la richiesta e produce una valutazione d'impatto con stima di effort e costi, di norma entro 10 giorni lavorativi.
- **Approvazione:** il Cliente approva formalmente la stima. In assenza di approvazione la Change Request resta sospesa.
- **Sviluppo e rilascio:** WellD sviluppa la funzionalità secondo le tempistiche concordate e la rilascia secondo il processo della sezione 10.
- **Verifica e accettazione:** il Cliente verifica e accetta il rilascio.

Le Change Request approvate sono fatturate a corpo o a consumo, secondo quanto concordato caso per caso, e non consumano il pacchetto ore della manutenzione correttiva. Le Change Request sono gestite su un canale parallelo e non incidono sui tempi SLA della manutenzione correttiva. Al rilascio di una Change Request, il perimetro del servizio si estende automaticamente alle funzionalità rilasciate.

## Canali operativi di supporto
WellD mette a disposizione i seguenti canali per la gestione delle segnalazioni e delle richieste:

- **Sistema di ticketing:** WellD fornisce e gestisce un sistema di ticketing dedicato al progetto. Tutte le segnalazioni devono transitare da questo sistema per garantire tracciabilità, calcolo automatico dei tempi SLA e reportistica. Il sistema è configurato all'attivazione del servizio e gli accessi sono forniti agli utenti autorizzati indicati dal Cliente.
- **Email:** un indirizzo email dedicato{{?EMAIL_SUPPORTO::, **[EMAIL_SUPPORTO]**,}}{{!EMAIL_SUPPORTO::, comunicato all'avvio del servizio,}} consente l'apertura di ticket; le email ricevute sono convertite automaticamente in ticket.
- **Referente WellD:** punto di contatto principale per il Cliente per i temi urgenti e di coordinamento, secondo quanto previsto dal profilo (sezione 4).
- **Lingua:** il supporto è erogato in italiano. Su richiesta la comunicazione può avvenire in inglese.
- **Orario:** finestra di copertura del profilo selezionato, nei giorni lavorativi secondo il calendario ufficiale della Repubblica e Cantone Ticino. Il servizio esclude weekend e festivi, salvo attivazione dell'opzione di reperibilità (sezione 4.2).

Le segnalazioni effettuate per canali diversi da quelli sopra indicati (telefonate dirette, messaggistica, email personali) non attivano i tempi SLA fino alla registrazione nel sistema di ticketing.

## Matrice di escalation
L'escalation è lo strumento con cui ciascuna Parte coinvolge livelli decisionali superiori quando un incident o una controversia operativa non trova soluzione nei tempi attesi. Si attiva su richiesta del Referente oppure automaticamente al verificarsi dei trigger indicati.

| Livello | Trigger di attivazione | Lato WellD | Lato Cliente |
|---|---|---|---|
| **1 — Operativo** | Gestione ordinaria dei ticket. | Team di supporto / Referente WellD{{?REFERENTE_WELLD:: [REFERENTE_WELLD]}} | Referente del Cliente{{?REFERENTE_CLIENTE:: [REFERENTE_CLIENTE]}} |
| **2 — Coordinamento** | S1 non ripristinato entro 1 giorno lavorativo dalla presa in carico; S2 oltre il doppio del target; disaccordo sulla classificazione di severità. | Responsabile delivery / Project Manager{{?PM_WELLD:: [PM_WELLD]}} | Responsabile applicativo o IT{{?RESP_CLIENTE:: [RESP_CLIENTE]}} |
| **3 — Direzionale** | S1 non ripristinato entro 3 giorni lavorativi; mancato rispetto ripetuto dei tempi di presa in carico nel trimestre; controversie contrattuali. | Direzione WellD{{?DIREZIONE_WELLD:: [DIREZIONE_WELLD]}} | Direzione del Cliente{{?DIREZIONE_CLIENTE:: [DIREZIONE_CLIENTE]}} |

A ogni livello di escalation WellD fornisce al Cliente un punto di situazione scritto con lo stato dell'incident, le azioni in corso e la stima aggiornata. I contatti della matrice sono aggiornati dalle Parti con comunicazione scritta al Referente dell'altra Parte, senza necessità di modifica del presente allegato.

## Obblighi del Cliente
Il rispetto dei livelli di servizio presuppone la collaborazione del Cliente. In particolare il Cliente si impegna a:

- Designare un **Referente unico** (e un sostituto) con autorità per classificare le segnalazioni, approvare le Change Request e confermare le risoluzioni.
- Utilizzare esclusivamente i **canali di supporto** indicati nella sezione 7 e limitare l'apertura dei ticket agli utenti autorizzati.
- Fornire, all'apertura del ticket e su richiesta di WellD, le **informazioni necessarie alla diagnosi**: descrizione, passi per riprodurre, utenti e orari interessati, screenshot o log disponibili.
- Garantire a WellD gli **accessi** (ambienti, sistemi terzi, credenziali tecniche, VPN) necessari all'erogazione del servizio, in particolare quando l'infrastruttura è gestita dal Cliente.
- Rendere disponibili gli **ambienti e i referenti** necessari per le verifiche e i collaudi, e confermare le risoluzioni entro 5 giorni lavorativi.
- Informare preventivamente WellD di **modifiche all'infrastruttura, ai sistemi integrati o alla configurazione** che possano incidere sulla Piattaforma.
- Garantire che gli utenti utilizzino la Piattaforma in conformità alla documentazione e alle condizioni d'uso concordate.

I tempi di presa in carico e di risoluzione sono sospesi per il periodo in cui WellD è in attesa di un adempimento del Cliente. Gli interventi resi necessari dal mancato rispetto degli obblighi di cui sopra sono fatturati a consumo fuori dal pacchetto ore.

## Gestione dei rilasci e degli ambienti
### Ambienti

Il servizio opera sui seguenti ambienti:

- **Produzione:** ambiente utilizzato dagli utenti finali. Ogni modifica transita dal processo di rilascio descritto di seguito.
- **Staging / pre-produzione:** ambiente allineato alla produzione, utilizzato per i test e per la verifica dei rilasci da parte del Cliente.
- {{?ALTRI_AMBIENTI::**[ALTRI_AMBIENTI]**}}

### Processo di rilascio

I rilasci in produzione seguono il processo standard WellD di integrazione e distribuzione continua (CI/CD):

- Ogni modifica è versionata, sottoposta a test automatici e rilasciata prima in staging.
- I rilasci che introducono funzionalità o modifiche visibili agli utenti sono comunicati al Referente del Cliente con le note di rilascio e, salvo urgenza, verificati dal Cliente in staging prima della messa in produzione.
- I rilasci correttivi urgenti (hotfix per incident S1 e S2) possono essere portati in produzione senza verifica preventiva del Cliente, con comunicazione contestuale al Referente.
- I rilasci che comportano indisponibilità della Piattaforma avvengono in finestre di manutenzione concordate, con il preavviso previsto dal profilo (sezione 4).
- Per ogni rilascio è disponibile una procedura di **rollback** alla versione precedente, attivata da WellD in caso di anomalie bloccanti riscontrate dopo il rilascio.

## Esclusioni dal servizio
Sono esclusi dal servizio, e sono gestiti su richiesta con quotazione separata o a consumo fuori dal pacchetto ore, gli interventi relativi a:

- Anomalie derivanti da **uso improprio** della Piattaforma o da utilizzo non conforme alla documentazione.
- Anomalie derivanti da **modifiche al codice, alla configurazione o ai dati** effettuate dal Cliente o da terzi non autorizzati da WellD.
- Malfunzionamenti di **sistemi, servizi o integrazioni di terze parti** non sviluppati da WellD (es. provider cloud, servizi di autenticazione esterni, API di terzi), fermo restando il supporto di WellD nella diagnosi e nel coordinamento con il fornitore terzo.
- Malfunzionamenti dell'**infrastruttura, delle postazioni di lavoro, della rete o dei dispositivi del Cliente**.
- Attività di **formazione**, assistenza agli utenti finali di primo livello, inserimento o bonifica massiva di dati, salvo diverso accordo.
- Interventi su componenti rilasciati **fuori dal perimetro** definito nella sezione 2 e non oggetto di Change Request approvata.
- Richieste di **nuove funzionalità o modifiche** ai requisiti, che seguono il processo di Change Request (sezione 6.2).
- Interventi resi necessari da **eventi di forza maggiore** o da cause non imputabili a WellD.

Qualora, in fase di diagnosi, un ticket aperto come incident risulti riconducibile a una delle esclusioni, WellD ne informa il Referente del Cliente; il tempo di analisi è contabilizzato sul pacchetto ore e l'eventuale intervento è concordato separatamente.

## Infrastruttura e disponibilità
La disponibilità della Piattaforma dipende dall'infrastruttura su cui è ospitata e dai relativi fornitori. **Il presente accordo non prevede una garanzia di uptime da parte di WellD**: gli impegni di WellD riguardano i tempi di presa in carico e di intervento definiti nella sezione 5. L'infrastruttura applicabile è indicata nella sezione 1.

### Infrastruttura gestita da WellD

Quando l'infrastruttura di produzione è gestita da WellD{{?PROVIDER_CLOUD::, presso **[PROVIDER_CLOUD]**}}:

- La disponibilità dell'infrastruttura è regolata dai livelli di servizio del provider, che WellD seleziona tra fornitori con data center in Svizzera e che comunica al Cliente su richiesta.
- WellD gestisce il rapporto con il provider, l'apertura dei ticket verso lo stesso e il coordinamento degli interventi.
- WellD esegue il monitoraggio della Piattaforma secondo il profilo selezionato e, in caso di indisponibilità rilevata, apre autonomamente l'incident corrispondente.
- WellD esegue backup periodici dei dati secondo la politica indicata nell'Allegato tecnico o nel Piano di Sicurezza del progetto, e ne verifica periodicamente la ripristinabilità.
- I costi dell'infrastruttura sono indicati nel contratto di fornitura.

### Infrastruttura gestita dal Cliente

Quando la Piattaforma è ospitata su infrastruttura gestita dal Cliente o da un fornitore da questi incaricato:

- Disponibilità, capacità, sicurezza perimetrale, backup e ripristino dell'infrastruttura sono responsabilità del Cliente o del suo fornitore.
- Il Cliente garantisce a WellD gli accessi tecnici necessari per la diagnosi e il rilascio delle correzioni; i tempi SLA sono sospesi in assenza di tali accessi.
- Gli incident la cui causa è riconducibile all'infrastruttura sono presi in carico da WellD ai fini della diagnosi; l'intervento risolutivo è di competenza del gestore dell'infrastruttura, con il quale WellD si coordina.
- Le modifiche all'infrastruttura che possono incidere sulla Piattaforma sono comunicate a WellD con un preavviso minimo di 5 giorni lavorativi.

### Manutenzione programmata

Le finestre di manutenzione programmata sono comunicate al Referente del Cliente con il preavviso previsto dal profilo e pianificate, di norma, in orari a basso traffico. WellD si impegna a contenere la durata delle interruzioni e a comunicare preventivamente la durata stimata dell'intervento. Le indisponibilità dovute a manutenzione programmata, a fattori esterni non imputabili a WellD o a interventi richiesti dal Cliente non costituiscono incident ai fini del presente accordo.

## Presidio e pacchetto ore
Il servizio è strutturato nelle seguenti voci. Gli importi sono definiti nel par. 6 del contratto di fornitura.

| Voce | Contenuto | Modalità |
|---|---|---|
| **Canone SLA** | Presidio secondo il profilo selezionato: presa in carico dei ticket, referente, monitoraggio, patch di sicurezza, manutenzione adattiva, sistema di ticketing, report ove previsto. | Canone fisso |
| **Pacchetto ore** | Ore di intervento per la manutenzione correttiva (analisi, correzione, test, rilascio). Le ore sono scalate dal pacchetto sulla base del tempo effettivo, con arrotondamento al quarto d'ora. | Pacchetto prepagato, valido 12 mesi; le ore non utilizzate si esauriscono alla scadenza |
| **Ore aggiuntive** | Interventi di manutenzione correttiva eccedenti il pacchetto ore, o interventi fuori perimetro (sezione 11). | A consumo, a consuntivo mensile |
| **Opzioni** | Reperibilità weekend e festivi, copertura estesa, pacchetto ore integrativo (sezione 4.2). | Canone e/o a consumo |
| **Manutenzione evolutiva** | Change Request e nuove funzionalità (sezione 6.2). | Quotazione separata, a corpo o a consumo |

- Il pacchetto ore vale per il periodo contrattuale di 12 mesi: le ore non utilizzate entro la scadenza si esauriscono comunque e non sono rimborsabili né trasferibili al periodo successivo. Lo stesso vale per un eventuale pacchetto integrativo.
- Il dimensionamento del pacchetto ore è definito nel contratto di fornitura sulla base del perimetro funzionale effettivo alla data di avvio del servizio ed è rivisto a ogni rinnovo (sezione 14).
- Al raggiungimento dell'80% del pacchetto ore WellD informa il Referente del Cliente. In caso di esaurimento anticipato, le Parti concordano un pacchetto ore integrativo oppure la gestione a consumo delle segnalazioni residue; in assenza di accordo, WellD garantisce comunque la presa in carico dei ticket S1.
- WellD rende disponibile al Cliente, su richiesta e comunque a ogni fatturazione, il dettaglio delle ore consumate per ticket.

## Durata, rinnovo e cessazione
- **Durata iniziale:** il servizio ha durata di 12 mesi a partire dalla data di avvio del servizio indicata nella sezione 1. Eventuali periodi di garanzia previsti dal contratto di fornitura decorrono in parallelo e non sospendono il presente accordo.
- **Rinnovo:** alla scadenza il servizio si rinnova tacitamente per periodi successivi di 12 mesi, salvo disdetta.
- **Disdetta:** ciascuna Parte può disdire il servizio con preavviso di 3 mesi rispetto alla scadenza, mediante comunicazione scritta (lettera raccomandata o email con conferma di ricezione agli indirizzi indicati nella sezione 1).
- **Revisione delle condizioni:** in occasione di ogni rinnovo le Parti verificano l'adeguatezza delle condizioni, in particolare il profilo di servizio, il dimensionamento del pacchetto ore e le tariffe, e formalizzano per iscritto le eventuali modifiche.
- **Sospensione:** in caso di mancato pagamento del canone oltre 30 giorni dalla scadenza della fattura, WellD può sospendere il servizio previa diffida scritta con termine di 15 giorni, fermo restando il supporto agli incident S1.

### Transizione e restituzione dei dati

In caso di cessazione del servizio, per qualsiasi causa, WellD garantisce un periodo di transizione di 10 giornate lavorative per il trasferimento delle conoscenze al nuovo fornitore o al team interno del Cliente, fatturato secondo le tariffe del contratto di fornitura salvo diverso accordo.

Tutti i dati di dominio — le informazioni inserite e generate dagli utenti tramite la Piattaforma — restano di proprietà del Cliente. Quando l'infrastruttura è gestita da WellD, i dati sono consegnati in formato aperto e documentato (export dei database e dei file) entro 30 giorni dalla richiesta scritta del Cliente e, successivamente, cancellati dai sistemi WellD entro i termini previsti dalla normativa applicabile, salvo obblighi di conservazione. Quando l'infrastruttura è gestita dal Cliente, i dati restano nella sua disponibilità e WellD si limita a revocare i propri accessi.

## Condizioni generali
- **Rapporto con il contratto di fornitura:** il presente allegato integra il contratto di fornitura Rif. **[RIF]**. In caso di conflitto prevale il contratto di fornitura, salvo per i livelli di servizio, per i quali prevale il presente allegato.
- **Limitazione di responsabilità:** le responsabilità di WellD sono limitate all'esecuzione del servizio in oggetto, erogato a regola d'arte e in conformità alle specifiche concordate. WellD non risponde di danni indiretti, perdita di profitto o danni consequenziali. La responsabilità complessiva di WellD per il presente accordo è limitata all'importo dei canoni pagati nei 12 mesi precedenti l'evento, salvo dolo o colpa grave.
- **Riservatezza:** WellD si impegna a mantenere la riservatezza su documenti, dati e informazioni di cui venga a conoscenza nell'esecuzione del servizio. Tutto il personale WellD coinvolto è soggetto a obbligo di riservatezza. L'impegno sopravvive alla cessazione del servizio per 5 anni.
- **Protezione dei dati:** il trattamento dei dati personali avviene nel rispetto della Legge federale sulla protezione dei dati (LPD) e, ove applicabile, del GDPR. I ruoli delle Parti e le misure tecniche e organizzative sono descritti nell'accordo sul trattamento dei dati e nel Piano di Sicurezza del progetto, ove presenti.
- **Proprietà intellettuale:** le condizioni relative alla proprietà intellettuale del codice e dei deliverable sono definite nel contratto di fornitura. Il presente allegato non le modifica. Le correzioni rilasciate nell'ambito del servizio seguono il regime del codice a cui si riferiscono.
- **Subfornitura:** WellD può avvalersi di propri collaboratori e di fornitori di infrastruttura, restando responsabile nei confronti del Cliente dell'esecuzione del servizio.
- **Forza maggiore:** nessuna Parte è responsabile per inadempimenti dovuti a eventi al di fuori del proprio ragionevole controllo. I tempi SLA sono sospesi per la durata dell'evento.
- **Foro competente e diritto applicabile:** per qualsiasi controversia relativa al presente accordo è competente il foro di Lugano (Svizzera). Si applica il diritto svizzero.

@@field CLIENTE
source: client

@@field EMITTENTE
source: issuer

@@field INDIRIZZO_EMITTENTE
source: issuerAddress

@@field OGGETTO_A_CORPO
label: Oggetto a corpo
hint: Completa la frase «Oggetto della fornitura è …». Compare anche nella tabella costi.
example: es. la progettazione e lo sviluppo dell'app …

@@field DESCRIZIONE_IN_UNA_FRASE
label: Descrizione in una frase
kind: longtext

@@field PIATTAFORMA
label: Piattaforma
example: Nome del software in manutenzione

@@field PROFILO
label: Profilo SLA
hint: Scegliendo il profilo si compilano tempi di presa in carico e copertura oraria.
options: Base | Standard | Premium
fills Base: TEMPO_S1 = 1 giorno lavorativo
fills Base: TEMPO_S2 = 2 giorni lavorativi
fills Base: TEMPO_S3 = 5 giorni lavorativi
fills Base: TEMPO_S4 = 10 giorni lavorativi
fills Base: COPERTURA_ORARIA = dal lunedì al venerdì, 09:00–18:00
fills Standard: TEMPO_S1 = 6 ore lavorative
fills Standard: TEMPO_S2 = 1 giorno lavorativo
fills Standard: TEMPO_S3 = 2 giorni lavorativi
fills Standard: TEMPO_S4 = 5 giorni lavorativi
fills Standard: COPERTURA_ORARIA = dal lunedì al venerdì, 09:00–18:00
fills Premium: TEMPO_S1 = 2 ore lavorative
fills Premium: TEMPO_S2 = 4 ore lavorative
fills Premium: TEMPO_S3 = 1 giorno lavorativo
fills Premium: TEMPO_S4 = 3 giorni lavorativi
fills Premium: COPERTURA_ORARIA = dal lunedì al venerdì, 08:00–20:00

@@field ORE
label: Ore del pacchetto annuale
kind: number

@@field DURATA
label: Durata prevista
example: es. 4 mesi

@@field DATA_AVVIO_SERVIZIO
label: Data di avvio del servizio
example: una data, oppure «la data di messa in produzione»

@@field VALUTA
source: currency

@@field MATERIALI_DATI_ACCESSI
label: Materiali, dati e accessi necessari
hint: Se vuoto, resta l'impegno generico a fornire quanto necessario.
kind: longtext

@@field INFRASTRUTTURA
label: Infrastruttura di produzione
options: gestita da WellD | gestita dal Cliente

@@field TEMPO_S1
label: Presa in carico S1 · Critica

@@field TEMPO_S2
label: Presa in carico S2 · Alta

@@field TEMPO_S3
label: Presa in carico S3 · Media

@@field TEMPO_S4
label: Presa in carico S4 · Bassa

@@field COPERTURA_ORARIA
label: Copertura oraria

@@field VALIDITA_GIORNI
label: Validità dell'offerta (giorni)
kind: number
source: validityDays

@@field ACCONTO
label: Acconto (%)
kind: percentage
default: 50

@@field SALDO
label: Saldo (%)
kind: percentage
compute: 100 - ACCONTO

@@field CADENZA_FATTURAZIONE
label: Cadenza di fatturazione
options: annuale | semestrale | trimestrale | mensile

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

@@field INDIRIZZO_CLIENTE
source: clientAddress

@@field OPZIONI
label: Opzioni attive
example: nessuna

@@field REFERENTE_CLIENTE
source: contacts

@@field EMAIL_REFERENTE_CLIENTE
label: E-mail referente Cliente

@@field REFERENTE_WELLD
label: Referente WellD

@@field EMAIL_REFERENTE_WELLD
label: E-mail referente WellD

@@field EMAIL_SUPPORTO
label: E-mail del supporto

@@field PM_WELLD
label: Responsabile delivery WellD

@@field RESP_CLIENTE
label: Responsabile applicativo del Cliente

@@field DIREZIONE_WELLD
label: Direzione WellD

@@field DIREZIONE_CLIENTE
label: Direzione del Cliente

@@field ALTRI_AMBIENTI
label: Altri ambienti
example: oltre a produzione e staging

@@field PROVIDER_CLOUD
label: Provider cloud

@@list FUNZIONALITÀ_O_DELIVERABLE
label: Funzionalità o deliverable

@@list ATTIVITÀ
label: Attività

@@list ESCLUSIONE
label: Esclusioni

@@list COMPONENTE
label: Componenti

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

@@block ai
label: Sistemi di Intelligenza Artificiale
explain: La soluzione usa modelli o servizi AI di terzi: i costi d'uso sono a carico del Cliente.
`;
