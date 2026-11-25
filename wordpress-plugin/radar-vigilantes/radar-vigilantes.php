<?php
/**
 * Plugin Name:       Radar Vigilantes
 * Plugin URI:        https://radar.deltasolutions.agency
 * Description:       Collega il sito a Radar (Delta Solutions): monitora aggiornamenti di core, plugin e temi e lo stato di sicurezza del sito.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Delta Solutions
 * Author URI:        https://deltasolutions.agency
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       radar-vigilantes
 * Update URI:        https://radar.deltasolutions.agency/vigilantes
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RADAR_VIGILANTES_VERSION', '1.0.0' );
define( 'RADAR_VIGILANTES_FILE', __FILE__ );
define( 'RADAR_VIGILANTES_DIR', __DIR__ );
define( 'RADAR_VIGILANTES_BASENAME', plugin_basename( __FILE__ ) );

require_once __DIR__ . '/includes/class-rv-settings.php';
require_once __DIR__ . '/includes/class-rv-signer.php';
require_once __DIR__ . '/includes/class-rv-fs.php';
require_once __DIR__ . '/includes/class-rv-security.php';
require_once __DIR__ . '/includes/class-rv-scanner.php';
require_once __DIR__ . '/includes/class-rv-tasks.php';
require_once __DIR__ . '/includes/class-rv-collector.php';
require_once __DIR__ . '/includes/class-rv-client.php';
require_once __DIR__ . '/includes/class-rv-rest.php';
require_once __DIR__ . '/includes/class-rv-events.php';
require_once __DIR__ . '/includes/class-rv-updater.php';

if ( is_admin() ) {
	require_once __DIR__ . '/includes/class-rv-admin.php';
	RV_Admin::init();
}

RV_Rest::init();
RV_Events::init();
RV_Updater::init();

register_activation_hook( __FILE__, array( 'RV_Events', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'RV_Events', 'deactivate' ) );
