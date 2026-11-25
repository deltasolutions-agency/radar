<?php
/**
 * Impostazioni del plugin: chiave di collegamento (URL Radar, id sito,
 * secret) e opzioni decise da Radar (scansione approfondita).
 *
 * La chiave può anche essere definita in wp-config.php:
 *   define( 'RADAR_VIGILANTES_KEY', 'rv1.xxxxx' );
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Settings {
	const OPTION = 'radar_vigilantes_settings';
	const STATUS = 'radar_vigilantes_status';

	/** @return array{radar_url:string,site_id:string,secret:string}|null */
	public static function parse_key( $key ) {
		$key = trim( (string) $key );
		if ( ! preg_match( '/^rv1\.([A-Za-z0-9_-]+)$/', $key, $m ) ) {
			return null;
		}
		$b64  = strtr( $m[1], '-_', '+/' );
		$pad  = strlen( $b64 ) % 4;
		$b64 .= $pad ? str_repeat( '=', 4 - $pad ) : '';
		$json = base64_decode( $b64, true );
		if ( false === $json ) {
			return null;
		}
		$v = json_decode( $json, true );
		if ( ! is_array( $v ) || empty( $v['u'] ) || empty( $v['i'] ) || empty( $v['s'] ) ) {
			return null;
		}
		$url = untrailingslashit( esc_url_raw( (string) $v['u'] ) );
		if ( ! $url || ! preg_match( '#^https?://#', $url ) ) {
			return null;
		}
		return array(
			'radar_url' => $url,
			'site_id'   => (string) $v['i'],
			'secret'    => (string) $v['s'],
		);
	}

	public static function from_constant() {
		return defined( 'RADAR_VIGILANTES_KEY' ) && RADAR_VIGILANTES_KEY;
	}

	/** @return array{radar_url:string,site_id:string,secret:string}|null */
	public static function connection() {
		if ( self::from_constant() ) {
			return self::parse_key( RADAR_VIGILANTES_KEY );
		}
		$o = self::all();
		if ( empty( $o['radar_url'] ) || empty( $o['site_id'] ) || empty( $o['secret'] ) ) {
			return null;
		}
		return array(
			'radar_url' => $o['radar_url'],
			'site_id'   => $o['site_id'],
			'secret'    => $o['secret'],
		);
	}

	public static function all() {
		$o = get_option( self::OPTION, array() );
		return is_array( $o ) ? $o : array();
	}

	public static function save_key( $key ) {
		$parsed = self::parse_key( $key );
		if ( ! $parsed ) {
			return false;
		}
		$o = array_merge( self::all(), $parsed );
		update_option( self::OPTION, $o, false );
		return true;
	}

	public static function disconnect() {
		$o = self::all();
		unset( $o['radar_url'], $o['site_id'], $o['secret'] );
		update_option( self::OPTION, $o, false );
	}

	public static function deep_scan() {
		$o = self::all();
		return ! empty( $o['deep_scan'] );
	}

	/** Opzioni ricevute da Radar (pull o risposta al push). */
	public static function apply_remote_options( $options ) {
		if ( ! is_array( $options ) ) {
			return;
		}
		$o = self::all();
		if ( array_key_exists( 'deep_scan', $options ) ) {
			$o['deep_scan'] = (bool) $options['deep_scan'];
		}
		update_option( self::OPTION, $o, false );
	}

	public static function status() {
		$s = get_option( self::STATUS, array() );
		return is_array( $s ) ? $s : array();
	}

	public static function set_status( array $patch ) {
		update_option( self::STATUS, array_merge( self::status(), $patch ), false );
	}
}
