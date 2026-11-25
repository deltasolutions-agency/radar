/**
 * Testi legali di Delta Solutions Cloud (Condizioni generali di servizio e
 * Accordo sul trattamento dei dati, DPA), pubblicati su /cloud/condizioni e
 * /cloud/dpa e accettati sulla pagina di pagamento /pay/[token].
 *
 * Se il testo cambia: aggiornare CLOUD_TERMS_VERSION e CLOUD_TERMS_DATE_LABEL.
 * I clienti con una versione precedente dovranno accettare di nuovo al
 * pagamento successivo (ConsentLog type CLOUD_CONSENT_TYPE).
 */

export const CLOUD_TERMS_VERSION = "2026-11-13";
export const CLOUD_TERMS_DATE_LABEL = "13 novembre 2026";
export const CLOUD_CONSENT_TYPE = "CLOUD_TC_DPA";
/**
 * Versione registrata nel ConsentLog. Prefisso "cloud-" perché altre pagine
 * (es. /attiva-rinnovo) cercano il consenso standard solo per versione.
 */
export const CLOUD_CONSENT_VERSION = `cloud-${CLOUD_TERMS_VERSION}`;
export const CLOUD_TERMS_PATH = "/cloud/condizioni";
export const CLOUD_DPA_PATH = "/cloud/dpa";

/** Clausole da approvare specificamente (artt. 1341-1342 c.c.), art. 19. */
export const CLOUD_VESSATORIE_IT =
  "5.3, 6.5, 7, 8, 9.4, 10.3, 12, 14, 15, 16.2 e 17.2";
export const CLOUD_VESSATORIE_EN =
  "5.3, 6.5, 7, 8, 9.4, 10.3, 12, 14, 15, 16.2 and 17.2";

export type LegalSection = {
  h: string;
  p?: string[];
  list?: string[];
  table?: { head: string[]; rows: string[][] };
  after?: string[];
};

export const FORNITORE =
  "Delta Solutions Agency di Andrea Trinca — Via Courmayeur 79, 00135 Roma (IT) — C.F. TRNNDR87C28H501E — P.IVA / VAT IT13983231005 — SDI KRRH6B9 — hello@deltasolutions.agency";

export const CLOUD_TERMS_INTRO = [
  "Queste Condizioni regolano il servizio Delta Solutions Cloud tra Delta Solutions e i clienti professionali. Si accettano online cliccando “Accetta e paga” sulla pagina di pagamento.",
];

