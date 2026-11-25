<?php
/**
 * Costruisce il report inviato a Radar (schema 1, vedi
 * src/lib/vigilantes/protocol.ts → reportSchema).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Collector {
	const SCHEMA = 1;

	/** Forza una nuova verifica degli aggiornamenti se l'ultima è vecchia. */
	public static function refresh_updates( $max_age = 21600 ) {
		require_once ABSPATH . 'wp-includes/update.php';
		// Anche la versione del plugin stesso: Radar può averne pubblicata una nuova.
		delete_site_transient( RV_Updater::CACHE );
		foreach ( array( 'update_plugins' => 'wp_update_plugins', 'update_themes' => 'wp_update_themes' ) as $transient => $fn ) {
			$t = get_site_transient( $transient );
			if ( is_object( $t ) && isset( $t->last_checked ) && time() - (int) $t->last_checked > $max_age ) {
				// Azzerare last_checked (senza cancellare il transient) fa ripartire
				// la verifica senza perdere i dati se wordpress.org non risponde.
				$t->last_checked = 0;
				set_site_transient( $transient, $t );
			}
			if ( function_exists( $fn ) ) {
				$fn();
			}
		}
		$core = get_site_transient( 'update_core' );
		if ( ! is_object( $core ) || ! isset( $core->last_checked ) || time() - (int) $core->last_checked > $max_age ) {
			if ( function_exists( 'wp_version_check' ) ) {
				wp_version_check( array(), true );
			}
		}
	}

	public static function build() {
		global $wp_version, $wpdb;
		require_once ABSPATH . 'wp-admin/includes/update.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		// Core
		$core_update = null;
		$updates     = get_core_updates( array( 'dismissed' => true ) );
		if ( is_array( $updates ) ) {
			foreach ( $updates as $u ) {
				if ( isset( $u->response ) && 'upgrade' === $u->response && version_compare( $u->current, $wp_version, '>' ) ) {
					$core_update = array( 'version' => $u->current, 'locale' => isset( $u->locale ) ? $u->locale : null );
					break;
				}
			}
		}

		// Plugin
		$plugin_updates = get_site_transient( 'update_plugins' );
		$plugin_resp    = is_object( $plugin_updates ) && isset( $plugin_updates->response ) ? (array) $plugin_updates->response : array();
		$auto_plugins   = (array) get_site_option( 'auto_update_plugins', array() );
		$network_active = is_multisite() ? (array) get_site_option( 'active_sitewide_plugins', array() ) : array();
		$plugins        = array();
		foreach ( get_plugins() as $file => $p ) {
			$u         = isset( $plugin_resp[ $file ] ) ? (object) $plugin_resp[ $file ] : null;
			$plugins[] = array(
				'slug'           => $file,
				'name'           => wp_strip_all_tags( $p['Name'] ),
				'version'        => $p['Version'] ? $p['Version'] : null,
				'active'         => is_plugin_active( $file ),
				'network_active' => isset( $network_active[ $file ] ),
				'auto_update'    => in_array( $file, $auto_plugins, true ),
				'author'         => wp_strip_all_tags( $p['Author'] ),
				'update'         => ( $u && ! empty( $u->new_version ) && version_compare( $u->new_version, $p['Version'], '>' ) ) ? array(
					'version'      => (string) $u->new_version,
					'requires_php' => isset( $u->requires_php ) ? $u->requires_php : null,
					'tested'       => isset( $u->tested ) ? $u->tested : null,
				) : null,
			);
		}
		if ( function_exists( 'get_mu_plugins' ) ) {
			foreach ( get_mu_plugins() as $file => $p ) {
				$plugins[] = array(
					'slug'    => 'mu:' . $file,
					'name'    => wp_strip_all_tags( $p['Name'] ? $p['Name'] : $file ) . ' (MU)',
					'version' => $p['Version'] ? $p['Version'] : null,
					'active'  => true,
					'update'  => null,
				);
			}
		}

		// Temi
		$theme_updates = get_site_transient( 'update_themes' );
		$theme_resp    = is_object( $theme_updates ) && isset( $theme_updates->response ) ? (array) $theme_updates->response : array();
		$auto_themes   = (array) get_site_option( 'auto_update_themes', array() );
		$active        = get_stylesheet();
		$parent        = get_template();
		$themes        = array();
		foreach ( wp_get_themes() as $slug => $t ) {
			$u        = isset( $theme_resp[ $slug ] ) ? (array) $theme_resp[ $slug ] : null;
			$themes[] = array(
				'slug'        => $slug,
				'name'        => wp_strip_all_tags( $t->get( 'Name' ) ),
				'version'     => $t->get( 'Version' ) ? $t->get( 'Version' ) : null,
				'active'      => $slug === $active || $slug === $parent,
				'parent'      => $t->parent() ? $t->get_template() : null,
				'auto_update' => in_array( $slug, $auto_themes, true ),
				'update'      => ( $u && ! empty( $u['new_version'] ) && version_compare( $u['new_version'], (string) $t->get( 'Version' ), '>' ) ) ? array( 'version' => (string) $u['new_version'] ) : null,
			);
		}

		// Amministratori
		$admins = array();
		$users  = get_users(
			array(
				'role'   => 'administrator',
				'fields' => array( 'ID', 'user_login', 'user_email', 'user_registered' ),
				'number' => 200,
			)
		);
		if ( is_multisite() ) {
			foreach ( get_super_admins() as $login ) {
				$u = get_user_by( 'login', $login );
				if ( $u ) {
					$users[] = $u;
				}
			}
		}
		$seen = array();
		foreach ( $users as $u ) {
			if ( isset( $seen[ $u->user_login ] ) ) {
				continue;
			}
			$seen[ $u->user_login ] = true;
			$admins[]               = array(
				'id'         => (int) $u->ID,
				'login'      => $u->user_login,
				'email'      => $u->user_email,
				'registered' => $u->user_registered,
			);
		}

		// Traduzioni
		$translations = function_exists( 'wp_get_translation_updates' ) ? count( wp_get_translation_updates() ) : 0;

		// Sicurezza (risultati in cache dei controlli periodici)
		$results  = RV_Tasks::results();
		$security = array(
			'integrity'   => isset( $results['integrity'] ) ? $results['integrity'] : null,
			'uploads_php' => isset( $results['uploads_php'] ) ? $results['uploads_php'] : null,
		);
		if ( RV_Settings::deep_scan() ) {
			$security['plugin_integrity'] = isset( $results['plugin_integrity'] ) ? $results['plugin_integrity'] : null;
			$mw                           = isset( $results['malware'] ) ? $results['malware'] : array( 'checked_at' => null, 'findings' => array() );
			$mw['complete']               = ! RV_Scanner::in_progress() && ! empty( $mw['checked_at'] );
			$mw['progress']               = RV_Scanner::progress();
			$security['malware']          = $mw;
		}
		$security = array_filter(
			$security,
			function ( $v ) {
				return null !== $v;
			}
		);

		$debug = defined( 'WP_DEBUG' ) && WP_DEBUG;
		return array(
			'schema'               => self::SCHEMA,
			'plugin_version'       => RADAR_VIGILANTES_VERSION,
			'generated_at'         => time(),
			'site'                 => array(
				'home_url'  => home_url(),
				'site_url'  => site_url(),
				'name'      => get_bloginfo( 'name' ),
				'multisite' => is_multisite(),
				'locale'    => get_locale(),
				'timezone'  => wp_timezone_string(),
			),
			'core'                 => array(
				'version' => $wp_version,
				'update'  => $core_update,
			),
			'env'                  => array(
				'php'                => PHP_VERSION,
				'mysql'              => method_exists( $wpdb, 'db_server_info' ) ? $wpdb->db_server_info() : null,
				'server'             => isset( $_SERVER['SERVER_SOFTWARE'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ), 0, 100 ) : null,
				'https'              => 0 === strpos( home_url(), 'https://' ),
				'debug'              => $debug,
				'debug_display'      => $debug && ( ! defined( 'WP_DEBUG_DISPLAY' ) || WP_DEBUG_DISPLAY ),
				'memory_limit'       => defined( 'WP_MEMORY_LIMIT' ) ? WP_MEMORY_LIMIT : null,
				'disallow_file_edit' => defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT,
				'disallow_file_mods' => defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS,
				'wp_cron_disabled'   => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
				'auto_update_core'   => self::core_auto_update_mode(),
			),
			'plugins'              => $plugins,
			'themes'               => $themes,
			'translations_updates' => $translations,
			'admins'               => $admins,
			'agent'                => RV_Guard::status(),
			'security'             => (object) $security,
		);
	}

	private static function core_auto_update_mode() {
		if ( defined( 'AUTOMATIC_UPDATER_DISABLED' ) && AUTOMATIC_UPDATER_DISABLED ) {
			return 'disabled';
		}
		if ( defined( 'WP_AUTO_UPDATE_CORE' ) ) {
			$v = WP_AUTO_UPDATE_CORE;
			if ( true === $v ) {
				return 'major';
			}
			if ( false === $v ) {
				return 'disabled';
			}
			return (string) $v;
		}
		return 'enabled' === get_site_option( 'auto_update_core_major' ) ? 'major' : 'minor';
	}
}
