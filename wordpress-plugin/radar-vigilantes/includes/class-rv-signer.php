<?php
/**
 * Firma HMAC-SHA256 condivisa con Radar (src/lib/vigilantes/protocol.ts):
 *   hex( HMAC( secret, "{ts}\n{METHOD}\n{route}\n{body}" ) ), finestra ±5 minuti.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Signer {
	const TOLERANCE = 300;

	public static function base( $ts, $method, $route, $body ) {
		return $ts . "\n" . strtoupper( $method ) . "\n" . $route . "\n" . $body;
	}

	public static function sign( $secret, $ts, $method, $route, $body ) {
		return hash_hmac( 'sha256', self::base( $ts, $method, $route, $body ), $secret );
	}

	/** Intestazioni per una richiesta verso Radar. */
	public static function headers( array $conn, $method, $route, $body ) {
		$ts = (string) time();
		return array(
			'X-Radar-Site'      => $conn['site_id'],
			'X-Radar-Timestamp' => $ts,
			'X-Radar-Signature' => self::sign( $conn['secret'], $ts, $method, $route, $body ),
		);
	}

	/** @return true|string true se valida, altrimenti il motivo. */
	public static function verify( array $conn, $site, $ts, $signature, $method, $route, $body ) {
		if ( ! $site || ! $ts || ! $signature ) {
			return 'firma mancante';
		}
		if ( ! hash_equals( (string) $conn['site_id'], (string) $site ) ) {
			return 'sito non corrispondente';
		}
		if ( ! preg_match( '/^\d{9,11}$/', (string) $ts ) ) {
			return 'timestamp non valido';
		}
		if ( abs( time() - (int) $ts ) > self::TOLERANCE ) {
			return 'timestamp fuori finestra (orologio del server sfasato?)';
		}
		$expected = self::sign( $conn['secret'], $ts, $method, $route, $body );
		if ( ! hash_equals( $expected, strtolower( (string) $signature ) ) ) {
			return 'firma non valida';
		}
		return true;
	}
}