export const CLOUD_TERMS: LegalSection[] = [
  {
    h: "Art. 1 — Definizioni",
    list: [
      "Fornitore o Delta Solutions: il soggetto indicato in intestazione.",
      "Cliente: l'impresa, lo studio professionale o l'ente che acquista il Servizio nell'esercizio della propria attività. Il Servizio non è destinato ai consumatori.",
      "Servizio: lo spazio cloud documentale dedicato al Cliente (“Cloud”), la console di gestione e gli eventuali Moduli attivati.",
      "Moduli: le funzioni aggiuntive a canone separato, come Video Checker e Image Checker.",
      "Referente: la persona indicata dal Cliente per la gestione del Servizio.",
      "Utenti: le persone a cui il Cliente o il Referente dà accesso al Cloud.",
      "Contenuti: file, dati e informazioni caricati nel Cloud dal Cliente, dagli Utenti o da terzi invitati.",
      "Pagina di pagamento: la pagina raggiunta dal link inviato al Cliente all'attivazione, dove si accettano le Condizioni e si effettua il primo pagamento.",
      "DPA: l'Accordo sul trattamento dei dati personali (art. 28 GDPR), parte integrante di queste Condizioni.",
    ],
  },
  {
    h: "Art. 2 — Oggetto del Servizio",
    p: [
      "2.1 Il Fornitore mette a disposizione del Cliente un Cloud documentale su istanza dedicata, con archiviazione su storage riservato al solo Cliente, accessibile via web, app desktop e mobile.",
      "2.2 Il Servizio comprende: spazio di archiviazione secondo il piano scelto, gestione di Utenti e permessi, personalizzazione grafica (logo, colori, sfondo), possibilità di usare un dominio del Cliente, backup secondo l'art. 9, assistenza via email e area clienti.",
      "2.3 Caratteristiche, limiti e prezzo del piano sono quelli indicati nell'offerta o nella Pagina di pagamento al momento dell'acquisto.",
    ],
  },
  {
    h: "Art. 3 — Conclusione del contratto",
    p: [
      "3.1 Il contratto si conclude quando il Cliente, sulla Pagina di pagamento, approva le clausole indicate all'art. 19 e clicca “Accetta e paga”, e il pagamento va a buon fine.",
      "3.2 Il Fornitore registra la versione delle Condizioni e del DPA accettata, la data e l'ora, l'indirizzo IP e i dati del Cliente. Le Condizioni restano consultabili nell'area clienti.",
      "3.3 Chi accetta dichiara di avere i poteri per impegnare il Cliente.",
    ],
  },
  {
    h: "Art. 4 — Attivazione, credenziali e accessi",
    p: [
      "4.1 Il Cloud è attivato al primo pagamento. Il Fornitore comunica al Referente l'indirizzo del Cloud e le credenziali iniziali.",
      "4.2 Il Cliente custodisce le credenziali con diligenza ed è responsabile di ogni attività svolta con esse; deve avvisare subito il Fornitore in caso di uso non autorizzato.",
      "4.3 Il Cliente decide chi sono gli Utenti e con quali permessi. Il Fornitore non risponde di condivisioni, link pubblici o accessi concessi dal Cliente o dagli Utenti.",
      "4.4 Il personale del Fornitore accede al Cloud del Cliente solo quando è necessario per assistenza, manutenzione, sicurezza o adempimento di obblighi di legge, come previsto dal DPA.",
    ],
  },
  {
    h: "Art. 5 — Moduli e servizi aggiuntivi",
    p: [
      "5.1 Il Cliente può attivare Moduli e servizi aggiuntivi (spazio extra, dominio dedicato, ecc.) dall'area clienti o su richiesta. L'attivazione vale come accettazione del relativo prezzo a listino.",
      "5.2 I Moduli sono regolati da queste Condizioni, salvo condizioni specifiche indicate al momento dell'attivazione. Il canone del Modulo si aggiunge a quello del Servizio e segue le stesse regole di durata, fatturazione e rinnovo.",
      "5.3 Un Modulo attivato nel corso dell'annualità scade insieme a essa e si rinnova con il Servizio. Il Cliente può disdirlo separatamente nei termini dell'art. 7.2; in caso di disattivazione anticipata si applica l'art. 7.3.",
    ],
  },
  {
    h: "Art. 6 — Corrispettivi, fatturazione e addebito automatico",
    p: [
      "6.1 Il Cliente paga: (a) l'eventuale importo una tantum di attivazione, solo con il primo pagamento; (b) il canone annuale del piano, suddiviso in rate mensili; (c) i canoni dei Moduli e dei servizi aggiuntivi attivati. Gli importi si intendono IVA esclusa.",
      "6.2 La prima rata è addebitata il giorno del primo pagamento, le successive ogni mese nello stesso giorno. Se quel giorno non esiste nel mese, l'addebito avviene l'ultimo giorno del mese.",
      "6.3 Con il primo pagamento il Cliente autorizza il Fornitore ad addebitare automaticamente le rate successive sul metodo di pagamento indicato, tramite il gestore dei pagamenti (Stripe). Il Cliente si impegna a mantenere valido il metodo di pagamento e ad aggiornarlo in caso di variazione.",
      "6.4 Il Fornitore emette fattura elettronica per ogni pagamento.",
      "6.5 La suddivisione in rate mensili è una facilitazione di pagamento: il Cliente è tenuto al pagamento dell'intero canone annuale. Le rate pagate non sono rimborsabili, salvo quanto previsto dall'art. 15.2.",
    ],
  },
  {
    h: "Art. 7 — Durata, rinnovo automatico e recesso",
    p: [
      "7.1 Il contratto ha durata di un anno dalla data del primo pagamento (“annualità”) e si rinnova automaticamente di anno in anno, salvo disdetta.",
      "7.2 Ciascuna parte può dare disdetta almeno 30 giorni prima della scadenza dell'annualità in corso. Il Cliente può farlo dall'area clienti o scrivendo a hello@deltasolutions.agency. La disdetta ha effetto alla scadenza dell'annualità.",
      "7.3 Il Cliente può recedere anche prima della scadenza. In tal caso il recesso ha effetto alla fine del mese già pagato e il Fornitore emette fattura, con addebito immediato, per le rate mensili residue fino alla scadenza dell'annualità in corso.",
      "7.4 Il Fornitore può recedere in qualsiasi momento con un preavviso di almeno 30 giorni, comunicato via email al Referente. In tal caso il Cliente non deve le rate successive alla data di efficacia del recesso.",
      "7.5 Alla cessazione del contratto, per qualsiasi causa, si applica l'art. 14.",
    ],
  },
  {
    h: "Art. 8 — Mancato pagamento, sospensione e risoluzione",
    p: [
      "8.1 Se un addebito non va a buon fine, il Fornitore avvisa il Referente via email e ritenta l'addebito nei giorni successivi.",
      "8.2 Se il pagamento non è regolarizzato entro 7 giorni dalla scadenza, il Fornitore può sospendere il Servizio. Durante la sospensione i Contenuti restano conservati ma non sono accessibili; le rate continuano a maturare.",
      "8.3 Se il pagamento non è regolarizzato entro 30 giorni dalla scadenza, il contratto si intende risolto di diritto ai sensi dell'art. 1456 c.c., con comunicazione al Referente. Il Fornitore emette fattura per l'intero importo dell'annualità in corso non ancora saldato, comprese le rate scadute, che il Cliente è tenuto a pagare entro 15 giorni dal ricevimento. Si applica inoltre l'art. 14.",
      "8.4 Il Fornitore può sospendere il Servizio anche senza preavviso in caso di uso contrario all'art. 10 o di rischio concreto per la sicurezza del sistema o di altri clienti, limitatamente al tempo necessario.",
    ],
  },
  {
    h: "Art. 9 — Livelli di servizio, manutenzione e backup",
    p: [
      "9.1 Il Fornitore si impegna a mantenere il Servizio disponibile con continuità, con un obiettivo di disponibilità mensile del 99%, escluse le manutenzioni programmate. L'obbligo è di mezzi e non di risultato.",
      "9.2 Le manutenzioni programmate sono comunicate con almeno 48 ore di anticipo e, per quanto possibile, svolte in orari di basso utilizzo. Gli interventi urgenti di sicurezza possono avvenire senza preavviso.",
      "9.3 Il Fornitore esegue backup automatici con frequenza giornaliera e conservazione di 14 giorni. I backup servono al ripristino del Servizio in caso di guasto. Il ripristino di singoli file cancellati dal Cliente è possibile, entro il periodo di conservazione, come servizio su richiesta.",
      "9.4 Se il Servizio resta indisponibile per cause imputabili al Fornitore per più di 72 ore consecutive, il Cliente ha diritto, su richiesta, a un'estensione gratuita dell'annualità in corso pari ai giorni di indisponibilità. Questo è l'unico rimedio per l'indisponibilità, salvo dolo o colpa grave.",
      "9.5 L'assistenza è fornita via email e area clienti nei giorni lavorativi, dalle 9:30 alle 18:00.",
    ],
  },
  {
    h: "Art. 10 — Obblighi del Cliente e uso consentito",
    p: [
      "10.1 Il Cliente si impegna a usare il Servizio per la propria attività professionale, nel rispetto della legge e di queste Condizioni, e risponde anche dell'operato degli Utenti.",
      "10.2 È vietato usare il Servizio per: caricare o diffondere contenuti illeciti o in violazione di diritti di terzi; distribuire malware; svolgere attività di spam, phishing o attacchi informatici; aggirare limiti tecnici o misure di sicurezza; rivendere il Servizio a terzi senza accordo scritto.",
      "10.3 Il Cliente manleva e tiene indenne il Fornitore da qualsiasi pretesa di terzi derivante dai Contenuti o dall'uso del Servizio in violazione di questo articolo.",
      "10.4 Il Cliente è responsabile della conservazione di copie dei Contenuti essenziali per la propria attività, anche al di fuori del Servizio.",
    ],
  },
  {
    h: "Art. 11 — Contenuti e proprietà intellettuale",
    p: [
      "11.1 I Contenuti restano di proprietà del Cliente o dei rispettivi titolari. Il Fornitore li tratta al solo fine di erogare il Servizio, come previsto dal DPA.",
      "11.2 Il software della console, i Moduli, i marchi e la documentazione del Fornitore restano di sua proprietà. Il Cliente riceve un diritto d'uso non esclusivo e non cedibile per la durata del contratto.",
      "11.3 Il Cloud è basato su software open source (Nextcloud), soggetto alle rispettive licenze.",
      "11.4 Il Cliente autorizza il Fornitore a citare il suo nome e logo tra i clienti, salvo diversa indicazione scritta.",
    ],
  },
  {
    h: "Art. 12 — Limitazione di responsabilità",
    p: [
      "12.1 Il Fornitore risponde dei danni diretti causati da propri inadempimenti, nel limite complessivo dei corrispettivi pagati dal Cliente nei 12 mesi precedenti l'evento dannoso.",
      "12.2 Il Fornitore non risponde di danni indiretti o consequenziali, come mancato guadagno, perdita di clientela, interruzione dell'attività o perdita di dati non ripristinabili dai backup previsti all'art. 9.",
      "12.3 Il Fornitore non risponde di disservizi dovuti a: forza maggiore; guasti o interruzioni di reti, fornitori di connettività o data center di terzi non imputabili al Fornitore; uso del Servizio non conforme all'art. 10; azioni del Cliente o degli Utenti, comprese cancellazioni e condivisioni.",
      "12.4 Le limitazioni di questo articolo non si applicano in caso di dolo o colpa grave (art. 1229 c.c.).",
    ],
  },
  {
    h: "Art. 13 — Protezione dei dati personali",
    p: [
      "13.1 Per i dati personali contenuti nel Cloud il Cliente è titolare del trattamento e il Fornitore è responsabile del trattamento ai sensi dell'art. 28 GDPR. Il rapporto è regolato dal DPA, accettato insieme a queste Condizioni.",
      "13.2 Il Cliente autorizza il Fornitore ad avvalersi dei sub-responsabili indicati nel DPA, tra cui Hetzner Online GmbH per server e storage situati nell'Unione Europea.",
      "13.3 I dati del Cliente e del Referente raccolti per la gestione del contratto, dei pagamenti (tramite Stripe) e della fatturazione sono trattati dal Fornitore in qualità di titolare, secondo l'Informativa privacy pubblicata sul sito.",
    ],
  },
  {
    h: "Art. 14 — Cessazione, restituzione e cancellazione dei Contenuti",
    p: [
      "14.1 Alla cessazione del contratto, per qualsiasi causa, l'accesso al Cloud passa in sola lettura per 30 giorni, durante i quali il Cliente può scaricare i Contenuti. Su richiesta, il Fornitore fornisce un export completo al prezzo di listino.",
      "14.2 Trascorso tale periodo, il Fornitore cancella definitivamente il Cloud, lo storage dedicato e i relativi backup entro i successivi 30 giorni e, su richiesta, ne dà conferma scritta.",
      "14.3 Dopo la cancellazione i Contenuti non sono più recuperabili. Il Fornitore non risponde della perdita di Contenuti non scaricati nei termini.",
      "14.4 Restano conservati i dati che il Fornitore deve tenere per obblighi di legge, come quelli contabili e fiscali.",
    ],
  },
  {
    h: "Art. 15 — Modifiche alle Condizioni, ai prezzi e al Servizio",
    p: [
      "15.1 Il Fornitore può modificare queste Condizioni e il DPA comunicandolo via email al Referente con almeno 30 giorni di anticipo. Le modifiche ai prezzi sono comunicate almeno 60 giorni prima della scadenza dell'annualità e si applicano dall'annualità successiva.",
      "15.2 Se non accetta le modifiche alle Condizioni o al DPA, il Cliente può recedere prima che entrino in vigore senza addebito delle rate residue. Per le modifiche ai prezzi resta ferma la disdetta prevista dall'art. 7.2.",
      "15.3 Se il Cliente continua a usare il Servizio dopo l'entrata in vigore delle modifiche, queste si intendono accettate. Per le clausole elencate all'art. 19 il Fornitore chiede una nuova approvazione specifica al primo accesso successivo.",
      "15.4 Il Fornitore può aggiornare il software e le funzioni del Servizio senza preavviso, purché non ne riduca in modo sostanziale le caratteristiche essenziali.",
    ],
  },
  {
    h: "Art. 16 — Cessione e subfornitori",
    p: [
      "16.1 Il Cliente non può cedere il contratto senza consenso scritto del Fornitore.",
      "16.2 Il Fornitore può cedere il contratto a un soggetto che subentri nell'attività, dandone comunicazione al Cliente, e può avvalersi di subfornitori per erogare il Servizio, restando responsabile del loro operato nei confronti del Cliente.",
    ],
  },
  {
    h: "Art. 17 — Legge applicabile e foro competente",
    p: [
      "17.1 Il contratto è regolato dalla legge italiana.",
      "17.2 Per ogni controversia relativa al contratto è competente in via esclusiva il Foro di Roma.",
    ],
  },
  {
    h: "Art. 18 — Disposizioni finali",
    p: [
      "18.1 Le comunicazioni tra le parti avvengono via email: per il Fornitore a hello@deltasolutions.agency, per il Cliente all'indirizzo del Referente indicato all'attivazione.",
      "18.2 Se una clausola risulta invalida, le altre restano valide.",
      "18.3 Queste Condizioni, il DPA e l'offerta o la Pagina di pagamento costituiscono l'intero accordo tra le parti sul Servizio. In caso di contrasto prevale, nell'ordine: il DPA per i dati personali, l'offerta scritta accettata, queste Condizioni.",
      "18.4 La mancata applicazione di un diritto non vale come rinuncia.",
    ],
  },
  {
    h: "Art. 19 — Approvazione specifica (artt. 1341 e 1342 c.c.)",
    p: [
      "Il Cliente dichiara di aver letto e di approvare specificamente le seguenti clausole: 5.3 (durata e disattivazione dei Moduli); 6.5 (obbligo di pagamento dell'intero canone annuale e non rimborsabilità delle rate); 7 (durata annuale, rinnovo automatico, termine di disdetta, addebito delle rate residue in caso di recesso anticipato, recesso del Fornitore); 8 (sospensione, risoluzione per mancato pagamento e fatturazione dell'importo residuo dell'annualità); 9.4 (unico rimedio per indisponibilità); 10.3 (manleva); 12 (limitazione di responsabilità); 14 (termini per scaricare i Contenuti e cancellazione); 15 (modifiche unilaterali); 16.2 (cessione del contratto da parte del Fornitore); 17.2 (foro esclusivo di Roma).",
    ],
  },
];

