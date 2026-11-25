<?php
/**
 * Disinstallazione: rimuove opzioni e stato del plugin.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'radar_vigilantes_settings', 'radar_vigilantes_status', 'radar_vigilantes_results', 'radar_vigilantes_scan_state', 'radar_vigilantes_pi_state' ) as $opt ) {
	delete_option( $opt );
}
delete_site_transient( 'radar_vigilantes_update_info' );
wp_clear_scheduled_hook( 'radar_vigilantes_daily' );
wp_clear_scheduled_hook( 'radar_vigilantes_push' );
