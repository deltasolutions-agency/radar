<?php
/**
 * Disinstallazione: avvisa Radar (chi ha disinstallato), poi rimuove loader,
 * opzioni e pianificazioni del plugin.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Le classi ci sono se il plugin è stato caricato in questa richiesta (loader).
if ( ! class_exists( 'RV_Client' ) && is_readable( __DIR__ . '/radar-vigilantes.php' ) ) {
	include_once __DIR__ . '/radar-vigilantes.php';
}
if ( class_exists( 'RV_Client' ) && class_exists( 'RV_Guard' ) ) {
	RV_Client::push( 'uninstalled', array( array( 'type' => 'uninstalled', 'user' => RV_Guard::current_login() ) ) );
	RV_Guard::remove_loader();
} else {
	$loader = ( defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins' ) . '/radar-vigilantes-loader.php';
	if ( is_file( $loader ) ) {
		@unlink( $loader ); // phpcs:ignore
	}
}

foreach ( array( 'radar_vigilantes_settings', 'radar_vigilantes_status', 'radar_vigilantes_results', 'radar_vigilantes_scan_state', 'radar_vigilantes_pi_state' ) as $opt ) {
	delete_option( $opt );
}
delete_site_transient( 'radar_vigilantes_update_info' );
wp_clear_scheduled_hook( 'radar_vigilantes_daily' );
wp_clear_scheduled_hook( 'radar_vigilantes_push' );
