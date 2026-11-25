<?php
/**
 * Pagina Impostazioni → Radar Vigilantes.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Admin {
	const PAGE = 'radar-vigilantes';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_rv_save', array( __CLASS__, 'handle_save' ) );
		add_action( 'admin_post_rv_action', array( __CLASS__, 'handle_action' ) );
		add_filter( 'plugin_action_links_' . RADAR_VIGILANTES_BASENAME, array( __CLASS__, 'links' ) );
	}

	public static function menu() {
		add_options_page( 'Radar Vigilantes', 'Radar Vigilantes', 'manage_options', self::PAGE, array( __CLASS__, 'render' ) );
	}

	public static function links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::url() ) . '">Impostazioni</a>' );
		return $links;
	}

	private static function url( array $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => self::PAGE ), $args ), admin_url( 'options-general.php' ) );
	}

	private static function done( $type, $msg ) {
		wp_safe_redirect( self::url( array( 'rv_' . $type => rawurlencode( $msg ) ) ) );
		exit;
	}

	public static function handle_save() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permesso negato' );
		}
		check_admin_referer( 'rv_save' );
		if ( RV_Settings::from_constant() ) {
			self::done( 'error', 'La chiave è definita in wp-config.php (RADAR_VIGILANTES_KEY).' );
		}
		if ( ! empty( $_POST['rv_disconnect'] ) ) {
			RV_Settings::disconnect();
			self::done( 'ok', 'Sito scollegato da Radar.' );
		}
		$key = isset( $_POST['rv_key'] ) ? sanitize_text_field( wp_unslash( $_POST['rv_key'] ) ) : '';
		if ( ! RV_Settings::save_key( $key ) ) {
			self::done( 'error', 'Chiave non valida: copiala di nuovo dalla scheda del sito in Radar.' );
		}
		RV_Tasks::run_due( 20 );
		$res = RV_Client::push( 'connected' );
		if ( true === $res ) {
			self::done( 'ok', 'Collegato: Radar ha ricevuto il primo report.' );
		}
		self::done( 'error', 'Chiave salvata, ma Radar non ha accettato il report: ' . $res );
	}

	public static function handle_action() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permesso negato' );
		}
		check_admin_referer( 'rv_action' );
		$what = isset( $_POST['rv_do'] ) ? sanitize_key( wp_unslash( $_POST['rv_do'] ) ) : '';
		if ( 'push' === $what ) {
			RV_Collector::refresh_updates();
			$res = RV_Client::push( 'manual' );
			true === $res ? self::done( 'ok', 'Report inviato a Radar.' ) : self::done( 'error', 'Invio non riuscito: ' . $res );
		}
		if ( 'scan' === $what ) {
			RV_Tasks::run_due( 25, true );
			$msg = RV_Scanner::in_progress()
				? 'Controlli eseguiti in parte (scansione approfondita ancora in corso: premi di nuovo per continuare).'
				: 'Controlli completati.';
			$res = RV_Client::push( 'scan' );
			true === $res ? self::done( 'ok', $msg . ' Report inviato a Radar.' ) : self::done( 'error', $msg . ' Invio non riuscito: ' . $res );
		}
		self::done( 'error', 'Azione sconosciuta.' );
	}

	private static function when( $ts ) {
		return $ts ? esc_html( wp_date( 'd/m/Y H:i', (int) $ts ) ) : 'mai';
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$conn    = RV_Settings::connection();
		$status  = RV_Settings::status();
		$results = RV_Tasks::results();
		$const   = RV_Settings::from_constant();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$ok  = isset( $_GET['rv_ok'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['rv_ok'] ) ) ) : '';
		$err = isset( $_GET['rv_error'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['rv_error'] ) ) ) : '';
		// phpcs:enable
		?>
		<div class="wrap">
			<h1>Radar Vigilantes</h1>
			<p>Collega questo sito a <strong>Radar</strong> (Delta Solutions): aggiornamenti di core, plugin e temi e stato di sicurezza vengono inviati a Radar, che avvisa quando serve intervenire. Il plugin non modifica nulla sul sito.</p>
			<?php if ( $ok ) : ?>
				<div class="notice notice-success"><p><?php echo esc_html( $ok ); ?></p></div>
			<?php endif; ?>
			<?php if ( $err ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( $err ); ?></p></div>
			<?php endif; ?>

			<h2>Collegamento</h2>
			<?php if ( $conn ) : ?>
				<p>Collegato a <code><?php echo esc_html( $conn['radar_url'] ); ?></code> come sito <code><?php echo esc_html( $conn['site_id'] ); ?></code><?php echo $const ? ' (chiave in wp-config.php)' : ''; ?>.</p>
			<?php else : ?>
				<p>Non collegato. In Radar apri <em>Vigilantes</em>, crea o apri il sito e copia la <strong>chiave di collegamento</strong>.</p>
			<?php endif; ?>
			<?php if ( ! $const ) : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="rv_save" />
					<?php wp_nonce_field( 'rv_save' ); ?>
					<p>
						<label for="rv_key"><strong>Chiave di collegamento</strong></label><br />
						<input type="password" id="rv_key" name="rv_key" class="large-text code" autocomplete="off" placeholder="<?php echo $conn ? 'Lascia vuoto per non cambiarla · incolla una nuova chiave per sostituirla' : 'rv1.…'; ?>" />
					</p>
					<p>
						<?php submit_button( $conn ? 'Sostituisci chiave' : 'Collega a Radar', 'primary', 'submit', false ); ?>
						<?php if ( $conn ) : ?>
							<button type="submit" name="rv_disconnect" value="1" class="button" onclick="return confirm('Scollegare il sito da Radar?');">Scollega</button>
						<?php endif; ?>
					</p>
				</form>
			<?php endif; ?>

			<?php if ( $conn ) : ?>
				<h2>Stato</h2>
				<table class="widefat striped" style="max-width:780px">
					<tbody>
						<tr><td>Ultimo invio a Radar</td><td><?php echo self::when( isset( $status['last_push_at'] ) ? $status['last_push_at'] : 0 ); ?><?php echo ! empty( $status['last_push_error'] ) ? ' — <span style="color:#b32d2e">' . esc_html( $status['last_push_error'] ) . '</span>' : ''; ?></td></tr>
						<tr><td>Ultimo controllo da Radar</td><td><?php echo self::when( isset( $status['last_pull_at'] ) ? $status['last_pull_at'] : 0 ); ?><?php echo ! empty( $status['last_pull_error'] ) ? ' — <span style="color:#b32d2e">rifiutato: ' . esc_html( $status['last_pull_error'] ) . '</span>' : ''; ?></td></tr>
						<tr><td>Integrità del core</td><td><?php echo self::when( isset( $results['integrity']['checked_at'] ) ? $results['integrity']['checked_at'] : 0 ); ?></td></tr>
						<tr><td>PHP in uploads</td><td><?php echo self::when( isset( $results['uploads_php']['checked_at'] ) ? $results['uploads_php']['checked_at'] : 0 ); ?></td></tr>
						<tr><td>Scansione approfondita</td><td><?php echo RV_Settings::deep_scan() ? 'attiva (decisa da Radar)' : 'spenta (si attiva da Radar)'; ?></td></tr>
						<?php if ( RV_Settings::deep_scan() ) : ?>
							<tr><td>Codice sospetto</td><td><?php echo self::when( isset( $results['malware']['checked_at'] ) ? $results['malware']['checked_at'] : 0 ); ?><?php echo RV_Scanner::in_progress() ? ' · ciclo in corso' : ''; ?></td></tr>
							<tr><td>Plugin wordpress.org</td><td><?php echo self::when( isset( $results['plugin_integrity']['checked_at'] ) ? $results['plugin_integrity']['checked_at'] : 0 ); ?></td></tr>
						<?php endif; ?>
					</tbody>
				</table>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:12px">
					<input type="hidden" name="action" value="rv_action" />
					<?php wp_nonce_field( 'rv_action' ); ?>
					<button type="submit" name="rv_do" value="push" class="button button-primary">Invia report ora</button>
					<button type="submit" name="rv_do" value="scan" class="button">Esegui controlli ora</button>
				</form>
				<p class="description">I risultati si consultano in Radar. Radar controlla il sito ogni giorno; il plugin invia un report anche dopo aggiornamenti, attivazioni e nuovi amministratori.</p>
			<?php endif; ?>
		</div>
		<?php
	}
}
