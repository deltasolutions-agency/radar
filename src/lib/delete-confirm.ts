/**
 * Parola di conferma FISSA richiesta per ogni eliminazione definitiva/
 * irreversibile (force-delete). Uniforme in tutta l'app, maiuscolo esatto
 * (confronto case-sensitive). Usata sia lato UI (per abilitare il pulsante) sia
 * lato server (validazione dell'endpoint).
 */
export const DELETE_CONFIRM_WORD = "ELIMINA";
