<?php
/**
 * Protezione dalla disattivazione: un piccolo loader in wp-content/mu-plugins
 * carica il plugin anche se viene disattivato dal pannello. La disattivazione
 * e la disinstallazione vengono comunque segnalate subito a Radar.
 * Il plugin resta visibile nella lista: niente è nascosto al cliente.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Guard {
	const LOADER = 'radar-vigilantes-loader.php';

	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'ensure_loader' ) );
		add_filter( 'plugin_row_meta', array( __CLASS__, 'row_meta' ), 10, 2 );
	}

	public static function loader_path() {
		$dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins';
		return wp_normalize_path( $dir . '/' . self::LOADER );
	}

	public static function loader_code() {
		return "<?php\n"
			. "/**\n"
			. " * Plugin Name: Radar Vigilantes (loader)\n"
			. " * Description: Mantiene attivo il monitoraggio Radar Vigilantes gestito da Delta Solutions. Si rimuove disinstallando Radar Vigilantes dalla pagina Plugin.\n"
			. " * Author: Delta Solutions\n"
			. " */\n"
			. "if ( ! defined( 'ABSPATH' ) ) { exit; }\n"
			. "\$rv_main = WP_PLUGIN_DIR . '/radar-vigilantes/radar-vigilantes.php';\n"
			. "if ( ! defined( 'RADAR_VIGILANTES_VERSION' ) && is_readable( \$rv_main ) ) {\n"
			. "\tdefine( 'RADAR_VIGILANTES_VIA_LOADER', true );\n"
			. "\trequire_once \$rv_main;\n"
			. "}\n"
			. "unset( \$rv_main );\n";
	}

	public static function loader_present() {
		return is_readable( self::loader_path() );
	}

	/** Crea (o ricrea) il loader se manca o è diverso. */
	public static function ensure_loader() {
		$path = self::loader_path();
		$code = self::loader_code();
		if ( is_readable( $path ) && (string) @file_get_contents( $path ) === $code ) { // phpcs:ignore
			return true;
		}
		if ( ! RV_Settings::connection() ) {
			return false; // solo per i siti collegati a Radar
		}
		$dir = dirname( $path );
		if ( ! is_dir( $dir ) && ! @mkdir( $dir, 0755, true ) ) { // phpcs:ignore
			return false;
		}
		return false !== @file_put_contents( $path, $code ); // phpcs:ignore
	}

	public static function remove_loader() {
		$path = self::loader_path();
		if ( is_file( $path ) ) {
			@unlink( $path ); // phpcs:ignore
		}
	}

	public static function active_in_admin() {
		$active = (array) get_option( 'active_plugins', array() );
		if ( in_array( RADAR_VIGILANTES_BASENAME, $active, true ) ) {
			return true;
		}
		if ( is_multisite() ) {
			$net = (array) get_site_option( 'active_sitewide_plugins', array() );
			return isset( $net[ RADAR_VIGILANTES_BASENAME ] );
		}
		return false;
	}

	/** Stato per il report a Radar. */
	public static function status() {
		$o = RV_Settings::all();
		return array(
			'loader'          => self::loader_present(),
			'via_loader'      => defined( 'RADAR_VIGILANTES_VIA_LOADER' ),
			'active_in_admin' => self::active_in_admin(),
			'deactivated_by'  => isset( $o['deactivated_by'] ) ? $o['deactivated_by'] : null,
			'deactivated_at'  => isset( $o['deactivated_at'] ) ? (int) $o['deactivated_at'] : null,
		);
	}

	public static function current_login() {
		$u = function_exists( 'wp_get_current_user' ) ? wp_get_current_user() : null;
		return ( $u && ! empty( $u->user_login ) ) ? $u->user_login : 'sconosciuto';
	}

	public static function row_meta( $meta, $file ) {
		if ( RADAR_VIGILANTES_BASENAME === $file ) {
			$meta[] = '<strong>Monitoraggio gestito da Delta Solutions</strong> — previsto dal contratto di manutenzione: non disattivare né rimuovere.';
		}
		return $meta;
	}
}
