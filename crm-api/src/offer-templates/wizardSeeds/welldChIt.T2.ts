/**
 * "Risorse a tempo" (mockup T2, code `T2`) in the offer markup of specs/20261115-crm-offer-wizard § Template text, converted from
 * the mockup of 2026-11-14: the header and signature the CRM draws are gone (DD-1), headings carry no number and the
 * mockup's layout markers are gone (DD-5), a literal CHF is `[VALUTA]` (DD-12), the cost table is `@@costs` (DD-13)
 * and the declarations at the end hold the mockup's labels, hints, examples and defaults verbatim, except that the
 * tariff's label reads "Tariffa / giorno", not "CHF / giorno": no label names a currency (AC-9.6, SA-6). The text has no
 * backslash, backtick or template placeholder, so a plain template literal holds it as it is (a tagged one would not:
 * Bun turns non-ASCII characters of a raw string into escapes).
 */
export const welldChItT2Text = `@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.

Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore», e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope
**A servizio:** attività svolta dal Fornitore presso la sede propria o del Cliente, su richiesta del Cliente stesso, e fatturata a consuntivo sulla base di uno statino di esecuzione lavori.

**Giorno/uomo:** otto ore lavorative di una risorsa del Fornitore.

**FTE (Full Time Equivalent):** impiego a tempo pieno di una risorsa per il periodo indicato.

**Statino:** riepilogo mensile dei giorni/uomo erogati, per profilo.

{{pacchetto::**Pacchetto giornate:** monte di giorni/uomo prepagato, valido per il periodo indicato al par. 7. Le giornate non utilizzate entro la scadenza si esauriscono comunque.}}

## OGGETTO DELLA FORNITURA
Oggetto della fornitura è l'attività di consulenza tecnica a servizio{{?AMBITO:: a supporto di **[AMBITO]**}}, nel periodo **[DATA_INIZIO]** – **[DATA_FINE]**, con i seguenti profili e volumi:

| Profilo | FTE | Impiego previsto | Giorni/uomo |
|---|---|---|---|
| **[PROFILO]** | **[FTE]** | **[IMPIEGO]** | **[GG]** |
| **Totale** | | | **[TOTALE_GG]** |

## ATTIVITÀ E TEMPISTICHE
Le attività sono pianificate in accordo con il Cliente, che ne indica obiettivi e priorità. Il Fornitore dà evidenza mensile delle attività svolte e dei giorni/uomo erogati tramite lo statino.

{{?IMPIEGO_MINIMO::L'impiego previsto è di almeno il **[IMPIEGO_MINIMO]**% per FTE su base mensile.}}

## CONDIZIONI DI FORNITURA
@@step conditions
La fornitura è da intendersi a servizio. Le attività si svolgeranno presso la sede del Fornitore e, per le riunioni di coordinamento e i passaggi di consegne, presso la sede indicata dal Cliente, con una cadenza da concordarsi tra le Parti.

Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente.

La fornitura esclude quanto non esplicitamente dichiarato nel par. 2.

### Trasferte

I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso unitamente ai giustificativi di spesa.

{{dati_critici::### Dati critici}}

{{dati_critici::Il Cliente è responsabile di non mettere il Fornitore a conoscenza di informazioni o dati critici (ad esempio numeri produttivi di carte bancarie o di credito, conti). Il Fornitore non si assume la responsabilità di violazioni o uso improprio di tali informazioni o dati.}}

## RISORSE
Le risorse tecniche allocate dal Fornitore hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate. Le risorse possono variare nel corso della fornitura.

{{risorse_extra::Eventuali risorse aggiuntive, richieste per iscritto dal Cliente, sono fornite alle tariffe del par. 6.}}

## COSTI
@@step costs
@@costs position unit
@@costlabels [VALUTA] / giorno | Giorni
@@line consulenza one_off each=PROFILO | Consulenza tecnica, **[PROFILO]** | unit=[TARIFFA] | qty=[GG]
@@OPT_START sconto
@@line sconto discount | Scontistica accordata | unit=?
@@OPT_END
@@total **TOTALE**
@@end

**Note:**

- I costi si intendono IVA esclusa.
- Le tariffe si intendono per giorno/uomo.
- {{consuntivo::Il totale è un tetto massimo: sono fatturati i soli giorni/uomo effettivamente erogati.}}
- {{pacchetto::Il Pacchetto giornate si esaurisce in ogni caso alla scadenza indicata al par. 7, anche se le giornate non sono state utilizzate.}}

## DURATA, RINNOVO E DISDETTA
La presente offerta è valida per **[VALIDITA_GIORNI]** giorni solari.

Il contratto ha durata fino al **[DATA_FINE]**, fatto salvo l'esaurimento anticipato dei giorni/uomo indicati al par. 6. Non sono previsti rinnovi taciti né disdette: l'eventuale proroga è concordata per iscritto tra le Parti.

{{pacchetto::Il Pacchetto giornate vale fino al **[DATA_FINE]**. Le giornate non utilizzate entro tale data si esauriscono comunque: non sono rimborsabili né trasferibili a un periodo successivo.}}

## FATTURAZIONE
{{consuntivo::I giorni/uomo erogati sono fatturati mensilmente a consuntivo, sulla base dello statino, nel limite del totale del par. 6.}}

{{pacchetto::Il Pacchetto giornate è fatturato in via anticipata, in soluzione unica, all'avvio del servizio.}}

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

@@field AMBITO
label: Ambito
hint: A supporto di quale progetto o team lavorano le risorse.
example: es. del team mobile banking

@@field DATA_INIZIO
label: Inizio
kind: date

@@field DATA_FINE
label: Fine
kind: date

@@field FTE
label: FTE
kind: number

@@field IMPIEGO
label: Impiego
example: 100%

@@field GG
label: Giorni/uomo
kind: number

@@field TOTALE_GG
label: Totale giorni/uomo
kind: number
compute: sum(GG)

@@field IMPIEGO_MINIMO
label: Impiego minimo (%)
hint: Percentuale minima per FTE su base mensile.
kind: percentage

@@field VALUTA
source: currency

@@field TARIFFA
label: Tariffa / giorno
kind: amount

@@field VALIDITA_GIORNI
label: Validità dell'offerta (giorni)
kind: number
source: validityDays

@@table PROFILO
label: Profilo
columns: PROFILO, FTE, IMPIEGO, GG, TARIFFA

@@block pacchetto
label: Pacchetto giornate prepagato
explain: Fatturato in anticipo. Le giornate non usate entro la scadenza si esauriscono.

@@block dati_critici
label: Clausola dati critici
explain: Il Cliente non espone al Fornitore dati critici (carte, conti). Tipica dei clienti bancari.

@@block risorse_extra
label: Risorse aggiuntive
explain: Risorse in più, su richiesta scritta, alle stesse tariffe.

@@block sconto
label: Scontistica accordata
explain: Aggiunge la riga di sconto, come importo.

@@block consuntivo
label: A consuntivo, con tetto
explain: Fatturazione mensile dei giorni erogati, nel limite del totale.

@@choice modalita
label: Modalità di fornitura
options: consuntivo | pacchetto
default: consuntivo
`;
