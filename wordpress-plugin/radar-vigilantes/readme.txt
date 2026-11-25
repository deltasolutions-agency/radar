=== Radar Vigilantes ===
Contributors: deltasolutions
Requires at least: 5.8
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later

Collega il sito a Radar (Delta Solutions) per il monitoraggio di aggiornamenti e sicurezza.

== Description ==

* Elenca core, plugin (anche premium, es. Divi) e temi con gli aggiornamenti disponibili.
* Controlli di sicurezza giornalieri: integrità dei file del core, file PHP in uploads, nuovi amministratori, debug visibile.
* Scansione approfondita (attivabile da Radar): codice offuscato, backdoor e file sospetti; confronto dei plugin wordpress.org con gli originali.
* Monitoraggio protetto: un loader in mu-plugins lo mantiene attivo; disattivazione e rimozione sono segnalate a Radar.
* Comunicazione firmata (HMAC-SHA256) in entrambe le direzioni; il plugin è in sola lettura: non modifica, non cancella e non aggiorna nulla.

== Installation ==

1. In Radar → Vigilantes crea il sito e scarica il plugin.
2. Plugin → Aggiungi nuovo → Carica plugin, poi attiva.
3. Impostazioni → Radar Vigilantes: incolla la chiave di collegamento.

In alternativa la chiave può stare in wp-config.php: `define( 'RADAR_VIGILANTES_KEY', 'rv1....' );`

== Changelog ==

= 1.0.1 =
* Scansione del codice: meno falsi positivi (regola /e corretta; offuscamento segnalato solo se il file esegue codice; index.php di protezione dei plugin ignorati; wp-config-docker.php noto).
* Loader in mu-plugins: il monitoraggio resta attivo anche se il plugin viene disattivato dal pannello; disattivazione e disinstallazione vengono segnalate subito a Radar con l'utente che le ha fatte.
* Avanzamento della scansione visibile in Radar.

= 1.0.0 =
* Prima versione.