export const CLOUD_DPA_INTRO = [
  "Questo Accordo regola il trattamento dei dati personali che Delta Solutions svolge per conto del Cliente nell'erogazione di Delta Solutions Cloud, ai sensi dell'art. 28 del Regolamento (UE) 2016/679 (“GDPR”). È parte integrante delle Condizioni generali di servizio ed è accettato con esse cliccando “Accetta e paga”.",
  "Titolare del trattamento: il Cliente, come identificato all'attivazione del Servizio.",
  "I termini con l'iniziale maiuscola hanno il significato indicato nelle Condizioni generali; gli altri termini (“dato personale”, “trattamento”, “violazione dei dati personali”, ecc.) hanno il significato dell'art. 4 GDPR.",
];

export const CLOUD_DPA: LegalSection[] = [
  {
    h: "Art. 1 — Oggetto e ruoli",
    p: [
      "1.1 Per i dati personali contenuti nel Cloud e nei Moduli, il Cliente è titolare del trattamento e Delta Solutions (“Responsabile”) è responsabile del trattamento.",
      "1.2 Il Cliente dichiara di trattare i dati in modo lecito e di avere una base giuridica valida per affidarli al Responsabile, compresi i dati di terzi (propri clienti, dipendenti, collaboratori) caricati nel Cloud.",
      "1.3 I dati del Cliente e del Referente necessari a gestire contratto, pagamenti e fatturazione sono trattati da Delta Solutions come titolare autonomo e non rientrano in questo Accordo.",
    ],
  },
  {
    h: "Art. 2 — Natura, finalità e durata del trattamento",
    p: [
      "2.1 Il Responsabile tratta i dati al solo fine di erogare il Servizio: archiviazione, sincronizzazione, condivisione, backup e ripristino, assistenza tecnica, sicurezza e, per i Moduli attivati, revisione e commento di file video, immagini e PDF.",
      "2.2 Categorie di interessati, tipi di dati e operazioni di trattamento sono indicati nell'Allegato A.",
      "2.3 Il trattamento dura quanto il contratto, più il periodo di restituzione e cancellazione previsto dall'art. 12.",
    ],
  },
  {
    h: "Art. 3 — Istruzioni del titolare",
    p: [
      "3.1 Il Responsabile tratta i dati solo su istruzione documentata del Cliente. Le Condizioni generali, questo Accordo e le impostazioni scelte dal Cliente nel Servizio costituiscono le istruzioni complete del Cliente.",
      "3.2 Ulteriori istruzioni vanno date per iscritto a hello@deltasolutions.agency. Se comportano attività non previste dal Servizio, il Responsabile può chiedere un compenso aggiuntivo, previo accordo.",
      "3.3 Il Responsabile informa subito il Cliente se ritiene che un'istruzione violi il GDPR o altre norme sulla protezione dei dati.",
      "3.4 Se una norma dell'Unione o italiana impone al Responsabile un trattamento diverso, il Responsabile ne informa il Cliente prima del trattamento, salvo che la norma lo vieti.",
    ],
  },
  {
    h: "Art. 4 — Dati particolari",
    p: [
      "4.1 Il Servizio è un archivio documentale generico. Se il Cliente vi carica categorie particolari di dati (art. 9 GDPR) o dati relativi a condanne penali e reati (art. 10 GDPR), è responsabile di valutarne la liceità e l'adeguatezza delle misure dell'Allegato B, e può chiedere al Responsabile misure aggiuntive.",
    ],
  },
  {
    h: "Art. 5 — Riservatezza e persone autorizzate",
    p: [
      "5.1 Il Responsabile consente l'accesso ai dati solo alle persone che ne hanno bisogno per erogare il Servizio, autorizzate per iscritto e vincolate alla riservatezza, anche dopo la fine del rapporto.",
      "5.2 L'accesso del personale ai Contenuti avviene solo per assistenza richiesta dal Cliente, manutenzione, sicurezza o obblighi di legge, ed è tracciato.",
    ],
  },
  {
    h: "Art. 6 — Sicurezza del trattamento",
    p: [
      "6.1 Il Responsabile adotta le misure tecniche e organizzative dell'Allegato B, adeguate al rischio ai sensi dell'art. 32 GDPR.",
      "6.2 Il Responsabile può aggiornare le misure nel tempo, purché il livello di sicurezza complessivo non si riduca.",
      "6.3 Il Cliente è responsabile delle misure che dipendono da lui: scelta degli Utenti e dei permessi, condivisioni e link pubblici, robustezza delle password, attivazione dell'autenticazione a due fattori, sicurezza dei dispositivi da cui accede.",
    ],
  },
  {
    h: "Art. 7 — Sub-responsabili",
    p: [
      "7.1 Il Cliente autorizza in via generale il Responsabile ad avvalersi di sub-responsabili. Quelli in uso alla data di questo Accordo sono elencati nell'Allegato C.",
      "7.2 Il Responsabile comunica via email al Referente l'aggiunta o la sostituzione di un sub-responsabile con almeno 30 giorni di anticipo. Il Cliente può opporsi per iscritto, per motivi fondati legati alla protezione dei dati, entro 15 giorni dalla comunicazione.",
      "7.3 Se l'opposizione non si risolve, il Cliente può recedere prima che il nuovo sub-responsabile inizi il trattamento, senza addebito delle rate residue.",
      "7.4 Il Responsabile impone a ciascun sub-responsabile, per contratto, obblighi di protezione dei dati equivalenti a quelli di questo Accordo, e risponde verso il Cliente del loro inadempimento.",
    ],
  },
  {
    h: "Art. 8 — Luogo del trattamento e trasferimenti",
    p: [
      "8.1 I Contenuti sono conservati su server e storage situati nell'Unione Europea.",
      "8.2 Il Responsabile non trasferisce dati personali fuori dallo Spazio Economico Europeo senza averne informato il Cliente e senza le garanzie previste dal Capo V del GDPR, come una decisione di adeguatezza o le clausole contrattuali tipo della Commissione europea. I trasferimenti in corso sono indicati nell'Allegato C.",
    ],
  },
  {
    h: "Art. 9 — Assistenza al titolare",
    p: [
      "9.1 Tenuto conto della natura del trattamento, il Responsabile assiste il Cliente:",
    ],
    list: [
      "nel rispondere alle richieste degli interessati (accesso, rettifica, cancellazione, limitazione, portabilità, opposizione), anche tramite le funzioni del Servizio che permettono al Cliente di gestire direttamente i Contenuti;",
      "nel rispettare gli obblighi degli artt. 32-36 GDPR (sicurezza, notifica delle violazioni, valutazione d'impatto e consultazione preventiva).",
    ],
    after: [
      "9.2 Se un interessato si rivolge direttamente al Responsabile, questo lo indirizza al Cliente e ne informa il Cliente senza ingiustificato ritardo, senza rispondere nel merito.",
      "9.3 L'assistenza che richiede attività straordinarie può essere fatturata a parte, previo accordo, salvo che derivi da un inadempimento del Responsabile.",
    ],
  },
  {
    h: "Art. 10 — Violazioni dei dati personali",
    p: [
      "10.1 Il Responsabile notifica al Cliente ogni violazione dei dati personali che riguarda i suoi Contenuti senza ingiustificato ritardo e comunque entro 48 ore da quando ne viene a conoscenza, scrivendo all'indirizzo email del Referente.",
      "10.2 La notifica indica, per quanto noto: natura della violazione, categorie e numero approssimativo di interessati e di dati coinvolti, probabili conseguenze, misure adottate o proposte, e un contatto per ulteriori informazioni. Le informazioni non disponibili subito sono fornite appena possibile.",
      "10.3 Spetta al Cliente, come titolare, valutare se notificare la violazione al Garante entro 72 ore e se comunicarla agli interessati. Il Responsabile non lo fa al suo posto, salvo richiesta scritta.",
    ],
  },
  {
    h: "Art. 11 — Verifiche",
    p: [
      "11.1 Il Responsabile mette a disposizione del Cliente, su richiesta, le informazioni necessarie a dimostrare il rispetto di questo Accordo.",
      "11.2 Il Cliente può svolgere, o far svolgere da un revisore vincolato alla riservatezza, un'ispezione all'anno, con preavviso scritto di almeno 30 giorni, in orario lavorativo e senza accesso ai dati di altri clienti. I costi sono a carico del Cliente, salvo che l'ispezione riveli una violazione rilevante del Responsabile.",
    ],
  },
  {
    h: "Art. 12 — Restituzione e cancellazione dei dati",
    p: [
      "12.1 Alla cessazione del contratto, per qualsiasi causa, il Cliente può scaricare i Contenuti nei termini dell'art. 14 delle Condizioni generali.",
      "12.2 Trascorsi tali termini, il Responsabile cancella definitivamente i Contenuti, il Cloud, lo storage dedicato e i backup, salvo che una norma dell'Unione o italiana ne imponga la conservazione. Su richiesta, ne dà conferma scritta.",
    ],
  },
  {
    h: "Art. 13 — Responsabilità",
    p: [
      "13.1 Ciascuna parte risponde dei danni causati dal proprio inadempimento al GDPR o a questo Accordo, secondo l'art. 82 GDPR.",
      "13.2 Nei rapporti tra le parti si applicano i limiti di responsabilità dell'art. 12 delle Condizioni generali, nella misura consentita dalla legge. I limiti non si applicano alle sanzioni o ai danni causati da dolo o colpa grave.",
    ],
  },
  {
    h: "Art. 14 — Durata e disposizioni finali",
    p: [
      "14.1 Questo Accordo ha la stessa durata del contratto e resta in vigore finché il Responsabile tratta dati per conto del Cliente.",
      "14.2 Le modifiche a questo Accordo seguono l'art. 15 delle Condizioni generali. Le modifiche imposte da norme o da provvedimenti del Garante si applicano dalla data indicata nella comunicazione.",
      "14.3 Per quanto riguarda la protezione dei dati, in caso di contrasto questo Accordo prevale sulle Condizioni generali.",
      "14.4 Si applicano la legge italiana e il foro dell'art. 17 delle Condizioni generali.",
    ],
  },
  {
    h: "Allegato A — Dettagli del trattamento",
    table: {
      head: ["Voce", "Descrizione"],
      rows: [
        ["Interessati", "Referente e Utenti del Cliente; persone i cui dati compaiono nei Contenuti (clienti, dipendenti, collaboratori, fornitori del Cliente); destinatari dei link di revisione dei Moduli"],
        ["Dati degli Utenti", "Nome, email, credenziali, ruolo e permessi, log di accesso e di attività, indirizzo IP"],
        ["Dati nei Contenuti", "Determinati dal Cliente: qualsiasi dato presente nei file caricati, comprese immagini e video"],
        ["Dati dei Moduli", "Commenti, annotazioni, versioni, nome ed email di chi accede ai link di revisione"],
        ["Operazioni", "Conservazione, organizzazione, consultazione, condivisione su istruzione del Cliente, backup, ripristino, generazione di anteprime, cancellazione"],
        ["Frequenza", "Continuativa, per la durata del contratto"],
      ],
    },
  },
  {
    h: "Allegato B — Misure di sicurezza",
    list: [
      "Isolamento: ogni Cliente ha un'istanza Cloud dedicata e uno storage dedicato, accessibile solo con credenziali riservate a quell'istanza; l'isolamento tra clienti è verificato con test periodici.",
      "Cifratura in transito: tutte le connessioni avvengono via HTTPS/TLS.",
      "Cifratura dei backup: i backup sono cifrati (AES-256) prima di essere salvati; i file del Cloud sono conservati sullo storage dedicato del Cliente, protetto dalle misure di isolamento e di accesso di questo allegato.",
      "Accesso amministrativo: console riservata al personale autorizzato con autenticazione a due fattori (TOTP); accesso ai server solo tramite chiavi SSH; nessuna credenziale condivisa tramite canali non sicuri.",
      "Autenticazione degli Utenti: password con requisiti minimi; autenticazione a due fattori disponibile; recupero password con link a scadenza (1 ora).",
      "Integrazioni: le comunicazioni tra i sistemi del Responsabile sono firmate (HMAC).",
      "Backup: automatici, con frequenza e conservazione indicate all'art. 9.3 delle Condizioni generali, su storage separato dall'istanza.",
      "Aggiornamenti: applicazione regolare delle patch di sicurezza del sistema operativo, di Nextcloud e dei componenti.",
      "Monitoraggio: controlli automatici dello stato dei servizi e log degli eventi rilevanti.",
      "Cancellazione: procedura documentata che elimina istanza, storage e backup alla cessazione.",
    ],
  },
  {
    h: "Allegato C — Sub-responsabili",
    table: {
      head: ["Sub-responsabile", "Servizio", "Luogo del trattamento"],
      rows: [
        ["Hetzner Online GmbH, Gunzenhausen (Germania)", "Server, storage a oggetti e backup", "Helsinki (Finlandia), Unione Europea"],
        ["Resend, Inc., San Francisco (Stati Uniti)", "Invio delle email di notifica del Servizio (indirizzo del destinatario e testo della notifica; non i Contenuti)", "Stati Uniti: trasferimento basato sull'EU-U.S. Data Privacy Framework e sulle clausole contrattuali tipo della Commissione europea"],
      ],
    },
    after: [
      "Stripe e il gestionale interno di fatturazione trattano solo i dati del Cliente per i pagamenti, come titolare autonomo (art. 1.3), e non sono sub-responsabili.",
    ],
  },
];
