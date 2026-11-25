<?php
/**
 * Aggiornamenti del plugin serviti da Radar (non da wordpress.org).
 * L'intestazione "Update URI" fa sì che WordPress chieda a questo filtro.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Updater {
	const HOST      = 'radar.deltasolutions.agency';
	const CACHE     = 'radar_vigilantes_update_info';
	const DEFAULT_RADAR = 'https://radar.deltasolutions.agency';

	public static function init() {
		add_filter( 'update_plugins_' . self::HOST, array( __CLASS__, 'check' ), 10, 3 );
		add_filter( 'plugins_api', array( __CLASS__, 'details' ), 10, 3 );
	}

	private static function radar_url() {
		$conn = RV_Settings::connection();
		return $conn ? $conn['radar_url'] : self::DEFAULT_RADAR;
	}

	/** @return array|null */
	public static function info( $force = false ) {
		$cached = get_site_transient( self::CACHE );
		if ( ! $force && is_array( $cached ) ) {
			return $cached;
		}
		$res = wp_remote_get( self::radar_url() . '/api/vigilantes/plugin/info', array( 'timeout' => 10 ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			set_site_transient( self::CACHE, array(), HOUR_IN_SECONDS ); // non riprovare a ogni pagina
			return null;
		}
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( ! is_array( $data ) || empty( $data['version'] ) || empty( $data['download_url'] ) ) {
			return null;
		}
		set_site_transient( self::CACHE, $data, 6 * HOUR_IN_SECONDS );
		return $data;
	}

	public static function check( $update, $plugin_data, $plugin_file ) {
		if ( RADAR_VIGILANTES_BASENAME !== $plugin_file ) {
			return $update;
		}
		$info = self::info();
		if ( ! $info || empty( $info['version'] ) ) {
			return $update;
		}
		return array(
			'id'           => self::HOST . '/radar-vigilantes',
			'slug'         => 'radar-vigilantes',
			'plugin'       => $plugin_file,
			'version'      => $info['version'],
			'url'          => isset( $info['homepage'] ) ? $info['homepage'] : '',
			'package'      => $info['download_url'],
			'tested'       => isset( $info['tested'] ) ? $info['tested'] : '',
			'requires_php' => isset( $info['requires_php'] ) ? $info['requires_php'] : '',
		);
	}

	public static function details( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || 'radar-vigilantes' !== $args->slug ) {
			return $result;
		}
		$info = self::info();
		if ( ! $info ) {
			return $result;
		}
		return (object) array(
			'name'          => 'Radar Vigilantes',
			'slug'          => 'radar-vigilantes',
			'version'       => $info['version'],
			'author'        => '<a href="https://deltasolutions.agency">Delta Solutions</a>',
			'homepage'      => isset( $info['homepage'] ) ? $info['homepage'] : '',
			'requires'      => isset( $info['requires'] ) ? $info['requires'] : '',
			'requires_php'  => isset( $info['requires_php'] ) ? $info['requires_php'] : '',
			'tested'        => isset( $info['tested'] ) ? $info['tested'] : '',
			'download_link' => $info['download_url'],
			'sections'      => array(
				'description' => 'Collega il sito a Radar (Delta Solutions) per il monitoraggio di aggiornamenti e sicurezza.',
			),
		);
	}
}
