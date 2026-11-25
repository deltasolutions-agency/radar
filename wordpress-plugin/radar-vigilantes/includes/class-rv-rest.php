<?php
/**
 * Endpoint interrogato da Radar: POST /radar-vigilantes/v1/status
 * (raggiungibile anche come /?rest_route=/radar-vigilantes/v1/status).
 * Accetta solo richieste firmate con il secret del sito.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Rest {
	const NS    = 'radar-vigilantes/v1';
	const ROUTE = '/radar-vigilantes/v1/status';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register' ) );
		// Alcuni plugin bloccano la REST API ai non autenticati: le richieste
		// firmate da Radar per la nostra rotta passano comunque.
		add_filter( 'rest_authentication_errors', array( __CLASS__, 'allow_signed' ), 999 );
	}

	public static function register() {
		register_rest_route(
			self::NS,
			'/status',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'status' ),
				'permission_callback' => array( __CLASS__, 'permission' ),
			)
		);
	}

	private static function is_our_route() {
		$route = '';
		if ( isset( $_GET['rest_route'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$route = sanitize_text_field( wp_unslash( $_GET['rest_route'] ) ); // phpcs:ignore
		} elseif ( isset( $_SERVER['REQUEST_URI'] ) ) {
			$path   = (string) wp_parse_url( esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ), PHP_URL_PATH ); // phpcs:ignore
			$prefix = '/' . rest_get_url_prefix();
			$pos    = strpos( $path, $prefix . '/' );
			$route  = false === $pos ? '' : substr( $path, $pos + strlen( $prefix ) );
		}
		return untrailingslashit( $route ) === self::ROUTE;
	}

	public static function allow_signed( $result ) {
		if ( ! is_wp_error( $result ) || ! self::is_our_route() ) {
			return $result;
		}
		$conn = RV_Settings::connection();
		if ( ! $conn ) {
			return $result;
		}
		$h = function ( $name ) {
			$key = 'HTTP_' . strtoupper( str_replace( '-', '_', $name ) );
			return isset( $_SERVER[ $key ] ) ? sanitize_text_field( wp_unslash( $_SERVER[ $key ] ) ) : null; // phpcs:ignore
		};
		$body = file_get_contents( 'php://input' ); // phpcs:ignore
		$ok   = RV_Signer::verify( $conn, $h( 'X-Radar-Site' ), $h( 'X-Radar-Timestamp' ), $h( 'X-Radar-Signature' ), 'POST', self::ROUTE, (string) $body );
		return true === $ok ? true : $result;
	}

	public static function permission( WP_REST_Request $request ) {
		$conn = RV_Settings::connection();
		if ( ! $conn ) {
			return new WP_Error( 'rv_not_connected', 'Sito non collegato a Radar', array( 'status' => 401 ) );
		}
		$body = (string) $request->get_body();
		$ok   = RV_Signer::verify(
			$conn,
			$request->get_header( 'x_radar_site' ),
			$request->get_header( 'x_radar_timestamp' ),
			$request->get_header( 'x_radar_signature' ),
			'POST',
			self::ROUTE,
			$body
		);
		if ( true !== $ok ) {
			RV_Settings::set_status( array( 'last_pull_error' => $ok, 'last_pull_error_at' => time() ) );
			return new WP_Error( 'rv_bad_signature', $ok, array( 'status' => 401 ) );
		}
		// Anti-replay: ogni nonce vale una volta sola.
		$data  = json_decode( $body, true );
		$nonce = is_array( $data ) && isset( $data['nonce'] ) ? (string) $data['nonce'] : '';
		if ( '' === $nonce ) {
			return new WP_Error( 'rv_bad_signature', 'nonce mancante', array( 'status' => 401 ) );
		}
		$key = 'rv_nonce_' . md5( $nonce );
		if ( get_transient( $key ) ) {
			return new WP_Error( 'rv_bad_signature', 'richiesta già usata', array( 'status' => 401 ) );
		}
		set_transient( $key, 1, 2 * RV_Signer::TOLERANCE );
		return true;
	}

	public static function status( WP_REST_Request $request ) {
		$data = json_decode( (string) $request->get_body(), true );
		$data = is_array( $data ) ? $data : array();
		if ( isset( $data['options'] ) ) {
			RV_Client::apply_options( $data['options'] );
		}
		RV_Guard::ensure_loader();
		if ( ! empty( $data['refresh'] ) ) {
			RV_Collector::refresh_updates();
		}
		// Controlli scaduti, a tempo limitato: Radar aspetta al massimo 45 s (inclusa la verifica aggiornamenti).
		RV_Tasks::run_due( 12 );
		RV_Settings::set_status( array( 'last_pull_at' => time(), 'last_pull_error' => null ) );

		$response = new WP_REST_Response( array( 'report' => RV_Collector::build() ), 200 );
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'X-LiteSpeed-Cache-Control', 'no-cache' );
		return $response;
	}
}
